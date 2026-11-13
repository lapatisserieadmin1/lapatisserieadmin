"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Checkbox, Field, Input } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import type { Tables } from "@/lib/database.types";
import { formatLeadTime, formatPaise, paiseToRupeesInput } from "@/lib/money";

type Variant = Tables<"product_variants">;
type SaveAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function VariantFields({
  variant,
  errors,
  idPrefix,
}: {
  variant?: Variant;
  errors: Record<string, string>;
  idPrefix: string;
}) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const lead = variant?.lead_time_minutes ?? 0;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Variant name" htmlFor={id("name")} error={errors.name}>
        <Input id={id("name")} name="name" defaultValue={variant?.name ?? ""} placeholder="e.g. 1 kg" required />
      </Field>
      <Field label="Price (₹)" htmlFor={id("price")} error={errors.price_paise}>
        <Input
          id={id("price")}
          name="price"
          inputMode="decimal"
          defaultValue={variant ? paiseToRupeesInput(variant.price_paise) : ""}
          placeholder="450.00"
          required
        />
      </Field>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Lead time</span>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor={id("lead_hours")}>Hours</label>
          <Input id={id("lead_hours")} name="lead_hours" inputMode="numeric" defaultValue={Math.floor(lead / 60)} className="w-20" />
          <span className="text-sm text-muted">h</span>
          <label className="sr-only" htmlFor={id("lead_minutes")}>Minutes</label>
          <Input id={id("lead_minutes")} name="lead_minutes" inputMode="numeric" defaultValue={lead % 60} className="w-20" />
          <span className="text-sm text-muted">m</span>
        </div>
        {errors.lead_time_minutes && <p className="text-xs text-danger">{errors.lead_time_minutes}</p>}
      </div>
      <div className="flex flex-wrap gap-5 sm:col-span-2 lg:col-span-4">
        <Checkbox name="is_eggless" label="Eggless" defaultChecked={variant?.is_eggless ?? false} />
        <Checkbox name="is_available" label="Available" defaultChecked={variant?.is_available ?? true} />
        <input type="hidden" name="sort_order" value={variant?.sort_order ?? 0} />
      </div>
    </div>
  );
}

export function NewVariantForm(props: { action: SaveAction }) {
  const [state, formAction] = useActionState(props.action, {});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <VariantFields errors={state.fieldErrors ?? {}} idPrefix="new-variant" />
      <div className="flex items-center gap-4">
        <SubmitButton pendingText="Adding…">Add variant</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function VariantRow({
  variant,
  canEdit,
  saveAction,
  archiveAction,
}: {
  variant: Variant;
  canEdit: boolean;
  saveAction: SaveAction;
  archiveAction: (archived: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(async (prev, formData) => {
    const result = await saveAction(prev, formData);
    if (result.ok) setEditing(false);
    return result;
  }, {});
  const [archiving, startArchive] = useTransition();
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const archived = Boolean(variant.archived_at);

  if (editing) {
    return (
      <li className="rounded-lg border border-brand/30 bg-brand-soft/40 p-4">
        <form action={formAction} className="flex flex-col gap-4">
          <VariantFields
            variant={variant}
            errors={state.fieldErrors ?? {}}
            idPrefix={`variant-${variant.id}`}
          />
          <div className="flex items-center gap-3">
            <SubmitButton>Save variant</SubmitButton>
            <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <FormMessage state={state} />
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className={archived ? "font-medium text-muted line-through" : "font-medium"}>{variant.name}</span>
          <span className="text-sm">{formatPaise(variant.price_paise)}</span>
          {variant.is_eggless && <Badge tone="ok">Eggless</Badge>}
          {!variant.is_available && <Badge tone="warn">Unavailable</Badge>}
          {archived && <Badge>Archived</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted">
          Lead time {formatLeadTime(variant.lead_time_minutes)}
        </p>
        {archiveError && <p className="mt-1 text-sm text-danger">{archiveError}</p>}
      </div>
      {canEdit && (
        <div className="flex gap-2">
          {!archived && (
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          )}
          <Button
            variant={archived ? "secondary" : "ghost"}
            disabled={archiving}
            onClick={() =>
              startArchive(async () => {
                setArchiveError(null);
                try {
                  await archiveAction(!archived);
                } catch (e) {
                  setArchiveError(e instanceof Error ? e.message : "Could not update the variant.");
                }
              })
            }
          >
            {archiving ? "Updating…" : archived ? "Restore" : "Archive"}
          </Button>
        </div>
      )}
    </li>
  );
}
