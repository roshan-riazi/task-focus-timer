import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = { title: "Forgot password — FocusFlow" };

export default function ForgotPasswordPage() {
  return (
    <section aria-labelledby="forgot-heading">
      <h1 id="forgot-heading" className="text-2xl font-semibold tracking-tight">
        Reset your password
      </h1>
      <p className="mt-2 max-w-prose text-sm opacity-80">
        Enter your email and we&apos;ll send a one-hour reset link.
      </p>
      <div className="mt-6">
        <ForgotPasswordForm />
      </div>
    </section>
  );
}
