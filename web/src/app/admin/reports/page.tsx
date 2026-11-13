import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { paymentMethodLabel, sourceLabel } from "@/lib/orders";
import { zonedDayKey } from "@/lib/time";
import { parseSalesReport, reportRange } from "@/lib/report";
import { Alert, Button, ButtonLink, Card, EmptyState, Input, PageHeader, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Analytics" };

const PICKS = [
  { range: "today", label: "Today" },
  { range: "yesterday", label: "Yesterday" },
  { range: "week", label: "This week" },
  { range: "month", label: "This month" },
] as const;

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

function Tile({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className={cx("rounded-xl border bg-surface p-4", strong ? "border-brand" : "border-line")}>
      <p className="text-sm text-muted">{label}</p>
      <p className={cx("mt-1 tabular-nums", strong ? "text-2xl font-semibold" : "text-xl font-medium")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function Table({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            {head.map((h, i) => (
              <th key={h} className={cx("py-2 pr-4 font-medium", i > 0 && "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, n) => (
            <tr key={n} className="border-b border-line last:border-0">
              {r.map((c, i) => (
                <td key={i} className={cx("py-2 pr-4", i > 0 && "text-right tabular-nums")}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Sales by bill date (business time zone); credit notes on their own date; money on the payment date.
export default async function ReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const tz = await getBusinessTimezone();
  const today = zonedDayKey(new Date(), tz);
  const picked = str(params.range);
  const range = reportRange({ range: picked, from: str(params.from), to: str(params.to) }, today);

  const supabase = await createClient();
  const { data, error } = range.error
    ? { data: null, error: null }
    : await supabase.rpc("sales_report", { p_from: range.from, p_to: range.to });
  const report = data ? parseSalesReport(data) : null;
  const s = report?.summary;
  const excelHref = `/admin/reports/export?${new URLSearchParams({ from: range.from, to: range.to })}`;
  const period = range.from === range.to ? range.from : `${range.from} to ${range.to}`;

  return (
    <>
      <PageHeader
        title="Analytics"
        description={`Sales by bill date (${tz}); payments and refunds by the date they were paid.`}
        actions={report && <ButtonLink href={excelHref} prefetch={false} variant="secondary">Download Excel</ButtonLink>}
      />

      <div className="flex flex-col gap-6">
        <form className="flex flex-wrap items-end gap-3" role="search">
          <nav aria-label="Quick ranges" className="flex flex-wrap gap-2">
            {PICKS.map((p) => (
              <ButtonLink
                key={p.range}
                href={`/admin/reports?range=${p.range}`}
                variant={!params.from && (picked ?? "today") === p.range ? "primary" : "secondary"}
              >
                {p.label}
              </ButtonLink>
            ))}
          </nav>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-from" className="text-sm font-medium">From</label>
            <Input id="report-from" type="date" name="from" defaultValue={range.from} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="report-to" className="text-sm font-medium">To</label>
            <Input id="report-to" type="date" name="to" defaultValue={range.to} required />
          </div>
          <Button type="submit" variant="secondary">Show</Button>
        </form>

        {range.error && <Alert tone="danger" title="Check the dates">{range.error}</Alert>}
        {error && <Alert tone="danger" title="Could not load the report">{error.message}</Alert>}

        {report && s && (
          <>
            <h2 className="-mb-3 text-lg font-semibold">{period}</h2>
            {s.bills === 0 && s.credit_notes === 0 && report.money.length === 0 ? (
              <EmptyState title="No sales or payments in this period">Bills, credit notes and payments appear here on the day they are made.</EmptyState>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Tile label="Net sales" value={formatPaise(s.net_paise)} hint="Billed minus credit notes" strong />
                  <Tile label="Bills" value={String(s.bills)} hint={`Billed ${formatPaise(s.billed_paise)}`} />
                  <Tile label="Discounts" value={formatPaise(s.discount_paise)} hint={`Gross ${formatPaise(s.gross_paise)}`} />
                  <Tile
                    label="Credit notes"
                    value={formatPaise(s.credited_paise)}
                    hint={`${s.credit_notes} issued`}
                  />
                  <Tile
                    label="Net collected"
                    value={formatPaise(report.money.reduce((t, m) => t + m.received_paise - m.refunded_paise, 0))}
                    hint="Payments minus refunds, all methods"
                  />
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <Card>
                    <h3 className="mb-3 font-semibold">Money by payment method</h3>
                    <Table
                      head={["Method", "Received", "Refunded", "Net"]}
                      empty="No payments in this period."
                      rows={report.money.map((m) => [
                        paymentMethodLabel[m.method as keyof typeof paymentMethodLabel] ?? m.method,
                        formatPaise(m.received_paise),
                        formatPaise(m.refunded_paise),
                        formatPaise(m.received_paise - m.refunded_paise),
                      ])}
                    />
                    <p className="mt-2 text-xs text-muted">Includes deposits on orders that are not billed yet.</p>
                  </Card>
                  <Card>
                    <h3 className="mb-3 font-semibold">By source</h3>
                    <Table
                      head={["Source", "Bills", "Billed", "Credited", "Net"]}
                      empty="No bills in this period."
                      rows={report.sources.map((x) => [
                        sourceLabel[x.source as keyof typeof sourceLabel] ?? x.source,
                        x.bills,
                        formatPaise(x.billed_paise),
                        formatPaise(x.credited_paise),
                        formatPaise(x.net_paise),
                      ])}
                    />
                  </Card>
                </div>

                <Card>
                  <h3 className="mb-3 font-semibold">Collections by day</h3>
                  <Table
                    head={["Paid on", "Received", "Refunded", "Net collected"]}
                    empty="No payments in this period."
                    rows={report.daily_money.map((day) => [
                      day.date,
                      formatPaise(day.received_paise),
                      formatPaise(day.refunded_paise),
                      formatPaise(day.received_paise - day.refunded_paise),
                    ])}
                  />
                  <p className="mt-2 text-xs text-muted">Includes deposits on unbilled orders, grouped by the payment date in the business timezone.</p>
                </Card>

                <Card>
                  <h3 className="mb-3 font-semibold">By category</h3>
                  <Table
                    head={["Category", "Quantity", "Gross", "Discount", "Net"]}
                    empty="No bills in this period."
                    rows={report.categories.map((c) => [c.name, c.quantity, formatPaise(c.gross_paise), formatPaise(c.discount_paise), formatPaise(c.net_paise)])}
                  />
                </Card>
                <Card>
                  <h3 className="mb-3 font-semibold">By product</h3>
                  <Table
                    head={["Product", "Quantity", "Gross", "Discount", "Net"]}
                    empty="No bills in this period."
                    rows={report.products.map((p) => [
                      `${p.name} — ${p.variant}`,
                      p.quantity,
                      formatPaise(p.gross_paise),
                      formatPaise(p.discount_paise),
                      formatPaise(p.net_paise),
                    ])}
                  />
                  <p className="mt-2 text-xs text-muted">From bill lines, before credit notes (credit notes have no item detail).</p>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}
