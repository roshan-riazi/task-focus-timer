"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AuthField } from "./auth-field";
import { useAuthSubmit } from "./use-auth-submit";
import { Button } from "../ui/button";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { submit, fieldErrors, formError, pending } = useAuthSubmit(
    "/api/auth/login",
    () => {
      router.push("/");
      router.refresh();
    },
  );

  return (
    <div className="grid max-w-sm gap-4">
      {searchParams.get("registered") && (
        <p role="status" className="text-sm">
          Account created. Sign in to start focusing.
        </p>
      )}
      {searchParams.get("reset") && (
        <p role="status" className="text-sm">
          Password updated. Sign in with your new password.
        </p>
      )}
      <form
        noValidate
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit({ email, password });
        }}
      >
        {formError && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {formError}
          </p>
        )}
        <AuthField
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          errors={fieldErrors.email}
        />
        <AuthField
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          errors={fieldErrors.password}
        />
        <Button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
      <p className="text-sm opacity-80">
        <Link href="/forgot-password" className="underline underline-offset-2">
          Forgot your password?
        </Link>
      </p>
      <p className="text-sm opacity-80">
        New here?{" "}
        <Link href="/register" className="underline underline-offset-2">
          Create an account
        </Link>
      </p>
    </div>
  );
}
