"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";

/** Signed-in header action: clears the session cookie, then lands home. */
export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function logout() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      setPending(false);
      router.push("/");
      router.refresh();
    }
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      onClick={logout}
      disabled={pending}
    >
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
