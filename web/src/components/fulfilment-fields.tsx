"use client";

import { Field, Input, cx } from "@/components/ui";
import type { Fulfilment } from "@/lib/orders";

export type FulfilmentValue = { fulfilment: Fulfilment; address: string; note: string };

// Collect from the store (green) or set up at the customer's place (red), with the customer's address and
// landmark (required for set-up, optional for Pickup/Cab).
// Used by every order form and by the order page's "Change" form.
export function FulfilmentFields({
  value,
  onChange,
  idPrefix = "fulfil",
}: {
  value: FulfilmentValue;
  onChange: (value: FulfilmentValue) => void;
  idPrefix?: string;
}) {
  const option = (f: Fulfilment, label: string, icon: string, tone: string, active: string) => (
    <label
      className={cx(
        "flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-sm font-semibold",
        value.fulfilment === f ? active : "border-line bg-surface text-muted hover:border-brand/40",
        "has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand",
      )}
    >
      <input
        type="radio"
        name={`${idPrefix}-type`}
        className="sr-only"
        checked={value.fulfilment === f}
        onChange={() => onChange({ ...value, fulfilment: f })}
      />
      <span aria-hidden>{icon}</span>
      <span className={value.fulfilment === f ? tone : undefined}>{label}</span>
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Pickup/Cab or set up" className="flex flex-wrap gap-3">
        {option("collect", "Pickup/Cab", "🏪", "text-ok", "border-ok bg-ok-soft")}
        {option("setup", "Set up at customer's place", "🚚", "text-danger", "border-danger bg-danger-soft")}
      </div>
      <div
        className={cx(
          "grid gap-3 rounded-xl border p-3",
          value.fulfilment === "setup" ? "border-danger/30 bg-danger-soft/40" : "border-ok/30 bg-ok-soft/40",
        )}
      >
        <Field
          label={value.fulfilment === "setup" ? "Set-up address" : "Customer address (optional)"}
          htmlFor={`${idPrefix}-address`}
          hint={value.fulfilment === "setup" ? undefined : "Where the cab goes, if the customer books one."}
        >
          <Input
            id={`${idPrefix}-address`}
            value={value.address}
            onChange={(e) => onChange({ ...value, address: e.target.value })}
            maxLength={300}
            required={value.fulfilment === "setup"}
            autoComplete="off"
            placeholder="House / hall, street, area"
          />
        </Field>
        <Field label="Landmark (optional)" htmlFor={`${idPrefix}-note`}>
          <Input
            id={`${idPrefix}-note`}
            value={value.note}
            onChange={(e) => onChange({ ...value, note: e.target.value })}
            maxLength={300}
            autoComplete="off"
            placeholder="e.g. Opposite the temple, near the bus stop"
          />
        </Field>
      </div>
    </div>
  );
}
