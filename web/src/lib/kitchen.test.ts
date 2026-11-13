import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cakeRows,
  groupChefWork,
  itemTotals,
  kitchenDay,
  kitchenMonth,
  kitchenTab,
  monthGridStart,
  shiftMonth,
  summariseByDay,
  tabRange,
  type ChefRow,
} from "./kitchen.ts";

function row(over: Partial<ChefRow>): ChefRow {
  return {
    order_id: "o1",
    reference: "B-1001",
    status: "confirmed",
    due_at: "2026-10-20T06:30:00Z",
    is_immediate: false,
    fulfilment: "collect",
    item_id: "i1",
    line_no: 1,
    product_name: "Truffle cake",
    variant_name: "1 kg",
    quantity: 1,
    is_eggless: false,
    notes: null,
    kitchen_id: "k1",
    kitchen_name: "Kitchen 1",
    image_url: null,
    cake: null,
    customer_name: "Priya",
    customer_phone: "9840000001",
    customer_notes: null,
    setup_address: null,
    setup_note: null,
    source: "CALL",
    internal_notes: null,
    ...over,
  };
}

test("tabs: unknown values mean today; ranges in business days", () => {
  assert.equal(kitchenTab("x"), "today");
  assert.equal(kitchenTab("later"), "later");
  assert.deepEqual(tabRange("today", "2026-10-20"), { from: "2026-10-20", to: "2026-10-20" });
  assert.deepEqual(tabRange("tomorrow", "2026-10-31"), { from: "2026-11-01", to: "2026-11-01" });
  assert.deepEqual(tabRange("later", "2026-10-20"), { from: "2026-10-22", to: "2026-11-04" });
});

test("rows group into orders; packed and cancelled go last", () => {
  const orders = groupChefWork([
    row({ order_id: "c", reference: "B-3", status: "cancelled", due_at: "2026-10-20T04:00:00Z", item_id: "c1" }),
    row({ order_id: "a", reference: "B-1", item_id: "a1" }),
    row({ order_id: "a", reference: "B-1", item_id: "a2", line_no: 2, product_name: "Bread", kitchen_id: "k2" }),
    row({ order_id: "r", reference: "B-2", status: "ready", due_at: "2026-10-20T05:00:00Z", item_id: "r1" }),
  ]);
  assert.deepEqual(orders.map((o) => o.reference), ["B-1", "B-2", "B-3"]);
  assert.equal(orders[0].lines.length, 2);
});

test("kitchen filter keeps only that kitchen's orders", () => {
  const orders = groupChefWork(
    [row({ order_id: "a", item_id: "a1" }), row({ order_id: "b", item_id: "b1", kitchen_id: "k2" })],
    "k1",
  );
  assert.deepEqual(orders.map((o) => o.id), ["a"]);
});

test("totals skip packed, cancelled and custom cakes", () => {
  const orders = groupChefWork([
    row({ order_id: "a", item_id: "a1", quantity: 2 }),
    row({ order_id: "b", item_id: "b1", quantity: 3 }),
    row({ order_id: "c", item_id: "c1", quantity: 5, status: "ready" }),
    row({ order_id: "d", item_id: "d1", quantity: 1, product_name: "Custom cake", cake: { flavour: "Vanilla" } }),
  ]);
  assert.deepEqual(itemTotals(orders), [{ name: "Truffle cake", size: "1 kg", quantity: 5 }]);
});

test("cake details read in order, empty ones left out", () => {
  const rows = cakeRows({ flavour: "Red velvet", weight_kg: "1.50", tiers: 2, message: "Happy birthday", theme: " ", cupcake_count: 12, popsicle_count: 0 });
  assert.deepEqual(rows, [
    { label: "Flavour", value: "Red velvet" },
    { label: "Weight", value: "1.5 kg · 2 tiers" },
    { label: "Message on cake", value: "“Happy birthday”" },
    { label: "Cupcakes", value: "12" },
  ]);
  // A cake saved before the counts has only the tick: shown as 1.
  assert.deepEqual(cakeRows({ flavour: "X", has_popsicles: true }).at(-1), { label: "Popsicles", value: "1" });
});

test("calendar: month grid starts on a Monday and covers 6 weeks; bad dates fall back", () => {
  assert.equal(monthGridStart("2026-10"), "2026-09-28"); // 1 Oct 2026 is a Thursday
  assert.equal(monthGridStart("2026-06"), "2026-06-01"); // 1 Jun 2026 is a Monday
  assert.deepEqual(tabRange("calendar", "2026-10-20", { month: "2026-10" }), { from: "2026-09-28", to: "2026-11-08" });
  assert.deepEqual(tabRange("day", "2026-10-20", { day: "2026-12-25" }), { from: "2026-12-25", to: "2026-12-25" });
  assert.equal(shiftMonth("2026-12", 1), "2027-01");
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.equal(kitchenTab("calendar"), "calendar");
  assert.equal(kitchenDay("2026-02-30", "2026-10-20"), "2026-10-20");
  assert.equal(kitchenDay("2026-11-05", "2026-10-20"), "2026-11-05");
  assert.equal(kitchenMonth("2026-13", "2026-10-20"), "2026-10");
  assert.equal(kitchenMonth("2027-01", "2026-10-20"), "2027-01");
});

test("calendar counts open orders per day, with cakes and set-ups; customer details carried", () => {
  const orders = groupChefWork([
    row({ order_id: "a", item_id: "1", due_at: "2026-10-21T06:00:00Z", fulfilment: "setup", setup_address: "12 Hall Rd" }),
    row({ order_id: "a", item_id: "2", due_at: "2026-10-21T06:00:00Z", fulfilment: "setup", cake: { flavour: "Vanilla" } }),
    row({ order_id: "b", item_id: "3", due_at: "2026-10-21T08:00:00Z" }),
    row({ order_id: "c", item_id: "4", due_at: "2026-10-21T09:00:00Z", status: "cancelled" }),
    row({ order_id: "d", item_id: "5", due_at: "2026-10-22T09:00:00Z", status: "ready" }),
  ]);
  const days = summariseByDay(orders, (o) => o.dueAt.slice(0, 10));
  assert.deepEqual(days.get("2026-10-21"), { orders: 2, cakes: 1, setups: 1 });
  assert.equal(days.has("2026-10-22"), false);
  const a = orders.find((o) => o.id === "a")!;
  assert.equal(a.customerName, "Priya");
  assert.equal(a.customerPhone, "9840000001");
  assert.equal(a.setupAddress, "12 Hall Rd");
});
