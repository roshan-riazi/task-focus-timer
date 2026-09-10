import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export const metadata: Metadata = { title: "Choose a new password — FocusFlow" };

export default function ResetPasswordPage() {
  return (
    <section aria-labelledby="reset-heading">
      <h1 id="reset-heading" className="text-2xl font-semibold tracking-tight">
        Choose a new password
      </h1>
      <div className="mt-6">
        <Suspense>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </section>
  );
}
