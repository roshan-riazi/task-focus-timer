import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HistoryPanel } from "@/components/history/history-panel";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "History — FocusFlow" };

/**
 * Session history (spec §8.8 + §9.2, issue 16): read-only paginated
 * intervals with period + type filters. Signed-out visitors go to /login —
 * sessions are per-user and the API would 401 anyway (spec §11.5).
 */
export default async function HistoryPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <section aria-labelledby="history-heading" className="grid min-w-0 gap-4">
      <div>
        <h1 id="history-heading" className="text-xl font-semibold tracking-tight">
          History
        </h1>
        <p className="mt-1 text-sm opacity-80">
          Every finalized interval, newest first. Breaks are saved too —
          Focus only hides them. Read-only: nothing here changes your data.
        </p>
      </div>
      <HistoryPanel />
    </section>
  );
}
