"use client";

import { useActionState } from "react";
import { Select } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";

type Kitchen = { id: string; name: string };

// One kitchen for all of a product's sizes; "mixed" when its sizes were set to different kitchens before.
export function KitchenCard({
  kitchens,
  current,
  canEdit,
  action,
}: {
  kitchens: Kitchen[];
  current: string | "mixed" | null;
  canEdit: boolean;
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
}) {
  const [state, formAction] = useActionState(action, {});

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-56">
        <label htmlFor="product-kitchen" className="mb-1 block text-sm font-medium">Made in</label>
        <Select id="product-kitchen" name="kitchen_id" defaultValue={current === "mixed" ? "" : (current ?? "")} disabled={!canEdit}>
          <option value="">{current === "mixed" ? "Different kitchens per size" : "No kitchen (every chef sees it)"}</option>
          {kitchens.map((k) => (
            <option key={k.id} value={k.id}>{k.name}</option>
          ))}
        </Select>
      </div>
      {canEdit && <SubmitButton variant="secondary">Save kitchen</SubmitButton>}
      <FormMessage state={state} />
    </form>
  );
}
