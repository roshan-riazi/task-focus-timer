import { describe, expect, it } from "vitest";
import { CANARY_TASK_NOTES, CANARY_TASK_TITLE } from "@/tests/canary";
import {
  reportError,
  scrubPayload,
  sentryBeforeSend,
  toPublicError,
} from "./errors";

const SECRET_URL = "postgres://focusflow:supersecret@db:5432/focusflow";

describe("error scrubbing (no task content, no secrets, no internals)", () => {
  it("scrubs task titles/notes/categories from arbitrary payloads", () => {
    const scrubbed = scrubPayload({
      title: CANARY_TASK_TITLE,
      notes: CANARY_TASK_NOTES,
      category: CANARY_TASK_TITLE,
      nested: { task: { title: CANARY_TASK_TITLE } },
      ok: "visible",
    });
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain(CANARY_TASK_TITLE);
    expect(text).not.toContain(CANARY_TASK_NOTES);
    expect((scrubbed as Record<string, unknown>).ok).toBe("visible");
  });

  it("scrubs secrets and connection strings, including inside messages", () => {
    const scrubbed = scrubPayload({
      message: `connect failed ${SECRET_URL}`,
      DATABASE_URL: SECRET_URL,
    });
    const text = JSON.stringify(scrubbed);
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain(SECRET_URL);
  });

  it("sentryBeforeSend drops request bodies and scrubs secrets from events", () => {
    const event = sentryBeforeSend({
      exception: { values: [{ type: "Error", value: `connect ${SECRET_URL}` }] },
      request: { data: { title: CANARY_TASK_TITLE, notes: CANARY_TASK_NOTES } },
      extra: { task: { title: CANARY_TASK_TITLE } },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain(CANARY_TASK_TITLE);
    expect(text).not.toContain(CANARY_TASK_NOTES);
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain(SECRET_URL);
  });

  it("sentryBeforeSend passes through null as null", () => {
    expect(sentryBeforeSend(null)).toBeNull();
  });

  it("toPublicError never leaks internals", () => {
    const pub = toPublicError(
      new Error(`query failed ${CANARY_TASK_TITLE}: ${SECRET_URL}`),
    );
    expect(pub.status).toBe(500);
    expect(JSON.stringify(pub.body)).not.toContain(CANARY_TASK_TITLE);
    expect(JSON.stringify(pub.body)).not.toContain("postgres://");
    expect(JSON.stringify(pub.body)).not.toContain("supersecret");
  });

  it("reportError resolves without throwing", async () => {
    await expect(
      reportError(new Error("db unavailable"), { requestId: "req-1" }),
    ).resolves.toBeUndefined();
  });
});
