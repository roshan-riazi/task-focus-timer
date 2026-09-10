import type { Metadata } from "next";
import Link from "next/link";
import { THEME_STORAGE_KEY } from "@/components/theme-toggle";
import { ThemeToggle } from "@/components/theme-toggle";
import { PrimaryNav } from "@/components/nav-links";
import { LogoutButton } from "@/components/auth/logout-button";
import { VerificationNag } from "@/components/auth/verification-nag";
import type { AppSession } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "FocusFlow",
  description: "Personal focus timer connected to a lightweight task list.",
};

const themeInitScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});var c=t==="light"?"light":"dark";document.documentElement.classList.remove("dark","light");document.documentElement.classList.add(c);}catch(e){document.documentElement.classList.add("dark");}})();`;

/**
 * Best-effort session read for the shell. A misconfigured auth backend
 * (missing AUTH_SECRET, unreachable DB) renders the signed-out shell rather
 * than a 500 — the failure goes to the scrubbed error pipeline for ops.
 */
async function currentSession(): Promise<AppSession | null> {
  try {
    const { getSession } = await import("@/lib/auth/session");
    return await getSession();
  } catch (cause) {
    const { reportError } = await import("@/lib/errors");
    await reportError(cause, {});
    return null;
  }
}

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await currentSession();
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none"
        >
          Skip to content
        </a>
        <header className="border-b">
          <div className="mx-auto flex min-h-14 w-full max-w-5xl flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2">
            <Link
              href="/"
              className="text-sm font-semibold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              FocusFlow
            </Link>
            {session && <PrimaryNav />}
            <nav
              aria-label="Account"
              className="flex items-center gap-1 text-sm"
            >
              {session ? (
                <>
                  <span className="mr-2 hidden opacity-80 sm:inline">
                    <span className="sr-only">Signed in as </span>
                    {session.user.email}
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link
                    href="/login"
                    className="rounded-md px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Sign in
                  </Link>
                  <Link
                    href="/register"
                    className="rounded-md px-3 py-2 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    Create account
                  </Link>
                </>
              )}
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8">
          {session && !session.user.emailVerified && (
            <div className="mb-6">
              <VerificationNag />
            </div>
          )}
          {children}
        </main>
        <footer className="border-t">
          <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-4 text-sm opacity-80">
            <span>FocusFlow — personal focus timer.</span>
            <nav aria-label="Legal">
              <Link
                href="/privacy"
                className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                Privacy notice
              </Link>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
