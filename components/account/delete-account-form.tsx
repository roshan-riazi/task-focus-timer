"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "../ui/button";

const CONFIRM_ID = "delete-account-confirmation";
const CONFIRM_ERROR_ID = "delete-account-confirmation-error";
const FORM_ERROR_ID = "delete-account-form-error";
const CONFIRMATION_LITERAL = "DELETE";

export class DeleteAccountApiError extends Error {
  readonly fields: Record<string, string[]>;
  readonly status: number;
  constructor(message: string, fields: Record<string, string[]>, status: number) {
    super(message);
    this.name = "DeleteAccountApiError";
    this.fields = fields;
    this.status = status;
  }
}

async function requestDeletion(confirmation: string): Promise<void> {
  const res = await fetch("/api/account", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation }),
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => ({}))) as {
    error?: {
      message?: string;
      fields?: Record<string, string[]>;
    };
  };
  throw new DeleteAccountApiError(
    body.error?.message ?? "Something went wrong.",
    body.error?.fields ?? {},
    res.status,
  );
}

/**
 * Danger zone (spec §8.1, issue 18): explicit two-step account deletion.
 * The destructive action stays hidden until requested; the final delete
 * enables only for the exact DELETE literal (mirroring the server-side
 * `deleteAccountSchema`), and success signs out to the landing page.
 * Field errors associate with the confirmation input (spec §12.3); focus
 * moves into the confirmation step on open (mount effect) and back to the
 * trigger on cancel (transition effect) — both flushed synchronously by
 * React, so keyboard and assistive-tech users never lose their place.
 */
export function DeleteAccountSection() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (!confirming) triggerRef.current?.focus();
  }, [confirming]);

  function begin() {
    setDeleted(false);
    setConfirming(true);
  }

  return (
    <section
      aria-labelledby="danger-zone-heading"
      className="grid min-w-0 max-w-xl gap-3 rounded-md border border-red-900/60 p-4"
    >
      <h2 id="danger-zone-heading" className="text-base font-semibold">
        Danger zone
      </h2>
      <p className="text-sm opacity-80">
        Deleting your account immediately and permanently removes your
        profile, tasks, timer history, and settings. Automated backups age
        out within 30 days. See the{" "}
        <Link
          href="/privacy"
          className="underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          privacy notice
        </Link>{" "}
        for details.
      </p>
      {deleted && <p role="status">Account deleted. Signing out…</p>}
      {!confirming ? (
        <div>
          <Button
            ref={triggerRef}
            type="button"
            onClick={begin}
            className="bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700"
          >
            Delete account…
          </Button>
        </div>
      ) : (
        <DeleteConfirmForm
          onCancel={() => setConfirming(false)}
          onDeleted={() => {
            setDeleted(true);
            router.push("/");
            router.refresh();
          }}
        />
      )}
    </section>
  );
}

function DeleteConfirmForm({
  onCancel,
  onDeleted,
}: {
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the confirmation input as soon as the step mounts.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setFieldError(null);
    setFormError(null);
    try {
      await requestDeletion(confirmation);
      onDeleted();
    } catch (error) {
      if (error instanceof DeleteAccountApiError) {
        const confirmationMessages = error.fields.confirmation ?? [];
        if (confirmationMessages.length > 0) {
          setFieldError(confirmationMessages.join(" "));
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError("Something went wrong. Check your connection and retry.");
      }
    } finally {
      setPending(false);
    }
  }

  const ready = confirmation === CONFIRMATION_LITERAL;

  return (
    <form
      onSubmit={(e) => void confirm(e)}
      aria-label="Confirm account deletion"
      className="grid gap-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      <p className="text-sm font-medium">
        This cannot be undone. Your tasks and focus history go with it.
      </p>
      {formError && (
        <p
          id={FORM_ERROR_ID}
          role="alert"
          className="text-sm text-red-700 dark:text-red-400"
        >
          {formError}
        </p>
      )}
      <div className="grid gap-1">
        <label htmlFor={CONFIRM_ID} className="text-sm font-medium">
          Type <kbd className="rounded bg-accent px-1">DELETE</kbd> to confirm
        </label>
        <input
          ref={inputRef}
          id={CONFIRM_ID}
          type="text"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
          autoComplete="off"
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? CONFIRM_ERROR_ID : undefined}
          className="h-10 rounded-md border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        />
        {fieldError && (
          <p
            id={CONFIRM_ERROR_ID}
            role="alert"
            className="text-sm text-red-700 dark:text-red-400"
          >
            {fieldError}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={pending || !ready}
          className="bg-red-700 text-white hover:bg-red-800 dark:bg-red-600 dark:hover:bg-red-700"
        >
          {pending ? "Deleting…" : "Delete my account"}
        </Button>
      </div>
    </form>
  );
}
