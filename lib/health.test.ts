import { describe, expect, it } from "vitest";
import { CANARY_TASK_NOTES, CANARY_TASK_TITLE } from "@/tests/canary";
import { createGetHealth } from "./health";
import { REQUEST_ID_HEADER } from "./request-id";

describe("GET /api/health (DB-gated, leak-free)", () => {
  it("returns 200 with db:up when the database answers", async () => {
    const GET = createGetHealth(async () => undefined);
    const res = await GET(
      new Request("http://localhost/api/health", {
        headers: { [REQUEST_ID_HEADER]: "req-health-up" },
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: "ok",
      checks: { db: "up" },
    });
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe("req-health-up");
  });

  it("returns 503 with db:down and no internals when the database is unreachable", async () => {
    const GET = createGetHealth(async () => {
      throw new Error(
        `connect ECONNREFUSED postgres://focusflow:supersecret@db:5432 ${CANARY_TASK_TITLE}`,
      );
    });
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(503);
    const body = (await res.json()) as unknown;
    expect(body).toEqual({ status: "error", checks: { db: "down" } });
    const text = JSON.stringify(body);
    expect(text).not.toContain("ECONNREFUSED");
    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain(CANARY_TASK_TITLE);
    expect(text).not.toContain(CANARY_TASK_NOTES);
    // Request ID is always issued for log correlation, even on failure.
    expect(res.headers.get(REQUEST_ID_HEADER)?.length).toBeGreaterThan(0);
  });

  it("carries no user data", async () => {
    const GET = createGetHealth(async () => undefined);
    const res = await GET(new Request("http://localhost/api/health"));
    const text = JSON.stringify(await res.json());
    for (const key of ["user", "email", "task", "title", "notes"]) {
      expect(text).not.toContain(`"${key}"`);
    }
  });
});
