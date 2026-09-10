import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy notice — FocusFlow" };

/**
 * Privacy disclosures (issue 18, spec §§8.1/12.2/12.5): what FocusFlow
 * stores, why, how long it lives, and how deletion works. Every claim
 * below mirrors the implementation — account purge (`DELETE /api/account`
 * → single `user.delete` with cascading relations), the 30-day backup
 * expiry (RUNBOOK §4), no product-analytics telemetry anywhere, and
 * scrubbed logs/error reports (`lib/sensitive-fields`).
 */
export default function PrivacyPage() {
  return (
    <section
      aria-labelledby="privacy-heading"
      className="grid max-w-prose gap-4"
    >
      <h1
        id="privacy-heading"
        className="text-2xl font-semibold tracking-tight"
      >
        Privacy notice
      </h1>
      <p className="text-sm opacity-80">Last updated: September 2026.</p>

      <h2 className="text-lg font-semibold">What we store</h2>
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        <li>
          Your email address and a one-way password hash (bcrypt) — to sign
          you in.
        </li>
        <li>
          Your settings, including timezone and alarm preferences — to run
          the timer your way.
        </li>
        <li>
          Your tasks (titles, notes, categories) and focus-session history —
          the product itself.
        </li>
        <li>
          Session tokens and single-use email tokens (verification, password
          reset) — to keep you signed in and recover accounts.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">What we never collect</h2>
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        <li>
          No product-analytics telemetry: there are no tracking scripts and
          no behavioral events. Aggregate usage figures, if ever published,
          come from database counts — never from client-side tracking.
        </li>
        <li>
          Task titles and notes never appear in server logs or error
          reports. Logs carry request IDs and error names; error reports
          carry error types — never messages that could embed task content.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Cookies and email</h2>
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        <li>
          One session cookie (HTTP-only, SameSite=Lax, Secure over HTTPS) —
          it keeps you signed in and nothing else.
        </li>
        <li>
          We email you only for account reasons: verification links and
          password resets. Verification never blocks first use.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Retention and deletion</h2>
      <ul className="grid list-disc gap-1 pl-5 text-sm">
        <li>
          Completed tasks and session history are kept until you delete them
          or delete your account.
        </li>
        <li>
          Deleting your account (Settings → Danger zone, with explicit
          typed confirmation) immediately and permanently purges your
          profile, settings, tasks, timer history, and sessions from the
          live database.
        </li>
        <li>
          Automated database backups age out within 30 days — a deleted
          account disappears from backup copies no later than 30 days after
          deletion.
        </li>
      </ul>

      <h2 className="text-lg font-semibold">Your control</h2>
      <p className="text-sm">
        Everything above is visible inside the app (Tasks, History,
        Analytics, Settings), and deletion is self-serve at any time. For
        questions about your data, reply to any account email and the
        operator will respond directly.
      </p>
    </section>
  );
}
