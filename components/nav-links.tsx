"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PRIMARY_LINKS = [
  { href: "/app", label: "Focus" },
  { href: "/app/history", label: "History" },
  { href: "/app/analytics", label: "Analytics" },
  { href: "/app/settings", label: "Settings" },
] as const;

const LINK_CLASS =
  "rounded-md px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary";

/**
 * Primary nav with `aria-current="page"` on the active destination (WCAG
 * 2.4.8 location + 4.1.2 name/role/state). Client-rendered so the current
 * pathname is known; the hrefs match the server shell exactly.
 */
export function PrimaryNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex items-center gap-1 text-sm">
      {PRIMARY_LINKS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={LINK_CLASS}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
