import { describe, expect, it } from "vitest";
import { ensureRequestId, REQUEST_ID_HEADER } from "./request-id";

describe("ensureRequestId", () => {
  it("exposes the shared header name", () => {
    expect(REQUEST_ID_HEADER).toBe("x-request-id");
  });

  it("preserves an incoming request ID", () => {
    expect(ensureRequestId("incoming-id-123")).toBe("incoming-id-123");
  });

  it("generates a non-empty ID when none is provided", () => {
    const a = ensureRequestId(null);
    const b = ensureRequestId(undefined);
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });

  it("generates an ID for blank input", () => {
    expect(ensureRequestId("   ").length).toBeGreaterThan(0);
  });

  it("trims whitespace and strips CR/LF from incoming IDs", () => {
    expect(ensureRequestId("  abc-123  ")).toBe("abc-123");
    const evil = ensureRequestId("abc\r\nX-Injected: 1");
    expect(evil).not.toMatch(/[\r\n]/);
  });

  it("caps oversize incoming IDs", () => {
    expect(ensureRequestId("a".repeat(500)).length).toBeLessThanOrEqual(128);
  });
});
