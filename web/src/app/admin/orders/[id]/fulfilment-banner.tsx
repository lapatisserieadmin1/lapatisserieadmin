"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, cx } from "@/components/ui";
import { FulfilmentFields, type FulfilmentValue } from "@/components/fulfilment-fields";
import type { Fulfilment } from "@/lib/orders";
import { mapsUrl } from "@/lib/location";
import { setFulfilmentAction } from "../actions";

// The big green (collect) or red (set up) banner at the top of an order, with "Change" until the order
// is closed. The database refuses changes on completed, cancelled and rejected orders.
export function FulfilmentBanner({
  orderId,
  version,
  fulfilment,
  address,
  note,
  canChange,
}: {
  orderId: string;
  version: number;
  fulfilment: Fulfilment;
  address: string | null;
  note: string | null;
  canChange: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<FulfilmentValue>({ fulfilment, address: address ?? "", note: note ?? "" });
  const [error, setError] = useState<{ message: string; kind?: string } | null>(null);
  const [pending, start] = useTransition();
  const setup = fulfilment === "setup";

  function save() {
    setError(null);
    start(async () => {
      let result: { ok?: boolean; message?: string; kind?: string };
      try {
        result = await setFulfilmentAction({ orderId, version, fulfilment: value.fulfilment, setupAddress: value.address, setupNote: value.note });
      } catch {
        result = { message: "Not saved, check the connection." };
      }
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError({ message: result.message ?? "Something went wrong.", kind: result.kind });
      }
    });
  }

  return (
    <section
      aria-label={setup ? "Set up at the customer's place" : "Pickup/Cab"}
      className={cx(
        "rounded-2xl border-2 p-4",
        setup ? "border-danger bg-danger-soft text-danger" : "border-ok bg-ok-soft text-ok",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-bold">
            <span aria-hidden>{setup ? "🚚 " : "🏪 "}</span>
            {setup ? "Set up at customer's place" : "Pickup/Cab"}
          </p>
          {address && <p className="mt-1 font-medium text-ink">{address}</p>}
          {note && <p className="text-sm text-ink">{`Landmark: ${note}`}</p>}
          {mapsUrl(address, note) && (
            <a href={mapsUrl(address, note)!} target="_blank" rel="noopener noreferrer"
              className="mt-1 inline-block text-sm font-medium text-ink underline underline-offset-2">
              Open in Google Maps
            </a>
          )}
        </div>
        {canChange && !editing && (
          <Button variant="secondary" onClick={() => setEditing(true)}>Change</Button>
        )}
      </div>
      {editing && (
        <div className="mt-4 flex flex-col gap-3 rounded-xl bg-surface p-3 text-ink">
          <FulfilmentFields value={value} onChange={(v) => { setError(null); setValue(v); }} idPrefix="change-fulfil" />
          {error && (
            <Alert tone="danger">
              <p>{error.message}</p>
              {error.kind === "conflict" && (
                <Button variant="secondary" className="mt-2" onClick={() => router.refresh()}>Reload order</Button>
              )}
            </Alert>
          )}
          <div className="flex gap-2">
            <Button disabled={pending || (value.fulfilment === "setup" && !value.address.trim())} onClick={save}>
              {pending ? "Saving…" : "Save"}
            </Button>
            <Button variant="secondary" onClick={() => { setEditing(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}
    </section>
  );
}
