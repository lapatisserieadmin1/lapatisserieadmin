import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { analyticsWorkbook, ordersWorkbook } from "./excel-report.ts";
import { parseSalesReport } from "./report.ts";

const labels = {
  method: { cash: "Cash" },
  source: { IN_STORE: "In-store" },
};

test("analytics exports a readable workbook with numeric money and daily collections", async () => {
  const report = parseSalesReport({
    from: "2026-11-10",
    to: "2026-11-11",
    timezone: "Asia/Kolkata",
    summary: { bills: 1, net_paise: 149000 },
    money: [{ method: "cash", received_paise: 99000, refunded_paise: 9000 }],
    daily_money: [{ date: "2026-11-10", received_paise: 99000, refunded_paise: 9000 }],
    products: [{ name: "=Unsafe", variant: "1 kg", quantity: 1, gross_paise: 149000, discount_paise: 0, net_paise: 149000 }],
  });
  const output = await analyticsWorkbook(report, labels);
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(output);

  assert.deepEqual(opened.worksheets.map((sheet) => sheet.name), [
    "Summary", "Payments", "Collections by day", "By source", "By category", "By product",
  ]);
  assert.equal(opened.getWorksheet("Payments")?.getCell("B2").value, 990);
  assert.equal(opened.getWorksheet("Collections by day")?.getCell("A2").value, "2026-11-10");
  assert.equal(opened.getWorksheet("By product")?.getCell("A2").value, "'=Unsafe");
});

test("order report export has a real numeric total row", async () => {
  const output = await ordersWorkbook(
    [{ id: "1", date: "2026-11-10", phone: "0900000000", kg: 1.5, pricePaise: 150000 }],
    { kg: 1.5, pricePaise: 150000 },
  );
  const opened = new ExcelJS.Workbook();
  await opened.xlsx.load(output);
  const sheet = opened.getWorksheet("Orders");

  assert.equal(sheet?.getCell("B2").value, "0900000000");
  assert.equal(sheet?.getCell("D2").value, 1500);
  assert.equal(sheet?.getCell("A3").value, "Total (1 orders)");
  assert.equal(sheet?.getCell("D3").value, 1500);
});
