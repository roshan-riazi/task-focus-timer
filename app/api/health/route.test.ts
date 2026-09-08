import { describe, expect, it } from "vitest";
import { GET, runtime } from "./route";
import { REQUEST_ID_HEADER } from "@/lib/request-id";

describe("GET /api/health", () => {
  it("runs on the Node.js runtime (never Edge)", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns a leak-free envelope reflecting live DB state (200 up / 503 down)", async () => {
    const res = await GET();
    expect([200, 503]).toContain(res.status);
    const body = (await res.json()) as {
      status: string;
      checks: { db: string };
    };
    if (res.status === 200) {
      expect(body).toEqual({ status: "ok", checks: { db: "up" } });
    } else {
      expect(body).toEqual({ status: "error", checks: { db: "down" } });
    }
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/postgres:\/\//i);
    expect(text).not.toMatch(/ECONNREFUSED|P2002|timed out/i);
    expect(res.headers.get(REQUEST_ID_HEADER)?.length).toBeGreaterThan(0);
  });
});
