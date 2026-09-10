import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/app/history",
}));

import { PrimaryNav } from "./nav-links";

/**
 * Seam (unit, Testing Library): the primary nav marks the current
 * destination for assistive tech (issue 17, WCAG 2.4.8/4.1.2).
 */
describe("<PrimaryNav />", () => {
  it("marks the current destination with aria-current", () => {
    render(<PrimaryNav />);
    expect(
      screen.getByRole("link", { name: /^history$/i }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", { name: /^focus$/i }),
    ).not.toHaveAttribute("aria-current");
    expect(
      screen.getByRole("link", { name: /^settings$/i }),
    ).not.toHaveAttribute("aria-current");
  });

  it("exposes all four primary destinations", () => {
    render(<PrimaryNav />);
    for (const name of [/^focus$/i, /^history$/i, /^analytics$/i, /^settings$/i]) {
      expect(screen.getByRole("link", { name })).toBeInTheDocument();
    }
  });
});
