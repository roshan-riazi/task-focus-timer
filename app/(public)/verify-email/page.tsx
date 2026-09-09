import type { Metadata } from "next";
import { Suspense } from "react";
import { VerifyEmailForm } from "@/components/auth/verify-email-form";

export const metadata: Metadata = { title: "Verify email — FocusFlow" };

export default function VerifyEmailPage() {
  return (
    <section aria-labelledby="verify-heading">
      <h1 id="verify-heading" className="text-2xl font-semibold tracking-tight">
        Verify your email
      </h1>
      <div className="mt-6">
        <Suspense>
          <VerifyEmailForm />
        </Suspense>
      </div>
    </section>
  );
}
