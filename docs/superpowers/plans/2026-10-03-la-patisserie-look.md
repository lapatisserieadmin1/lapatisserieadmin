# La Patisserie Look and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle every staff screen to the owner's pink "La Patisserie" mock-up and replace the admin shell with an icon sidebar, a top bar (search, bell, avatar) and decoration, without changing behaviour.

**Architecture:** Theme tokens in `globals.css` drive every screen; a new shell (`components/shell/*`) wraps `/admin`; shared UI components get the new shape; the login and kitchen screens get brand chrome. Counts for badges come from one cached server helper whose arithmetic is a pure, tested function.

**Tech Stack:** Next.js 16, Tailwind v4 theme tokens, `next/font/google` (Playfair Display, Great Vibes), `lucide-react`, `next/image`.

**Spec:** `docs/superpowers/specs/2026-10-03-la-patisserie-look-design.md`

## Global Constraints

- No behaviour changes: same routes, same server actions, same role rules.
- Kitchen tickets keep their sizes and contrast; prints stay black and white on paper.
- Body text contrast ≥ 4.5:1 on its background.
- Phones: sidebar behind a menu button; no horizontal scroll at 375 px.

## Review Focus

1. Counter staff must not see admin-only menu items (Analytics, Staff & Kitchens, Shop Settings) — covered by the nav-items unit test.
2. The top-bar search must keep the orders page's sanitising (it already strips symbols) — it only builds a URL.
3. The badge queries must not run for chefs or break when counts are zero.
4. Long names and the sticky corner script must not cover content on narrow screens.
5. The kitchen tablet remains readable at arm's length.

---

### Task 1: Theme, fonts, images, icons

**Files:** `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/package.json`, `web/public/brand/*`.

- [ ] Add `lucide-react`. Copy and resize `la pater/images/{chocolate,hero,redvelvet}.jpg` to `web/public/brand/` (≤ 1200 px wide, quality 80).
- [ ] Load Playfair Display (`--font-display`) and Great Vibes (`--font-script`) with `next/font/google`; keep Geist.
- [ ] Replace colour tokens per spec §3; add `note`, `note-line`, `script`; base styles: `h1,h2,h3` use the display font; body background canvas.
- [ ] Typecheck, build; commit.

### Task 2: Shared UI components

**Files:** `web/src/components/ui.tsx`, `web/src/components/form-status.tsx`.

- [ ] Card: 16 px radius, soft pink shadow. Buttons: rose primary, white/pink-border secondary, ghost, danger. Badges: pill shape with the new tints. Inputs: rounded, pink focus ring. PageHeader: display-font title. Add `Brand` (logo) and `ScriptText` components.
- [ ] Typecheck, lint, build; commit.

### Task 3: Admin shell

**Files:** create `web/src/components/shell/{sidebar.tsx,topbar.tsx,nav-items.ts,shell-counts.ts,user-menu.tsx}`, `web/src/lib/shell.ts` (+ test), `web/src/app/admin/soon/[slug]/page.tsx`; modify `web/src/app/admin/layout.tsx`; remove `web/src/app/admin/nav.tsx`.

**Produces:** `navItems(role): NavSection[]` (pure), `attentionCount({pending, kitchenAlerts, latePickups})` (pure), `getShellCounts(role)` (server, cached per request).

- [ ] Unit tests: nav items per role (counter staff never get admin-only items; coming-soon items present for both); attention count sums and ignores negatives.
- [ ] Implement; sidebar with icons, active state, badges, coming-soon group, cake footer; top bar with search form (GET `/admin/orders`, `q`, `when=all`), bell (count, link `/admin`), user menu (Sign out); mobile menu button toggling the sidebar; corner script and footer quote.
- [ ] Coming-soon page per slug (title, one-line description, back link).
- [ ] Tests, typecheck, lint, build; commit.

### Task 4: Login, kitchen, print chrome

**Files:** `web/src/app/login/page.tsx`, `web/src/app/login/login-form.tsx`, `web/src/app/kitchen/page.tsx`, `web/src/app/kitchen/pin/page.tsx`, `web/src/app/print/print-button.tsx`.

- [ ] Login split layout with photo and script; kitchen and PIN pages: brand header and script footer, tickets unchanged in size; print button style.
- [ ] Typecheck, lint, build; commit.

### Task 5: Page pass, settings, screenshots, deploy

- [ ] Walk every admin page for hard-coded colours or spacing that clash; fix.
- [ ] Set `business_settings.business_name` to "La Patisserie" on the live project (owner decision).
- [ ] Local screenshots (desktop and 375 px) of Login, Dashboard, Orders, an order, KOT, Reports, kitchen tablet; check contrast.
- [ ] HANDOVER/TODO update; commit; push (deploys); confirm the deployment.
