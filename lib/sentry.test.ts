import { afterEach, describe, expect, it } from "vitest";
import { CANARY_TASK_NOTES, CANARY_TASK_TITLE } from "@/tests/canary";
import { sentryBeforeSend } from "./errors";

const DSN = "https://public@example.ingest.sentry.io/1";

describe("Sentry init options (issue 06: scrubbed errors, DSN-gated)", () => {
  const prev = process.env.ERROR_DSN;

  afterEach(() => {
    if (prev === undefined) delete process.env.ERROR_DSN;
    else process.env.ERROR_DSN = prev;
  });

  it("is disabled without a DSN and enabled with one", async () => {
    const { getSentryDsn, isSentryEnabled } = await import("./sentry");
    delete process.env.ERROR_DSN;
    expect(getSentryDsn()).toBeUndefined();
    expect(isSentryEnabled()).toBe(false);

    process.env.ERROR_DSN = "";
    expect(isSentryEnabled()).toBe(false);

    process.env.ERROR_DSN = DSN;
    expect(getSentryDsn()).toBe(DSN);
    expect(isSentryEnabled()).toBe(true);
  });

  it("exposes the shared scrub hook as beforeSend with PII off and no tracing", async () => {
    process.env.ERROR_DSN = DSN;
    const { getSentryInitOptions } = await import("./sentry");
    const options = getSentryInitOptions();
    expect(options.dsn).toBe(DSN);
    expect(options.beforeSend).toBe(sentryBeforeSend);
    expect(options.sendDefaultPii).toBe(false);
    // Error monitoring only: no performance tracing on the free-tier MVP.
    expect(options.tracesSampleRate ?? 0).toBe(0);
  });

  it("scrubs canary task content through the wired beforeSend", async () => {
    process.env.ERROR_DSN = DSN;
    const { getSentryInitOptions } = await import("./sentry");
    const { beforeSend } = getSentryInitOptions();
    const event = beforeSend!({
      request: { data: { title: CANARY_TASK_TITLE, notes: CANARY_TASK_NOTES } },
      extra: { taskTitle: CANARY_TASK_TITLE },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(CANARY_TASK_TITLE);
    expect(text).not.toContain(CANARY_TASK_NOTES);
  });
});
