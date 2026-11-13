"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui";
import { customerFlagsAction, type CustomerFlags } from "@/app/admin/orders/actions";

const PHONE = /^\+?[0-9]{10,15}$/;

// Warns while taking an order when the phone belongs to a blocked customer or one with no-shows.
// Blocked numbers are still refused by create_order; this only tells staff before they submit.
export function CustomerWarning({ phone }: { phone: string }) {
  const normalised = phone.replace(/[\s()-]/g, "");
  const valid = PHONE.test(normalised);
  const [loaded, setLoaded] = useState<{ phone: string; flags: CustomerFlags | null } | null>(null);

  useEffect(() => {
    if (!valid) return;
    let live = true;
    // Short pause so typing the last digits does not fire one lookup per key.
    const timer = setTimeout(() => {
      customerFlagsAction(normalised).then((flags) => {
        if (live) setLoaded({ phone: normalised, flags });
      });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [normalised, valid]);

  if (!valid || !loaded || loaded.phone !== normalised || !loaded.flags) return null;
  const { name, isBlocked, blockedReason, noShowCount } = loaded.flags;
  const noShows = noShowCount > 0 ? `${noShowCount} recorded no-show${noShowCount === 1 ? "" : "s"}` : null;

  return isBlocked ? (
    <Alert tone="danger" title={`${name} is blocked`}>
      {blockedReason}
      {noShows && ` · ${noShows}`}. The order will be refused unless an admin overrides with a reason.
    </Alert>
  ) : (
    <Alert tone="warn" title={`${name} has ${noShows}`}>
      Recorded on earlier orders that were not collected.
    </Alert>
  );
}
