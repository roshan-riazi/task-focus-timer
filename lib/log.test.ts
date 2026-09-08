import { describe, expect, it, vi } from "vitest";
import {
  CANARY_TASK_NOTES,
  CANARY_TASK_TITLE,
  captureStream,
} from "@/tests/canary";
import { createLogger, getLogger } from "./log";

describe("structured logger (no task content, request-ID)", () => {
  it("emits JSON lines carrying the request ID", () => {
    const { chunks, stream } = captureStream();
    const log = createLogger({ requestId: "req-123" }, stream);
    log.info({ route: "/api/health" }, "health check");
    expect(chunks.length).toBe(1);
    const line = JSON.parse(chunks[0]);
    expect(line.requestId).toBe("req-123");
    expect(line.route).toBe("/api/health");
    expect(line.msg).toBe("health check");
  });

  it("never emits task titles, notes, or categories, even when passed directly", () => {
    const { chunks, stream } = captureStream();
    const log = createLogger({ requestId: "req-canary" }, stream);
    log.info(
      {
        title: CANARY_TASK_TITLE,
        notes: CANARY_TASK_NOTES,
        category: CANARY_TASK_TITLE,
        taskTitle: CANARY_TASK_TITLE,
      },
      "task event",
    );
    const output = chunks.join("\n");
    expect(output).not.toContain(CANARY_TASK_TITLE);
    expect(output).not.toContain(CANARY_TASK_NOTES);
  });

  it("redacts nested task content and secrets", () => {
    const { chunks, stream } = captureStream();
    const log = createLogger({ requestId: "req-nested" }, stream);
    log.info(
      {
        task: { title: CANARY_TASK_TITLE, notes: CANARY_TASK_NOTES },
        DATABASE_URL: "postgres://secret",
      },
      "nested",
    );
    const output = chunks.join("\n");
    expect(output).not.toContain(CANARY_TASK_TITLE);
    expect(output).not.toContain(CANARY_TASK_NOTES);
  });

  it("getLogger returns a usable logger without a stream", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const log = getLogger("req-default");
      expect(() => log.info("hello")).not.toThrow();
    } finally {
      spy.mockRestore();
    }
  });
});
