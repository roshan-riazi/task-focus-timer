import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/settings/settings-form";
import { getSession } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Settings — FocusFlow" };

/**
 * Settings (spec §8.7 + §9.2, issue 16): durations, auto-start, sound
 * preset with preview + volume, timezone, notifications. Signed-out
 * visitors go to /login — settings are per-user and the API would 401
 * anyway (spec §11.5).
 */
export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  return (
    <section aria-labelledby="settings-heading" className="grid min-w-0 gap-4">
      <div>
        <h1 id="settings-heading" className="text-xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm opacity-80">
          Tune your intervals, alarm, and timezone.
        </p>
      </div>
      <SettingsForm />
    </section>
  );
}
