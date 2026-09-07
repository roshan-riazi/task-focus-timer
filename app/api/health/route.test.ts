import { describe, expect, it } from "vitest";
import { GET, runtime } from "./route";

describe("GET /api/health", () => {
  it("runs on the Node.js runtime (never Edge)", () => {
    expect(runtime).toBe("nodejs");
  });

  it("returns 200 with a { status: 'ok' } envelope", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });
});
