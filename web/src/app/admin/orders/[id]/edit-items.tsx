"use client";

import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { CataloguePicker, QuantityStepper } from "@/components/catalogue-picker";
import { OverridePrompt } from "@/components/override-prompt";
import { formatPaise } from "@/lib/money";
import type { CatalogueProduct } from "@/lib/catalogue";
import { updateOrderItemsAction } from "../actions";

export type ExistingLine = {
  id: string;
  productName: string;
  variantName: string;
  unitPricePaise: number;
  quantity: number;
  notes: string;
  isEggless: boolean;
};

// lineId for lines already on the order (price kept), variantId for new ones (today's price).
type EditLine = {
  key: string;
  lineId?: string;
  variantId?: string;
  productName: string;
  variantName: string;
  unitPricePaise: number;
  quantity: number;
  notes: string;
  isEggless: boolean;
};

type Failure = { message: string; kind?: string };

const fromExisting = (lines: ExistingLine[]): EditLine[] => lines.map((l) => ({ ...l, key: l.id, lineId: l.id }));

// Shows the order's items (children) until "Edit items" is pressed, then the editor in their place.
export function EditItems({
  orderId,
  version,
  isAdmin,
  needsReason,
  discountPaise,
  existing,
  catalogue,
  children,
}: {
  orderId: string;
  version: number;
  isAdmin: boolean;
  needsReason: boolean;
  discountPaise: number;
  existing: ExistingLine[];
  catalogue: CatalogueProduct[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<EditLine[]>(() => fromExisting(existing));
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<Failure | null>(null);
  const [pending, start] = useTransition();

  const subtotal = lines.reduce((sum, l) => sum + l.unitPricePaise * l.quantity, 0);
  const reasonOk = !needsReason || reason.trim().length >= 3;

  if (!open) {
    return (
      <>
        {children}
        <div className="mt-3">
          <Button variant="secondary" onClick={() => setOpen(true)}>Edit items</Button>
        </div>
      </>
    );
  }

  function close() {
    setOpen(false);
    setLines(fromExisting(existing));
    setReason("");
    setFailed(null);
  }

  function update(key: string, patch: Partial<EditLine>) {
    setFailed(null);
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function add(productId: string, variantId: string) {
    const product = catalogue.find((p) => p.id === productId);
    const variant = product?.variants.find((v) => v.id === variantId);
    if (!product || !variant) return;
    setFailed(null);
    setLines((current) => {
      // Merge only into another new line: an existing line may carry an older price.
      const same = current.find((l) => l.variantId === variantId && !l.notes);
      if (same) return current.map((l) => (l === same ? { ...l, quantity: Math.min(999, l.quantity + 1) } : l));
      return [
        ...current,
        {
          key: crypto.randomUUID(),
          variantId,
          productName: product.name,
          variantName: variant.name,
          unitPricePaise: variant.pricePaise,
          quantity: 1,
          notes: "",
          isEggless: variant.isEggless,
        },
      ];
    });
  }

  function save(overrideReason?: string) {
    setFailed(null);
    start(async () => {
      const result = await updateOrderItemsAction({
        orderId,
        version,
        lines: lines.map((l) =>
          l.lineId
            ? { lineId: l.lineId, quantity: l.quantity, notes: l.notes }
            : { variantId: l.variantId ?? "", quantity: l.quantity, notes: l.notes },
        ),
        reason,
        overrideReason,
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setFailed({ message: result.message ?? "Could not save the items.", kind: result.kind });
      }
    });
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No items. Add at least one, or cancel the order instead.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {lines.map((l) => (
              <li key={l.key} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{l.productName}</p>
                    <p className="text-sm text-muted">
                      {l.variantName}
                      {l.isEggless && " · Eggless"} · {formatPaise(l.unitPricePaise)}
                      {!l.lineId && " · new"}
                    </p>
                  </div>
                  <p className="whitespace-nowrap font-medium">{formatPaise(l.unitPricePaise * l.quantity)}</p>
                </div>
                <QuantityStepper
                  id={l.key}
                  label={l.productName}
                  quantity={l.quantity}
                  onChange={(quantity) => update(l.key, { quantity })}
                  onRemove={() => { setFailed(null); setLines((c) => c.filter((x) => x.key !== l.key)); }}
                />
                <label className="sr-only" htmlFor={`edit-notes-${l.key}`}>Item notes</label>
                <Input id={`edit-notes-${l.key}`} className="mt-2" placeholder="Notes, e.g. cake message" maxLength={500}
                  value={l.notes} onChange={(e) => update(l.key, { notes: e.target.value })} />
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-1 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{formatPaise(subtotal)}</span></div>
          {discountPaise > 0 && (
            <div className="flex justify-between text-ok">
              <span>Discount (stays at {formatPaise(discountPaise)}, never more than the subtotal)</span>
              <span>−{formatPaise(Math.min(discountPaise, subtotal))}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <span>New total</span><span>{formatPaise(Math.max(0, subtotal - discountPaise))}</span>
          </div>
        </div>
        <Field
          label={needsReason ? "Reason for the change" : "Reason (optional)"}
          htmlFor="edit-reason"
          hint={needsReason ? "Confirmed and preparing orders need a reason; it is shown in the timeline." : undefined}
        >
          <Input id="edit-reason" value={reason} onChange={(e) => { setFailed(null); setReason(e.target.value); }} maxLength={300}
            placeholder="e.g. Customer called to add puffs" />
        </Field>
        {failed && (failed.kind === "conflict" ? (
          <Alert tone="danger">
            <p>{failed.message}</p>
            <Button variant="secondary" className="mt-2" onClick={() => { close(); router.refresh(); }}>Reload order</Button>
          </Alert>
        ) : (
          <OverridePrompt key={failed.message} error={failed} isAdmin={isAdmin} pending={pending} onOverride={(o) => save(o)} />
        ))}
        <div className="flex gap-2">
          <Button disabled={pending || lines.length === 0 || !reasonOk} onClick={() => save()}>
            {pending ? "Saving…" : "Save items"}
          </Button>
          <Button variant="secondary" onClick={close}>Discard changes</Button>
        </div>
      </div>
      <div>
        <h3 className="mb-2 font-semibold">Add items</h3>
        <CataloguePicker catalogue={catalogue} onAdd={add} listClassName="max-h-96" />
      </div>
    </div>
  );
}
