import { test } from "node:test";
import assert from "node:assert/strict";
import { CAKE_PHOTO_MAX_BYTES, cakeDetailsSchema, cakeExtras, cakePhotoProblem, cakeSizeName } from "./custom-cake.ts";

test("the size reads like the order line the database writes", () => {
  assert.equal(cakeSizeName(1.5, 2), "1.5 kg · 2 tiers");
  assert.equal(cakeSizeName(1, 1), "1 kg");
  assert.equal(cakeSizeName(0.75, 1), "0.75 kg");
});

test("cake details: flavour and a sensible weight are required, the rest is optional", () => {
  const ok = cakeDetailsSchema.safeParse({ flavour: " Chocolate ", weightKg: "1.5", tiers: "2", isEggless: true });
  assert.ok(ok.success);
  assert.equal(ok.data.flavour, "Chocolate");
  assert.equal(ok.data.weightKg, 1.5);
  assert.equal(ok.data.tiers, 2);
  assert.equal(ok.data.theme, undefined);
  assert.ok(!cakeDetailsSchema.safeParse({ flavour: "", weightKg: "1", tiers: "1", isEggless: false }).success);
  assert.ok(!cakeDetailsSchema.safeParse({ flavour: "Vanilla", weightKg: "0", tiers: "1", isEggless: false }).success);
  assert.ok(!cakeDetailsSchema.safeParse({ flavour: "Vanilla", weightKg: "60", tiers: "1", isEggless: false }).success);
  assert.ok(!cakeDetailsSchema.safeParse({ flavour: "Vanilla", weightKg: "1", tiers: "11", isEggless: false }).success);
});

test("only JPEG, PNG or WebP photos up to 5 MB", () => {
  assert.equal(cakePhotoProblem({ type: "image/jpeg", size: 1000 }), null);
  assert.match(cakePhotoProblem({ type: "image/gif", size: 1000 }) ?? "", /JPEG, PNG or WebP/);
  assert.match(cakePhotoProblem({ type: "image/png", size: CAKE_PHOTO_MAX_BYTES + 1 }) ?? "", /5 MB/);
});

test("set-up and delivery charges are optional rupees, kept as paise", () => {
  const base = { flavour: "Vanilla", weightKg: "1", tiers: "1", isEggless: false };
  const none = cakeDetailsSchema.safeParse(base);
  assert.ok(none.success);
  assert.equal(none.data.setupCharge, 0);
  assert.equal(none.data.deliveryCharge, 0);
  assert.equal(none.data.cupcakeCount, 0);
  const some = cakeDetailsSchema.safeParse({ ...base, setupCharge: "500", deliveryCharge: "1,250.50", popsicleCount: "6", fondant: " Full " });
  assert.ok(some.success);
  assert.equal(some.data.setupCharge, 50000);
  assert.equal(some.data.deliveryCharge, 125050);
  assert.equal(some.data.popsicleCount, 6);
  assert.equal(some.data.fondant, "Full");
  assert.ok(!cakeDetailsSchema.safeParse({ ...base, setupCharge: "-5" }).success);
  assert.ok(!cakeDetailsSchema.safeParse({ ...base, deliveryCharge: "abc" }).success);
});

test("cupcakes and popsicles are whole numbers from 0 to 999; empty is 0", () => {
  const base = { flavour: "Vanilla", weightKg: "1", tiers: "1", isEggless: false };
  assert.equal(cakeDetailsSchema.parse({ ...base, cupcakeCount: "" }).cupcakeCount, 0);
  assert.equal(cakeDetailsSchema.parse({ ...base, cupcakeCount: "12" }).cupcakeCount, 12);
  assert.ok(!cakeDetailsSchema.safeParse({ ...base, cupcakeCount: "-1" }).success);
  assert.ok(!cakeDetailsSchema.safeParse({ ...base, cupcakeCount: "2.5" }).success);
  assert.ok(!cakeDetailsSchema.safeParse({ ...base, popsicleCount: "1000" }).success);
});

test("extras read as a short list with counts; old ticks count as 1", () => {
  assert.equal(cakeExtras({ cupcake_count: 12, popsicle_count: 1, has_cupcakes: true, has_popsicles: true }), "12 cupcakes, 1 popsicle");
  assert.equal(cakeExtras({ cupcake_count: 0, popsicle_count: 6, has_cupcakes: false, has_popsicles: true }), "6 popsicles");
  assert.equal(cakeExtras({ cupcake_count: 0, popsicle_count: 0, has_cupcakes: false, has_popsicles: false }), "");
  assert.equal(cakeExtras({ has_cupcakes: true, has_popsicles: false }), "1 cupcake");
});
