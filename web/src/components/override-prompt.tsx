"use client";

import { useState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { OVERRIDABLE_KINDS, OVERRIDE_REASON_MIN } from "@/lib/orders";

export type ActionFailure = { message: string; kind?: string };

// Shows why an action was refused. For overridable refusals, admins can retry it with a
// reason that is recorded in the order timeline (AC-36). Others see the refusal only; the
// database message already says an admin can override.
export function OverridePrompt({
  error,
  isAdmin,
  pending,
  title,
  actionLabel = "Save with override",
  onOverride,
}: {
  error: ActionFailure;
  isAdmin: boolean;
  pending: boolean;
  title?: string;
  actionLabel?: string;
  onOverride: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const canOverride = isAdmin && Boolean(error.kind && OVERRIDABLE_KINDS.has(error.kind));

  return (
    <Alert tone="danger" title={title}>
      <p>{error.message}</p>
      {canOverride && (
        <div className="mt-3 flex flex-col gap-2 text-ink">
          <Field label="Override reason (recorded in the timeline)" htmlFor="override-reason" hint={`At least ${OVERRIDE_REASON_MIN} characters.`}>
            <Input
              id="override-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Owner approved an extra festival order"
              maxLength={300}
            />
          </Field>
          <Button
            type="button"
            variant="danger"
            disabled={pending || reason.trim().length < OVERRIDE_REASON_MIN}
            onClick={() => onOverride(reason.trim())}
          >
            {pending ? "Saving…" : actionLabel}
          </Button>
        </div>
      )}
    </Alert>
  );
}
