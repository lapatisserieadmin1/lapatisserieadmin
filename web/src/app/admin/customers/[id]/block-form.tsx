"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { setCustomerBlockedAction } from "../actions";

// Block or unblock with a mandatory reason; both are kept in the customer's history.
export function BlockForm({ customerId, isBlocked }: { customerId: string; isBlocked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!open) {
    return (
      <Button variant={isBlocked ? "secondary" : "danger"} onClick={() => setOpen(true)}>
        {isBlocked ? "Unblock customer" : "Block customer"}
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-line p-4"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const result = await setCustomerBlockedAction({ customerId, blocked: !isBlocked, reason });
          if (result.ok) {
            setOpen(false);
            setReason("");
            router.refresh();
          } else {
            setError(result.message ?? "Could not save.");
          }
        });
      }}
    >
      <Field
        label={isBlocked ? "Reason for unblocking" : "Reason for blocking"}
        htmlFor="block-reason"
        hint={isBlocked ? "New orders from this number will be accepted again." : "New orders from this number are refused unless an admin overrides with a reason."}
      >
        <Input id="block-reason" value={reason} onChange={(e) => { setError(null); setReason(e.target.value); }} maxLength={300} autoFocus />
      </Field>
      {error && <Alert tone="danger">{error}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" variant={isBlocked ? "primary" : "danger"} disabled={pending || reason.trim().length < 3}>
          {pending ? "Saving…" : isBlocked ? "Unblock" : "Block"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => { setOpen(false); setError(null); }}>Close</Button>
      </div>
    </form>
  );
}
