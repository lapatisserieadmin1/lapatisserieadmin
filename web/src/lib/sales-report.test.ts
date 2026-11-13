import assert from "node:assert/strict";
import { test } from "node:test";
import { formatKg, orderKg, reportTotals, variantKg } from "./sales-report.ts";

test("sizes are read as kilos; sizes without a weight are not", () => {
  assert.equal(variantKg("1 kg"), 1);
  assert.equal(variantKg("1 kg Eggless"), 1);
  assert.equal(variantKg("500 g"), 0.5);
  assert.equal(variantKg("250 g box"), 0.25);
  assert.equal(variantKg("1.5kg"), 1.5);
  assert.equal(variantKg("Each"), null);
  assert.equal(variantKg("Box of 6"), null);
});

test("an order's kilos: the custom cake's weight, or the weighed items times quantity", () => {
  assert.equal(orderKg([{ variant_name: "Custom", quantity: 1, cancelled_quantity: 0 }], 2.5), 2.5);
  assert.equal(
    orderKg(
      [
        { variant_name: "500 g", quantity: 3, cancelled_quantity: 1 },
        { variant_name: "1 kg", quantity: 1, cancelled_quantity: 0 },
        { variant_name: "Each", quantity: 4, cancelled_quantity: 0 },
      ],
      null,
    ),
    2,
  );
  assert.equal(orderKg([{ variant_name: "Each", quantity: 4, cancelled_quantity: 0 }], null), null);
});

test("the total row adds the kilos and prices", () => {
  const t = reportTotals([
    { id: "a", date: "2026-10-01", phone: "9840000001", kg: 1.5, pricePaise: 150000 },
    { id: "b", date: "2026-10-02", phone: null, kg: null, pricePaise: 25000 },
  ]);
  assert.deepEqual(t, { kg: 1.5, pricePaise: 175000 });
  assert.equal(formatKg(null), "—");
  assert.equal(formatKg(0.25), "0.25 kg");
});
