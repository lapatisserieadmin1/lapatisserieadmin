"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { formatPaise, paiseToRupeesInput } from "@/lib/money";
import { applyDiscountAction, issueBillAction, issueCreditNoteAction } from "../actions";

export function DiscountForm({
  orderId,
  version,
  currentDiscountPaise,
  isAdmin,
  limitBps,
}: {
  orderId: string;
  version: number;
  currentDiscountPaise: number;
  isAdmin: boolean;
  limitBps: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"percent" | "amount">("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (v: string, r: string, k: "percent" | "amount") =>
    start(async () => {
      setError(null);
      const result = await applyDiscountAction({ orderId, version, kind: k, value: v, reason: r });
      if (result.ok) {
        setOpen(false);
        setValue("");
        setReason("");
        router.refresh();
      } else setError(result.message ?? "Could not apply the discount.");
    });

  if (!open) {
    return (
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" className="text-brand-strong hover:underline" onClick={() => setOpen(true)}>
          {currentDiscountPaise > 0 ? "Change discount" : "Add discount"}
        </button>
        {currentDiscountPaise > 0 && (
          <button type="button" className="text-danger hover:underline" disabled={pending} onClick={() => submit("0", "", "amount")}>
            Remove discount
          </button>
        )}
        {error && <span className="text-danger">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="od-kind">Discount type</label>
        <Select id="od-kind" value={kind} onChange={(e) => setKind(e.target.value as "percent" | "amount")} className="w-24">
          <option value="percent">%</option>
          <option value="amount">₹</option>
        </Select>
        <label className="sr-only" htmlFor="od-value">Discount</label>
        <Input id="od-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "percent" ? "10" : "100"} />
      </div>
      <label className="sr-only" htmlFor="od-reason">Reason</label>
      <Input id="od-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required)" maxLength={300} />
      {!isAdmin && <p className="text-xs text-muted">Counter limit {limitBps / 100}% off; ask an admin for more.</p>}
      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button disabled={pending || !value.trim() || reason.trim().length < 2} onClick={() => submit(value, reason, kind)}>
          {pending ? "Applying…" : "Apply discount"}
        </Button>
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function BillPanel({
  orderId,
  canBill,
  bill,
  credits,
  isAdmin,
}: {
  orderId: string;
  canBill: boolean;
  bill: { id: string; number: string; totalPaise: number; issuedAt: string } | null;
  credits: { id: string; number: string; totalPaise: number; reason: string; issuedLabel: string }[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const credited = credits.reduce((s, c) => s + c.totalPaise, 0);
  const remaining = bill ? bill.totalPaise - credited : 0;
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditKey, setCreditKey] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState(paiseToRupeesInput(remaining));
  const [reason, setReason] = useState("");

  if (!bill) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted">No bill yet.{canBill ? "" : " Orders can be billed once confirmed."}</p>
        {canBill && (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                setError(null);
                const result = await issueBillAction(orderId);
                if (result.ok) router.refresh();
                else setError(result.message ?? "Could not issue the bill.");
              })
            }
          >
            {pending ? "Issuing…" : "Issue bill"}
          </Button>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-mono font-medium">{bill.number}</p>
          <p className="text-xs text-muted">{bill.issuedAt} · {formatPaise(bill.totalPaise)}</p>
        </div>
        <div className="flex gap-2">
          <a href={`/print/bill/${bill.id}?size=80mm`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-brand-soft">Print 80mm</a>
          <a href={`/print/bill/${bill.id}?size=a4`} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-1.5 font-medium hover:bg-brand-soft">A4</a>
        </div>
      </div>

      {credits.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {credits.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <div>
                <p className="font-mono">{c.number} · <span className="text-danger">−{formatPaise(c.totalPaise)}</span></p>
                <p className="text-xs text-muted">{c.issuedLabel} · {c.reason}</p>
              </div>
              <a href={`/print/credit-note/${c.id}?size=80mm`} target="_blank" rel="noreferrer" className="text-brand-strong hover:underline">Print</a>
            </li>
          ))}
        </ul>
      )}

      {isAdmin && remaining > 0 && (!creditOpen ? (
        <button type="button" className="self-start text-danger hover:underline" onClick={() => { setCreditOpen(true); setAmount(paiseToRupeesInput(remaining)); }}>
          Issue credit note
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-danger/30 p-3">
          <p className="text-xs text-muted">Bills are never edited. A credit note reduces what the customer owes; record any cash refund separately in Payments.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label={`Amount (up to ${formatPaise(remaining)})`} htmlFor="cn-amount">
              <Input id="cn-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field label="Reason" htmlFor="cn-reason">
              <Input id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} placeholder="e.g. Damaged item" />
            </Field>
          </div>
          {error && <p className="text-danger">{error}</p>}
          <div className="flex gap-2">
            <Button
              variant="danger"
              disabled={pending || reason.trim().length < 3}
              onClick={() =>
                start(async () => {
                  setError(null);
                  const result = await issueCreditNoteAction({ orderId, billId: bill.id, idempotencyKey: creditKey, amount, reason });
                  if (result.ok) {
                    setCreditOpen(false);
                    setReason("");
                    setCreditKey(crypto.randomUUID());
                    router.refresh();
                  } else setError(result.message ?? "Could not issue the credit note.");
                })
              }
            >
              {pending ? "Issuing…" : "Issue credit note"}
            </Button>
            <Button variant="secondary" onClick={() => setCreditOpen(false)}>Cancel</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
