"use client";

import { useState } from "react";

export interface AuthFieldErrors {
  [field: string]: string[];
}

interface AuthErrorEnvelope {
  error?: {
    code?: string;
    message?: string;
    fields?: AuthFieldErrors;
  };
}

/**
 * Shared JSON-POST submit for the auth pages. Maps the API error envelope
 * (`{ error: { code, message, fields? } }`, SYSTEM_DESIGN §6) onto
 * field-associated messages (spec §12.3) plus one assertive form-level
 * message. Returns `true` from submit when the request succeeded.
 */
export function useAuthSubmit(
  action: string,
  onSuccess: (body: unknown) => void,
) {
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(values: Record<string, string>): Promise<void> {
    setPending(true);
    setFieldErrors({});
    setFormError(null);
    try {
      const res = await fetch(action, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await res.json().catch(
        () => ({}),
      )) as AuthErrorEnvelope;
      if (!res.ok) {
        setFieldErrors(body.error?.fields ?? {});
        setFormError(body.error?.message ?? "Something went wrong.");
        return;
      }
      onSuccess(body);
    } catch {
      setFormError("Something went wrong. Check your connection and retry.");
    } finally {
      setPending(false);
    }
  }

  return { submit, fieldErrors, formError, pending };
}
