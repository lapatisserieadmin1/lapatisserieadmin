"use client";

import { useActionState } from "react";
import { Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import { requestPasswordReset, setNewPassword } from "./actions";

export function ForgotForm() {
  const [state, action] = useActionState<ActionState, FormData>(requestPasswordReset, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="Email" htmlFor="email" hint="The email you sign in with.">
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Sending…" className="w-full py-2.5">
        Send reset link
      </SubmitButton>
    </form>
  );
}

export function NewPasswordForm() {
  const [state, action] = useActionState<ActionState, FormData>(setNewPassword, {});
  return (
    <form action={action} className="flex flex-col gap-4">
      <Field label="New password" htmlFor="password" hint="At least 10 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
      </Field>
      <Field label="Type it again" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton pendingText="Saving…" className="w-full py-2.5">
        Save new password
      </SubmitButton>
    </form>
  );
}
