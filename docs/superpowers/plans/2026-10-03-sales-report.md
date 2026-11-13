# Daily Sales Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin-only sales report for a date range (bill dates, business time zone) with summary, money by method, and product/category/source breakdowns, plus CSV export; totals reconcile with bills, credit notes and payments (AC-35).

**Architecture:** One `security definer` SQL function `public.sales_report(from, to)` computes every figure as JSON (one source of truth, testable on PGlite). The page renders it; a route handler turns the same JSON into CSV through a pure, unit-tested builder.

**Tech Stack:** Postgres plpgsql, Next.js 16 App Router (server components, route handler), TypeScript, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-03-sales-report-design.md`

## Global Constraints

- Admins only (owner, 2026-10-03). Counter staff and chefs get `forbidden`.
- Sales on `bills.issued_at`, credit notes on `credit_notes.issued_at`, money on `payments.recorded_at`, all as business-time-zone days (`private.business_timezone()`); due dates never used.
- Integer paise everywhere; ranges `from ≤ to`, at most 366 days.
- Function: `security definer`, `set search_path = ''`, role check first, `private.fail`; execute revoked from `public, anon`, granted to `authenticated`.
- SQL checks run on PGlite: `cd supabase/local/pglite && node run.mjs report_logic`. Apply to the live project with MCP `apply_migration` only after every suite passes; compare `md5(replace(prosrc, E'\r', ''))` with PGlite.

## Review Focus

1. A bill at 23:30 India time belongs to that day, one at 00:30 to the next (UTC is 5:30 behind) — covered by B2/B3 in the checks.
2. A deposit paid on an order that has no bill yet appears under money, never under sales.
3. A credit note issued on a later day reduces that later day, not the bill's day.
4. CSV values with commas or quotes in product names stay in one column.
5. An empty day returns zeros and empty tables, not nulls that crash the page.

---

### Task 1: `sales_report` function

**Files:** Create `supabase/tests/report_logic.sql`, `supabase/migrations/20261003000600_sales_report.sql`.

**Interfaces — Produces:** `public.sales_report(p_from date, p_to date) returns jsonb`:

```json
{ "from": "2026-11-10", "to": "2026-11-10", "timezone": "Asia/Kolkata",
  "summary": { "bills": 2, "gross_paise": 0, "discount_paise": 0, "billed_paise": 0, "tax_paise": 0,
               "credit_notes": 1, "credited_paise": 0, "credited_tax_paise": 0, "net_paise": 0, "net_tax_paise": 0 },
  "money": [ { "method": "cash", "received_paise": 0, "refunded_paise": 0 } ],
  "products": [ { "name": "", "variant": "", "quantity": 0, "gross_paise": 0, "discount_paise": 0, "net_paise": 0 } ],
  "categories": [ { "name": "", "quantity": 0, "gross_paise": 0, "discount_paise": 0, "net_paise": 0 } ],
  "sources": [ { "source": "IN_STORE", "bills": 0, "billed_paise": 0, "credited_paise": 0, "net_paise": 0 } ] }
```

Arrays are `[]` when empty; products and categories ordered by net desc then name; money and sources by name.

- [ ] Step 1: write `report_logic.sql` with fixed day D = 2026-11-10 (India time), data inserted directly as superuser:
  - categories T Rp Cakes / T Rp Puffs; orders O1 (IN_STORE, 990501), O2 (CALL, 990502), O3 (ONLINE, 990503), O4 (CALL, 990504, never billed); order lines so categories resolve by `line_no`.
  - B1 on O1 at D 10:00 IST: cake ×2 gross 100000 discount 10000 net 90000 tax 4286; puff ×3 gross 9000 net 9000 tax 1373; subtotal 109000, discount 10000, total 99000, CGST 2829, SGST 2830.
  - B2 on O2 at D 23:30 IST: cake ×1 gross 50000 net 50000 tax 2381; total 50000, CGST 1190, SGST 1191.
  - B3 on O3 at D+1 00:30 IST (outside).
  - CN1 on B1 at D 15:00 IST: 9000 (CGST 214, SGST 215). CN2 on B3 at D+1 (outside).
  - Payments: O1 cash 99000 at D 10:00; O1 cash refund 9000 at D 15:00; O2 UPI 20000 at D−1 (outside) and UPI 30000 at D 23:00; O4 card 15000 at D 12:00.
  - Checks (admin): summary = `2 / 159000 / 10000 / 149000 / 8040 / 1 / 9000 / 429 / 140000 / 7611`; money = `card 15000/0, cash 99000/9000, upi 30000/0`; products = `T Rp Cake — 1 kg 3 140000, T Rp Puff — Each 3 9000`; categories = `T Rp Cakes 140000, T Rp Puffs 9000`; sources = `CALL 1 50000 0 50000, IN_STORE 1 99000 9000 90000`; AC-35: `billed_paise` and `credited_paise` equal direct sums over `bills`/`credit_notes` for the IST day; an empty day (D+30) gives zeros and `[]`; counter refused (`forbidden: Only an admin can see sales reports.`); `from > to` refused (`Choose a start date on or before the end date.`); a 400-day range refused (`Choose a range of at most one year.`).
- [ ] Step 2: run on PGlite — fails (function missing).
- [ ] Step 3: write the migration (function as specified; bill lines from `jsonb_array_elements(bills.lines)`, categories by joining `order_items` on `(order_id, line_no)`, sources by `orders.source`, money grouped by `payments.method`).
- [ ] Step 4: run every suite on PGlite — all pass.
- [ ] Step 5: commit.

### Task 2: Report page and CSV

**Files:** Create `web/src/lib/report.ts`, `web/src/lib/report.test.ts`, `web/src/app/admin/reports/export/route.ts`; replace `web/src/app/admin/reports/page.tsx`; modify `web/src/lib/database.types.ts` (`sales_report: { Args: { p_from: string; p_to: string }; Returns: Json }`).

**Interfaces — Produces:** `type SalesReport` (the JSON above); `parseSalesReport(json: unknown): SalesReport` (defaults for missing arrays); `reportToCsv(r: SalesReport): string` (sections Summary, Money, By source, By category, By product; header rows; rupees with two decimals, no ₹ sign; RFC 4180 quoting); `reportRange(params, todayKey): { from, to, error? }` for the quick picks (today, yesterday, week = Monday–today, month = 1st–today) and custom dates.

- [ ] Step 1: unit tests — CSV quoting (`Cake, "Choco"` → `"Cake, ""Choco"""`), paise → `1234.50`, section order, empty report; range picks for a fixed today; invalid custom range message.
- [ ] Step 2: run — fail.
- [ ] Step 3: implement `report.ts`; page: `requireRole(["admin"])`, GET form (from, to, quick-pick links), `supabase.rpc("sales_report")`, summary tiles, tables, "Download CSV" link to `/admin/reports/export?from&to`; route handler: `assertRole(["admin"])`, same RPC, `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="sales-<from>-to-<to>.csv"` and a UTF-8 BOM so Excel reads it.
- [ ] Step 4: `npm test`, typecheck, lint, build — pass.
- [ ] Step 5: commit.

### Task 3: Ship

- [ ] Apply the migration live (MCP `apply_migration`), compare the function hash with PGlite; run advisors.
- [ ] HANDOVER (new section, tests table, Phase 7 row) and TODO; commit; push (deploys); confirm a new production deployment is Ready.
