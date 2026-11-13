# Chef PIN Sign-in (5D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chefs sign in on a registered kitchen tablet by tapping their name and typing an admin-set PIN; revoking the tablet or resetting the PIN ends that session at the next load or 10-second refresh.

**Architecture:** Two tables (`kitchen_devices`, `staff_pins`) written only by functions. Admin functions run as the signed-in admin; the PIN check, chef list and session check run with the service-role key (server only). A successful PIN check creates a normal Supabase session for the chef (admin `generateLink` + `verifyOtp` on the cookie-bound client) and an HMAC-signed `kitchen_pin` cookie that `/kitchen` and `/kitchen/stamp` re-check.

**Tech Stack:** Postgres + pgcrypto (`extensions.crypt`), Supabase Auth admin API, Next.js 16 server actions and route handlers, Node `crypto`.

**Spec:** `docs/superpowers/specs/2026-10-03-chef-pin-signin-design.md` (amended: separate `staff_pins` table; `/login` forwards to `/kitchen/pin` on a registered tablet).

## Global Constraints

- PIN: 4–6 digits, set by an admin, chefs only (owner). No auto-lock, no lock-out (owner); wrong PINs are counted per tablet.
- PINs work only with a valid `kitchen_device` cookie whose SHA-256 hash matches an unrevoked `kitchen_devices.token_hash`, for active chefs assigned to that tablet's kitchen.
- The PIN hash never leaves the database, is never in `audit_events`, and no staff role can select it.
- Service-role-only functions: execute revoked from `public, anon, authenticated`, granted to `service_role`.
- Cookies: `kitchen_device` (32 random bytes, base64url; httpOnly, secure in production, SameSite=Lax, 400 days, path `/`); `kitchen_pin` (`base64url(json).hmac`, same flags, session length).
- Without `SUPABASE_SECRET_KEY` the PIN screen says PIN sign-in is not set up; nothing else changes.
- SQL checks on PGlite; live apply via MCP after all suites pass; compare function hashes with `supabase/local/pglite/fn-hash.mjs`.

## Review Focus

1. A revoked tablet or a PIN reset must end an already-open chef session (page load and the 10-second stamp poll), not only block new sign-ins.
2. A chef assigned to Kitchen 2 must not sign in on a Kitchen 1 tablet, and an inactive chef on none.
3. A forged or edited `kitchen_pin` cookie must be rejected (HMAC), and `/kitchen/pin` must be reachable while signed out (proxy exception) without opening any other `/kitchen` route.
4. Wrong PINs must be counted even though the attempt fails (no exception rollback).
5. `/login?email=1` must still allow an admin to sign in on a registered tablet.

---

### Task 1: Database

**Files:** `supabase/tests/pin_logic.sql`, `supabase/migrations/20261003000700_chef_pin_signin.sql`.

**Produces (SQL):**
- tables `kitchen_devices(id, kitchen_id, label, token_hash unique, registered_by, registered_at, revoked_at, revoked_by, last_used_at, failed_pins)`, `staff_pins(user_id pk, pin_hash, set_at, set_by)`.
- `public.set_staff_pin(p_user_id uuid, p_pin text) returns void` (admin; null clears).
- `public.register_kitchen_device(p_kitchen_id uuid, p_label text, p_token_hash text) returns uuid` (admin).
- `public.revoke_kitchen_device(p_device_id uuid) returns void` (admin).
- `public.verify_kitchen_pin(p_token_hash text, p_user_id uuid, p_pin text) returns jsonb` → `{"ok": true, "device_id", "kitchen_id"}` or `{"ok": false}` (service role).
- `public.kitchen_device_chefs(p_token_hash text) returns jsonb` → `{"device_id", "kitchen": {"id","name"}, "chefs": [{"user_id","full_name","has_pin"}]}` or `null` (service role).
- `public.kitchen_pin_session_valid(p_token_hash text, p_user_id uuid, p_signed_in_at timestamptz) returns boolean` (service role).

- [ ] Step 1: checks — set/clear PIN (admin only; 4–6 digits; chefs only), register (admin only; label 1–60; 64-hex hash), verify (right PIN ok with device and kitchen; wrong PIN `{ok:false}` and `failed_pins` 1, then success resets to 0 and sets `last_used_at`; other kitchen's chef, inactive chef, unknown or revoked tablet, cleared PIN → `{ok:false}`), chef list (active chefs of the tablet's kitchen with `has_pin`; `null` for a revoked tablet), session validity (true; false after PIN reset or revoke), authenticated cannot execute the service functions or read `staff_pins`, audit rows for PINs carry no hash.
- [ ] Step 2: run on PGlite — fails.
- [ ] Step 3: migration.
- [ ] Step 4: all suites pass; commit.

### Task 2: Web

**Files:** create `web/src/lib/pin-cookie.ts` (+ test), `web/src/lib/kitchen-device.ts` (server-only helpers), `web/src/app/kitchen/pin/page.tsx`, `web/src/app/kitchen/pin/pin-pad.tsx`, `web/src/app/kitchen/pin/actions.ts`, `web/src/app/kitchen/pin/end/route.ts`; modify `src/proxy.ts`, `src/app/login/page.tsx`, `src/app/login/actions.ts` (signOut), `src/app/kitchen/page.tsx`, `src/app/kitchen/stamp/route.ts`, `src/app/admin/staff/page.tsx`, `staff-forms.tsx`, `actions.ts`, `src/lib/database.types.ts`.

**Produces (TS):** `signPinSession(payload, secret)`, `readPinSession(value, secret) → { deviceId, userId, signedInAt } | null`; `hashDeviceToken(token)`; `getDeviceToken()`, `pinSessionStatus() → "none" | "ok" | "invalid"`.

- [ ] Step 1: unit tests for `pin-cookie.ts` (round trip, tampered payload, tampered signature, wrong secret, malformed) — fail, implement, pass.
- [ ] Step 2: server helpers and actions (register/revoke/set PIN for admins; PIN sign-in for the tablet; sign-out back to the picker on a registered tablet).
- [ ] Step 3: screens (PIN picker + keypad; Staff & Kitchens: PIN per chef, Kitchen tablets list, Register this tablet; kitchen header Switch chef).
- [ ] Step 4: session re-checks in `/kitchen` (redirect to `/kitchen/pin/end`) and `/kitchen/stamp` (401).
- [ ] Step 5: typecheck, lint, tests, build; local smoke test of the PIN sign-in with the demo chef against the live auth (registers a tablet named "Local test", then revokes it); commit.

### Task 3: Ship

- [ ] Apply the migration live; compare hashes; advisors.
- [ ] HANDOVER section 16, tests table, 5D row; TODO; commit; push.
- [ ] Owner adds `SUPABASE_SECRET_KEY` to Vercel production (command given to them), then redeploy.
