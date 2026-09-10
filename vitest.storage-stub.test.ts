import { afterEach, describe, expect, it } from "vitest";
import { ensureMemoryLocalStorage } from "./vitest.storage-stub";

/**
 * Contract test for the Node 26 `localStorage` fallback: simulates the
 * missing-store condition (the `undefined` global seen under Node 26's
 * file-backed storage without `--localstorage-file`) and pins that the
 * helper installs a working Storage — and that it never touches a store
 * that already works (the jsdom path on older runtimes).
 */
describe("ensureMemoryLocalStorage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );

  function removeStore(): void {
    Object.defineProperty(globalThis, "localStorage", {
      value: undefined,
      writable: true,
      configurable: true,
    });
  }

  function restoreStore(): void {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
  }

  afterEach(() => {
    restoreStore();
  });

  it("installs a working Storage when none is usable", () => {
    removeStore();
    ensureMemoryLocalStorage();
    const stub = globalThis.localStorage as Storage;
    expect(typeof stub.getItem).toBe("function");
    stub.setItem("k", "v");
    expect(stub.getItem("k")).toBe("v");
    expect(stub.getItem("missing")).toBeNull();
    expect(stub.length).toBe(1);
    expect(stub.key(0)).toBe("k");
    expect(stub.key(9)).toBeNull();
    stub.removeItem("k");
    expect(stub.getItem("k")).toBeNull();
    stub.setItem("a", "1");
    stub.clear();
    expect(stub.length).toBe(0);
  });

  it("leaves an already-working store untouched", () => {
    const before = globalThis.localStorage;
    ensureMemoryLocalStorage();
    expect(globalThis.localStorage).toBe(before);
  });
});
