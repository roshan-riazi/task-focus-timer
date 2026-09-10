import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface AuthFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  id: string;
  label: string;
  errors?: string[];
}

/**
 * Labelled auth input with field-associated errors (spec §12.3): invalid
 * fields get `aria-invalid` + `aria-describedby` pointing at their message.
 */
export function AuthField({ id, label, errors = [], ...props }: AuthFieldProps) {
  const errorId = `${id}-error`;
  const invalid = errors.length > 0;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        className={cn(
          "h-10 rounded-md border bg-background px-3 text-sm",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          invalid && "border-red-500",
        )}
        {...props}
      />
      {invalid && (
        <p id={errorId} role="alert" className="text-sm text-red-500">
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}
