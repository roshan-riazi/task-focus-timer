import { describe, expect, it } from "vitest";
import { getInitialTheme } from "./theme-toggle";

describe("getInitialTheme", () => {
  it("defaults to dark when nothing is stored", () => {
    expect(getInitialTheme(null)).toBe("dark");
  });

  it("honours a remembered light choice", () => {
    expect(getInitialTheme("light")).toBe("light");
  });

  it("honours a remembered dark choice", () => {
    expect(getInitialTheme("dark")).toBe("dark");
  });
});
