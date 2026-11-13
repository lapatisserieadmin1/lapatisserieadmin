"use client";

import { useActionState } from "react";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";
import { FormMessage, SubmitButton, type ActionState } from "@/components/form-status";
import type { Tables } from "@/lib/database.types";

type Product = Tables<"products">;
type Category = Pick<Tables<"categories">, "id" | "name" | "is_active">;

export function ProductForm({
  action,
  categories,
  product,
  readOnly = false,
  submitLabel,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  categories: Category[];
  product?: Product;
  readOnly?: boolean;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const err = state.fieldErrors ?? {};

  return (
    <form action={formAction}>
      <fieldset disabled={readOnly} className="grid gap-5 md:grid-cols-2">
        <Field label="Product name" htmlFor="name" error={err.name} className="md:col-span-2">
          <Input id="name" name="name" defaultValue={product?.name} required maxLength={100} />
        </Field>

        <Field label="Category" htmlFor="category_id" error={err.category_id}>
          <Select id="category_id" name="category_id" defaultValue={product?.category_id ?? ""} required>
            <option value="" disabled>
              Choose a category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.is_active ? "" : " (inactive)"}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Preparation"
          htmlFor="prep_type"
          error={err.prep_type}
          hint="Made-to-order items are baked for the order. Ready-stock items are taken from the shelf."
        >
          <Select id="prep_type" name="prep_type" defaultValue={product?.prep_type ?? "made_to_order"}>
            <option value="made_to_order">Made to order</option>
            <option value="ready_stock">Ready stock</option>
          </Select>
        </Field>

        <Field label="Description" htmlFor="description" error={err.description} className="md:col-span-2">
          <Textarea id="description" name="description" defaultValue={product?.description ?? ""} maxLength={2000} />
        </Field>

        <Field label="HSN code" htmlFor="hsn_code" error={err.hsn_code} hint="From your accountant. Optional for now.">
          <Input id="hsn_code" name="hsn_code" inputMode="numeric" defaultValue={product?.hsn_code ?? ""} />
        </Field>

        <div className="flex flex-col gap-3 md:col-span-2">
          <Checkbox
            name="contains_egg"
            label="Contains egg"
            hint="Leave unticked for egg-free products. Add an eggless variant below if you offer both."
            defaultChecked={product?.contains_egg ?? false}
          />
          <Checkbox
            name="is_available"
            label="Available to order"
            hint="Untick to pause the product without archiving it."
            defaultChecked={product?.is_available ?? true}
          />
        </div>
      </fieldset>

      {!readOnly && (
        <div className="mt-6 flex items-center gap-4">
          <SubmitButton>{submitLabel}</SubmitButton>
          <FormMessage state={state} />
        </div>
      )}
    </form>
  );
}
