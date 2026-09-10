"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthField } from "./auth-field";
import { useAuthSubmit } from "./use-auth-submit";
import { Button } from "../ui/button";

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [password, setPassword] = useState("");
  const { submit, fieldErrors, formError, pending } = useAuthSubmit(
    "/api/auth/reset-password",
    () => router.push("/login?reset=1"),
  );

  if (!token) {
    return (
      <div className="grid max-w-sm gap-4">
        <p role="alert" className="text-sm text-red-500">
          This reset link is missing its token. Request a fresh one.
        </p>
        <p className="text-sm opacity-80">
          <Link href="/forgot-password">Send a new reset link</Link>
        </p>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="grid max-w-sm gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({ token, password });
      }}
    >
      {formError && (
        <p role="alert" className="text-sm text-red-500">
          {formError}
        </p>
      )}
      <AuthField
        id="reset-password"
        label="New password (8 or more characters)"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        errors={fieldErrors.password}
      />
      {fieldErrors.token && (
        <p role="alert" className="text-sm text-red-500">
          This link is invalid or has expired.{" "}
          <Link href="/forgot-password">Send a new reset link</Link>
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
