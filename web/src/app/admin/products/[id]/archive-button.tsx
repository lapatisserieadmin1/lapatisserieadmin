"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";

export function ArchiveProductButton({
  archived,
  action,
}: {
  archived: boolean;
  action: (archived: boolean) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = (next: boolean) =>
    start(async () => {
      setError(null);
      try {
        await action(next);
        setConfirming(false);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not update the product.");
      }
    });

  if (archived) {
    return (
      <Button variant="secondary" disabled={pending} onClick={() => run(false)}>
        {pending ? "Restoring…" : "Restore product"}
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">Hide from new orders?</span>
          <Button variant="danger" disabled={pending} onClick={() => run(true)}>
            {pending ? "Archiving…" : "Archive"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setConfirming(true)}>
          Archive product
        </Button>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
