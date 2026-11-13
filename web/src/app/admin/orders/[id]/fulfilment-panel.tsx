"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Field, Input } from "@/components/ui";
import { OverridePrompt } from "@/components/override-prompt";
import { formatPaise } from "@/lib/money";
import type { OrderStatus } from "@/lib/orders";
import { markPackedAction, recordHandoverAction, reopenPackingAction } from "../actions";

type Failure = { message: string; kind?: string };
type Outcome = { ok?: boolean; message?: string; kind?: string };

// Packing (one confirmation per order → Ready) and handover (once → Completed), Phase 5B.
// The database enforces every rule; this panel explains what is missing before it is tried.
export function FulfilmentPanel({
  orderId,
  version,
  status,
  isAdmin,
  balancePaise,
  isSetup = false,
  packed,
  handedOver,
}: {
  orderId: string;
  version: number;
  status: OrderStatus;
  isAdmin: boolean;
  balancePaise: number;
  isSetup?: boolean;
  packed: { label: string; note: string | null } | null;
  handedOver: { label: string; collectedBy: string | null; creditReason: string | null } | null;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [collectedBy, setCollectedBy] = useState("");
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");
  const [failed, setFailed] = useState<{ error: Failure; retry?: (overrideReason: string) => Promise<Outcome> } | null>(null);
  const [pending, start] = useTransition();

  function run(attempt: () => Promise<Outcome>, retry?: (overrideReason: string) => Promise<Outcome>) {
    setFailed(null);
    start(async () => {
      let result: Outcome;
      try {
        result = await attempt();
      } catch {
        result = { message: "Not saved, check the connection." };
      }
      if (result.ok) {
        setReopening(false);
        setReason("");
        router.refresh();
      } else {
        setFailed({ error: { message: result.message ?? "Something went wrong.", kind: result.kind }, retry });
      }
    });
  }

  const packable = status === "confirmed" || status === "preparing";
  const handover = (creditReason?: string) =>
    recordHandoverAction({ orderId, version, collectedBy, creditReason });

  const failure = failed &&
    (failed.error.kind === "conflict" ? (
      <Alert tone="danger">
        <p>{failed.error.message}</p>
        <Button variant="secondary" className="mt-2" onClick={() => { setFailed(null); router.refresh(); }}>Reload order</Button>
      </Alert>
    ) : (
      <OverridePrompt
        key={failed.error.message}
        error={failed.error}
        isAdmin={isAdmin}
        pending={pending}
        title={failed.error.kind === "balance" ? "Balance due" : undefined}
        actionLabel={failed.error.kind === "balance" ? "Hand over on credit" : undefined}
        onOverride={(r) => failed.retry && run(() => failed.retry!(r), failed.retry)}
      />
    ));

  if (status === "completed") {
    return (
      <dl className="flex flex-col gap-2 text-sm">
        {packed && <div><dt className="text-muted">Packed</dt><dd>{packed.label}{packed.note && ` · ${packed.note}`}</dd></div>}
        {handedOver ? (
          <>
            <div><dt className="text-muted">{isSetup ? "Set up" : "Handed over"}</dt><dd className="font-medium">{handedOver.label}</dd></div>
            {handedOver.collectedBy && <div><dt className="text-muted">Collected by</dt><dd>{handedOver.collectedBy}</dd></div>}
            {handedOver.creditReason && (
              <div><dt className="text-muted">Handed over on credit</dt><dd>{handedOver.creditReason}</dd></div>
            )}
          </>
        ) : (
          <p className="text-muted">Completed at the counter.</p>
        )}
      </dl>
    );
  }

  if (status === "confirmed" || status === "preparing") {
    return (
      <div className="flex flex-col gap-3">
        {packable && (
          <p className="text-sm text-muted">When everything is ready, check each item, quantity and any cake wording, then confirm the packing.</p>
        )}
        <Field label="Packing note (optional)" htmlFor="packing-note">
          <Input id="packing-note" value={note} onChange={(e) => { setFailed(null); setNote(e.target.value); }} maxLength={300}
            placeholder="e.g. Candles packed separately" />
        </Field>
        <div>
          <Button disabled={pending || !packable} onClick={() => run(() => markPackedAction({ orderId, version, note }))}>
            {pending ? "Saving…" : "Mark packed"}
          </Button>
        </div>
        {failure}
      </div>
    );
  }

  if (status !== "ready") return null;

  return (
    <div className="flex flex-col gap-3">
      {packed && (
        <p className="text-sm">
          <span className="font-medium">Packed</span> {packed.label}
          {packed.note && <span className="text-muted"> · {packed.note}</span>}
        </p>
      )}
      <p className={balancePaise > 0 ? "text-sm font-semibold text-warn" : balancePaise < 0 ? "text-sm font-semibold text-danger" : "text-sm font-semibold text-ok"}>
        {balancePaise > 0
          ? `Balance due ${formatPaise(balancePaise)}: record the payment before handing over.`
          : balancePaise < 0
            ? `Refund due ${formatPaise(-balancePaise)}`
            : "Fully paid"}
      </p>
      <Field
        label={isSetup ? "Received by (optional)" : "Collected by (optional)"}
        htmlFor="collected-by"
        hint={isSetup ? "Who took the cake at the venue, if not the customer." : "Only if someone other than the customer collects."}
      >
        <Input id="collected-by" value={collectedBy} onChange={(e) => { setFailed(null); setCollectedBy(e.target.value); }} maxLength={80} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => run(() => handover(), (r) => handover(r))}>
          {pending ? "Saving…" : isSetup ? "Set up done" : "Hand over"}
        </Button>
        {isAdmin && !reopening && (
          <Button variant="secondary" onClick={() => { setReopening(true); setFailed(null); }}>Reopen packing</Button>
        )}
      </div>
      {reopening && (
        <div className="flex flex-col gap-2 rounded-lg border border-line p-4">
          <Field label="Reason for reopening (recorded)" htmlFor="reopen-reason" hint="At least 5 characters.">
            <Input id="reopen-reason" value={reason} onChange={(e) => { setFailed(null); setReason(e.target.value); }} maxLength={300} autoFocus
              placeholder="e.g. Wrong box, repacking" />
          </Field>
          <div className="flex gap-2">
            <Button variant="danger" disabled={pending || reason.trim().length < 5}
              onClick={() => run(() => reopenPackingAction({ orderId, version, reason }))}>
              {pending ? "Saving…" : "Reopen packing"}
            </Button>
            <Button variant="secondary" onClick={() => setReopening(false)}>Close</Button>
          </div>
        </div>
      )}
      {failure}
    </div>
  );
}
