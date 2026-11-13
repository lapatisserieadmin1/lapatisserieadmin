import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByWindow, windowFor } from "./capacity.ts";

const windows = [
  { starts_at: "09:00", ends_at: "11:00", max: 6, used: 0 },
  { starts_at: "11:00", ends_at: "13:00", max: null, used: 0 },
  { starts_at: "16:00", ends_at: "18:30", max: 4, used: 0 },
];

test("windowFor includes both ends of a window", () => {
  assert.equal(windowFor("09:00", windows)?.starts_at, "09:00");
  assert.equal(windowFor("10:59", windows)?.starts_at, "09:00");
  assert.equal(windowFor("18:30", windows)?.starts_at, "16:00");
});

test("windowFor picks the later window on a shared boundary, like private.window_for", () => {
  assert.equal(windowFor("11:00", windows)?.starts_at, "11:00");
});

test("windowFor returns null outside every window", () => {
  assert.equal(windowFor("08:59", windows), null);
  assert.equal(windowFor("14:00", windows), null);
  assert.equal(windowFor("18:31", windows), null);
  assert.equal(windowFor("10:00", []), null);
});

test("groupByWindow keeps window order, keeps empty windows, and collects the rest", () => {
  const orders = [
    { ref: "A", time: "17:00" },
    { ref: "B", time: "09:30" },
    { ref: "C", time: "14:15" },
    { ref: "D", time: "10:45" },
  ];
  const { groups, outside } = groupByWindow(orders, (o) => o.time, windows);
  assert.deepEqual(
    groups.map((g) => [g.window.starts_at, g.orders.map((o) => o.ref)]),
    [["09:00", ["B", "D"]], ["11:00", []], ["16:00", ["A"]]],
  );
  assert.deepEqual(outside.map((o) => o.ref), ["C"]);
});
