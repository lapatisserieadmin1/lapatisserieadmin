// The chef screen (2026-10-20): rows from public.chef_work grouped into orders. Everything about an order
// except money: no prices, totals or payments reach it.
import type { Database } from "./database.types";
import { addDays } from "./time.ts";

export type ChefRow = Database["public"]["Functions"]["chef_work"]["Returns"][number];

// "day" is one date picked on the calendar; it has no chip of its own (the Calendar chip stays lit).
export type KitchenTab = "today" | "tomorrow" | "later" | "calendar" | "day";
export const KITCHEN_TABS: { key: KitchenTab; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "later", label: "Next 2 weeks" },
  { key: "calendar", label: "Calendar" },
];

export function kitchenTab(value: unknown): KitchenTab {
  return value === "tomorrow" || value === "later" || value === "calendar" || value === "day" ? value : "today";
}

// A calendar day from the URL ("YYYY-MM-DD"), or today when it is missing or not a real date.
export function kitchenDay(value: unknown, todayKey: string): string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && addDays(value, 0) === value ? value : todayKey;
}

// A calendar month from the URL ("YYYY-MM"), or this month.
export function kitchenMonth(value: unknown, todayKey: string): string {
  return typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : todayKey.slice(0, 7);
}

// The month grid: whole weeks, Monday to Sunday, 6 rows = 42 days (chef_work allows up to 62).
export const CALENDAR_DAYS = 42;
export function monthGridStart(month: string): string {
  const first = `${month}-01`;
  return addDays(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
}

export function shiftMonth(month: string, by: number): string {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
}

// Business-time date range [from, to] (inclusive) for a tab.
export function tabRange(tab: KitchenTab, todayKey: string, pick: { day?: string; month?: string } = {}): { from: string; to: string } {
  if (tab === "tomorrow") return { from: addDays(todayKey, 1), to: addDays(todayKey, 1) };
  if (tab === "later") return { from: addDays(todayKey, 2), to: addDays(todayKey, 15) };
  if (tab === "day") {
    const day = pick.day ?? todayKey;
    return { from: day, to: day };
  }
  if (tab === "calendar") {
    const start = monthGridStart(pick.month ?? todayKey.slice(0, 7));
    return { from: start, to: addDays(start, CALENDAR_DAYS - 1) };
  }
  return { from: todayKey, to: todayKey };
}

export type CakeInfo = {
  flavour?: string;
  weight_kg?: number | string;
  tiers?: number;
  theme?: string;
  design?: string;
  model?: string;
  fondant?: string;
  cream?: string;
  filling?: string;
  toppings?: string;
  message?: string;
  is_eggless?: boolean;
  has_cupcakes?: boolean;
  has_popsicles?: boolean;
  cupcake_count?: number;
  popsicle_count?: number;
  instructions?: string;
  addon_details?: string;
  photo_paths?: string[];
};

export type ChefLine = {
  id: string;
  name: string;
  size: string;
  quantity: number;
  isEggless: boolean;
  notes: string | null;
  kitchenId: string | null;
  kitchenName: string | null;
  imageUrl: string | null;
  cake: CakeInfo | null;
};

export type ChefOrder = {
  id: string;
  reference: string;
  status: ChefRow["status"];
  dueAt: string;
  isImmediate: boolean;
  fulfilment: ChefRow["fulfilment"];
  source: ChefRow["source"];
  customerName: string | null;
  customerPhone: string | null;
  customerNotes: string | null;
  setupAddress: string | null;
  setupNote: string | null;
  internalNotes: string | null;
  lines: ChefLine[];
};

// Rows arrive sorted by pickup time, order and line; one card per order, cancelled orders last.
// kitchen_id is the order's kitchen (2026-10-24): custom cake orders Kitchen 1, every other order Kitchen 2.
export function groupChefWork(rows: ChefRow[], kitchenId: string | null = null): ChefOrder[] {
  const orders = new Map<string, ChefOrder>();
  for (const r of rows) {
    if (kitchenId && r.kitchen_id !== kitchenId) continue;
    let o = orders.get(r.order_id);
    if (!o) {
      o = {
        id: r.order_id,
        reference: r.reference,
        status: r.status,
        dueAt: r.due_at,
        isImmediate: r.is_immediate,
        fulfilment: r.fulfilment,
        source: r.source,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerNotes: r.customer_notes,
        setupAddress: r.setup_address,
        setupNote: r.setup_note,
        internalNotes: r.internal_notes,
        lines: [],
      };
      orders.set(r.order_id, o);
    }
    o.lines.push({
      id: r.item_id,
      name: r.product_name,
      size: r.variant_name,
      quantity: r.quantity,
      isEggless: r.is_eggless,
      notes: r.notes,
      kitchenId: r.kitchen_id,
      kitchenName: r.kitchen_name,
      imageUrl: r.image_url,
      cake: (r.cake as CakeInfo | null) ?? null,
    });
  }
  const list = [...orders.values()];
  const rank = (o: ChefOrder) => (o.status === "cancelled" ? 2 : o.status === "ready" ? 1 : 0);
  return list.sort((a, b) => rank(a) - rank(b) || a.dueAt.localeCompare(b.dueAt));
}

// "12 × Chocolate truffle" totals across the open (not packed, not cancelled) orders shown.
export function itemTotals(orders: ChefOrder[]): { name: string; size: string; quantity: number }[] {
  const totals = new Map<string, { name: string; size: string; quantity: number }>();
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "ready") continue;
    for (const l of o.lines) {
      if (l.cake) continue;
      const key = `${l.name}\u0000${l.size}`;
      const t = totals.get(key) ?? { name: l.name, size: l.size, quantity: 0 };
      t.quantity += l.quantity;
      totals.set(key, t);
    }
  }
  return [...totals.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));
}

// Cake details as labelled rows, in the order a chef reads them.
export function cakeRows(c: CakeInfo): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const add = (label: string, value: string | undefined | null) => {
    if (value && String(value).trim()) rows.push({ label, value: String(value).trim() });
  };
  add("Flavour", c.flavour);
  if (c.weight_kg != null) add("Weight", `${Number(c.weight_kg)} kg${c.tiers && c.tiers > 1 ? ` · ${c.tiers} tiers` : ""}`);
  add("Theme", c.theme);
  add("Colour", c.design);
  add("Model", c.model);
  add("Fondant", c.fondant);
  add("Cream", c.cream);
  add("Filling", c.filling);
  add("Toppings", c.toppings);
  add("Message on cake", c.message ? `“${c.message}”` : null);
  const cupcakes = extraCount(c.cupcake_count, c.has_cupcakes);
  const popsicles = extraCount(c.popsicle_count, c.has_popsicles);
  if (cupcakes) add("Cupcakes", String(cupcakes));
  if (popsicles) add("Popsicles", String(popsicles));
  add("Instructions", c.instructions);
  add("Add on", c.addon_details);
  return rows;
}

// Cupcakes and popsicles are counts since 2026-10-24 (0 = none); rows from before have only the tick.
export function extraCount(count: number | null | undefined, ticked: boolean | null | undefined): number {
  return typeof count === "number" ? count : ticked ? 1 : 0;
}

// Per-day counts for the calendar: open orders, custom cakes and set-ups (packed and cancelled left out).
export type DaySummary = { orders: number; cakes: number; setups: number };
export function summariseByDay(orders: ChefOrder[], dayOf: (o: ChefOrder) => string): Map<string, DaySummary> {
  const days = new Map<string, DaySummary>();
  for (const o of orders) {
    if (o.status === "cancelled" || o.status === "ready") continue;
    const key = dayOf(o);
    const d = days.get(key) ?? { orders: 0, cakes: 0, setups: 0 };
    d.orders += 1;
    d.cakes += o.lines.filter((l) => l.cake).length;
    if (o.fulfilment === "setup") d.setups += 1;
    days.set(key, d);
  }
  return days;
}
