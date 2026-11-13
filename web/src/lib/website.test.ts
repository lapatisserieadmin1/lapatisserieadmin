import { test } from "node:test";
import assert from "node:assert/strict";
import { submitArgs, websiteMenuStatus, websiteOrderSchema } from "./website.ts";

const base = {
  idempotencyKey: "0f8fad5b-d9cb-469f-a165-70867728950e",
  name: " Priya ",
  phone: "98400 00001",
  email: "",
  date: "2026-10-20",
  time: "16:30",
  orderType: "birthday",
  message: "Happy birthday Anu",
};

test("a website order: blanks become undefined, items and fulfilment default", () => {
  const parsed = websiteOrderSchema.safeParse(base);
  assert.ok(parsed.success);
  assert.equal(parsed.data.name, "Priya");
  assert.equal(parsed.data.email, undefined);
  assert.deepEqual(parsed.data.items, []);
  assert.equal(parsed.data.fulfilment, "collect");
  assert.ok(!websiteOrderSchema.safeParse({ ...base, email: "not-an-email" }).success);
  assert.ok(!websiteOrderSchema.safeParse({ ...base, orderType: "anything" }).success);
  assert.ok(!websiteOrderSchema.safeParse({ ...base, items: [{ variantId: "x", quantity: 1 }] }).success);
});

test("the pickup time is read in the bakery's time zone", () => {
  const parsed = websiteOrderSchema.parse(base);
  const result = submitArgs(parsed, "Asia/Kolkata");
  assert.ok("args" in result);
  assert.equal(result.args.p_due_at, "2026-10-20T11:00:00.000Z");
  assert.equal(result.args.p_setup_address, null);
  assert.equal(result.args.p_setup_note, null);
});

test("Pickup/Cab orders keep the customer's address and landmark", () => {
  const pickup = websiteOrderSchema.parse({ ...base, setupAddress: " 12 Lake View Road, T Nagar ", setupNote: " Opposite the temple " });
  const result = submitArgs(pickup, "Asia/Kolkata");
  assert.ok("args" in result);
  assert.equal(result.args.p_fulfilment, "collect");
  assert.equal(result.args.p_setup_address, "12 Lake View Road, T Nagar");
  assert.equal(result.args.p_setup_note, "Opposite the temple");
  assert.ok(!websiteOrderSchema.safeParse({ ...base, setupNote: "x".repeat(301) }).success);
});

test("an order needs a message or items; set-up needs an address", () => {
  const noMessage = websiteOrderSchema.parse({ ...base, message: "" });
  assert.deepEqual(submitArgs(noMessage, "Asia/Kolkata"), { error: "Please tell us what you would like to order." });
  const withItem = websiteOrderSchema.parse({
    ...base,
    message: "",
    items: [{ variantId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", quantity: 2 }],
  });
  const ok = submitArgs(withItem, "Asia/Kolkata");
  assert.ok("args" in ok);
  assert.deepEqual(ok.args.p_items, [{ variant_id: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", quantity: 2 }]);
  const setup = websiteOrderSchema.parse({ ...base, fulfilment: "setup" });
  assert.deepEqual(submitArgs(setup, "Asia/Kolkata"), { error: "Please enter the address where we should set up." });
});

test("a product is on the website menu only with an available size, in a shown category", () => {
  const ok = { archived: false, isAvailable: true, categoryActive: true, variants: [{ archived: false, isAvailable: true }] };
  assert.deepEqual(websiteMenuStatus(ok), { shown: true });
  assert.match((websiteMenuStatus({ ...ok, variants: [] }) as { reason: string }).reason, /no size and price/);
  assert.match((websiteMenuStatus({ ...ok, variants: [{ archived: true, isAvailable: true }] }) as { reason: string }).reason, /no size and price/);
  assert.match((websiteMenuStatus({ ...ok, variants: [{ archived: false, isAvailable: false }] }) as { reason: string }).reason, /None of its sizes/);
  assert.match((websiteMenuStatus({ ...ok, categoryActive: false }) as { reason: string }).reason, /category is hidden/);
  assert.match((websiteMenuStatus({ ...ok, isAvailable: false }) as { reason: string }).reason, /unavailable/);
  assert.match((websiteMenuStatus({ ...ok, archived: true }) as { reason: string }).reason, /archived/);
});
