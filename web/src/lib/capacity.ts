// Shapes returned by public.pickup_availability (migration 0410).
export type WindowUsage = { starts_at: string; ends_at: string; used: number; max: number | null };
export type CategoryUsage = { category_id: string; name: string; used: number; max: number };
export type PickupAvailability = { windows: WindowUsage[]; categories: CategoryUsage[] };

// Window rows as sent to set_pickup_windows / set_date_windows.
export type WindowInput = { starts_at: string; ends_at: string; max_orders: number | null };

type Slot = { starts_at: string; ends_at: string };

// Window for a business-local "HH:MM", mirroring private.window_for: both ends inclusive,
// and on a shared boundary the later-starting window wins. Null when outside every window.
export function windowFor<W extends Slot>(time: string, windows: W[]): W | null {
  let match: W | null = null;
  for (const w of windows) {
    if (w.starts_at <= time && time <= w.ends_at && (!match || w.starts_at > match.starts_at)) match = w;
  }
  return match;
}

// Orders sorted into their pickup windows (every window listed, in the given order);
// orders outside all windows (admin overrides) go to `outside`.
export function groupByWindow<T, W extends Slot>(orders: T[], timeOf: (order: T) => string, windows: W[]) {
  const groups = windows.map((window) => ({ window, orders: [] as T[] }));
  const outside: T[] = [];
  for (const order of orders) {
    const w = windowFor(timeOf(order), windows);
    const group = w && groups.find((g) => g.window === w);
    if (group) group.orders.push(order);
    else outside.push(order);
  }
  return { groups, outside };
}

// "09:00" -> "9:00 AM", "13:30" -> "1:30 PM".
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${suffix}`;
}
