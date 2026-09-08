import { describe, expect, it } from "vitest";
import { createGetHealth } from "@/lib/health";
import { createLogger } from "@/lib/log";
import { sentryBeforeSend } from "@/lib/errors";
import { CANARY_TASK_NOTES, CANARY_TASK_TITLE, captureStream } from "./canary";

/**
 * Issue 06 acceptance: canary fixture strings (standing in for user-authored
 * task titles/notes) appear nowhere in logs, error reports, or payloads
 * outside first-party API bodies.
 */
describe("observability canary scrub (issue 06 acceptance)", () => {
  it("keeps canaries out of logs, error reports, and health payloads", async () => {
    // 1. Structured logs.
    const { chunks, stream } = captureStream();
    createLogger({ requestId: "req-canary" }, stream).info(
      {
        title: CANARY_TASK_TITLE,
        notes: CANARY_TASK_NOTES,
        task: { title: CANARY_TASK_TITLE, notes: CANARY_TASK_NOTES },
      },
      "task event",
    );

    // 2. Scrubbed error reports (Sentry beforeSend shape).
    const event = sentryBeforeSend({
      request: { data: { title: CANARY_TASK_TITLE, notes: CANARY_TASK_NOTES } },
      extra: { taskTitle: CANARY_TASK_TITLE },
    });

    // 3. Health payload on the failure path (error carries canaries).
    const GET = createGetHealth(async () => {
      throw new Error(`boom ${CANARY_TASK_TITLE} ${CANARY_TASK_NOTES}`);
    });
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(503);
    const bodyText = JSON.stringify(await res.json());

    const combined =
      chunks.join("\n") + "\n" + JSON.stringify(event) + "\n" + bodyText;
    expect(combined).not.toContain(CANARY_TASK_TITLE);
    expect(combined).not.toContain(CANARY_TASK_NOTES);
  });

  it("health payload on the up path is a fixed envelope with no user-data surface", async () => {
    const GET = createGetHealth(async () => undefined);
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).toBe('{"status":"ok","checks":{"db":"up"}}');
    expect(text).not.toContain(CANARY_TASK_TITLE);
    expect(text).not.toContain(CANARY_TASK_NOTES);
  });
});
