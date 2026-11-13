"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input, Select } from "@/components/ui";
import { paymentMethodLabel, type OrderStatus, type PaymentMethod } from "@/lib/orders";
import { OverridePrompt } from "@/components/override-prompt";
import { PickupWindows } from "@/components/pickup-windows";
import { paiseToRupeesInput } from "@/lib/money";
import {
  cancelOrderAction,
  confirmOrderAction,
  recordNoShowAction,
  recordPaymentAction,
  rejectOrderAction,
  rescheduleOrderAction,
  undoNoShowAction,
} from "../actions";

type Failure = { message: string; kind?: string };

function ErrorBox({ error, onReload }: { error: Failure; onReload: () => void }) {
  return (
    <Alert tone="danger">
      <p>{error.message}</p>
      {error.kind === "conflict" && (
        <Button variant="secondary" className="mt-2" onClick={onReload}>
          Reload order
        </Button>
      )}
    </Alert>
  );
}

type Mode = null | "reject" | "cancel" | "reschedule";
type Attempt = (overrideReason?: string) => Promise<{ ok?: boolean; message?: string; kind?: string }>;

export function OrderActions({
  orderId,
  version,
  status,
  isAdmin,
  canConfirm,
  dueLocal,
  categoryIds,
}: {
  orderId: string;
  version: number;
  status: OrderStatus;
  isAdmin: boolean;
  canConfirm: boolean;
  dueLocal: string;
  categoryIds: string[];
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [reason, setReason] = useState("");
  const [newDue, setNewDue] = useState(dueLocal);
  const [failed, setFailed] = useState<{ error: Failure; retry: Attempt } | null>(null);
  const [pending, start] = useTransition();

  const awaiting = status === "draft" || status === "pending_confirmation";
  const open = !["completed", "rejected", "cancelled"].includes(status);
  // Preparing orders too. Packed orders are reopened first.
  const reschedulable = awaiting || status === "confirmed" || status === "preparing";

  // Runs an action; on refusal keeps it so an admin can retry it with an override reason.
  function run(attempt: Attempt, overrideReason?: string) {
    setFailed(null);
    start(async () => {
      const result = await attempt(overrideReason);
      if (result.ok) {
        setMode(null);
        setReason("");
        router.refresh();
      } else {
        setFailed({ error: { message: result.message ?? "Something went wrong.", kind: result.kind }, retry: attempt });
      }
    });
  }

  if (!open) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {awaiting && canConfirm && (
          <Button disabled={pending} onClick={() => run((o) => confirmOrderAction({ orderId, version, overrideReason: o }))}>
            {pending && mode === null ? "Confirming…" : "Confirm order"}
          </Button>
        )}
        {isAdmin && reschedulable && (
          <Button variant="secondary" onClick={() => { setMode(mode === "reschedule" ? null : "reschedule"); setFailed(null); }}>
            Reschedule
          </Button>
        )}
        {isAdmin && awaiting && (
          <Button variant="secondary" onClick={() => { setMode(mode === "reject" ? null : "reject"); setFailed(null); }}>
            Reject
          </Button>
        )}
        {isAdmin && (
          <Button variant="danger" onClick={() => { setMode(mode === "cancel" ? null : "cancel"); setFailed(null); }}>
            Cancel order
          </Button>
        )}
      </div>

      {(mode === "reject" || mode === "cancel") && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
          <Field
            label={mode === "reject" ? "Reason for rejecting" : "Reason for cancelling"}
            htmlFor="close-reason"
            hint={mode === "cancel" ? "Payments are not refunded automatically; record any refund separately." : "The customer should be told this reason."}
          >
            <Input id="close-reason" value={reason} onChange={(e) => { setFailed(null); setReason(e.target.value); }} maxLength={300} autoFocus />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" disabled={pending || reason.trim().length < 3}
              onClick={() => run(() => (mode === "reject" ? rejectOrderAction : cancelOrderAction)({ orderId, version, reason }))}>
              {pending ? "Saving…" : mode === "reject" ? "Reject order" : "Cancel order"}
            </Button>
            <Button variant="secondary" onClick={() => setMode(null)}>Keep order</Button>
          </div>
        </div>
      )}

      {mode === "reschedule" && (
        <div className="flex flex-col gap-3 rounded-lg border border-line p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="New pickup time" htmlFor="new-due">
              <Input id="new-due" type="datetime-local" value={newDue} onChange={(e) => { setFailed(null); setNewDue(e.target.value); }} />
            </Field>
            <Field label="Reason" htmlFor="resched-reason">
              <Input id="resched-reason" value={reason} onChange={(e) => { setFailed(null); setReason(e.target.value); }} maxLength={300} placeholder="e.g. Customer asked for evening" />
            </Field>
          </div>
          <PickupWindows
            dayKey={newDue.slice(0, 10)}
            time={newDue.slice(11, 16)}
            categoryIds={categoryIds}
            excludeOrderId={orderId}
            onPick={(t) => { setFailed(null); setNewDue(`${newDue.slice(0, 10)}T${t}`); }}
          />
          <div className="flex gap-2">
            <Button disabled={pending || reason.trim().length < 3}
              onClick={() => run((o) => rescheduleOrderAction({ orderId, version, dueLocal: newDue, reason, overrideReason: o }))}>
              {pending ? "Saving…" : "Save new time"}
            </Button>
            <Button variant="secondary" onClick={() => { setMode(null); setFailed(null); }}>Close</Button>
          </div>
        </div>
      )}

      {failed && (failed.error.kind === "conflict" ? (
        <ErrorBox error={failed.error} onReload={() => { setFailed(null); router.refresh(); }} />
      ) : (
        <OverridePrompt
          key={failed.error.message}
          error={failed.error}
          isAdmin={isAdmin}
          pending={pending}
          onOverride={(reason) => run(failed.retry, reason)}
        />
      ))}
    </div>
  );
}

// Records that the customer did not collect. The order's status is left alone: staff cancel
// or complete it separately. Admins can undo with a reason.
export function NoShowPanel({
  orderId,
  version,
  isAdmin,
  canRecord,
  recorded,
}: {
  orderId: string;
  version: number;
  isAdmin: boolean;
  canRecord: boolean;
  recorded: { label: string } | null;
}) {
  const router = useRouter();
  const [undoing, setUndoing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<Failure | null>(null);
  const [pending, start] = useTransition();

  function run(attempt: () => Promise<{ ok?: boolean; message?: string; kind?: string }>) {
    setError(null);
    start(async () => {
      const result = await attempt();
      if (result.ok) {
        setUndoing(false);
        setReason("");
        router.refresh();
      } else {
        setError({ message: result.message ?? "Something went wrong.", kind: result.kind });
      }
    });
  }

  if (!recorded && !canRecord) return null;

  return (
    <div className="flex flex-col gap-2">
      {recorded ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-danger">No-show recorded</span>
          <span className="text-muted">{recorded.label}</span>
          {isAdmin && !undoing && (
            <Button variant="secondary" onClick={() => setUndoing(true)}>Undo</Button>
          )}
        </div>
      ) : (
        <div>
          <Button variant="secondary" disabled={pending} onClick={() => run(() => recordNoShowAction({ orderId, version }))}>
            {pending ? "Saving…" : "Record no-show"}
          </Button>
          <p className="mt-1 text-xs text-muted">Counts against the customer. It does not cancel or complete the order.</p>
        </div>
      )}
      {undoing && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
          <Field label="Reason for undoing" htmlFor="undo-no-show-reason">
            <Input id="undo-no-show-reason" value={reason} onChange={(e) => { setError(null); setReason(e.target.value); }} maxLength={300} autoFocus placeholder="e.g. Customer collected late" />
          </Field>
          <div className="flex gap-2">
            <Button disabled={pending || reason.trim().length < 3} onClick={() => run(() => undoNoShowAction({ orderId, version, reason }))}>
              {pending ? "Saving…" : "Undo no-show"}
            </Button>
            <Button variant="secondary" onClick={() => { setUndoing(false); setError(null); }}>Close</Button>
          </div>
        </div>
      )}
      {error && <ErrorBox error={error} onReload={() => { setError(null); router.refresh(); }} />}
    </div>
  );
}

export function PaymentForm({
  orderId,
  balancePaise,
  refundablePaise,
  isAdmin,
  acceptsPayments,
  today,
}: {
  orderId: string;
  balancePaise: number;
  refundablePaise: number;
  isAdmin: boolean;
  acceptsPayments: boolean;
  today: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<"payment" | "refund">(acceptsPayments && balancePaise > 0 ? "payment" : "refund");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [amount, setAmount] = useState(paiseToRupeesInput(Math.max(0, kind === "payment" ? balancePaise : refundablePaise)));
  const [paidOn, setPaidOn] = useState(today);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  const canPay = acceptsPayments && balancePaise > 0;
  const canRefund = isAdmin && refundablePaise > 0;
  if (!canPay && !canRefund) return null;

  function switchKind(next: "payment" | "refund") {
    setKind(next);
    setAmount(paiseToRupeesInput(next === "payment" ? balancePaise : refundablePaise));
    setMessage(null);
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        start(async () => {
          const result = await recordPaymentAction({ orderId, idempotencyKey: key, kind, method, amount, paidOn, reference, note });
          if (result.ok) {
            setMessage({ ok: true, text: kind === "payment" ? "Payment recorded." : "Refund recorded." });
            setKey(crypto.randomUUID());
            setReference("");
            setNote("");
            router.refresh();
          } else {
            setMessage({ ok: false, text: result.message ?? "Could not record it." });
          }
        });
      }}
    >
      {canPay && canRefund && (
        <div className="flex gap-4" role="radiogroup" aria-label="Type">
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" className="accent-brand" checked={kind === "payment"} onChange={() => switchKind("payment")} /> Payment
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" className="accent-brand" checked={kind === "refund"} onChange={() => switchKind("refund")} /> Refund
          </label>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount (₹)" htmlFor="pay-amount">
          <Input id="pay-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        </Field>
        <Field label="Method" htmlFor="pay-method">
          <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(paymentMethodLabel) as PaymentMethod[]).map((m) => (
              <option key={m} value={m}>{paymentMethodLabel[m]}</option>
            ))}
          </Select>
        </Field>
        <Field label={kind === "refund" ? "Refund date" : "Paid on"} htmlFor="pay-date">
          <Input id="pay-date" type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} required />
        </Field>
        <Field label="Transaction reference (optional)" htmlFor="pay-ref" hint="UPI or card transaction ID.">
          <Input id="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} />
        </Field>
        <Field label={kind === "refund" ? "Reason (required)" : "Note (optional)"} htmlFor="pay-note">
          <Input id="pay-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} required={kind === "refund"} />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" variant={kind === "refund" ? "danger" : "primary"} disabled={pending}>
          {pending ? "Saving…" : kind === "payment" ? "Record payment" : "Record refund"}
        </Button>
        {message && <p aria-live="polite" className={message.ok ? "text-sm text-ok" : "text-sm text-danger"}>{message.text}</p>}
      </div>
    </form>
  );
}
