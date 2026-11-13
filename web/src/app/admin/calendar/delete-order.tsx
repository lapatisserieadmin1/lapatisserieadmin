"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteOrderAction } from "../orders/actions";

// Admin only: one tap deletes the order from the calendar, with its payments and bill, and no questions
// (owner, 2026-10-28).
export function DeleteOrderButton({ orderId, reference }: { orderId: string; reference: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function remove() {
    setError(null);
    start(async () => {
      const r = await deleteOrderAction({ orderId, reason: "Deleted from the calendar" }).catch(() => null);
      if (r?.ok) router.refresh();
      else setError(r?.message ?? "Could not delete. Try again.");
    });
  }

  return (
    <span className="relative z-10 inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={remove}
        disabled={pending}
        className="rounded-lg border border-danger/40 bg-surface px-2.5 py-1 text-xs font-medium text-danger hover:bg-danger-soft disabled:opacity-60"
        aria-label={`Delete order ${reference}`}
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {error && <span role="alert" className="max-w-48 text-right text-xs text-danger">{error}</span>}
    </span>
  );
}
