import { describe, expect, it, vi } from "vitest";
import {
  HistoryServiceError,
  createHistoryService,
  decodeCursor,
  encodeCursor,
  getLocalDateParts,
  periodStartUtc,
  toPublicHistorySession,
  type HistoryRow,
  type HistoryStore,
} from "./service";

/**
 * Seam 2 (unit, hermetic): period math, cursor pagination, and list
 * orchestration over an in-memory fake store — no Prisma, no Next.js.
 * Live-DB coverage of the same contract (filters, keyset stability,
 * snapshot legibility, scoping) lands in
 * app/api/sessions/sessions.integration.test.ts.
 */

const USER = "user-1";

function row(overrides: Partial<HistoryRow> = {}): HistoryRow {
  const startedAt = overrides.startedAt ?? new Date("2026-09-10T10:00:00.000Z");
  return {
    id: crypto.randomUUID(),
    userId: USER,
    taskId: null,
    taskTitleSnapshot: null,
    categorySnapshot: null,
    intervalType: "focus",
    status: "completed",
    plannedDurationSeconds: 1500,
    actualDurationSeconds: 1500,
    startedAt,
    expectedEndAt: new Date(startedAt.getTime() + 1500_000),
    completedAt: new Date(startedAt.getTime() + 1500_000),
    cancelledAt: null,
    ...overrides,
  };
}

function fakeStore(opts: {
  timezone?: string;
  rows?: HistoryRow[];
} = {}): HistoryStore & {
  calls: { timezoneFor: string[]; list: { userId: string; filter: unknown }[] };
} {
  const record = {
    timezoneFor: [] as string[],
    list: [] as { userId: string; filter: unknown }[],
  };
  return {
    calls: record,
    async getTimezone(userId: string): Promise<string> {
      record.timezoneFor.push(userId);
      return opts.timezone ?? "UTC";
    },
    async listSessions(userId: string, filter: never): Promise<HistoryRow[]> {
      record.list.push({ userId, filter });
      return opts.rows ?? [];
    },
  } as unknown as HistoryStore & {
    calls: { timezoneFor: string[]; list: { userId: string; filter: unknown }[] };
  };
}

describe("periodStartUtc (pure timezone math)", () => {
  const noon = new Date("2026-01-15T12:00:00.000Z");

  it("resolves Today/7d/30d in UTC", () => {
    expect(periodStartUtc(noon, "UTC", "today").toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
    expect(periodStartUtc(noon, "UTC", "7d").toISOString()).toBe(
      "2026-01-09T00:00:00.000Z",
    );
    expect(periodStartUtc(noon, "UTC", "30d").toISOString()).toBe(
      "2025-12-17T00:00:00.000Z",
    );
  });

  it("resolves local midnight in winter and summer Berlin", () => {
    expect(
      periodStartUtc(noon, "Europe/Berlin", "today").toISOString(),
    ).toBe("2026-01-14T23:00:00.000Z");
    expect(
      periodStartUtc(new Date("2026-07-15T12:00:00.000Z"), "Europe/Berlin", "today").toISOString(),
    ).toBe("2026-07-14T22:00:00.000Z");
    expect(periodStartUtc(noon, "Europe/Berlin", "7d").toISOString()).toBe(
      "2026-01-08T23:00:00.000Z",
    );
  });

  it("lands spring-forward midnight in the pre-transition offset", () => {
    // 2026-03-29 02:00 CET -> 03:00 CEST; midnight itself is still CET (+1).
    expect(
      periodStartUtc(new Date("2026-03-29T12:00:00.000Z"), "Europe/Berlin", "today").toISOString(),
    ).toBe("2026-03-28T23:00:00.000Z");
  });

  it("spans the spring-forward gap by calendar days, not 24h multiples", () => {
    // Monday after the change: local Mar 30 minus 6 = Mar 24 (CET midnight).
    // A naive today-start-minus-144h would answer 22:00Z; the calendar answers 23:00Z.
    expect(
      periodStartUtc(new Date("2026-03-30T12:00:00.000Z"), "Europe/Berlin", "7d").toISOString(),
    ).toBe("2026-03-23T23:00:00.000Z");
  });

  it("lands fall-back midnight in the pre-transition offset", () => {
    // 2026-10-25 03:00 CEST -> 02:00 CET; midnight itself is still CEST (+2).
    expect(
      periodStartUtc(new Date("2026-10-25T12:00:00.000Z"), "Europe/Berlin", "today").toISOString(),
    ).toBe("2026-10-24T22:00:00.000Z");
  });

  it("spans the fall-back overlap by calendar days, not 24h multiples", () => {
    // Monday after the change: local Oct 26 minus 6 = Oct 20 (CEST midnight).
    expect(
      periodStartUtc(new Date("2026-10-26T12:00:00.000Z"), "Europe/Berlin", "7d").toISOString(),
    ).toBe("2026-10-19T22:00:00.000Z");
  });

  it("resolves dates past the date line (UTC+14)", () => {
    expect(getLocalDateParts(noon, "Pacific/Kiritimati")).toEqual({
      year: 2026,
      month: 1,
      day: 16,
    });
    expect(periodStartUtc(noon, "Pacific/Kiritimati", "today").toISOString()).toBe(
      "2026-01-15T10:00:00.000Z",
    );
  });

  it("falls back to UTC on an invalid zone instead of throwing", () => {
    expect(periodStartUtc(noon, "Not/AZone", "today").toISOString()).toBe(
      "2026-01-15T00:00:00.000Z",
    );
  });
});

describe("history cursors", () => {
  it("round-trips (startedAt, id) and carries no session content", () => {
    const id = crypto.randomUUID();
    const startedAt = new Date("2026-09-10T10:00:00.000Z");
    const token = encodeCursor({ startedAt, id });
    expect(token).not.toContain("focus");
    const decoded = decodeCursor(token);
    expect(decoded.id).toBe(id);
    expect(decoded.startedAt.toISOString()).toBe(startedAt.toISOString());
    const payload = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(payload).sort()).toEqual(["i", "s"]);
  });

  it("rejects forged cursors as 400s, never 500s", () => {
    for (const token of [
      "bogus",
      Buffer.from(JSON.stringify({ nope: 1 }), "utf8").toString("base64url"),
      Buffer.from(JSON.stringify({ s: "not-a-date", i: crypto.randomUUID() }), "utf8").toString(
        "base64url",
      ),
      Buffer.from(JSON.stringify({ s: "2026-09-10T10:00:00.000Z", i: "nope" }), "utf8").toString(
        "base64url",
      ),
    ]) {
      try {
        decodeCursor(token);
        expect.unreachable(`cursor should reject: ${token}`);
      } catch (error) {
        expect(error).toBeInstanceOf(HistoryServiceError);
        expect((error as HistoryServiceError).code).toBe("VALIDATION_ERROR");
      }
    }
  });
});

describe("history list orchestration", () => {
  const NOW = new Date("2026-09-10T12:00:00.000Z");

  function serviceWith(store: HistoryStore) {
    return createHistoryService({ now: () => NOW, store });
  }

  it("asks the store for the rolling-week window with take = limit + 1", async () => {
    const store = fakeStore({ rows: [] });
    const service = serviceWith(store);
    const result = await service.list(USER, {});
    expect(result).toEqual({ sessions: [], nextCursor: null });
    expect(store.calls.timezoneFor).toEqual([USER]);
    expect(store.calls.list).toHaveLength(1);
    const call = store.calls.list[0];
    expect(call.userId).toBe(USER);
    const filter = call.filter as {
      from: Date;
      to: Date;
      intervalTypes: null;
      take: number;
      cursor?: unknown;
    };
    expect(filter.from.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    // The window is closed above at now: future-dated rows never leak in.
    expect(filter.to).toEqual(NOW);
    expect(filter.intervalTypes).toBeNull();
    expect(filter.take).toBe(21);
    expect(filter).not.toHaveProperty("cursor");
  });

  it("maps focus-only to a single interval type and honors period + limit", async () => {
    const store = fakeStore({ timezone: "Europe/Berlin", rows: [] });
    const service = serviceWith(store);
    await service.list(USER, { period: "today", type: "focus", limit: 5 });
    const filter = store.calls.list[0].filter as {
      from: Date;
      intervalTypes: string[];
      take: number;
    };
    // Sep 10 Berlin (CEST): local midnight Sep 10 = Sep 09 22:00Z.
    expect(filter.from.toISOString()).toBe("2026-09-09T22:00:00.000Z");
    expect(filter.intervalTypes).toEqual(["focus"]);
    expect(filter.take).toBe(6);
  });

  it("passes a decoded cursor through and mints the next page token", async () => {
    const first = row({ startedAt: new Date("2026-09-10T10:00:00.000Z") });
    const second = row({ startedAt: new Date("2026-09-09T10:00:00.000Z") });
    const overflow = row({ startedAt: new Date("2026-09-08T10:00:00.000Z") });
    const store = fakeStore({ rows: [first, second, overflow] });
    const service = serviceWith(store);
    const cursor = encodeCursor({
      startedAt: new Date("2026-09-10T11:00:00.000Z"),
      id: crypto.randomUUID(),
    });
    const result = await service.list(USER, { limit: 2, cursor });
    expect(result.sessions).toHaveLength(2);
    const seen = store.calls.list[0].filter as {
      cursor: { startedAt: Date; id: string };
    };
    expect(seen.cursor.startedAt.toISOString()).toBe("2026-09-10T11:00:00.000Z");
    // Next cursor continues after the last row of this page.
    expect(result.nextCursor).toBe(
      encodeCursor({ startedAt: second.startedAt, id: second.id }),
    );
  });

  it("returns a null cursor on the last page", async () => {
    const only = row();
    const store = fakeStore({ rows: [only] });
    const result = await serviceWith(store).list(USER, { limit: 20 });
    expect(result.sessions).toHaveLength(1);
    expect(result.nextCursor).toBeNull();
  });

  it("rejects a forged cursor before touching the store query", async () => {
    const listSessions = vi.fn(async () => []);
    const store: HistoryStore = {
      getTimezone: async () => "UTC",
      listSessions,
    };
    try {
      await serviceWith(store).list(USER, { cursor: "bogus" });
      expect.unreachable("forged cursor should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryServiceError);
      expect((error as HistoryServiceError).fields?.cursor).toHaveLength(1);
    }
    expect(listSessions).not.toHaveBeenCalled();
  });

  it("falls back to UTC when the stored zone is invalid", async () => {
    const store = fakeStore({ timezone: "Bogus/Zone", rows: [] });
    await serviceWith(store).list(USER, { period: "today" });
    const filter = store.calls.list[0].filter as { from: Date };
    expect(filter.from.toISOString()).toBe("2026-09-10T00:00:00.000Z");
  });

  it("rejects unknown filters as 400s with a field map", async () => {
    const store = fakeStore({ rows: [] });
    try {
      await serviceWith(store).list(USER, { period: "week" });
      expect.unreachable("bad period should reject");
    } catch (error) {
      expect(error).toBeInstanceOf(HistoryServiceError);
      expect((error as HistoryServiceError).code).toBe("VALIDATION_ERROR");
    }
    expect(store.calls.list).toHaveLength(0);
  });

  it("preserves snapshots and formats timestamps as UTC ISO strings", () => {
    const publicRow = toPublicHistorySession(
      row({
        taskId: crypto.randomUUID(),
        taskTitleSnapshot: "Old task (deleted)",
        categorySnapshot: "work",
      }),
    );
    expect(publicRow.taskTitleSnapshot).toBe("Old task (deleted)");
    expect(publicRow.categorySnapshot).toBe("work");
    expect(publicRow.startedAt).toBe("2026-09-10T10:00:00.000Z");
  });
});
