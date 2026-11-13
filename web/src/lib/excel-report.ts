import ExcelJS from "exceljs";
import type { ReportLabels, SalesReport } from "./report";
import type { ReportRow } from "./sales-report";

const currencyFormat = "#,##0.00;[Red]-#,##0.00";
const textCell = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const rupees = (paise: number) => paise / 100;

function addSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number)[][],
  currencyColumns: number[] = [],
  decimalColumns: number[] = [],
) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true };
  sheet.columns.forEach((column, index) => {
    column.width = Math.max(14, Math.min(36, headers[index].length + 4));
  });
  for (const column of currencyColumns) sheet.getColumn(column).numFmt = currencyFormat;
  for (const column of decimalColumns) sheet.getColumn(column).numFmt = "0.000";
  return sheet;
}

function workbook(): ExcelJS.Workbook {
  const result = new ExcelJS.Workbook();
  result.creator = "La Patisserie Madras";
  result.subject = "Staff report";
  result.created = new Date();
  return result;
}

async function writeWorkbook(book: ExcelJS.Workbook): Promise<ArrayBuffer> {
  const written = new Uint8Array(await book.xlsx.writeBuffer());
  const result = new ArrayBuffer(written.byteLength);
  new Uint8Array(result).set(written);
  return result;
}

export async function analyticsWorkbook(report: SalesReport, labels: ReportLabels): Promise<ArrayBuffer> {
  const book = workbook();
  const netCollected = report.money.reduce((sum, row) => sum + row.received_paise - row.refunded_paise, 0);

  addSheet(book, "Summary", ["Metric", "Value"], [
    ["From", textCell(report.from)],
    ["To", textCell(report.to)],
    ["Business timezone", textCell(report.timezone)],
    ["Bills", report.summary.bills],
    ["Gross sales (Rs)", rupees(report.summary.gross_paise)],
    ["Discounts (Rs)", rupees(report.summary.discount_paise)],
    ["Billed (Rs)", rupees(report.summary.billed_paise)],
    ["Credit notes", report.summary.credit_notes],
    ["Credited (Rs)", rupees(report.summary.credited_paise)],
    ["Net sales (Rs)", rupees(report.summary.net_paise)],
    ["Net collected (Rs)", rupees(netCollected)],
  ], [2]);

  addSheet(book, "Payments", ["Method", "Received (Rs)", "Refunded (Rs)", "Net (Rs)"],
    report.money.map((row) => [
      textCell(labels.method[row.method] ?? row.method),
      rupees(row.received_paise),
      rupees(row.refunded_paise),
      rupees(row.received_paise - row.refunded_paise),
    ]), [2, 3, 4]);

  addSheet(book, "Collections by day", ["Date", "Received (Rs)", "Refunded (Rs)", "Net (Rs)"],
    report.daily_money.map((row) => [
      textCell(row.date),
      rupees(row.received_paise),
      rupees(row.refunded_paise),
      rupees(row.received_paise - row.refunded_paise),
    ]), [2, 3, 4]);

  addSheet(book, "By source", ["Source", "Bills", "Billed (Rs)", "Credited (Rs)", "Net (Rs)"],
    report.sources.map((row) => [
      textCell(labels.source[row.source] ?? row.source),
      row.bills,
      rupees(row.billed_paise),
      rupees(row.credited_paise),
      rupees(row.net_paise),
    ]), [3, 4, 5]);

  addSheet(book, "By category", ["Category", "Quantity", "Gross (Rs)", "Discount (Rs)", "Net (Rs)"],
    report.categories.map((row) => [
      textCell(row.name),
      row.quantity,
      rupees(row.gross_paise),
      rupees(row.discount_paise),
      rupees(row.net_paise),
    ]), [3, 4, 5]);

  addSheet(book, "By product", ["Product", "Variant", "Quantity", "Gross (Rs)", "Discount (Rs)", "Net (Rs)"],
    report.products.map((row) => [
      textCell(row.name),
      textCell(row.variant),
      row.quantity,
      rupees(row.gross_paise),
      rupees(row.discount_paise),
      rupees(row.net_paise),
    ]), [4, 5, 6]);

  return writeWorkbook(book);
}

export async function ordersWorkbook(rows: ReportRow[], totals: { kg: number; pricePaise: number }): Promise<ArrayBuffer> {
  const book = workbook();
  const sheet = addSheet(book, "Orders", ["Date", "Customer number", "Kg", "Price (Rs)"], [
    ...rows.map((row) => [
      textCell(row.date),
      textCell(row.phone ?? "—"),
      row.kg ?? "",
      rupees(row.pricePaise),
    ]),
    [`Total (${rows.length} orders)`, "", totals.kg, rupees(totals.pricePaise)],
  ], [4], [3]);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  return writeWorkbook(book);
}
