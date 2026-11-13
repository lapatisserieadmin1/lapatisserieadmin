"use client";

import { useFormStatus } from "react-dom";
import type { ComponentProps } from "react";
import { Button } from "@/components/ui";

export type ActionState = {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
};

export function SubmitButton({
  children,
  pendingText = "Saving…",
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-disabled={pending} {...props}>
      {pending ? pendingText : children}
    </Button>
  );
}

export function FormMessage({ state }: { state: ActionState | undefined }) {
  if (!state?.message) return <p aria-live="polite" className="sr-only" />;
  return (
    <p
      aria-live="polite"
      className={state.ok ? "text-sm font-medium text-ok" : "text-sm font-medium text-danger"}
    >
      {state.message}
    </p>
  );
}
