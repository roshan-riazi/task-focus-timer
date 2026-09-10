import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in — FocusFlow" };

export default function LoginPage() {
  return (
    <section aria-labelledby="login-heading">
      <h1 id="login-heading" className="text-2xl font-semibold tracking-tight">
        Sign in
      </h1>
      <div className="mt-6">
        <Suspense>
          <LoginForm />
        </Suspense>
      </div>
    </section>
  );
}
