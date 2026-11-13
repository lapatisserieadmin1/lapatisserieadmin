"use client";

import { useEffect, useState } from "react";
import { cx } from "@/components/ui";
import { formatClock, type PickupAvailability } from "@/lib/capacity";
import { pickupAvailabilityAction } from "@/app/admin/orders/actions";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

// Shows the day's pickup windows with bookings, and caps for the categories in this order.
// Full windows stay selectable: saving then asks an admin for an override reason.
export function PickupWindows({
  dayKey,
  time,
  categoryIds,
  excludeOrderId,
  onPick,
}: {
  dayKey: string;
  time: string;
  categoryIds: string[];
  // The order being rescheduled, left out of the counts (it does not compete with itself).
  excludeOrderId?: string;
  onPick: (time: string) => void;
}) {
  const [loaded, setLoaded] = useState<{ dayKey: string; data: PickupAvailability | null } | null>(null);
  const validDay = DAY_KEY.test(dayKey);

  useEffect(() => {
    if (!validDay) return;
    let live = true;
    pickupAvailabilityAction(dayKey, excludeOrderId).then((data) => {
      if (live) setLoaded({ dayKey, data });
    });
    return () => {
      live = false;
    };
  }, [dayKey, validDay, excludeOrderId]);

  if (!validDay) return null;
  if (!loaded || loaded.dayKey !== dayKey) return <p className="text-sm text-muted">Checking availability…</p>;
  if (!loaded.data) return <p className="text-sm text-muted">Could not load availability for this day.</p>;

  const { windows, categories } = loaded.data;
  const capped = categories.filter((c) => categoryIds.includes(c.category_id));

  return (
    <div className="flex flex-col gap-2">
      {windows.length === 0 ? (
        <p className="text-sm text-muted">No pickup windows set for this day; any time within opening hours.</p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Pickup windows">
          {windows.map((w) => {
            const full = w.max !== null && w.used >= w.max;
            const selected = time >= w.starts_at && time < w.ends_at;
            return (
              <li key={w.starts_at}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onPick(w.starts_at)}
                  className={cx(
                    "rounded-lg border px-3 py-1.5 text-left text-sm",
                    selected ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-brand",
                    full && "text-danger",
                  )}
                >
                  {formatClock(w.starts_at)}–{formatClock(w.ends_at)} ·{" "}
                  {w.max === null ? `${w.used} booked` : `${w.used}/${w.max} booked`}
                  {full && <span className="ml-1 font-semibold">Full</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {capped.map((c) => (
        <p key={c.category_id} className={cx("text-sm", c.used >= c.max ? "text-danger" : "text-muted")}>
          {c.name}: {c.used}/{c.max} orders on this day{c.used >= c.max ? " — full" : ""}
        </p>
      ))}
    </div>
  );
}
