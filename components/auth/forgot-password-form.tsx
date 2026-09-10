"use client";

import { useState } from "react";
import Link from "next/link";
import { AuthField } from "./auth-field";
import { useAuthSubmit } from "./use-auth-submit";
import { Button } from "../ui/button";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const { submit, fieldErrors, formError, pending } = useAuthSubmit(
    "/api/auth/forgot-password",
    () => setDone(true),
  );

  // Same copy whether or not the address exists (spec §12.2: no oracle).
  if (done) {
    return (
      <p role="status" className="max-w-sm text-sm">
        If an account exists for that address, a reset link is on its way. It
        expires in 1 hour.
      </p>
    );
  }

  return (
    <form
      noValidate
      className="grid max-w-sm gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ email });
      }}
    >
      {formError && (
        <p role="alert" className="text-sm text-red-500">
          {formError}
        </p>
      )}
      <AuthField
        id="forgot-email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        errors={fieldErrors.email}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Send reset link"}
      </Button>
      <p className="text-sm opacity-80">
        <Link href="/login">Back to sign in</Link>
      </p>
    </form>
  );
}
