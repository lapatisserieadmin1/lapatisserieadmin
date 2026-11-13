"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { deleteProductAction } from "./actions";

// Admin only. Asks once, then deletes the product with its sizes and photo; past orders keep its name and price.
export function DeleteProductButton({ productId, name, afterDelete }: { productId: string; name: string; afterDelete?: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setError(null);
      const r = await deleteProductAction(productId).catch(() => null);
      if (r?.ok) {
        setConfirming(false);
        if (afterDelete) router.push(afterDelete);
        router.refresh();
      } else {
        setError(r?.message ?? "Could not delete the product. Check the connection and try again.");
      }
    });

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-sm text-muted">Delete “{name}” for good?</span>
          <Button variant="danger" className="py-1.5!" disabled={pending} onClick={run}>
            {pending ? "Deleting…" : "Delete"}
          </Button>
          <Button variant="secondary" className="py-1.5!" disabled={pending} onClick={() => setConfirming(false)}>
            Keep
          </Button>
        </div>
      ) : (
        <Button variant="danger" className="py-1.5!" onClick={() => setConfirming(true)} aria-label={`Delete product ${name}`}>
          Delete
        </Button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
