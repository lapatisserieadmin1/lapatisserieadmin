# Phase 7 — Daily sales report

Date: 2026-10-03. Status: written for owner review.
PRD references: "Daily sales report" (section 5F), AC-35, Home-screen rule (sales use bill and payment dates, not due dates).

## 1. Goal and decisions

An admin picks a date range and sees what was sold, by product, category, source and payment method, with gross sales, discounts, tax, credit notes, refunds and net, and can download it as CSV. The totals must match the bills, credit notes and payments behind them (AC-35).

| Decision | Choice |
|---|---|
| Who | **Owner, 2026-10-03: admins only.** |
| Dates | Business time zone. Sales are counted on the **bill date** (`bills.issued_at`); credit notes on their own date; money on the payment's `recorded_at`. Due dates are not used. |
| What counts as a sale | Every GST bill, counter sales included. Orders without a bill are not sales yet. |
| Default range | Today. Quick picks: Today, Yesterday, This week, This month; or any range up to 1 year. |
| Out of scope | Accounting exports, charts, comparisons, report locking (Release 1.1 reconciliation). |

## 2. Figures

For the range:

- **Summary:** bills (count), gross sales (sum of bill subtotals), discounts, net sales before credit notes (sum of bill totals), credit notes (count, total), **net sales** = bill totals − credit notes, GST (CGST, SGST: bills minus credit notes), taxable value.
- **Money:** payments received by method (cash, UPI, card, …) and refunds paid by method; **net collected** = payments − refunds. Shown separately from sales, because a deposit can be paid before its bill exists.
- **By product/variant:** quantity, gross, discount, net — from bill lines (`bills.lines`), which are snapshots, so later price or name changes do not alter old reports.
- **By category:** the same, joining each bill line to its order line for the category (bill lines carry `line_no`).
- **By source:** In-store, Online, Call — bills joined to orders.

Credit notes reduce the summary and the source breakdown on their date; they are not spread over products (a credit note has no line detail), and the product table says so.

## 3. Database

`public.sales_report(p_from date, p_to date) returns jsonb` — admin only (`forbidden` otherwise), `security definer`, range ≤ 366 days and `from ≤ to`. Returns `{ summary, money, products, categories, sources }` in integer paise. One function keeps every figure consistent and testable.

## 4. Screens

`/admin/reports` (today a placeholder): date range form with the quick picks; summary tiles; Money table; By source, By category, By product tables; **Download CSV** (one file, sections separated by a heading row) from a route handler `/admin/reports/export?from&to`, admin only.

## 5. Testing

- `supabase/tests/report_logic.sql` (PGlite): a counter sale, a billed order with a discount, a credit note on another day, payments and a refund by different methods, an unbilled order with a deposit, a bill just outside the range. Checks every summary figure against direct sums of the underlying rows (AC-35), date boundaries in the business time zone, category and source grouping, counter staff refused.
- Unit test for the CSV builder (escaping commas, quotes, ₹ amounts as plain rupees with two decimals).
- Typecheck, lint, build.
