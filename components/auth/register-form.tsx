"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AuthField } from "./auth-field";
import { useAuthSubmit } from "./use-auth-submit";
import { Button } from "../ui/button";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, fieldErrors, formError, pending } = useAuthSubmit(
    "/api/auth/register",
    () => router.push("/login?registered=1"),
  );

  return (
    <form
      noValidate
      className="grid max-w-sm gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit({
          email,
          password,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
      }}
    >
      {formError && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {formError}
        </p>
      )}
      <AuthField
        id="register-email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        errors={fieldErrors.email}
      />
      <AuthField
        id="register-password"
        label="Password (8 or more characters)"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        errors={fieldErrors.password}
      />
      {fieldErrors.timezone && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {fieldErrors.timezone.join(" ")}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-sm opacity-80">
        Already have an account?{" "}
        <Link href="/login" className="underline underline-offset-2">
          Sign in
        </Link>
      </p>
    </form>
  );
}
