import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDateOnly, zonedDayKey, zonedDayStart } from "./time.ts";

test("payment dates map to the start of the selected business-local day", () => {
  const date = zonedDayStart("2026-11-10", "Asia/Kolkata");
  assert.ok(date);
  assert.equal(zonedDayKey(date, "Asia/Kolkata"), "2026-11-10");
  assert.equal(date.toISOString(), "2026-11-09T18:30:00.000Z");
  assert.equal(zonedDayStart("2026-02-31", "Asia/Kolkata"), null);
});

test("payment history formats the paid-on date without displaying a misleading time", () => {
  assert.equal(formatDateOnly("2026-11-09T18:30:00.000Z", "Asia/Kolkata"), "10 Nov 2026");
});
