"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Checkbox, Field, Input, Textarea, cx } from "@/components/ui";
import { SourceBadge } from "@/components/order-badges";
import { formatLeadTime, formatPaise } from "@/lib/money";
import { OverridePrompt } from "@/components/override-prompt";
import { PickupWindows } from "@/components/pickup-windows";
import { CataloguePicker, QuantityStepper } from "@/components/catalogue-picker";
import type { CatalogueProduct } from "@/lib/catalogue";
import { CustomerWarning } from "@/components/customer-warning";
import { FulfilmentFields, type FulfilmentValue } from "@/components/fulfilment-fields";
import { createOrderAction } from "../actions";

type Line = { key: string; productId: string; variantId: string; quantity: number; notes: string };

export function OrderEntry({
  source,
  catalogue,
  canConfirm,
  isAdmin,
  defaultDueLocal,
}: {
  source: "IN_STORE" | "CALL" | "CUSTOMER";
  catalogue: CatalogueProduct[];
  canConfirm: boolean;
  isAdmin: boolean;
  defaultDueLocal: string;
}) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [lines, setLines] = useState<Line[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pickupNow, setPickupNow] = useState(source === "IN_STORE");
  const [dueLocal, setDueLocal] = useState(defaultDueLocal);
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [confirm, setConfirm] = useState(canConfirm && source === "IN_STORE");
  const [fulfil, setFulfil] = useState<FulfilmentValue>({ fulfilment: "collect", address: "", note: "" });
  const [error, setError] = useState<{ message: string; kind?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const variantIndex = useMemo(() => {
    const map = new Map<string, { product: CatalogueProduct; variant: CatalogueProduct["variants"][number] }>();
    for (const product of catalogue) for (const variant of product.variants) map.set(variant.id, { product, variant });
    return map;
  }, [catalogue]);

  const total = lines.reduce((sum, l) => sum + (variantIndex.get(l.variantId)?.variant.pricePaise ?? 0) * l.quantity, 0);
  const maxLead = lines.reduce((max, l) => {
    const entry = variantIndex.get(l.variantId);
    return entry && entry.product.prepType === "made_to_order" ? Math.max(max, entry.variant.leadTimeMinutes) : max;
  }, 0);
  const categoryIds = [...new Set(lines.map((l) => variantIndex.get(l.variantId)?.product.categoryId).filter((id): id is string => Boolean(id)))];
  const needsCustomer = source !== "IN_STORE" || !pickupNow;
  const isSetup = fulfil.fulfilment === "setup";

  function addVariant(productId: string, variantId: string) {
    setError(null);
    setLines((current) => {
      const existing = current.find((l) => l.variantId === variantId && !l.notes);
      if (existing) return current.map((l) => (l === existing ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
      return [...current, { key: crypto.randomUUID(), productId, variantId, quantity: 1, notes: "" }];
    });
  }

  function updateLine(key: string, patch: Partial<Line>) {
    setError(null);
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function submit(overrideReason?: string) {
    setError(null);
    startTransition(async () => {
      const result = await createOrderAction({
        idempotencyKey,
        source,
        items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity, notes: l.notes })),
        customerName,
        customerPhone,
        dueLocal: pickupNow ? null : dueLocal,
        customerNotes,
        internalNotes,
        confirm,
        overrideReason,
        fulfilment: fulfil.fulfilment,
        setupAddress: fulfil.address,
        setupNote: fulfil.note,
      });
      if (result.ok) {
        router.push(`/admin/orders/${result.orderId}?created=1`);
      } else {
        setError({ message: result.message ?? "Could not save the order.", kind: result.kind });
      }
    });
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
      {/* Catalogue */}
      <Card className="lg:order-1">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Add items</h2>
          <SourceBadge source={source} />
        </div>
        <CataloguePicker catalogue={catalogue} onAdd={addVariant} autoFocus />
      </Card>

      {/* Order */}
      <div className="flex flex-col gap-4 lg:order-2">
        <Card>
          <h2 className="mb-3 text-lg font-semibold">Order</h2>
          {lines.length === 0 ? (
            <p className="text-sm text-muted">No items yet. Pick products from the list.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {lines.map((l) => {
                const entry = variantIndex.get(l.variantId);
                if (!entry) return null;
                return (
                  <li key={l.key} className="py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium">{entry.product.name}</p>
                        <p className="text-sm text-muted">
                          {entry.variant.name}
                          {entry.variant.isEggless && " · Eggless"} · {formatPaise(entry.variant.pricePaise)}
                        </p>
                      </div>
                      <p className="whitespace-nowrap font-medium">{formatPaise(entry.variant.pricePaise * l.quantity)}</p>
                    </div>
                    <QuantityStepper
                      id={l.key}
                      label={entry.product.name}
                      quantity={l.quantity}
                      onChange={(quantity) => updateLine(l.key, { quantity })}
                      onRemove={() => { setError(null); setLines((c) => c.filter((x) => x.key !== l.key)); }}
                    />
                    <label className="sr-only" htmlFor={`notes-${l.key}`}>Item notes</label>
                    <Input id={`notes-${l.key}`} className="mt-2" placeholder="Notes, e.g. cake message" maxLength={500}
                      value={l.notes} onChange={(e) => updateLine(l.key, { notes: e.target.value })} />
                  </li>
                );
              })}
            </ul>
          )}
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-muted">Total</span>
            <span className="text-xl font-semibold">{formatPaise(total)}</span>
          </div>
        </Card>

        <Card className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold">{isSetup ? "Set-up" : "Pickup"}</h2>
          <FulfilmentFields
            value={fulfil}
            onChange={(v) => {
              setError(null);
              setFulfil(v);
              // Set-up is always at an agreed time, never "now".
              if (v.fulfilment === "setup") setPickupNow(false);
            }}
          />
          {source === "IN_STORE" && !isSetup && (
            <div className="flex gap-4" role="radiogroup" aria-label="Pickup time">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pickup" className="accent-brand" checked={pickupNow} onChange={() => { setError(null); setPickupNow(true); }} />
                Now (walk-in)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="pickup" className="accent-brand" checked={!pickupNow} onChange={() => { setError(null); setPickupNow(false); }} />
                Later
              </label>
            </div>
          )}
          {!pickupNow && (
            <>
              <Field label={isSetup ? "Set-up date and time" : "Pickup date and time"} htmlFor="due" hint={`${maxLead > 0 ? `These items need ${formatLeadTime(maxLead)} of preparation. ` : ""}Bakery timezone; past dates are allowed for staff-entered orders.`}>
                <Input id="due" type="datetime-local" value={dueLocal} onChange={(e) => { setError(null); setDueLocal(e.target.value); }} required />
              </Field>
              <PickupWindows
                dayKey={dueLocal.slice(0, 10)}
                time={dueLocal.slice(11, 16)}
                categoryIds={categoryIds}
                onPick={(t) => { setError(null); setDueLocal(`${dueLocal.slice(0, 10)}T${t}`); }}
              />
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={needsCustomer ? "Customer name" : "Customer name (optional)"} htmlFor="cname">
              <Input id="cname" value={customerName} onChange={(e) => setCustomerName(e.target.value)} maxLength={80} autoComplete="off" />
            </Field>
            <Field label={needsCustomer ? "Phone" : "Phone (optional)"} htmlFor="cphone">
              <Input id="cphone" type="tel" inputMode="tel" value={customerPhone} onChange={(e) => { setError(null); setCustomerPhone(e.target.value); }} autoComplete="off" />
            </Field>
          </div>
          <CustomerWarning phone={customerPhone} />
          <Field label="Customer notes" htmlFor="cnotes">
            <Textarea id="cnotes" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} maxLength={1000} className="min-h-14" />
          </Field>
          <Field label="Internal notes (staff only)" htmlFor="inotes">
            <Textarea id="inotes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} maxLength={1000} className="min-h-14" />
          </Field>
          {canConfirm ? (
            <Checkbox
              label="Confirm now"
              hint={source === "IN_STORE" ? "Walk-in and counter orders are usually confirmed straight away." : "Confirms the promised time. Leave unticked to review later."}
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
          ) : (
            <p className="text-sm text-muted">An admin will confirm this order.</p>
          )}
        </Card>

        {error && (
          <OverridePrompt
            key={error.message}
            title="Order not saved"
            error={error}
            isAdmin={isAdmin}
            pending={pending}
            onOverride={(reason) => submit(reason)}
          />
        )}

        <Button
          type="button"
          className={cx("py-3 text-base")}
          disabled={pending || lines.length === 0 || (isSetup && !fulfil.address.trim())}
          onClick={() => submit()}
        >
          {pending ? "Saving…" : confirm ? `Create and confirm · ${formatPaise(total)}` : `Create order · ${formatPaise(total)}`}
        </Button>
      </div>
    </div>
  );
}
