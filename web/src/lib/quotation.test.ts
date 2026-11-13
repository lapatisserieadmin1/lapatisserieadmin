import { test } from "node:test";
import assert from "node:assert/strict";
import { captionBill, parseQuotation, quotationFileName, quotationView, withoutPrices } from "./quotation.ts";

const base = {
  timezone: "Asia/Kolkata",
  shop: { name: "La Patisserie", phone: "98400 00001" },
  order: {
    id: "7b0c7a8e-0000-4000-8000-000000000001",
    reference: "B-1042",
    status: "confirmed",
    created_at: "2026-10-20T05:00:00Z",
    due_at: "2026-10-30T12:30:00Z",
    is_immediate: false,
    fulfilment: "setup",
    setup_address: "5 Lake View Road",
    kitchen: "Kitchen 1",
  },
  cake: { flavour: "Belgian chocolate", weight_kg: 2, tiers: 2, message: "Happy 5th, Aarav", cupcake_count: 12, popsicle_count: 0 },
};
const items = [
  { line_no: 1, name: "Custom cake", variant: "2 kg", quantity: 1, kind: "cake", is_eggless: true, notes: null },
  { line_no: 2, name: "Set-up charge", variant: "Balloon arch", quantity: 1, kind: "setup", is_eggless: false, notes: null },
  { line_no: 3, name: "Delivery charge", variant: "Within 10 km", quantity: 1, kind: "delivery", is_eggless: false, notes: null },
];
const priced = [
  { unit_price_paise: 450000, line_total_paise: 450000 },
  { unit_price_paise: 150000, line_total_paise: 150000 },
  { unit_price_paise: 30000, line_total_paise: 30000 },
];
const amounts = {
  subtotal_paise: 630000, discount_paise: 0, tax_paise: 30000, total_paise: 630000,
  credited_paise: 0, advance_paise: 200000, balance_paise: 430000,
};

test("the full quotation carries every amount: lines, set-up, delivery, total, advance and balance", () => {
  const q = parseQuotation({ ...base, mode: "full", items: items.map((i, n) => ({ ...i, ...priced[n] })), amounts });
  const v = quotationView(q);
  assert.equal(v.priced, true);
  assert.ok(!v.facts.some((f) => f.label === "Date"));
  assert.deepEqual(v.lines.map((l) => [l.title, l.total]), [
    ["Custom cake — 2 kg", "₹4,500.00"],
    ["Set-up — Balloon arch", "₹1,500.00"],
    ["Delivery — Within 10 km", "₹300.00"],
  ]);
  assert.deepEqual(v.totals.map((t) => `${t.label} ${t.value}`), [
    "Total ₹6,300.00", "Advance paid ₹2,000.00", "Balance ₹4,300.00",
  ]);
  assert.ok(v.facts.some((f) => f.label === "Venue" && f.value === "5 Lake View Road"));
  assert.ok(v.cake.some((r) => r.label === "Message on cake" && r.value.includes("Happy 5th")));
  assert.ok(v.cake.some((r) => r.label === "Cupcakes" && r.value === "12"));
  assert.ok(!v.facts.some((f) => f.label === "Kitchen"));
});

test("the kitchen quotation never carries an amount, even if one slipped into the data", () => {
  const leaky = { ...base, mode: "kitchen", items: items.map((i, n) => ({ ...i, ...priced[n] })), amounts };
  const q = parseQuotation(leaky);
  assert.equal(q.amounts, null);
  assert.ok(q.lines.every((l) => l.unitPricePaise === null && l.lineTotalPaise === null));
  const v = quotationView(q);
  assert.equal(v.priced, false);
  assert.equal(v.totals.length, 0);
  assert.ok(v.lines.every((l) => l.unit === null && l.total === null));
  assert.doesNotMatch(JSON.stringify(v), /₹|paise/);
  assert.ok(v.lines.some((l) => l.title === "Set-up — Balloon arch"));
  assert.ok(v.facts.some((f) => f.label === "Kitchen" && f.value === "Kitchen 1"));
});

test("withoutPrices turns a full quotation into the kitchen one", () => {
  const full = parseQuotation({ ...base, mode: "full", items: items.map((i, n) => ({ ...i, ...priced[n] })), amounts });
  const v = quotationView(withoutPrices(full));
  assert.equal(v.priced, false);
  assert.doesNotMatch(JSON.stringify(v), /₹/);
});

test("the WhatsApp bill lists cake, set-up and delivery, then total, advance and balance; none for the kitchen", () => {
  const full = parseQuotation({ ...base, mode: "full", items: items.map((i, n) => ({ ...i, ...priced[n] })), amounts });
  assert.deepEqual(captionBill(full), {
    lines: [
      { label: "Custom cake (2 kg)", paise: 450000 },
      { label: "Set-up charge", paise: 150000 },
      { label: "Delivery charge", paise: 30000 },
    ],
    discountPaise: 0, totalPaise: 630000, advancePaise: 200000, balancePaise: 430000,
  });
  assert.equal(captionBill(withoutPrices(full)), null);
});

test("a full quotation without amounts is refused rather than shown as free", () => {
  assert.throws(() => parseQuotation({ ...base, mode: "full", items }));
});

test("file names use the order number only", () => {
  assert.equal(quotationFileName("B-1042", "pdf"), "LaPatisserieMadras-Order-in-msg-B-1042.pdf");
  assert.equal(quotationFileName("B-1042", "png"), "LaPatisserieMadras-Order-in-msg-B-1042.png");
});

test("the Order in msg has the shop's name and fixed address, no GST line, and an add-on line", () => {
  const withAddon = [...items, { line_no: 9, name: "Add-on", variant: "Custom cake", quantity: 1, kind: "addon", is_eggless: false }];
  const q = parseQuotation({
    ...base,
    mode: "full",
    items: withAddon.map((i, n) => ({ ...i, unit_price_paise: priced[n]?.unit_price_paise ?? 35000, line_total_paise: priced[n]?.line_total_paise ?? 35000 })),
    amounts,
  });
  const v = quotationView(q);
  assert.equal(v.title, "Order in msg");
  assert.equal(v.shopName, "La Patisserie Madras");
  assert.ok(v.shopContact[0].startsWith("Bharath Nagar Extn, 7, Water Canal Rd"));
  assert.ok(!v.totals.some((t) => /GST/.test(t.label)));
  assert.ok(v.lines.some((l) => l.title === "Add on — Custom cake" && l.total === "₹350.00"));
  assert.deepEqual(captionBill(q)?.lines.at(-1), { label: "Add-on", paise: 35000 });
});
