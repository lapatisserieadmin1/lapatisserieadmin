import { test } from "node:test";
import assert from "node:assert/strict";
import { isCakeOrder } from "./cake-order.ts";

test("custom cakes and items from a cake category make a cake order", () => {
  assert.equal(isCakeOrder({ hasCustomCake: true, itemCategories: [] }), true);
  assert.equal(isCakeOrder({ hasCustomCake: false, itemCategories: ["Breads", "Cakes"] }), true);
  assert.equal(isCakeOrder({ hasCustomCake: false, itemCategories: ["Cup cakes"] }), true);
  assert.equal(isCakeOrder({ hasCustomCake: false, itemCategories: ["Breads", "Cookies", null] }), false);
  assert.equal(isCakeOrder({ hasCustomCake: false, itemCategories: [] }), false);
});
