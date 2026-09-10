/**
 * In-memory `localStorage` fallback for the test setup (see
 * `vitest.setup.ts`).
 *
 * Node 26 ships an experimental file-backed `localStorage` global that is
 * *unavailable* without `--localstorage-file`, so under Node 26 the jsdom
 * environment no longer provides a working `localStorage` (component tests
 * failed with `Cannot read properties of undefined (reading 'clear')`).
 * This installs a small in-memory Storage when none is usable; on runtimes
 * where jsdom already provides a working store it is a no-op.
 */
export function ensureMemoryLocalStorage(): void {
  let usable = false;
  try {
    usable =
      typeof localStorage !== "undefined" &&
      typeof localStorage.getItem === "function";
    if (usable) localStorage.getItem("__probe__");
  } catch {
    usable = false;
  }
  if (usable) return;
  const store = new Map<string, string>();
  const stub: Storage = {
    get length() {
      return store.size;
    },
    clear: () => {
      store.clear();
    },
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(String(key), String(value));
    },
  };
  try {
    Object.defineProperty(globalThis, "localStorage", {
      value: stub,
      writable: true,
      configurable: true,
    });
  } catch {
    try {
      (globalThis as Record<string, unknown>).localStorage = stub;
    } catch {
      // Non-configurable host global: leave it — tests fail loudly as
      // before instead of running against a half-installed store.
      return;
    }
  }
  try {
    const w = (globalThis as Record<string, unknown>).window as
      | Record<string, unknown>
      | undefined;
    if (w && typeof w.localStorage === "undefined") {
      Object.defineProperty(w, "localStorage", {
        value: stub,
        writable: true,
        configurable: true,
      });
    }
  } catch {
    // No window (node env): nothing to mirror onto.
  }
}
