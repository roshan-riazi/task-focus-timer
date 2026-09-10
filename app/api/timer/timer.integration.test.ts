import { afterEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createCancelTimerHandler,
  createCompleteTimerHandler,
  createCurrentTimerHandler,
  createPauseTimerHandler,
  createResumeTimerHandler,
  createSkipBreakTimerHandler,
  createStartTimerHandler,
  type TimerHandlerDeps,
} from "@/lib/timer/handlers";
import { createPrismaTimerStore } from "@/lib/timer/prisma-store";
import { createTimerService, type TimerService } from "@/lib/timer/service";
import type { AppSession } from "@/lib/auth/session";

const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const describeIfDb = hasDatabaseUrl ? describe : describe.skip;

const APP_URL = "http://localhost:3000";

/**
 * Issue 10 acceptance against live Postgres (TEST_STRATEGY §2, API level):
 *
 * - Start on a selected task → exactly one running row with planned
 *   duration + expected end from saved settings; second start (running or
 *   paused) → 409 ACTIVE_TIMER_EXISTS with still one active row.
 * - Pause + clock travel (via timestamp backdating — TEST_STRATEGY forbids
 *   real 5-minute waits) → remainder frozen, actual duration excludes the
 *   gap on resume + finalize.
 * - Complete early → completed minutes counted, cycle NOT incremented;
 *   complete at/after expiry → bounded minutes, cycle +1.
 * - Double-complete (same Idempotency-Key, concurrent) → finalized once,
 *   one cycle bump max; different key after finalize → 409
 *   ALREADY_FINALIZED; finalize with no history → 409 NO_ACTIVE_TIMER.
 * - Skip-break: focus → 409; long break → cycle reset.
 * - Per-user scoping, both directions; unauthenticated → 401.
 */
describeIfDb(
  "timer API (live Postgres)",
  () => {
    let db: PrismaClient;
    let service: TimerService;
    const createdUserIds: string[] = [];

    async function setup(): Promise<void> {
      const mod = await import("@/lib/db");
      db = mod.db;
      service = createTimerService({
        now: () => new Date(),
        store: createPrismaTimerStore(db),
      });
    }

    let ready: Promise<void> | null = null;
    async function ensureReady(): Promise<void> {
      ready ??= setup();
      await ready;
    }

    function email(prefix: string): string {
      return `${prefix}-${crypto.randomUUID()}@example.com`;
    }

    async function makeUser(
      prefix: string,
      settings?: { focusDurationSeconds?: number },
    ): Promise<{ id: string; email: string }> {
      const address = email(prefix);
      const user = await db.user.create({ data: { email: address } });
      if (settings) {
        await db.userSettings.create({
          data: { userId: user.id, ...settings },
        });
      }
      createdUserIds.push(user.id);
      return { id: user.id, email: address };
    }

    async function makeTask(
      userId: string,
      title = "Write report",
    ): Promise<string> {
      const task = await db.task.create({
        data: { userId, title, category: "work", position: 1000 },
      });
      return task.id;
    }

    function depsFor(userId: string, userEmail: string): TimerHandlerDeps {
      const session: AppSession = {
        user: { id: userId, email: userEmail, emailVerified: null, timezone: "UTC" },
        expires: new Date("2030-10-09T12:00:00.000Z").toISOString(),
      };
      return {
        getService: async () => service,
        getSession: async () => session,
        appUrl: APP_URL,
      };
    }

    function startReq(body: unknown): Request {
      return new Request(`${APP_URL}/api/timer/start`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: APP_URL },
        body: JSON.stringify(body),
      });
    }

    function actionReq(path: string, key?: string): Request {
      return new Request(`${APP_URL}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: APP_URL,
          ...(key !== undefined ? { "idempotency-key": key } : {}),
        },
      });
    }

    function currentReq(): Request {
      return new Request(`${APP_URL}/api/timer/current`, { method: "GET" });
    }

    type SessionBody = {
      id: string;
      intervalType: string;
      status: string;
      plannedDurationSeconds: number;
      actualDurationSeconds: number | null;
      startedAt: string;
      expectedEndAt: string;
      pausedAt: string | null;
      accumulatedPauseSeconds: number;
      taskId: string | null;
      taskTitleSnapshot: string | null;
      categorySnapshot: string | null;
    };

    async function start(
      deps: TimerHandlerDeps,
      body: unknown,
    ): Promise<{ status: number; session?: SessionBody; raw: Response; data: { session?: SessionBody; error?: { code: string } } }> {
      const raw = await createStartTimerHandler(deps)(startReq(body));
      const data = (await raw.json()) as { session?: SessionBody; error?: { code: string } };
      return { status: raw.status, session: data.session, raw, data };
    }

    async function activeCount(userId: string): Promise<number> {
      return db.timerSession.count({
        where: { userId, status: { in: ["running", "paused"] } },
      });
    }

    async function cycleCount(userId: string): Promise<number> {
      const row = await db.focusCycleState.findUnique({
        where: { userId },
      });
      return row?.completedFocusCount ?? 0;
    }

    /** Move the active interval's start back `secondsAgo`, keeping the plan. */
    async function backdateStart(userId: string, secondsAgo: number): Promise<void> {
      const active = await db.timerSession.findFirst({
        where: { userId, status: { in: ["running", "paused"] } },
      });
      if (!active) throw new Error("test: no active session to backdate");
      const startedAt = new Date(Date.now() - secondsAgo * 1000);
      await db.timerSession.update({
        where: { id: active.id },
        data: {
          startedAt,
          expectedEndAt: new Date(
            startedAt.getTime() + active.plannedDurationSeconds * 1000,
          ),
        },
      });
    }

    afterEach(async () => {
      if (db) {
        // Users cascade to settings, tasks, sessions, cycle state, and
        // idempotency keys.
        await db.user.deleteMany({
          where: { id: { in: createdUserIds.splice(0) } },
        });
      }
    });

    it("starts one running session on the selected task with settings-derived plan", async () => {
      await ensureReady();
      const user = await makeUser("timer-start");
      const userDeps = depsFor(user.id, user.email);
      const taskId = await makeTask(user.id);

      const created = await start(userDeps, {
        intervalType: "focus",
        taskId,
      });
      expect(created.status).toBe(201);
      expect(created.session).toMatchObject({
        intervalType: "focus",
        status: "running",
        plannedDurationSeconds: 1500,
        taskId,
      });
      const planned = created.session!.plannedDurationSeconds;
      const span =
        Date.parse(created.session!.expectedEndAt) -
        Date.parse(created.session!.startedAt);
      expect(span).toBe(planned * 1000);

      // Current restores the same interval (the refresh story: remaining
      // time derives from authoritative timestamps).
      const current = await createCurrentTimerHandler(userDeps)(currentReq());
      expect(current.status).toBe(200);
      const currentBody = (await current.json()) as { session: SessionBody };
      expect(currentBody.session.id).toBe(created.session!.id);
      expect(await activeCount(user.id)).toBe(1);
    });

    it("reads planned durations from saved settings at start", async () => {
      await ensureReady();
      const user = await makeUser("timer-settings-plan", {
        focusDurationSeconds: 60,
      });
      const userDeps = depsFor(user.id, user.email);
      const created = await start(userDeps, { intervalType: "focus" });
      expect(created.status).toBe(201);
      expect(created.session!.plannedDurationSeconds).toBe(60);
    });

    it("rejects a second start while running or paused with ACTIVE_TIMER_EXISTS", async () => {
      await ensureReady();
      const user = await makeUser("timer-double-start");
      const userDeps = depsFor(user.id, user.email);

      expect((await start(userDeps, { intervalType: "focus" })).status).toBe(
        201,
      );
      const second = await start(userDeps, { intervalType: "short_break" });
      expect(second.status).toBe(409);
      expect(second.data.error?.code).toBe("ACTIVE_TIMER_EXISTS");

      await createPauseTimerHandler(userDeps)(actionReq("/api/timer/pause"));
      const whilePaused = await start(userDeps, { intervalType: "focus" });
      expect(whilePaused.status).toBe(409);
      expect(await activeCount(user.id)).toBe(1);
    });

    it("pauses, freezes accrual across travel, and excludes the gap on finalize", async () => {
      await ensureReady();
      const user = await makeUser("timer-pause-math");
      const userDeps = depsFor(user.id, user.email);
      await start(userDeps, { intervalType: "focus" });

      // 100s of focus, then pause.
      await backdateStart(user.id, 100);
      const paused = await createPauseTimerHandler(userDeps)(
        actionReq("/api/timer/pause"),
      );
      expect(paused.status).toBe(200);
      const pausedBody = (await paused.json()) as { session: SessionBody };
      expect(pausedBody.session.status).toBe("paused");
      expect(pausedBody.session.pausedAt).not.toBeNull();
      const frozenEnd = pausedBody.session.expectedEndAt;

      // Five minutes pass while paused: travel the pause stamp back.
      const active = await db.timerSession.findFirst({
        where: { userId: user.id },
      });
      await db.timerSession.update({
        where: { id: active!.id },
        data: { pausedAt: new Date(Date.now() - 300 * 1000) },
      });
      const resumed = await createResumeTimerHandler(userDeps)(
        actionReq("/api/timer/resume"),
      );
      expect(resumed.status).toBe(200);
      const resumedBody = (await resumed.json()) as { session: SessionBody };
      expect(resumedBody.session).toMatchObject({
        status: "running",
        pausedAt: null,
        accumulatedPauseSeconds: 300,
      });
      // The expected end shifted forward by exactly the gap.
      expect(
        Date.parse(resumedBody.session.expectedEndAt) - Date.parse(frozenEnd),
      ).toBe(300 * 1000);

      // Travel 200s past resume, then complete: 100 + 200 = 300s of focus.
      await backdateStart(user.id, 100 + 300 + 200);
      // Re-apply the accumulated pause (backdateStart rewrites stamps only).
      await db.timerSession.updateMany({
        where: { userId: user.id },
        data: { accumulatedPauseSeconds: 300 },
      });
      const done = await createCompleteTimerHandler(userDeps)(
        actionReq("/api/timer/complete"),
      );
      expect(done.status).toBe(200);
      const doneBody = (await done.json()) as { session: SessionBody };
      // Gap excluded (within a few seconds of wall-clock slop between the
      // backdate and the finalize).
      expect(doneBody.session.actualDurationSeconds).toBeGreaterThanOrEqual(
        295,
      );
      expect(doneBody.session.actualDurationSeconds).toBeLessThanOrEqual(305);
      expect(await cycleCount(user.id)).toBe(0);
    });

    it("completes early with minutes but no cycle bump; completes at expiry with one bump", async () => {
      await ensureReady();
      const user = await makeUser("timer-early-full");
      const userDeps = depsFor(user.id, user.email);

      await start(userDeps, { intervalType: "focus" });
      await backdateStart(user.id, 600);
      const early = await createCompleteTimerHandler(userDeps)(
        actionReq("/api/timer/complete"),
      );
      expect(early.status).toBe(200);
      const earlyBody = (await early.json()) as { session: SessionBody };
      expect(earlyBody.session.status).toBe("completed");
      expect(earlyBody.session.actualDurationSeconds).toBeGreaterThanOrEqual(
        595,
      );
      expect(earlyBody.session.actualDurationSeconds).toBeLessThanOrEqual(605);
      expect(await cycleCount(user.id)).toBe(0);

      // Full expiry: start past the plan, complete caps at the plan + bumps once.
      await start(userDeps, { intervalType: "focus" });
      await backdateStart(user.id, 1600);
      const full = await createCompleteTimerHandler(userDeps)(
        actionReq("/api/timer/complete"),
      );
      expect(full.status).toBe(200);
      const fullBody = (await full.json()) as { session: SessionBody };
      expect(fullBody.session.actualDurationSeconds).toBe(1500);
      expect(await cycleCount(user.id)).toBe(1);
    });

    it("finalizes concurrent same-key completes once with one cycle bump", async () => {
      await ensureReady();
      const user = await makeUser("timer-concurrent");
      const userDeps = depsFor(user.id, user.email);
      await start(userDeps, { intervalType: "focus" });
      await backdateStart(user.id, 1600);

      const [first, second] = await Promise.all([
        createCompleteTimerHandler(userDeps)(
          actionReq("/api/timer/complete", "concurrent-key"),
        ),
        createCompleteTimerHandler(userDeps)(
          actionReq("/api/timer/complete", "concurrent-key"),
        ),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = (await first.json()) as { session: SessionBody };
      const secondBody = (await second.json()) as { session: SessionBody };
      expect(secondBody.session.id).toBe(firstBody.session.id);
      expect(
        await db.timerSession.count({ where: { userId: user.id } }),
      ).toBe(1);
      expect(await cycleCount(user.id)).toBe(1);
    });

    it("conflicts with ALREADY_FINALIZED on a different key, NO_ACTIVE_TIMER with no history", async () => {
      await ensureReady();
      const fresh = await makeUser("timer-no-history");
      const freshDeps = depsFor(fresh.id, fresh.email);
      const missing = await createCompleteTimerHandler(freshDeps)(
        actionReq("/api/timer/complete"),
      );
      expect(missing.status).toBe(409);
      expect(
        ((await missing.json()) as { error: { code: string } }).error.code,
      ).toBe("NO_ACTIVE_TIMER");

      const user = await makeUser("timer-finalized");
      const userDeps = depsFor(user.id, user.email);
      await start(userDeps, { intervalType: "focus" });
      expect(
        (
          await createCompleteTimerHandler(userDeps)(
            actionReq("/api/timer/complete", "key-1"),
          )
        ).status,
      ).toBe(200);
      const again = await createCompleteTimerHandler(userDeps)(
        actionReq("/api/timer/complete", "key-2"),
      );
      expect(again.status).toBe(409);
      expect(
        ((await again.json()) as { error: { code: string } }).error.code,
      ).toBe("ALREADY_FINALIZED");
      // Same-key replay still succeeds after finalization.
      const replay = await createCompleteTimerHandler(userDeps)(
        actionReq("/api/timer/complete", "key-1"),
      );
      expect(replay.status).toBe(200);
    });

    it("cancels without cycle movement and snapshots the task on finalize", async () => {
      await ensureReady();
      const user = await makeUser("timer-cancel-snap");
      const userDeps = depsFor(user.id, user.email);
      const taskId = await makeTask(user.id, "Trip");
      await start(userDeps, { intervalType: "focus", taskId });
      await backdateStart(user.id, 1600);

      const cancelled = await createCancelTimerHandler(userDeps)(
        actionReq("/api/timer/cancel"),
      );
      expect(cancelled.status).toBe(200);
      const body = (await cancelled.json()) as { session: SessionBody };
      expect(body.session).toMatchObject({
        status: "cancelled",
        taskTitleSnapshot: "Trip",
        categorySnapshot: "work",
      });
      expect(await cycleCount(user.id)).toBe(0);
    });

    it("resets the cycle on long-break complete and long-break skip, never on focus-cancel", async () => {
      await ensureReady();
      const user = await makeUser("timer-cycle-reset");
      const userDeps = depsFor(user.id, user.email);
      await db.focusCycleState.create({
        data: { userId: user.id, completedFocusCount: 3 },
      });

      await start(userDeps, { intervalType: "long_break" });
      const done = await createCompleteTimerHandler(userDeps)(
        actionReq("/api/timer/complete"),
      );
      expect(done.status).toBe(200);
      expect(await cycleCount(user.id)).toBe(0);

      await db.focusCycleState.update({
        where: { userId: user.id },
        data: { completedFocusCount: 3 },
      });
      await start(userDeps, { intervalType: "long_break" });
      const skipped = await createSkipBreakTimerHandler(userDeps)(
        actionReq("/api/timer/skip-break"),
      );
      expect(skipped.status).toBe(200);
      expect(
        ((await skipped.json()) as { session: SessionBody }).session.status,
      ).toBe("cancelled");
      expect(await cycleCount(user.id)).toBe(0);

      // Skipping a focus interval is not a break action.
      await start(userDeps, { intervalType: "focus" });
      const notABreak = await createSkipBreakTimerHandler(userDeps)(
        actionReq("/api/timer/skip-break"),
      );
      expect(notABreak.status).toBe(409);
      expect(
        ((await notABreak.json()) as { error: { code: string } }).error.code,
      ).toBe("INVALID_TRANSITION");
    });

    it("rejects illegal pause/resume moves with 409", async () => {
      await ensureReady();
      const user = await makeUser("timer-moves");
      const userDeps = depsFor(user.id, user.email);

      expect(
        (await createPauseTimerHandler(userDeps)(actionReq("/api/timer/pause")))
          .status,
      ).toBe(409);
      await start(userDeps, { intervalType: "focus" });
      expect(
        (
          await createResumeTimerHandler(userDeps)(
            actionReq("/api/timer/resume"),
          )
        ).status,
      ).toBe(409);
      expect(
        (await createPauseTimerHandler(userDeps)(actionReq("/api/timer/pause")))
          .status,
      ).toBe(200);
      expect(
        (await createPauseTimerHandler(userDeps)(actionReq("/api/timer/pause")))
          .status,
      ).toBe(409);
    });

    it("validates input bodies and idempotency keys with 400s", async () => {
      await ensureReady();
      const user = await makeUser("timer-validation");
      const userDeps = depsFor(user.id, user.email);

      expect((await start(userDeps, { intervalType: "nap" })).status).toBe(
        400,
      );
      expect((await start(userDeps, {})).status).toBe(400);
      expect(
        (await start(userDeps, { intervalType: "focus", taskId: "nope" }))
          .status,
      ).toBe(400);
      expect(
        (await start(userDeps, { intervalType: "focus", taskId: crypto.randomUUID() }))
          .status,
      ).toBe(404);

      await start(userDeps, { intervalType: "focus" });
      expect(
        (
          await createCompleteTimerHandler(userDeps)(
            actionReq("/api/timer/complete", "x".repeat(129)),
          )
        ).status,
      ).toBe(400);
    });

    it("isolates timers by user, both directions", async () => {
      await ensureReady();
      const a = await makeUser("timer-scope-a");
      const b = await makeUser("timer-scope-b");
      const depsA = depsFor(a.id, a.email);
      const depsB = depsFor(b.id, b.email);

      await start(depsA, { intervalType: "focus" });

      // B sees nothing of A's: idle current, and B's own lifecycle is
      // independent (mutations scope to B's rows only).
      const currentB = (await (
        await createCurrentTimerHandler(depsB)(currentReq())
      ).json()) as { session: null };
      expect(currentB.session).toBeNull();
      expect(
        (await createPauseTimerHandler(depsB)(actionReq("/api/timer/pause")))
          .status,
      ).toBe(409);
      expect(
        (await start(depsB, { intervalType: "short_break" })).status,
      ).toBe(201);

      // A's interval survived B's probes untouched.
      const currentA = (await (
        await createCurrentTimerHandler(depsA)(currentReq())
      ).json()) as { session: SessionBody };
      expect(currentA.session.intervalType).toBe("focus");
      expect(await activeCount(a.id)).toBe(1);
      expect(await activeCount(b.id)).toBe(1);
    });

    it("requires a session on every route", async () => {
      await ensureReady();
      const signedOut: TimerHandlerDeps = {
        getService: async () => service,
        getSession: async () => null,
        appUrl: APP_URL,
      };
      expect(
        (await createCurrentTimerHandler(signedOut)(currentReq())).status,
      ).toBe(401);
      expect((await start(signedOut, { intervalType: "focus" })).status).toBe(
        401,
      );
      expect(
        (
          await createCompleteTimerHandler(signedOut)(
            actionReq("/api/timer/complete"),
          )
        ).status,
      ).toBe(401);
    });
  },
  60_000,
);
