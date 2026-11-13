import { test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_LISTS, fulfilmentLabel, fulfilmentRowClass, listKeyForSource, searchEverywhere, sourceLabel } from "./orders.ts";

test("the top-bar search looks in both lists and every status; the list's own search box stays in its list", () => {
  assert.equal(searchEverywhere("Priya", "all"), true);
  assert.equal(searchEverywhere("9000012301", "all"), true);
  assert.equal(searchEverywhere("", "all"), false);
  assert.equal(searchEverywhere("Priya", ""), false);
  assert.equal(searchEverywhere("Priya", "something"), false);
});

test("customer orders have their own label and sit in the Online / Call / Customer list", () => {
  assert.equal(sourceLabel.CUSTOMER, "Customer");
  assert.deepEqual(ORDER_LISTS.online_call.sources, ["ONLINE", "CALL", "CUSTOMER"]);
  assert.equal(ORDER_LISTS.online_call.label, "Online / Call / Customer");
  assert.equal(listKeyForSource("CUSTOMER"), "online_call");
  assert.equal(listKeyForSource("IN_STORE"), "in_store");
});

test("collect is green and set-up is red, always with words", () => {
  assert.equal(fulfilmentLabel.collect, "Pickup/Cab");
  assert.equal(fulfilmentLabel.setup, "Set up");
  assert.match(fulfilmentRowClass("collect"), /border-l-ok/);
  assert.match(fulfilmentRowClass("setup"), /border-l-danger/);
  assert.equal(fulfilmentRowClass(null), "");
});
