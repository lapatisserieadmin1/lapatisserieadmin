"use client";

import { useActionState, useEffect, useRef } from "react";
import { Checkbox, Input } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import type { Tables } from "@/lib/database.types";

type Category = Tables<"categories">;
type SaveAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;

function Fields({ category, prefix, errors }: { category?: Category; prefix: string; errors: Record<string, string> }) {
  return (
    <>
      <div className="min-w-48 flex-1">
        <label htmlFor={`${prefix}-name`} className="mb-1 block text-xs font-medium text-muted">Name</label>
        <Input id={`${prefix}-name`} name="name" defaultValue={category?.name} required maxLength={60} placeholder="e.g. Cakes" />
        {errors.name && <p className="mt-1 text-xs text-danger">{errors.name}</p>}
      </div>
      <div className="w-24">
        <label htmlFor={`${prefix}-sort`} className="mb-1 block text-xs font-medium text-muted">Order</label>
        <Input id={`${prefix}-sort`} name="sort_order" inputMode="numeric" defaultValue={category?.sort_order ?? 0} />
      </div>
      <div className="pb-2">
        <Checkbox name="is_active" label="Active" defaultChecked={category?.is_active ?? true} />
      </div>
    </>
  );
}

export function CategoryRow({ category, action }: { category: Category; action: SaveAction }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <li className="rounded-lg border border-line p-4">
      <form action={formAction} className="flex flex-wrap items-end gap-3">
        <Fields category={category} prefix={`cat-${category.id}`} errors={state.fieldErrors ?? {}} />
        <SubmitButton variant="secondary">Save</SubmitButton>
        <FormMessage state={state} />
      </form>
    </li>
  );
}

export function NewCategoryForm({ action }: { action: SaveAction }) {
  const [state, formAction] = useActionState(action, {});
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.ok) ref.current?.reset();
  }, [state]);

  return (
    <form ref={ref} action={formAction} className="flex flex-wrap items-end gap-3">
      <Fields prefix="new-cat" errors={state.fieldErrors ?? {}} />
      <SubmitButton pendingText="Adding…">Add category</SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
