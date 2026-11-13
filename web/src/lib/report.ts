// Daily sales report: the shape returned by public.sales_report, the date range the page asks for,
// and the CSV download. Pure: imported by unit tests, so keep any imports from "@/" type-only.

export type ReportSummary = {
  bills: number;
  gross_paise: number;
  discount_paise: number;
  billed_paise: number;
  tax_paise: number;
  credit_notes: number;
  credited_paise: number;
  credited_tax_paise: number;
  net_paise: number;
  net_tax_paise: number;
  cgst_paise: number;
  sgst_paise: number;
  taxable_paise: number;
  credited_cgst_paise: number;
  credited_sgst_paise: number;
  credited_taxable_paise: number;
  net_cgst_paise: number;
  net_sgst_paise: number;
  net_taxable_paise: number;
};
export type ReportMoney = { method: string; received_paise: number; refunded_paise: number };
export type ReportDailyMoney = { date: string; received_paise: number; refunded_paise: number };
export type ReportProduct = { name: string; variant: string; quantity: number; gross_paise: number; discount_paise: number; net_paise: number };
export type ReportCategory = { name: string; quantity: number; gross_paise: number; discount_paise: number; net_paise: number };
export type ReportSource = { source: string; bills: number; billed_paise: number; credited_paise: number; net_paise: number };

export type SalesReport = {
  from: string;
  to: string;
  timezone: string;
  summary: ReportSummary;
  money: ReportMoney[];
  daily_money: ReportDailyMoney[];
  products: ReportProduct[];
  categories: ReportCategory[];
  sources: ReportSource[];
};

export type ReportLabels = { method: Record<string, string>; source: Record<string, string> };

const SUMMARY_KEYS: (keyof ReportSummary)[] = [
  "bills", "gross_paise", "discount_paise", "billed_paise", "tax_paise",
  "credit_notes", "credited_paise", "credited_tax_paise", "net_paise", "net_tax_paise",
  "cgst_paise", "sgst_paise", "taxable_paise", "credited_cgst_paise", "credited_sgst_paise", "credited_taxable_paise",
  "net_cgst_paise", "net_sgst_paise", "net_taxable_paise",
];

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v) || 0);
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const list = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

// Missing figures become 0 and missing lists [], so an empty day renders instead of crashing.
export function parseSalesReport(json: unknown): SalesReport {
  const o = (json ?? {}) as Record<string, unknown>;
  const s = (o.summary ?? {}) as Record<string, unknown>;
  return {
    from: str(o.from),
    to: str(o.to),
    timezone: str(o.timezone),
    summary: Object.fromEntries(SUMMARY_KEYS.map((k) => [k, num(s[k])])) as ReportSummary,
    money: list(o.money).map((m) => ({ method: str(m.method), received_paise: num(m.received_paise), refunded_paise: num(m.refunded_paise) })),
    daily_money: list(o.daily_money).map((m) => ({
      date: str(m.date), received_paise: num(m.received_paise), refunded_paise: num(m.refunded_paise),
    })),
    products: list(o.products).map((p) => ({
      name: str(p.name), variant: str(p.variant), quantity: num(p.quantity),
      gross_paise: num(p.gross_paise), discount_paise: num(p.discount_paise), net_paise: num(p.net_paise),
    })),
    categories: list(o.categories).map((c) => ({
      name: str(c.name), quantity: num(c.quantity),
      gross_paise: num(c.gross_paise), discount_paise: num(c.discount_paise), net_paise: num(c.net_paise),
    })),
    sources: list(o.sources).map((x) => ({
      source: str(x.source), bills: num(x.bills), billed_paise: num(x.billed_paise),
      credited_paise: num(x.credited_paise), net_paise: num(x.net_paise),
    })),
  };
}

// Plain rupees with two decimals (no ₹ sign), so spreadsheets read them as numbers.
export function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

function cell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (...cells: (string | number)[]) => cells.map(cell).join(",");

// Text from the catalogue (product, variant and category names, labels) that starts like a formula
// gets a leading apostrophe, so Excel and Google Sheets show it instead of running it. Amounts are
// written by rupees() and stay numbers.
const text = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

export function reportToCsv(r: SalesReport, labels: ReportLabels): string {
  const s = r.summary;
  const out: string[] = [
    row("Sales report", `${r.from} to ${r.to}`, r.timezone),
    "",
    row("Summary"),
    row("Bills", s.bills),
    row("Gross sales", rupees(s.gross_paise)),
    row("Discounts", rupees(s.discount_paise)),
    row("Billed", rupees(s.billed_paise)),
    row("Credit notes", s.credit_notes),
    row("Credited", rupees(s.credited_paise)),
    row("Net sales", rupees(s.net_paise)),
    "",
    row("Money"),
    row("Method", "Received", "Refunded", "Net collected"),
    ...r.money.map((m) =>
      row(text(labels.method[m.method] ?? m.method), rupees(m.received_paise), rupees(m.refunded_paise), rupees(m.received_paise - m.refunded_paise)),
    ),
    "",
    row("By source"),
    row("Source", "Bills", "Billed", "Credited", "Net"),
    ...r.sources.map((x) =>
      row(text(labels.source[x.source] ?? x.source), x.bills, rupees(x.billed_paise), rupees(x.credited_paise), rupees(x.net_paise)),
    ),
    "",
    row("By category"),
    row("Category", "Quantity", "Gross", "Discount", "Net"),
    ...r.categories.map((c) => row(text(c.name), c.quantity, rupees(c.gross_paise), rupees(c.discount_paise), rupees(c.net_paise))),
    "",
    row("By product"),
    row("Product", "Variant", "Quantity", "Gross", "Discount", "Net"),
    ...r.products.map((p) => row(text(p.name), text(p.variant), p.quantity, rupees(p.gross_paise), rupees(p.discount_paise), rupees(p.net_paise))),
  ];
  return out.join("\r\n") + "\r\n";
}

export type ReportRange = { from: string; to: string; error?: string };
export type RangeParams = { range?: string; from?: string; to?: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const toDate = (key: string) => new Date(`${key}T00:00:00Z`);
const toKey = (d: Date) => d.toISOString().slice(0, 10);
// A real calendar date: 2026-02-31 parses (as 3 March) but does not survive the round trip.
const isDay = (key: string) => DAY.test(key) && !Number.isNaN(toDate(key).getTime()) && toKey(toDate(key)) === key;
const shift = (key: string, days: number) => {
  const d = toDate(key);
  d.setUTCDate(d.getUTCDate() + days);
  return toKey(d);
};

// The range the page shows. todayKey is today's date in the business time zone. Matches the checks
// in public.sales_report, so a bad custom range is explained before any query runs.
export function reportRange(params: RangeParams, todayKey: string): ReportRange {
  if (params.from || params.to) {
    const from = params.from ?? "";
    const to = params.to ?? "";
    if (!isDay(from) || !isDay(to)) {
      return { from: todayKey, to: todayKey, error: "Enter dates as YYYY-MM-DD." };
    }
    if (from > to) return { from, to, error: "Choose a start date on or before the end date." };
    if ((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000 > 365) {
      return { from, to, error: "Choose a range of at most one year." };
    }
    return { from, to };
  }
  switch (params.range) {
    case "yesterday": {
      const y = shift(todayKey, -1);
      return { from: y, to: y };
    }
    case "week": {
      const weekday = (toDate(todayKey).getUTCDay() + 6) % 7; // Monday = 0
      return { from: shift(todayKey, -weekday), to: todayKey };
    }
    case "month":
      return { from: `${todayKey.slice(0, 8)}01`, to: todayKey };
    default:
      return { from: todayKey, to: todayKey };
  }
}
