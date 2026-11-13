# La Patisserie — order management

**New here? Start with [HANDOVER.md](HANDOVER.md).**

Planning documents: [PRD.md](PRD.md), [TODO.md](TODO.md), [PROJECT_RULES.md](PROJECT_RULES.md).

Status (2026-10-13, live): custom cakes also take theme, design, model, fondant, cupcakes/popsicles and set-up and delivery charges, and the calendar shows each cake's flavour, weight, fondant and theme (HANDOVER section 20). From 2026-10-09: KOT, the chef screens and Counter Sale are removed, and Customers (for counter staff too), Customer orders, custom cake orders with photo and advance, product photos and collect / set-up with green and red highlights are added (HANDOVER section 19). Live, from 2026-10-05: staff login, catalogue, orders, calendar, payments, counter sale, GST bills, kitchen tickets with a chef screen and KOT, changes after the kitchen started, packing and handover, chef PIN sign-in on kitchen tablets, the daily sales report and the Home dashboard are built and deployed. The admin screens now use the owner's pink La Patisserie look; the rest of the owner's mock-up (Orders page, product photos, custom cake details, notifications, delivery) is being built in pieces. The live database holds demo data. Production: https://bakery-admin-ten.vercel.app (`main` deploys on every push). See [HANDOVER.md](HANDOVER.md).

`la pater/` is the original static prototype, kept as reference.

## Structure

- `web/` — Next.js 16 app (App Router, Tailwind v4) for the staff screens.
- `supabase/migrations/` — database schema, applied to the Supabase project `auri-bakery` (ap-south-1).
- `supabase/tests/` — SQL rule checks (access, orders, billing, capacity, no-shows, item edits, no-KOT switch-off, collect / set-up, custom cakes, photos, packing and handover, sales report) that run inside a rolled-back transaction, plus QA-user setup for end-to-end scripts.
- `supabase/seed/` — demo data for the live project and the script that removes it before go-live.
- `supabase/local/` — runs those checks without touching the Supabase project: `pglite/` (Postgres in Node, no install) or `run-tests.sh` (a local PostgreSQL).
- `docs/superpowers/` — design specs and implementation plans for recent work.
- `web/scripts/e2e/` — end-to-end checks through the real server actions (run against staging).

## Running locally

```bash
cd web
npm install
# web/.env.local already has the project URL and publishable key.
# Add SUPABASE_SECRET_KEY (Supabase → Project Settings → API Keys) to manage staff logins.
npm run create-admin -- --email you@example.com --name "Your Name"
npm run dev
```

Open http://localhost:3000 — it redirects to the staff sign-in page.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

SQL rule checks, without touching the Supabase project:

```bash
cd supabase/local/pglite && npm install && node run.mjs   # PGlite: no PostgreSQL needed
supabase/local/run-tests.sh                               # or on a local PostgreSQL 16+ (superuser)
supabase/local/concurrency-kitchen.sh                     # two-session lock check (needs psql)
```

After changing the schema, update `web/src/lib/database.types.ts` and rerun the SQL checks. See HANDOVER.md sections 3 and 5 for details, the end-to-end scripts and their caveats.

## Roles

| Role | Lands on | Can |
|---|---|---|
| Admin | `/admin` | Everything, including confirming call orders, cancel, reschedule, refunds, credit notes, staff, settings |
| Counter staff | `/admin` | Take in-store, call, customer and custom cake orders, confirm walk-ins, look up customers, record payments, issue bills, discounts up to the limit, pack and hand over orders (handing over with a balance due needs an admin) |
| Chef | — | No access since KOT was removed (2026-10-09); give former chefs a counter role or disable them |

Access is enforced by Postgres row-level security, not just by hiding screens.
