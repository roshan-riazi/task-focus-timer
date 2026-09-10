import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AnalyticsPanel } from "@/components/analytics/analytics-panel";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Analytics — FocusFlow" };

/**
 * Individual analytics (spec §8.9 + §9.2, issue 16): timezone-aware
 * metric cards, daily bars with table equivalents, and ranked lists.
 * Signed-out visitors go to /login — aggregates are per-user and the API
 * would 401 anyway (spec §11.5).
 */
export default async function AnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <section aria-labelledby="analytics-heading" className="grid min-w-0 gap-4">
      <div>
        <h1 id="analytics-heading" className="text-xl font-semibold tracking-tight">
          Analytics
        </h1>
        <p className="mt-1 text-sm opacity-80">
          Where your focused time went, grouped by your saved timezone.
          Computed from your sessions — never stored separately.
        </p>
      </div>
      <AnalyticsPanel />
    </section>
  );
}
