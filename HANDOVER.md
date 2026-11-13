# Handover — La Patisserie order management

Date: 2026-10-05 (first written 2026-09-27). Read this first, then [TODO.md](TODO.md) ("Start here"), [PRD.md](PRD.md), and [PROJECT_RULES.md](PROJECT_RULES.md). Designs and plans for recent work are in `docs/superpowers/specs/` and `docs/superpowers/plans/`. The project folder and repository still carry the old working name "Auri Bakery"; the owner chose **La Patisserie** on 2026-10-03.

**State on 2026-10-09:** the owner asked for KOT to be removed, Customers in its place, customer orders, custom cake orders, product photos, and collect-or-set-up with green/red highlights. That work is **built and tested on branch `no-kot-custom-cakes`, not yet merged, deployed or applied to the live database** (section 19 lists the owner steps). `main` (`b4e9eae`) is what is live: everything up to 2026-10-05, with every migration up to `20261003000900` applied. Mock-up pieces 3 (product photos) and 4 (custom cake details) are done on the branch; piece 2 (Orders page like the mock-up) is still to do.

## 1. Where things stand

| Phase | State | What exists |
|---|---|---|
| 0–2 Planning | Mostly done | PRD v0.3, rules, TODO. Many business decisions still open (PRD section 14, TODO Phase 0). |
| 3 Foundation | **Done** | Staff login, roles, kitchens, products/variants/categories, settings, audit log. |
| 4A Orders | **Done** | In-store and call orders, two order lists, order detail, confirm/reject/cancel/reschedule, payments and refunds, calendar, opening hours and closures, customers. |
| 4B Billing | **Done** | Counter quick sale, discounts, GST bills (gap-free per financial year), credit notes, 80mm and A4 print. |
| 4C | **Done except notifications** | Pickup windows, category caps, festival overrides, shared override prompt, calendar views, demo-login buttons, customer blocking and no-shows (section 9), item edits (section 10). Left: notification templates (owner to choose a channel). |
| 5A Kitchen tickets | **Removed (owner, 2026-10-09; on the branch)** | Was: tickets per kitchen, chef screen, KOT page (sections 11–12, 14, 16 are now history). Confirming makes no ticket; staff pack when ready (section 19). |
| 5B Packing and handover | **Done, deployed** | Packing → Ready; handover → Completed with the balance check and a GST bill; admin reopen and credit handover (section 13). **Defaults need the owner's confirmation** (section 6). |
| 5C Kitchen revisions | **Done, reviewed, deployed** | Changes after the kitchen acknowledged: tickets revised in place, Changed banner to acknowledge, packing waits (section 14). |
| 5D Chef PIN sign-in | **Removed with KOT (on the branch)** | Chef logins and kitchen tablets no longer have access (section 19). |
| 6 Public website | Not started | Deferred by the owner. Offers & Banners and Reviews belong to it. |
| 7 Reports and Home | **Done, deployed** | Daily sales report with CSV and GST split (section 15); Home with kitchen workload and alerts (section 17). |
| Owner's mock-up | **Pieces 1, 3, 4 done** (3 and 4 on the branch) | Look and shell (section 18); product photos and custom cake orders (section 19). Left: 2 Orders page like the mock-up → 5 notifications → 6 delivery (set-up at the customer's place now covers part of it). |
| 2026-10-09 changes | **Built, tested, not deployed** | No KOT; Customers for counter staff; Customer order source; custom cake orders (photo, price, advance, sticky note, cake sheet); product photos; collect / set up with green and red highlights (section 19). |
| 8–9 | Not started | Rehearsal, launch, Release 1.1 exceptions. |

**Browser checks so far:** automated headless-Chrome screenshots of login, Dashboard, Orders, KOT, Reports, a coming-soon page, the phone menu and the kitchen tablet (2026-10-04), plus HTTP-level checks of the PIN pages and live smoke tests of PIN sign-in. **No one has yet clicked through the real flows** (taking, confirming, changing, packing and handing over an order; the chef screen on a tablet; prints on an 80mm printer). The owner wants that walkthrough last, after the build work; it is the biggest remaining risk (section 8).

**The live database holds demo data** (owner's request, 2026-10-03): 16 demo products in 5 categories, 15 orders B-1001…B-1015 in every state (completed with bills AB/2026-27/00001–00005 and one credit note, preparing, a change awaiting the kitchen, packed awaiting pickup, cancelled with stop-work, rejected, pending, an open kitchen issue), 12 demo customers. Staff: Demo Admin and Demo Chef (both kitchens). Load with `supabase/seed/demo_data.sql`; **before real data goes in, run `supabase/seed/remove_demo_data.sql`** (SQL editor or MCP): it deletes every demo order, bill, payment, customer and product and restarts numbering at B-1001 and bill 00001. Run SQL tests locally (section 5), not on the live project.

### Owner decisions to keep in mind

- **No stock or inventory tracking** (owner, 2026-10-02). Ready-stock items are sold without counts or allocation records. Do not design stock counts into any phase, including 5B packing.
- **No KOT** (owner, 2026-10-09): no kitchen tickets, chef screen or chef logins. Orders go Confirmed → Packed → Handed over.
- **Collect or set up** (owner, 2026-10-09): every order is collected from the store (green) or set up at the customer's place (red, needs the address), shown everywhere orders appear.
- **Recording a no-show never changes the order's status.**
- **Brand: La Patisserie** (owner, 2026-10-03), chef-hat logo, tagline "More than cakes, sweeter moments"; decoration everywhere including the kitchen tablet; unbuilt screens shown as "Coming soon".
- **Delivery is wanted after all** (owner, 2026-10-03, reversing pickup-only): build it as piece 6; ask the owner for the rules (charge, area, who delivers) then.
- **Chef PINs** (owner, 2026-10-03): set by an admin; tablets never lock by themselves; no lock-out after wrong PINs.
- **Sales report: admins only** (owner, 2026-10-03).
- **Changes after the kitchen acknowledged** (owner, 2026-10-03): the ticket keeps its status and ready counts and shows the exact changes, which the kitchen acknowledges; packing waits for that. Lowering a quantity below what is already made caps the ready count; nothing records the extra (no waste or counter-sale record).

## 2. Accounts and access

| What | Where |
|---|---|
| Supabase project | `auri-bakery`, ref `hljkydruionasnouyrpu`, region ap-south-1 (Mumbai), in the owner's Supabase organisation. Ask the owner to invite you. |
| Demo admin login | `demo@auri.test`. The password is in `web/.admin-password.txt` on the owner's machine; it is git-ignored. Get it from the owner privately. `@auri.test` cannot receive emails, so create a real admin before go-live and disable this one. |
| Demo chef login | `chef@auri.test`, created 2026-10-03, assigned to Kitchen 1 and Kitchen 2. The password and the kitchen-tablet PIN are in `web/.admin-password.txt` (git-ignored); `web/.env.local` has `DEMO_CHEF_*` (so local `/login` shows a Demo chef button). Not yet on Vercel. |
| Demo-login buttons | `/login` shows "Demo admin" / "Demo chef" buttons that fill the form while `DEMO_ADMIN_*` / `DEMO_CHEF_*` are set (owner's choice, including production). **Production has `DEMO_ADMIN_*` only** (set 2026-10-03), so anyone who opens the live site can sign in as the demo admin. Local `web/.env.local` has both. **Delete them on Vercel and redeploy before real data goes in.** |
| Secret key | In `web/.env.local` as `SUPABASE_SECRET_KEY` (2026-10-03). **Not on Vercel yet**: production needs it for chef PIN sign-in and for creating staff logins and resetting passwords there (`vercel env add SUPABASE_SECRET_KEY production` from `web/`, then redeploy). It was pasted in a chat session, so **rotate it before go-live** (Supabase → API Keys) and update both places. Never commit it. |
| Publishable key and URL | Already in `web/.env.local` (safe for browsers). `web/.env.example` documents all variables. |
| Function region | **`bom1` (Mumbai), pinned in `web/vercel.json` (2026-10-18).** Until then functions ran in `iad1` (Washington DC) while the database is in Mumbai: admin pages took 2–3.5 s, now 0.2–0.7 s. Keep them in the database's region. |
| Hosting | Vercel project `bakery-admin` (team "sandymandycandy's projects"), root `web/`, production at **https://bakery-admin-ten.vercel.app**. **Git integration connected 2026-10-03:** pushes to `main` deploy to production; other branches get preview deployments. The first Git deployment (2026-10-03) built nothing and served 404s until the project's **Root Directory was set to `web`** (done 2026-10-03, with framework Next.js). **The 5C merge push (`9ab84fc`) did not start a deployment**; it was deployed by hand through the API (`POST /v13/deployments` with `gitSource` for `main`). After a push, check `vercel ls` (from `web/`) shows a new Production deployment; if not, check the GitHub app connection in the Vercel dashboard. Production env vars today: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`. Manual deploys, if ever needed, run from the repository root (Root Directory is `web`). `web/vercel.json` pins the Next.js preset (without it the site served only 404s). |
| Version control | GitHub: `sandymandycandy/bakery-admin`. `main` holds all work; every feature branch is merged (old local branches `phase-4c-*`, `phase-5a-*` and remote `claude/exciting-goldberg-09thku` can be deleted). Secrets (`web/.env.local`, `web/.admin-password.txt`) are git-ignored and must be shared separately. |


## 3. Running it

```bash
cd web
npm install
npm run dev            # http://localhost:3000 → redirects to /login
npm run typecheck      # next typegen + tsc
npm run lint
npm test               # unit tests (Node's built-in runner, src/**/*.test.ts)
npm run build
npm run create-admin -- --email you@example.com --name "Your Name" [--role admin|counter|chef]   # needs SUPABASE_SECRET_KEY
```

Node 22 is used (22.18+ runs the `.ts` tests directly). There is no Docker, so there is no local Supabase; the app talks to the hosted project.

The SQL rule checks do not need the hosted project. On any PostgreSQL 16+ where you are a superuser:

```bash
supabase/local/run-tests.sh                  # every check file (or name some: run-tests.sh packing_logic)
supabase/local/concurrency-kitchen.sh        # two-session lock-order check
```

**No PostgreSQL on the machine?** `supabase/local/pglite/` runs the same checks on PGlite (Postgres compiled to WebAssembly, in Node): `cd supabase/local/pglite && npm install && node run.mjs [names…]`. It needs Python for `check_results.py`. The 2026-10-03 5C results come from it; it reproduces every earlier result.

`run-tests.sh` builds a scratch database from `supabase/local/shim.sql` (stand-ins for Supabase's `auth` schema and API roles) plus every migration, runs each `supabase/tests/*.sql`, and compares every outcome with the file's `-- expect:` comments. Checks without a machine-checkable expectation (most of `orders_logic` and `billing_logic`) are printed for a person to read.

**If `npm run dev` returns 500 on every page** with a Turbopack panic about `globals.css` (`node process exited … 0xc0000142`), start with `npx next dev --webpack` instead. This happened from a sandboxed agent shell on the owner's machine; it may not affect a normal terminal. Production builds on Vercel are unaffected.

**Next.js 16 is newer than most training data and tutorials.** `web/AGENTS.md` points to the bundled docs in `web/node_modules/next/dist/docs/`. Notable differences: `middleware.ts` is now `src/proxy.ts`; `params`/`searchParams` are Promises; `PageProps<"/route">` and `LayoutProps` are global types generated by `next typegen`. The `react-hooks/purity` lint rule rejects `Date.now()` during render.

## 4. Architecture

```
auri bakery/
├── PRD.md, TODO.md, PROJECT_RULES.md, HANDOVER.md, README.md
├── docs/superpowers/          specs and implementation plans for recent work
├── la pater/                  original static prototype (reference only; do not modify)
├── supabase/
│   ├── migrations/            schema, in order (applied to the live project)
│   ├── tests/                 SQL rule checks (run in a transaction, then rolled back)
│   └── local/                 runs the checks on a scratch local PostgreSQL (no Supabase needed)
└── web/                       Next.js 16 app (App Router, Tailwind v4, zod)
    ├── src/proxy.ts           session refresh; signed-out users → /login
    ├── src/lib/               auth, Supabase clients, money, time zone, orders, kitchen, DB types
    ├── src/app/login          staff sign-in (chefs go to /kitchen)
    ├── src/app/admin/...      admin and counter screens (incl. /admin/kot)
    ├── src/app/kitchen        chef screen (tickets for the chef's kitchens)
    ├── src/app/print/...      printable bill, credit note, kitchen ticket
    ├── src/components/        shared UI, override prompt, catalogue picker, kitchen ticket card
    └── scripts/               create-admin, e2e/
```

### How writes work (important)

- **Catalogue, staff, settings, hours, and closures** are written directly through Supabase with row-level security (RLS). Only admins can write.
- **Orders, payments, bills, credit notes, customers' flags, and kitchen tickets can only be written through Postgres functions.** Staff have **no insert or update grants** on those tables.
  - Orders and money: `create_order`, `confirm_order`, `reject_order`, `cancel_order`, `reschedule_order`, `update_order_items`, `record_payment`, `apply_discount`, `issue_bill`, `issue_credit_note`, `counter_sale`, `record_no_show`, `undo_no_show`, `set_customer_blocked`, and (5B) `mark_packed`, `reopen_packing`, `record_handover`.
  - Kitchen: `acknowledge_ticket`, `start_ticket`, `set_line_ready`, `report_issue`, `resolve_issue`, `acknowledge_stop_work`, `record_ticket_print`. Read-only: `ticket_stamp` (the chef screen's change check).
- Order functions check the caller's role, validate everything, take an **idempotency key** where a retry could duplicate, take the order **version** so concurrent edits fail with "conflict", and write an `order_events` timeline row.
- Kitchen functions take **no version**: each states an end result ("12 ready", "started"), so repeats and double taps change nothing. Admins may act on tickets only as an exception with a reason (at least 5 characters).
- **Lock order: the order first, then its tickets.** `private.lock_order` locks the order (`for update`); chef actions go through `private.lock_ticket`, which locks the order (`for no key update`) before the ticket, and `private.kitchen_guard` locks the order's tickets before it checks them. Keep this order in new functions, or an admin edit and a chef tap on the same order can deadlock (`supabase/local/concurrency-kitchen.sh` reproduces it without the fix).
- The functions are `SECURITY DEFINER` in `public`. The Supabase advisor warns about this; it is intentional (they are the only write path and each checks the role). Helpers live in the unexposed `private` schema.
- Errors use `private.fail(message, kind)`. The message is written for staff; `kind` travels in the Postgres `hint` field (`slot`, `lead_time`, `capacity`, `conflict`, `forbidden`, `unmapped`, `billed`, `blocked`, `unavailable`, `kitchen`, …). `web/src/lib/orders.ts → rpcError` maps them; `slot`, `lead_time`, `blocked` and `capacity` show the shared `OverridePrompt`, where admins retry with a reason. `kitchen` is deliberately not overridable.
- Every table has an audit trigger (`audit_events`: who, what, before, after).

### Invariants — do not break

- Money is **integer paise** everywhere. Prices are **GST-inclusive**; tax is the included portion per line.
- Order lines are **snapshots**: catalogue edits never change existing orders. Kitchen ticket lines are snapshots of order lines.
- All scheduling uses the **business timezone** from `business_settings` (Asia/Kolkata). Convert with `web/src/lib/time.ts`; never use the server's or browser's zone.
- Payments are an **append-only ledger**: corrections are refunds. Bills and credit notes are **immutable**, and bill numbers are **gap-free per financial year** (April–March) via `document_sequences`. A billed order cannot be cancelled until fully credited.
- Chefs see **only kitchen tickets for their assigned kitchens** (`staff_kitchens`) and never orders, payments, customers, order events, bills or prices.
- Balances come from the `order_summaries` view: total − credit notes − payments + refunds. Cancelled and rejected orders charge nothing, so a negative balance means a refund is due.
- `order_summaries` is built with `o.*`, which Postgres expands when the view is created. It was last recreated on 2026-10-03 (`20261003000500`), so it has every `orders` column up to 5B; a column added to `orders` later is missing until the view is recreated (drop and create, then the same grants).

### Database migrations

Files in `supabase/migrations/` were applied to the live project in order through the Supabase MCP server. The CLI is not linked. To continue:

- Install the Supabase CLI and run `supabase link --project-ref hljkydruionasnouyrpu`. Check that the remote migration history matches the files (names: `foundation`, `orders`, `billing`, `bill_gst_split_per_rate`, `bill_gst_split_integer_division`, `counter_sale_precheck`, `capacity`, `capacity_enforcement`, `capacity_review_fixes`, `no_shows`, `edit_order_items`, `kitchen_tickets`, `kitchen_review_fixes`, `packing_handover`).
  - The last GST-split fix was applied as `bill_gst_split_integer_division`, but its file is `20260927000310_bill_gst_split_per_rate.sql` (the file already contains the fixed version). Reconcile the history names when linking.
- New tables in `public` get full API access by default in Supabase. Every migration so far **revokes** that and grants only what is needed; keep doing this, and enable RLS on every table.
- When a migration replaces an existing function, copy its **latest** definition (later migrations redefine `confirm_locked`, `reschedule_order`, `cancel_order`, `update_order_items`) and change only what you need.
- After schema changes, update `web/src/lib/database.types.ts`. It was condensed by hand from generated output (write-only-by-function tables are `Insert: never`); later tables and functions were added by hand in the same shape. Replacing it with fully generated types is fine.
- Run the security and performance advisors after each migration. Expected findings today (checked 2026-10-03): `authenticated_security_definer_function_executable` for the 27 public write functions (intentional), unused indexes (empty database), `document_sequences` with no policy (intentional), leaked-password protection off (turn it on).
- **Applying through the Supabase MCP connector:** `apply_migration` waits for an interactive confirmation on destructive statements such as `DROP FUNCTION` and times out when nobody answers. Write migrations without drops (replace instead, as `20261003000100` does for `sync_ticket`), or apply them in the SQL editor.
- **Live project vs the migration files (checked 2026-10-03 by digest):** tables, columns, constraints, indexes, policies, grants, triggers, views and 62 of 71 functions are byte-identical. The other 9 (`build_tickets`, `confirm_locked`, `issue_bill_locked`, `recalc_order_totals`, `cancel_order`, `counter_sale`, `report_issue`, `reschedule_order`, `update_order_items`) differ only in SQL comments, which were left out when they were applied. Nothing to do; a later migration that replaces them brings the comments back.

## 5. Tests

| Test | How to run | Last result |
|---|---|---|
| `supabase/tests/rls_foundation.sql` | `supabase/local/pglite` (`node run.mjs`) or `supabase/local/run-tests.sh` | 11/11 (2026-10-03; the file has 11 checks, which the earlier "13/13" did not match) |
| `supabase/tests/orders_logic.sql` | same | 22/22 (2026-10-03): 6 machine-checked, 16 read and identical to the run before the 2026-10-03 migrations except the time-of-day message noted below |
| `supabase/tests/billing_logic.sql` | same | 21/21 (2026-10-03): 9 machine-checked, 12 read and identical |
| `supabase/tests/capacity_logic.sql` | same | 29/29 (2026-10-03): 28 machine-checked, 1 read |
| `supabase/tests/no_show_logic.sql` | same | 26/26 (2026-10-03). Orders from 990001. |
| `supabase/tests/edit_items_logic.sql` | same | 21/21 (2026-10-03). Orders from 990101. |
| `supabase/tests/kitchen_logic.sql` | same | 48/48 (2026-10-03): access per kitchen, ticket building, chef actions, ready counts and corrections, issues, prints, edits/reschedules while New and refused after acknowledgement, cancel → stop-work, and F1–F4 for the review fixes. Orders from 990201. |
| `supabase/tests/packing_logic.sql` | same | 22/22 (2026-10-03, Phase 5B): packing refusals, ready-stock-only packing, retries, balance check and credit handover, bill at handover, reopen. Orders from 990301. |
| `supabase/tests/pin_logic.sql` | `supabase/local/pglite` | 19/19 + 4 read (2026-10-03, Phase 5D): who sets PINs and registers tablets, PIN format, chefs only, PIN changes audited without the hash, nobody can read hashes or call the tablet functions, right/wrong PIN (counted), other kitchen, inactive chef, unknown or revoked tablet, chef list, PIN logins recorded and checked against their own tablet, PIN reset and revoke end those logins in `auth.sessions` but not the chef's email login. |
| `supabase/tests/report_logic.sql` | `supabase/local/pglite` | 12/12 (2026-10-03, Phase 7): summary incl. CGST/SGST/taxable, money by method (deposit on an unbilled order), products, categories, sources, AC-35 totals against the bills and credit notes, India-time day boundaries, empty day, range checks, counter refused. Orders from 990501. |
| `supabase/tests/revisions_logic.sql` | same | 35/35 (2026-10-04, Phase 5C and its review fixes): who may change preparing orders, in-place revisions with kept/capped ready counts, merged change lists, acknowledgement (who, repeats), removed lines kept as cancelled, stop-work when a kitchen loses everything, New tickets still rebuilt, packing blocked until acknowledged, packed orders reopened first, reschedules, bills without removed lines. Orders from 990401. |
| `supabase/local/concurrency-kitchen.sh` | run it | PASS (2026-10-03, before 5C). Needs `psql`; not rerun since 5C replaced `kitchen_guard` with `private.revise_tickets` (which takes the same order-then-tickets locks). |
| `supabase/tests/no_kot_logic.sql` | `supabase/local/pglite` | 5/5 (2026-10-09): unmapped made-to-order item confirms with no ticket, packs; chef PINs closed; live tickets and issues retired; retired order packs. Orders from 990901. |
| `supabase/tests/fulfilment_logic.sql` | same | 11/11 (2026-10-09): set-up needs an address and a time; collect stores none; Customer source needs name and phone, admin-only confirm; `set_fulfilment` validates, logs, refuses closed orders; counter sale is collect. |
| `supabase/tests/custom_cakes_logic.sql` | same | 14/14 (2026-10-09): staff price and settings GST, details kept, advance as a payment, idempotent, validation, re-pricing, no quantity increase, locked once packed, counter can read. |
| `supabase/tests/photos_logic.sql` | same | 8/8 (2026-10-09): buckets, admin-only product photos from the bucket, cake photo under its order, removal. |
| `kitchen_logic`, `revisions_logic`, `pin_logic` | — | **Deleted 2026-10-09** with KOT. `packing_logic` (now 20/20) and `orders_logic` (AC-06 now expects confirmation) were updated. |
| `web/src/lib/*.test.ts` (capacity, report, home, shell, orders, custom-cake, product-photo) | `npm test` | 26/26 (2026-10-09): pickup windows; report CSV and date ranges; collected-today; menu per role (no KOT, Customers for counter) and bell count; search scope, Customer list, green/red classes; cake details, size name, photo checks; product photo path. |
| `web/scripts/e2e/orders-4a.mjs` | Build, `npm start -- -p 3100`, create QA users (`supabase/tests/qa_users.sql`), then `QA_PW=... npm run e2e:orders` | 29/29 (Phase 4A) |
| `web/scripts/e2e/billing-4b.mjs` | Same setup, `npm run e2e:billing` | 17/19; the 2 failures are test-script issues (assertions depend on leftover data). Fix before relying on it. |

**Prefer the PGlite runner** (`cd supabase/local/pglite && npm install && node run.mjs`, section 3): it needs no PostgreSQL and touches nothing live. The results above come from it; the live project was compared with the migration files separately (section 4). **If you run SQL tests on the live project** through the Supabase MCP tool or any client that returns only the last result: replace the file's last two lines (`select … from r …; rollback;`) with
`do $$ begin raise exception E'RESULTS\n%', (select string_agg(check_name || ' => ' || coalesce(outcome,'NULL'), E'\n' order by n) from r); end $$;`
The error message then lists every check, and the exception rolls everything back. `supabase/local/mcp-bundle.sh <test> [migration…]` builds such a batch, with not-yet-applied migrations in front. The Supabase MCP server asks for confirmation on every batch that contains `DELETE`/`UPDATE` without `WHERE` or `DROP` (the test setup does), so prefer the PGlite runner. In the SQL editor, run the file as is. Compare each outcome with the `-- expect:` comment above it.

Caveats:
- The newer test files insert orders directly with high order numbers, so they do not consume `order_number_seq`. The older ones (`orders_logic`, `capacity_logic`, `billing_logic`) call `create_order` and **do** consume order numbers. Reset the sequence only while no real orders exist.
- The e2e scripts **commit data**. Run them against staging. Never run successful counter sales or bill issuing on the live project after launch: bills are permanent and consume real numbers.
- Some messages depend on the time of day: for example `orders_logic`'s "lead time violation" check reports the opening-hours message when run late at night.

## 6. Defaults chosen (owner has not confirmed)

| Default | Where to change |
|---|---|
| Business name **La Patisserie** (owner, 2026-10-03; set in Settings 2026-10-04). Bill prefix still `AB` | Settings |
| Custom cake GST 5% included in the staff price; HSN empty | Settings |
| Counter staff can take custom cake orders and edit the cake until packed; only an admin changes the price of a confirmed custom cake | `update_custom_cake` |
| Set-up has no extra charge (add a line if needed); the set-up time is the order's due time | Owner to confirm |
| Prices include GST; intra-state CGST/SGST split | Code (migrations 0200/0300) |
| Opening hours 9 AM–9 PM every day | Settings → Opening hours |
| Counter staff discount limit 10% | Settings |
| Counter staff can confirm in-store orders; only admins confirm call orders, reject, cancel, reschedule, refund, issue credit notes, or resolve kitchen issues | Migrations (role checks in functions) |
| Manual payment recording; no stock counts (owner, 2026-10-02). Pickup only **for now**: the owner wants delivery later (piece 6) | PRD section 2 |
| 5B: counter staff can pack and hand over orders (PRD: "Admin or permitted Counter Staff") | `mark_packed`, `record_handover` (migration `20261003000200`) |
| 5B: handing over with a balance due needs an admin and a credit reason (AC-10); a refund due does not block handover | `record_handover` |
| 5B: handover issues the GST bill when the order has none (PRD 5F: every completed sale gets a bill) | `record_handover` |
| 5B: only an admin can reopen a packed order, with a reason; it returns to Preparing (Confirmed when there are no kitchen tickets) | `reopen_packing` |

Also unconfirmed: the mock-up status colours (Pending pink, Confirmed blue, Preparing yellow, Ready and Completed both green); the owner was asked whether Completed should be grey. Business decisions still needed are listed in PRD section 14 and TODO Phase 0. The most urgent are: GSTIN/FSSAI/tax rates (check with the accountant), the real product list with kitchen mapping, opening hours, and the notification channel.

## 7. Known gaps and risks

- **Real flows not clicked through yet** (section 1). Print layouts have not been checked on a real 80mm printer.
- **The live site offers a demo admin login to anyone** (`DEMO_ADMIN_*` on Vercel) and holds demo data. Fine for showing the owner; remove both before real customers (TODO Start here).
- **Chef PIN sign-in is off on the live site** until `SUPABASE_SECRET_KEY` is set on Vercel; the secret key must be rotated before go-live (section 2).
- **No staging environment.** Production uses the only Supabase project. SQL logic is tested on PGlite; the app itself only runs against the live project. The free plan allows two active projects and the owner already uses one elsewhere.
- **Vercel missed one Git push** (2026-10-03, the 5C merge); later pushes deployed. After pushing, confirm a new Production deployment for the commit (section 2).
- Handover issues a GST bill when the order has none, which uses a bill number for good. Do not hand over test orders on the live project except as demo data that `remove_demo_data.sql` will remove.
- Packing is one confirmation per order; the itemized checklist and recipient checks are Release 1.1.
- The chef screen polls every 10 seconds (not Supabase Realtime); a tap that fails on the network shows "Not saved" and Offline.
- Look (section 18) leftovers: sidebar and bell counts refresh only on a full page load or refresh; the account menu does not close on Escape or outside clicks; the "coming soon" placeholders for Offers and Reviews open for counter staff by URL; 9 px tagline.
- `supabase/local/concurrency-kitchen.sh` (needs `psql`) has not been rerun since 5C.
- Leaked-password protection is off (Supabase → Auth → Password security).
- `next start` warns about `outputFileTracingRoot` (multiple lockfiles on the machine). Harmless.

## 8. Suggested order of work

0. **Ship the 2026-10-09 branch** (section 19): owner approves; apply migrations `20261009000100`–`0300` to the live project; merge `no-kot-custom-cakes` into `main` (Vercel deploys); click through the new screens.
1. **Piece 2 of the owner's mock-up: the Orders page** — status tabs with counts, search, date and order-type filters, rows with item photos (placeholder until piece 3), and the order detail opening beside the list with notes and the main next-step button. Brainstorm it from the mock-up (section 18), write a spec and plan as for piece 1.
3. **Piece 5: notifications** (the bell; today it opens the Dashboard) and, once the owner picks a channel, customer notification templates (PRD 5F proposes WhatsApp click-to-chat).
4. **Piece 6: delivery** — ask the owner for the rules first (charge, area, who delivers, "Out for delivery" handover).
5. **Owner steps:** add `SUPABASE_SECRET_KEY` on Vercel; confirm the 5B defaults and the status colours (section 6); supply business details (GSTIN, FSSAI, tax rates, products with kitchens, hours).
6. **Browser walkthrough of every flow** (owner wants it after the build work): admin and counter, chef on a tablet with PIN sign-in, the revision flow, packing and handover, prints. Consider Playwright (a headless-Chrome screenshot script was used for piece 1; it lives only in a session scratchpad, so rewrite it under `web/scripts/` if kept).
7. **Before go-live:** run `supabase/seed/remove_demo_data.sql`; delete `DEMO_*` on Vercel; rotate the secret key; create real admin and staff logins and disable the demo ones; enable leaked-password protection; staging and backups (Phases 7–8).
8. Public website (Phase 6, with Offers & Banners and Reviews) when the owner is ready.

## 9. Customer blocking and no-shows (built 2026-09-30)

Migration `20260930000100_no_shows.sql` (applied). PRD 5F "Spam and no-show protection".

- **Owner's decision:** recording a no-show does **not** change the order's status. Staff cancel or complete the order separately.
- **Database:** `orders.no_show_at`/`no_show_by` (each order counts at most once); `record_no_show` (admin and counter; orders with a customer, past pickup, in confirmed/preparing/ready/cancelled); `undo_no_show` (admin, reason); `set_customer_blocked` (admin, reason both ways); `customer_events` keeps every block and unblock with its reason.
- **Screens:** customer page `/admin/customers/[id]`; Blocked / N no-shows badges, Record no-show and Undo on the order page; a warning under the phone field on the new-order form (`src/components/customer-warning.tsx`).

## 10. Editing items on an order (built 2026-09-30)

Migration `20260930000200_edit_order_items.sql` (applied); `update_order_items(order, version, lines, reason, override_reason)`. The order page shows **Edit items** in the Items card.

- **Who and when:** admin and counter staff on draft and pending orders; admins only on confirmed orders, with a required reason. Never on preparing, ready or closed orders, or once a GST bill exists (credit note instead). Since 5A, also refused once any kitchen ticket is past New.
- **Lines:** the full new list. Existing lines keep their price snapshot; new lines take today's price; lines left out are deleted (the audit log keeps them).
- **Checks, only on what the edit adds:** availability (not overridable), preparation time, and daily caps for newly added categories; lead-time and cap refusals can be overridden by an admin with a reason.
- **Money:** totals recalculated; a discount keeps its rupee amount, capped at the new subtotal.
- **Timeline:** one `items_changed` event listing each change and the old and new totals; `tickets_revised` when kitchen tickets were rebuilt.
- Product search and quantity controls are shared with the new-order form (`src/components/catalogue-picker.tsx`, `src/lib/catalogue.ts`).

## 11. Kitchen tickets (Phase 5A, built 2026-10-03)

Spec `docs/superpowers/specs/2026-09-30-kitchen-tickets-design.md`; plan `docs/superpowers/plans/2026-09-30-kitchen-tickets.md`; migration `20260930000300_kitchen_tickets.sql` (applied as `kitchen_tickets`).

- **Tables:**
  - `kitchen_tickets`: one per order per kitchen; reference `B-1001-K1`; revision; status `new → acknowledged → preparing → ready`, or `cancelled`; pickup and start-by times; who/when for each step; stop-work acknowledgement; print count. No prices or customer data.
  - `kitchen_ticket_lines`: snapshot of made-to-order lines with ready counts.
  - `kitchen_issues`: problems reported by chefs, resolved by admins.
  - View `order_kitchen_progress`: `all_ready`, `open_issues`, `stop_work_pending` per order.
- **Access:** `private.can_see_kitchen` — admin and counter see all; chefs only their `staff_kitchens`.
- **When tickets are made:** in `private.confirm_locked` (both confirm paths). Ready-stock lines and counter sales get none. `private.build_tickets` rebuilds tickets when a confirmed order is edited or rescheduled **while every ticket is New** (revision + 1 only for tickets that changed; a kitchen that drops out gets a stop-work ticket that keeps its lines). Once any ticket is past New, `private.kitchen_guard` refuses edits and reschedules with kind `kitchen`.
- **Cancelling** an order cancels its tickets and raises a stop-work notice until a chef acknowledges it. Ready counts stay as a record.
- **Order status:** Confirmed → Preparing when any ticket starts. When every ticket is ready the order **stays Preparing** with an "All kitchen items ready" badge; packing then sets Ready (5B, section 13).
- **Screens:**
  - Chef screen `/kitchen`: Today / Tomorrow / Later, overdue first, source filter, kitchen switch, one-tap Ready, Part ready, Report issue, Print, stop-work notices, "Updated N s ago" / Offline banner.
  - `/admin/kot`: open issues with Resolve, stop-work list, tickets by day/kitchen/source/status.
  - Order page Kitchen card; kitchen badges in order lists and the calendar.
  - `/print/kot/[id]`: 80mm, COPY on reprints.
- **Refresh:** the chef screen polls a change stamp every 10 seconds and reloads only when it changed. Since 2026-10-03 the stamp is `public.ticket_stamp()`: a digest of the `updated_at` values of the tickets that can be on screen (still being worked on, or touched in the last two days), scoped to the chef's kitchens by row-level security. Every ticket write touches `updated_at`.
- **Since 5C** (section 14) `private.kitchen_guard` is gone: edits and reschedules revise acknowledged tickets in place instead of being refused.

## 12. Kitchen review fixes (built 2026-10-03)

Migration `20261003000100_kitchen_review_fixes.sql` (applied as `kitchen_review_fixes`); web commit `c8180e8`, SQL commit `79f28e8`.

- **One lock order** (order, then ticket): `lock_ticket` locks the order first; `kitchen_guard` locks the tickets it checks; `resolve_issue` goes through `lock_ticket`. Before this, an admin edit and a chef starting the same order's ticket deadlocked (reproduced and now passing in `supabase/local/concurrency-kitchen.sh`).
- The "Kitchen ticket ready" timeline entry carries the admin's reason when an admin acts as the kitchen (`sync_ticket(uuid, text)`; the one-argument form stays and forwards).
- `public.ticket_stamp()` replaces the count + newest `updated_at` stamp (which could miss a late commit and counted all history).
- Web: the chef screen goes to `/login` when the session is gone (401, or the proxy's redirect) instead of showing Offline forever; `/admin/kot` "Open" on today includes open tickets from earlier days; Part ready "Save" needs an admin's reason; cancelled tickets can be printed; the Resolve form catches network errors.

## 13. Packing and handover (Phase 5B, built 2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-packing-handover-design.md`; migration `20261003000200_packing_handover.sql` (applied as `packing_handover`); commit `7399343`.

- **Columns on `orders`:** `packed_at`, `packed_by`, `packing_note`, `handed_over_by`, `collected_by`, `credit_reason` (`completed_at` already existed). `order_summaries` has them since `20261003000500`.
- **`mark_packed(order, version, note)`** (admin, counter): Confirmed or Preparing orders whose live kitchen tickets are all Ready and with no open kitchen issue → **Ready**. Ready-stock-only orders pack straight from Confirmed. Packing a Ready order again changes nothing.
- **`record_handover(order, version, collected_by, credit_reason)`** (admin, counter): Ready orders → **Completed**. A balance due is refused with kind `balance`; an admin retries with a credit reason through the shared `OverridePrompt` ("Hand over on credit"), and the balance at handover is recorded. Issues the GST bill if there is none. Handing over again changes nothing (AC-22).
- **`reopen_packing(order, version, reason)`** (admin): Ready → Preparing (Confirmed without kitchen tickets), packing record cleared, timeline keeps it.
- **Screens:** order page "Packing & handover" card (what is still missing, Mark packed, handover form with the balance, Reopen); Home "Ready for pickup" list with late collections; timeline entries Packed, Packing reopened, Handed over.
- **Not done (Release 1.1):** itemized checklist, recipient verification, partial collection, late/uncollected workflow beyond the Home list.

## 14. Kitchen revisions (Phase 5C, built 2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-kitchen-revisions-design.md`; plan `docs/superpowers/plans/2026-10-03-kitchen-revisions.md`; migrations `20261003000300_kitchen_revisions.sql` and `20261003000400_kitchen_revisions_fixes.sql` (applied to the live project as `kitchen_revisions` and `kitchen_revisions_fixes`; the live function bodies were compared with the file by `md5(prosrc)`).

- **Owner's decisions:** a revised ticket keeps its status and ready counts and shows a change list the kitchen acknowledges; the chef keeps working. Lowering below the ready count caps it, with no waste record.
- **Columns:** `kitchen_tickets.pending_changes` (jsonb list of `{key, kind: quantity|notes|pickup, item, from, to}`; an added item is a quantity change from 0, a removed one to 0), `has_pending_changes` (generated), `changes_acknowledged_at/by`. Ticket lines may now be quantity 0 when cancelled. `order_kitchen_progress.changes_pending`.
- **Functions:**
  - `update_order_items` and `reschedule_order` now accept **preparing** orders (admin, reason); **ready** (packed) orders are refused with kind `kitchen` ("Reopen packing first"). They call `private.apply_ticket_changes`.
  - `private.revise_tickets` updates acknowledged, preparing and ready tickets in place (lines matched by `order_item_id`; ready counts kept or capped; new lines added; removed lines kept at 0 as cancelled; pickup moves recorded) and merges the entries into `pending_changes` with `private.merge_ticket_changes` (net change since the last acknowledgement; 2 → 3 → 2 leaves the list). `private.build_tickets` still rebuilds New tickets as in 5A and cancels kitchens with nothing left (stop-work).
  - An order line the kitchen has acknowledged is no longer deleted when it is left out of an edit: `cancelled_quantity = quantity`, value 0. Sending a removed line's id again is refused.
  - `public.acknowledge_ticket_changes(ticket, reason)`: the assigned chef, or an admin with a reason; repeats do nothing; timeline `ticket_changes_acknowledged`.
  - `mark_packed` refuses while any live ticket has unacknowledged changes. `sync_ticket` ignores cancelled lines; `set_line_ready` refuses them. Bills leave out fully cancelled lines.
- **Screens:** chef screen and order page show a "Changed · revision N" banner with the change list and **Acknowledge changes**; removed lines struck through; Ready tickets with changes stay on the chef's Active tab and sort first. Order page: Edit items and Reschedule on preparing orders, removed items struck through, a hint to reopen packed orders, the packing card names kitchens that have not acknowledged, the timeline lists each change. `/admin/kot`: "Awaiting acknowledgement of changes". Order lists and calendar: "Change unacknowledged" badge. Print: REVISED rN, the change list, removed lines.
- **Review fixes** (`20261003000400`): removed lines no longer count as already on the order for category caps; `acknowledge_ticket_changes(ticket, reason, expected_revision)` refuses (kind `conflict`) when the order changed again after the screen loaded, so a chef never clears changes they have not seen.
- **Review minors fixed** (`20261003000500`, 2026-10-03): `order_summaries.kitchen_ids` and the reschedule preview ignore removed lines; stop-work notices and prints leave out earlier-removed lines; an item added and removed before acknowledgement is deleted from the ticket; Ready tickets with changes show only on Active (chef) and once on `/admin/kot`; a ticket made Ready by an edit logs "Order changed: everything left was already made."; `report_issue` refuses removed items; pickup change entries are UTC text. `revisions_logic` 34/34.
- **Not done:** moving items between kitchens; waste or counter-sale records; edits on billed orders (credit note). Not yet walked through in a browser.

## 15. Daily sales report (Phase 7, built 2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-sales-report-design.md`; plan `docs/superpowers/plans/2026-10-03-sales-report.md`; migration `20261003000600_sales_report.sql` (applied live as `sales_report`).

- **Owner's decision:** admins only.
- **`public.sales_report(from, to)`** returns JSON in paise: summary (bills, gross, discounts, billed, GST with CGST/SGST and taxable value for bills, credit notes and net (review fix `20261003000800`), credit notes, net sales = billed − credit notes), money by payment method (received, refunded), and sales by product/variant (from bill lines), category (bill line → order line → category) and source. Days are business-time-zone days; sales on `bills.issued_at`, credit notes on their own `issued_at`, money on `payments.recorded_at`. At most 366 days.
- **Screens:** `/admin/reports` with Today / Yesterday / This week (from Monday) / This month or custom dates; `/admin/reports/export` downloads the same report as CSV (UTF-8 with BOM for Excel; rupees with two decimals). Helpers and tests: `web/src/lib/report.ts`.
- Credit notes are not spread over products (they have no line detail); the product table says so.

## 16. Chef PIN sign-in on kitchen tablets (Phase 5D, built 2026-10-03)

Spec `docs/superpowers/specs/2026-10-03-chef-pin-signin-design.md`; plan `docs/superpowers/plans/2026-10-03-chef-pin-signin.md`; migrations `20261003000700_chef_pin_signin.sql` and `20261003000800_review_fixes.sql` (both live).

- **Owner's decisions:** admins set PINs (4–6 digits); tablets never lock by themselves; no lock-out after wrong PINs (they are counted per tablet and shown to admins). Accepted risk: a PIN works only on a registered tablet, so guessing needs the tablet itself.
- **Setup:** an admin opens Staff & Kitchens **on the tablet** → Kitchen tablets → *Register this browser as a tablet* (chooses the kitchen). That puts a random token in an httpOnly cookie (`kitchen_device`, 400 days); the database keeps only its SHA-256 (`kitchen_devices`). Then sign out: the tablet shows the chef picker (`/kitchen/pin`). Each chef row has *Set PIN* / *Reset PIN* / *Remove PIN*.
- **Sign-in:** the chef taps their name and types the PIN. The server (service-role key) runs `verify_kitchen_pin` (registered, unrevoked tablet; active chef of that tablet's kitchen; right PIN; `{ok:false}` for every refusal), opens a normal Supabase login for the chef without a password (admin `generateLink` + `verifyOtp`, nothing emailed) and records it by session id in `kitchen_pin_sessions`.
- **Staying valid (review fix):** `/kitchen` and `/kitchen/stamp` ask `kitchen_pin_session_status(session id, tablet hash)` on every load and 10-second poll: `none` = an email login, `ok`, or `invalid` (tablet revoked, PIN reset/removed, chef moved or deactivated, login used from another browser). Revoking a tablet or changing a chef's PIN also deletes those logins from `auth.sessions` (refresh tokens die; verified live). Invalid → `/kitchen/pin/end` signs out this device and returns to the picker. If the check itself fails (database unreachable), the chef stays signed in (availability).
- **Elsewhere:** `/login` on a registered tablet forwards to the picker (`/login?email=1` still offers email and password). Sign out / *Switch chef* end only this device's login. Without `SUPABASE_SECRET_KEY` the picker says PIN sign-in is not set up and nothing else changes.
- PIN hashes are in `staff_pins` (bcrypt via `extensions.crypt`): no policies, no grants, never in `audit_events` (PIN changes are logged as UPDATE/DELETE on `staff_pins` without the hash).
- **Review minors fixed** (2026-10-03, `20261003000900` and web): CSV text that starts like a spreadsheet formula (`= + - @`) gets a leading apostrophe; impossible custom report dates (2026-02-31) are refused before the query; an item added before acknowledgement and partly made stays as a Removed line when removed; the `database.types.ts` comment about `order_summaries` columns is corrected.

## 17. Home screen (completed 2026-10-03)

`/admin` (admin and counter): New in-store / call order, Open calendar, Open KOT; missing-routing alert; a **Kitchen needs attention** alert (changes not acknowledged, stop-work not acknowledged, open kitchen issues, tickets past start-by and not started); tiles for due today, awaiting confirmation, overdue and balance due today; due-today split (in-store, online/call, preparing, ready); **money collected today** for admins (payments minus refunds by payment date, the sales report's rule); one card per kitchen (open tickets, items to make, not started, late to start, past pickup, changes unacknowledged; links to `/admin/kot?kitchen=…`); ready for pickup with late collections; next 7 days; setup checklist. Figures: `web/src/lib/home.ts` (unit-tested).

## 18. La Patisserie look (piece 1 of the owner's mock-up, 2026-10-04)

Spec `docs/superpowers/specs/2026-10-03-la-patisserie-look-design.md`; plan `docs/superpowers/plans/2026-10-03-la-patisserie-look.md`. The owner sent a pink "La Patisserie" mock-up; it is being built in pieces: **1 look and shell (done)** → 2 Orders page like the mock-up → 3 product photos → 4 custom cake details → 5 notifications → 6 delivery (owner now wants delivery, reversing pickup-only; rules to be asked then). Offers & Banners and Reviews stay "coming soon" until the public website.

- **Brand:** La Patisserie, chef-hat mark and tagline (`Brand`, `ChefHat`, `ScriptText` in `components/ui.tsx`); business name in Settings set to La Patisserie on 2026-10-04 (new bills carry it).
- **Theme:** tokens in `globals.css` (brand `#c2456a`, chosen for 4.5:1 contrast with white text; `rose` `#e8789a` for decoration only; blush canvas; `note`/`note-line` sticky-note yellow for piece 4). Fonts: Playfair Display (headings, `font-display`), Great Vibes (`font-script`), Geist (body). Headings get the display font in the base layer, so a heading's own font class still wins.
- **Shell:** `components/shell/admin-shell.tsx` (client): icon sidebar (lucide-react 1.51.0, pinned) with count badges (Orders: awaiting confirmation; KOT: kitchen alerts), "Coming soon" group (`/admin/soon/<slug>`), cake photo footer; top bar with order search (`/admin/orders?q=&when=all`), bell (awaiting confirmation + kitchen alerts + late pickups, opens the Dashboard until piece 5), user menu with Sign out; phone drawer. Menu and bell rules: `lib/shell.ts` (unit-tested); counts: `lib/shell-counts.ts`.
- **Other screens:** login split layout with the patisserie photo; kitchen tablet and PIN picker branded with a script footer (tickets keep their sizes and contrast); status colours follow the mock-up (pending pink, confirmed blue, preparing yellow, ready/completed green, cancelled red).
- Photos from the original prototype are in `web/public/brand/` (resized).
- **Review fixes (2026-10-04):** top-bar search sends `scope=all` and finds orders in both lists, any status and date (`searchEverywhere`); phone menu is a modal `<dialog>` (focus, Escape, inert background); brand deepened to `#b93f63` (5.3:1 on white, 4.95 on the page, 4.51 on pale pink); account menu and badges have screen-reader names; coming-soon pages ignore names like `constructor`; printed bill and credit-note headings stay in the plain font. **Deferred:** badges refresh only on a full page load or refresh; counter staff can open the admin-only "coming soon" pages by URL (placeholders only); the user menu does not close on Escape or outside clicks; login script colour relies on CSS order; 9 px tagline; status colours now show Ready and Completed both green and Pending in brand pink (as in the mock-up), confirm with the owner.

## 19. No KOT, Customers, customer orders, custom cakes, photos, collect / set up (owner, 2026-10-09)

Spec `docs/superpowers/specs/2026-10-09-no-kot-custom-cakes-design.md`; plan `docs/superpowers/plans/2026-10-09-no-kot-custom-cakes.md`. Branch `no-kot-custom-cakes`.

**Owner steps to ship (in this order):**
1. Apply `supabase/migrations/20261009000100_customer_source_fulfilment_type.sql`, then `…0200_no_kot_custom_cakes.sql`, then `…0300_photos.sql` to the live project (SQL editor, or MCP `apply_migration`; 0200 contains `drop function`/`drop view`/`drop column`, which the MCP connector asks to confirm). Apply 0100 on its own first: a new enum value cannot be used in the transaction that adds it.
2. Merge the branch into `main` and push; check that Vercel makes a Production deployment for the commit.
3. Click through: new customer order, new custom cake order with photo and advance, the Custom cakes tab, a set-up order (red everywhere), the cake sheet print, a product photo, Customers as counter staff.
4. Former chef accounts: give them a counter role or untick Active on Staff (the page lists them).

**What changed**
- **KOT removed.** `private.build_tickets` and `private.apply_ticket_changes` do nothing; confirming and adding items no longer need a kitchen. The migration cancels live tickets without stop-work and resolves open issues (`private.retire_kitchen_tickets`, logs "Kitchen tickets retired"). Chef PIN and tablet functions are revoked. Web: `/admin/kot`, `/kitchen/**`, `/print/kot` and the kitchen libraries are deleted; kitchen fields left Products, Categories and Staff ("Staff" now: admin and counter logins); chef accounts are refused at sign-in and treated as signed out. Ticket tables and history stay in the database, unused.
- **Customers** is in KOT's place in the sidebar for admin and counter staff; only admins block or unblock.
- **Customer source** (`order_source` `CUSTOMER`, 💬): orders a customer sends in (WhatsApp, message). Call-order rules (name, phone, pickup time; admin confirms). In the **Online / Call / Customer** list.
- **Collect / set up:** `orders.fulfilment` (`collect` | `setup`) with `setup_address` (required for set-up) and `setup_note`; replaces the unused `fulfillment_type` placeholder. On every order form (`components/fulfilment-fields.tsx`); `set_fulfilment` changes it until the order is closed. Green rows/badges for collect and red for set-up on Orders, every Calendar view (with a filter), Dashboard; the order page has a big banner with Change; the handover button reads "Set up done"; bills and cake sheets print COLLECT / SET UP at the address.
- **Custom cake orders:** `/admin/orders/new-cake` (button on Orders and the Dashboard). Source in-store / call / customer; flavour, weight, tiers, theme, cream, filling, toppings, message, eggless, instructions; reference photo; staff price (GST from Settings, default 5%); optional advance recorded as a payment. One order line "Custom cake — 1.5 kg · 2 tiers" (no product), details in `custom_cakes`. Orders → **Custom cakes** tab. Order page: yellow sticky-note card (edit details and price until packed, add/replace/remove photo) and **Print cake sheet** (`/print/cake/[order id]`, 80mm or A4).
- **Product photos:** product page → Photo (admins). Thumbnails (or a pink cake placeholder) in Products, the order entry and order lines.
- **Photos and Storage:** buckets `product-photos` (public) and `custom-cake-photos` (private, signed URLs), JPEG/PNG/WebP up to 5 MB. The browser uploads straight to Storage with the staff member's session (storage policies check the role), then a server action attaches the file (`set_product_image`, `set_custom_cake_photo`) and deletes the replaced one. This keeps photos out of server actions (Next caps them at 1 MB, Vercel at about 4.5 MB).

- **Later the same day (owner):** **Counter Sale removed** (menu item and `/admin/counter`; the `counter_sale` database function stays, unused) and the **New customer order** button removed from the Orders page (customer orders can still be started from the new-order page's "Switch to customer" link, and custom cakes still take the Customer source).
- **Shipped 2026-10-09:** migrations `20261009000100`–`0300` applied to the live project (function digests compared with the files: identical), branch merged into `main` and deployed.

**Not done / to watch**
- Browser click-through of the new screens: not possible before the migrations are on the live project (the app has no staging database).
- `supabase/seed/demo_data.sql` and `supabase/local/concurrency-kitchen.sh` still use kitchen tickets; re-running the demo seed fails at its ticket steps (the live demo data is already loaded).
- A photo uploaded but not attached (network drop between the two steps) stays in the bucket as an orphan.
- Thumbnails load the full photo (no image optimisation); upload reasonably sized photos.

## 20. Custom cake extras and cake details on the calendar (owner, 2026-10-13)

Migration `20261013000100_custom_cake_extras.sql`. **Shipped 2026-10-13:** applied to the live project, merged into `main`, deployed.

- **New cake details** (`custom_cakes`): `theme` (now its own field), `design`, `model`, `fondant` (text, e.g. "Full fondant"), `has_cupcakes`, `has_popsicles`. On the new custom cake form, the order page's cake card (view and edit) and the printed cake sheet ("Extras: Cupcakes, Popsicles").
- **Set-up and delivery charges** (`setup_charge_paise`, `delivery_charge_paise`, optional, in the form's price section). A charge above zero is its own order line ("Set-up charges" / "Delivery charges", variant "Custom cake") at the custom cake GST rate and HSN from Settings, so totals, bills and balances include it. `private.sync_cake_charges` adds, re-prices or deletes the lines; `custom_cakes.setup_charge_item_id` / `delivery_charge_item_id` point at them. The advance is checked against the whole total. Only an admin changes a confirmed cake's price or charges; counter staff can still change its details.
- `create_custom_cake_order` now creates the order unconfirmed, adds the details and charge lines, then confirms if asked.
- **Calendar:** day and agenda rows show "🎂 flavour · weight · Fondant · Theme" under the customer name, with the set-up address; week chips show the same and the address; month cells count custom cakes.
- Checks: `supabase/tests/custom_cakes_logic.sql` C15–C22; `web/src/lib/custom-cake.test.ts`.

**Not done / to watch**
- Not yet clicked through on the live site.
- Owner to confirm the charges' GST (same rate as custom cakes, default 5%); delivery services are often taxed differently.
- Cupcakes and popsicles are ticks only, with no count (counts go in Special instructions).

## 21. Public website connected to the order system (owner, 2026-10-16)

**Database shipped 2026-10-16:** `website_orders` applied to the live project (function digests compared with the file: identical; `website_catalogue()` returns the 16 demo products). The security advisor now also lists `anon_security_definer_function_executable` for these two functions: intentional, they are the website's only way in.

The owner sent the finished static site (`la-patisserie-frontend.zip`, a newer version of `la pater/` with logos) and asked to connect it. Migration `20261016000100_website_orders.sql`; checks `supabase/tests/website_logic.sql` (18/18 on PGlite); `web/src/lib/website.ts` (unit-tested).

- **Where it lives:** `web/public/site/` (the owner's HTML, CSS and JS, kept as plain files so later versions can be dropped in). `next.config.ts` rewrites `/` to `/site/index.html`; the old `/` → login redirect is gone. Staff use `/login` (linked in the footer).
- **Products:** `script.js` loads `/api/site/catalogue` → `public.website_catalogue()` (anon): available products in active categories with available sizes, lowest price, photo, veg/egg and eggless flags; nothing staff-only. Cards replace the showcase cards; if the call fails or the catalogue is empty the showcase cards stay. Products without a photo get one of the site's photos.
- **Orders:** the form (name, phone, optional email, optional product and size from the catalogue + quantity, date and time, collect or set up with address, order type, message) posts to `/api/site/order` → `public.submit_website_order` (anon). The order arrives in Orders as **Online 🌐, pending confirmation**; an admin confirms, edits items or rejects it as usual. Requests with no product arrive with a total of 0 for staff to price (Edit items) or reject and re-enter as a custom cake order. The type, email and message go into the customer notes.
- **Checks:** opening hours and closures, lead time and capacity are enforced (no overrides from the website); blocked phones are refused; an existing customer's name is never changed by a visitor. Spam: hidden honeypot field, at most 3 waiting orders per phone and 30 website orders an hour in total. Retries with the same key return the same order.
- **Time zone:** the website reads dates in Asia/Kolkata (visitors cannot read Settings).
- **Deployed 2026-10-18** (`main`), then **made fast** the same day: photos in `public/site/images` were resized and recompressed under the same names (owner's originals: 1024 px, ~800 KB each; now ≤1920 px hero / 1000 px others, ~100 KB). **If the owner sends new photos, shrink them the same way.** Below-the-fold images are `loading="lazy"`; the loading screen shows for 350 ms instead of waiting for every photo plus 1.2 s; sparkles only with a mouse. Cache headers in `next.config.ts` (images 1 day, CSS/JS 10 min, product list 5 min at the CDN). Slow-4G phone: usable 4.1 s → 1.9 s, fully loaded 25 s → 5.7 s.
- **Not done:** the newsletter box does nothing; the contact section's hours (10 AM–8 PM) are typed into the HTML and differ from Settings (9–9 default); no confirmation message or email to the customer (staff call them); no order status page for customers (`orders.access_token` is reserved for it).

## 22. Allergens removed; Notifications, Offers & Banners, Reviews (owner, 2026-10-18)

- **Allergens removed from every screen** (owner): the product form no longer asks for them and order lines no longer show them. `products.allergens` and the `order_items.allergens` snapshot stay in the database, unused (allergens already entered are kept but shown nowhere). Allergy questions from customers need a staff answer.
- **Nothing is "Coming soon" any more.** `/admin/soon/*` and `components/coming-soon.tsx` are gone; the three items are in the main menu.
- **Notifications** (`/admin/notifications`, admin and counter): orders waiting for confirmation (newest first, so website orders stand out), packed orders past pickup, and (admins) reviews waiting. The bell opens it and counts the same things (`lib/shell.ts → attentionCount`, `lib/shell-counts.ts`). No stored "read" state: items leave the list when they are dealt with.
- **Offers & Banners** (`/admin/offers`, admins): title, text, optional photo (public `product-photos` bucket under `offers/`), optional button (`#contact`, `#products`, `/…` or `https://…`; checked in `lib/offers.ts` and by a database constraint), show-from / until dates, on/off, order. The website's "Current offers" section (after the hero) shows the live ones and is hidden when there are none.
- **Reviews** (`/admin/reviews`, admins): customers send them from the website's "Share your experience" form (`/api/site/review` → `public.submit_review`, no login; honeypot; at most 20 an hour). They wait as **pending** until an admin approves (shown on the website, newest 12) or hides them; delete removes one. Staff can change only the status, never the words (column grant). Sidebar badge: reviews waiting.
- Migration `20261018000100_offers_reviews.sql` (**applied to the live project 2026-10-18**); checks `supabase/tests/offers_reviews_logic.sql` (13/13); `web/src/lib/offers.test.ts`. Website data: `/api/site/content` → `public.website_content()`, cached 5 min at the CDN (`max-age=0` so browsers always ask again).
- Clicked through on 2026-10-18 against the live database (review sent → Notifications → approved → on the website; offer added → on the website), then the test review and offer were deleted.

## 23. WhatsApp messages; staff logins on the live site (owner, 2026-10-19)

- **WhatsApp messages** (click-to-chat, no paid service): the order page has a **Message the customer** card when the order has a phone number. It offers the messages that fit the order's stage (`lib/whatsapp.ts → availableMessages`): Order received (pending), Order confirmed (items, pickup or set-up time and place, total, balance), Ready (pickup, or "we will be at <address>" for set-up), Balance reminder (when money is due), Thank you + review link (completed; links to the website's reviews section). Cancelled and rejected orders get none. Staff can edit the text, then **Open in WhatsApp** (wa.me: the app on phones, WhatsApp Web on computers) and press send there. Indian 10-digit numbers get +91.
- Opening a message is recorded on the timeline ("WhatsApp message opened", with the message) through `public.record_customer_message` (admin and counter; migration `20261019000100_customer_messages.sql`, **applied live 2026-10-19**; checks `customer_messages_logic.sql` 4/4). It records that the message was opened, not that it was sent (PROJECT_RULES 2.20).
- **`SUPABASE_SECRET_KEY` is now on Vercel production** (2026-10-19, marked sensitive), so admins can create staff logins and reset passwords on the live Staff page. It is still the key that was pasted in a chat: **rotate it before go-live** (Supabase → API Keys) and update both `web/.env.local` and Vercel.
- **Test counter login** `counter@auri.test` (role counter), password in `web/.admin-password.txt` (git-ignored). Remove it with the demo accounts before go-live.
- Owner (2026-10-19): FSSAI and GSTIN are not needed for now.

## 24. Chef screen is back, with no amounts (owner, 2026-10-20)

Migration `20261020000100_chef_screen.sql` (**applied live 2026-10-20**); checks `supabase/tests/chef_screen_logic.sql` 17/17 and `rls_foundation.sql` updated; `web/src/lib/kitchen.ts` (unit-tested).

- **Chefs sign in again** at `/login` and land on **`/kitchen`**. Tabs: Today / Tomorrow / Next 2 weeks; a kitchen switch for chefs in more than one kitchen; "Total to make" per product and size; one card per order with pickup time, order number, Collect (green) / Set up (red), status (To make / Preparing / Packed ✓ / Cancelled — stop), items with photo, quantity, size, veg/eggless and item notes; custom cakes as a yellow note with every cake detail and the reference photo. Refreshes every minute.
- **No amounts or customer details reach chefs.** They read only through `public.chef_work(from, to)`, which returns no prices, totals, payments, customer names, phones, addresses or order notes. `private.is_staff()` now means admin or counter, so every "Staff read …" policy (products, prices, settings, offers, reviews, hours…) excludes chefs. Chefs can read kitchen names and only the cake photos of cakes on their own screen. Every `/admin` and `/print` page sends a chef back to `/kitchen`.
- **Which chef sees what:** each order line keeps the kitchen of its product size. A chef sees the kitchens ticked for them on **Staff**, plus lines with **no kitchen set** (so nothing is missed; they are labelled). Pending orders never show; packed and cancelled ones stay visible, greyed.
- **Setting kitchens:** Products → product → **Kitchen** (one choice for all its sizes; new sizes copy it; the list shows a Kitchen column and warns about made-to-order products without one). New custom cake form → **Made in** (default the first kitchen). Order page → a **Kitchen** picker on every made-to-order line until the order is packed or closed (`public.set_item_kitchen`, admin and counter, logged "Kitchen changed"). Staff page: Chef role with kitchen ticks, and kitchen renaming.
- Admin and counter staff have **Chef screen** in the sidebar to see what chefs see (all kitchens).
- Three test orders B-1025–B-1027 (internal note `DEMO DATA`) were added to try the screen; `remove_demo_data.sql` deletes them.

## 25. Website gallery managed by admins (owner, 2026-10-20)

Migrations `20261020000200_gallery.sql` and `20261020000300_product_photo_cleanup.sql` (**both applied live 2026-10-20**); checks `supabase/tests/gallery_logic.sql` 6/6; `web/src/lib/gallery.ts` (unit-tested).

- **Admin → Gallery** (`/admin/gallery`, admins only): **Add photos** (up to 20 at once; JPEG/PNG/WebP up to 5 MB; uploaded straight to the public `product-photos` bucket under `gallery/`), then per photo a caption, an order number (lower first) and **Show**; Delete removes the row and the file.
- **Website:** `website_content()` now returns `gallery` (shown photos, up to 60). The Gallery section ("Sweet Moments") replaces its six built-in photos with these as soon as at least one is shown; the tile pattern repeats every six with `grid-auto-flow: dense`; captions show on hover and in the lightbox (now a delegated click handler). Like offers, changes reach the website within 5 minutes (CDN cache on `/api/site/content`).
- **Fixed:** removing a file from `product-photos` silently did nothing, because Storage needs the admin to be able to select the object first. The new "Admins read product photos" policy fixes deleted gallery photos and replaced offer photos (older replaced offer photos may still be in `offers/` as orphans).
- Clicked through on the live database (two photos added, shown on the website, lightbox opened, then deleted with their files).

## 26. Chef screen for phones and PCs; one login per kitchen (owner, 2026-10-20)

- **Layout:** sticky compact header (phones: brand and Sign out on one row, name and "Updated" time below); day tabs and kitchen tabs scroll sideways instead of wrapping; order cards in 1 column on phones, 2 from tablet width (md) and 3 on wide screens (2xl), content capped at 1600 px; custom cake photo full width on phones. Checked at 390, 820, 1440 and 1920 px: no sideways scrolling.
- **Kitchen logins** (chef role, created 2026-10-20 with the Supabase admin API): `kitchen1@auri.test` (Kitchen 1 only) and `kitchen2@auri.test` (Kitchen 2 only); passwords in `web/.admin-password.txt` (git-ignored). Checked: each sees only its own kitchen's items (plus items with no kitchen set). The demo chef `chef@auri.test` still has both kitchens. Before go-live, replace these test logins with real ones (Staff → Add staff member → Chef, tick one kitchen).

## 27. Website menu status; chef calendar; chefs see everything except money (owner, 2026-10-20/21)

- **Products on the website:** the menu (`website_catalogue()`) lists a product only when it is not archived, is available, its category is shown, and it has at least one available size with a price. Admin → Products now has a **Website** column ("On website" / "Not shown") and each product page says why it is not shown (`websiteMenuStatus` in `lib/website.ts`). `/api/site/catalogue` is cached for 60 s at the CDN (was 300 s).
- **Chef calendar:** `/kitchen?tab=calendar&m=YYYY-MM` shows a month grid (Mon–Sun, 42 days) with each day's open orders, custom cakes and set-ups for the chef's kitchen(s); tapping a day opens `/kitchen?tab=day&d=YYYY-MM-DD` with that day's order cards and a "← Calendar" link.
- **Order details for chefs** (migration `20261020000400_chef_order_details.sql`): `chef_work` also returns the customer's name and phone (tap to call), the customer's notes, the set-up address and note, and how the order came in. Still left out: prices, totals, discounts, charges, payments, and staff notes (`internal_notes`, which often record payments). Checked by `chef_screen_logic.sql` H4/H4b.

## 28. Up to 5 reference photos per custom cake (owner, 2026-10-21)

- Migration `20261021000100_cake_photos_five.sql`: `custom_cakes.photo_path` → `photo_paths text[]` (0–5, in the order added; old single photos copied over), `set_custom_cake_photo` → `set_custom_cake_photos(order, paths[])` (sets the whole list; refuses more than 5, duplicates, and paths outside the order's folder). `chef_work` returns `cake.photo_paths`; the chefs' storage policy checks the list.
- New custom cake form: pick several photos at once (up to 5), previews with Remove. Order page cake card: photo grid, Remove on each, "Add photos (n of 5)" until full; removed files are deleted from Storage (`setCustomCakePhotosAction`). Print cake sheet prints all photos (2 per row on A4/A5, stacked on 80 mm). Chef screen: one photo as before, several in a row that scrolls sideways.
- Checked by `photos_logic.sql` S4–S5 and `chef_screen_logic.sql` H5/H6.

## 29. Demo data removed from the live site (owner, 2026-10-21)

- Ran `supabase/seed/remove_demo_data.sql` on the live project: the 18 demo orders (B-1001–B-1015, B-1025–B-1027) with their items, payments, bills and timeline, their customers, the 15 demo products and the now-empty demo categories (Cakes, Breads, Cookies). Bill and credit-note numbering restarts at 00001.
- Kept on the owner's instruction: test orders B-1016–B-1021 and B-1028 (not marked as demo), so order numbers continue from B-1029. Kept: the owner's products (Faluda ×2), categories Pastries, Savouries and "cake tub", kitchens, gallery, and all staff logins (`*@auri.test` are still the only logins; create real ones on Staff, then remove these).
- The "Demo logins" fill buttons on /login are removed from the code (they let anyone sign in as admin). The `DEMO_*` variables on Vercel no longer do anything and can be deleted in the dashboard.

## 30. Logins and "Forgot password?" (owner, 2026-10-21)

- Demo logins `demo@auri.test` and `chef@auri.test` deleted. New admin `admin@auri.test`. Logins now: admin, counter, kitchen1, kitchen2 (all `@auri.test`); passwords in `web/.admin-password.txt` (git-ignored). Deleting demo@ needed `payments_immutable` lifted briefly to clear `recorded_by` on the kept test orders' payments.
- "Forgot password?" on /login → `/forgot-password` (emails a Supabase reset link; same reply whether or not the email exists) → link → `/auth/callback` (handles `?code=` and `?token_hash=&type=recovery`) → `/reset-password` (new password twice, min 10) → the person's home screen. A link that lands on another page (Supabase's Site URL fallback) is forwarded by `proxy.ts` (`strayResetLink`). Tested end to end with a generated recovery link; a used link is refused.
- **Email delivery:** reset emails go only to real inboxes. `@auri.test` addresses cannot receive mail, and Supabase's built-in mailer only sends to the project's team members (a few per hour). For staff: give them real emails and set up custom SMTP in Supabase (Auth → SMTP Settings). In Supabase Auth → URL Configuration, set Site URL to the live site and add `https://bakery-admin-ten.vercel.app/auth/callback` to Redirect URLs. Until then, an admin resets passwords on the Staff page.
