# Phase 5D — Chef PIN sign-in on kitchen tablets

Date: 2026-10-03. Status: written for owner review.
PRD references: "Kitchen tablet sign-in" (section 5F), data model "Trusted Device / Staff PIN", AC-34.

## 1. Goal and decisions

A kitchen tablet is registered once by an admin for one kitchen. On it, a chef taps their name and types a PIN instead of an email and password. Every kitchen action stays attributed to the chef who signed in.

| Decision | Choice |
|---|---|
| Who sets PINs | **Owner, 2026-10-03: the admin**, in Staff & Kitchens; 4–6 digits; the admin tells the chef. Reset replaces it. |
| Auto-lock | **Owner, 2026-10-03: none.** A tablet stays signed in until someone taps **Switch chef** or **Sign out**. |
| Lock-out after wrong PINs | **Owner, 2026-10-03: none.** Accepted risk: a PIN works only on a registered tablet (a server-checked device token), so guessing needs the physical tablet in the kitchen. Wrong attempts are counted on the device row so an admin can see them. |
| Where PINs work | Only on a registered tablet, only for chefs assigned to that tablet's kitchen and active. Everywhere else, email and password as today. |
| Revocation | Revoking a tablet or resetting a chef's PIN signs that tablet session out at its next page load or 10-second refresh (AC-34 "immediately"). |
| Admins and counter staff | Not affected; they keep email and password. |
| Needs | `SUPABASE_SECRET_KEY` on the server (local: in `.env.local`; production: a Vercel environment variable the owner adds). Without it the PIN screen explains that and nothing else changes. |

## 2. Data

### `kitchen_devices`

| Column | Notes |
|---|---|
| `id uuid pk` | |
| `kitchen_id uuid → kitchens` | One kitchen per tablet. |
| `label text` | e.g. "Kitchen 1 tablet", 1–60 characters. |
| `token_hash text unique` | SHA-256 of the random device token kept in the tablet's cookie. The token itself is never stored. |
| `registered_by`, `registered_at` | |
| `revoked_at`, `revoked_by` | Revoked tablets stop working at once. |
| `last_used_at` | Last successful PIN sign-in. |
| `failed_pins integer default 0` | Wrong PINs since the last success (shown to admins; no lock-out). |

RLS: admins read; no direct writes (functions only). Audit trigger.

### `staff_pins` (separate table; amended during planning)

`user_id pk → staff_profiles`, `pin_hash text` (bcrypt via `extensions.crypt(…, extensions.gen_salt('bf'))`), `set_at`, `set_by`. RLS on with no policies and all privileges revoked from `anon`/`authenticated`: only the functions below touch it. It is kept out of `staff_profiles` because that table's audit trigger copies whole rows into `audit_events`, and a 4-digit PIN's hash could be cracked from there. PIN changes are written to `audit_events` by hand, without the hash (`PIN_SET` / `PIN_CLEARED`).

## 3. Functions

- `public.set_staff_pin(p_user_id, p_pin)` — admin only; chefs only; 4–6 digits; stores the hash and `pin_set_at = now()`; `null` clears it. Timeline/audit through the audit trigger (hash never logged: the audit trigger skips `pin_hash`).
- `public.register_kitchen_device(p_kitchen_id, p_label, p_token_hash)` — admin only; returns the device id.
- `public.revoke_kitchen_device(p_device_id)` — admin only.
- `public.verify_kitchen_pin(p_token_hash, p_user_id, p_pin)` — **service role only** (not `authenticated`). Returns the device id and kitchen when the device is registered and not revoked, the chef is active, assigned to that kitchen and has a PIN, and the PIN matches; otherwise refuses with one generic message ("PIN not accepted.") and increments `failed_pins`. On success resets `failed_pins`, sets `last_used_at`.
- `public.kitchen_device_chefs(p_token_hash)` — service role only: the chef names (id, full name, has PIN) for the tablet's chef picker.

## 4. Sign-in flow (web)

1. **Register** (admin, on the tablet): sign in normally, open Staff & Kitchens → Kitchen tablets → **Register this tablet for Kitchen N**. The server creates a 32-byte random token, stores its hash, and sets an httpOnly, secure, `SameSite=Lax`, 400-day cookie `kitchen_device`. The admin then signs out; the tablet shows the chef picker.
2. **Chef picker** `/kitchen/pin`: shown when the `kitchen_device` cookie is present and valid. Large name buttons for the kitchen's chefs; tapping one asks for the PIN on a big numeric keypad.
3. **PIN check** (server action): `verify_kitchen_pin` with the service-role client. On success the server creates a normal Supabase session for that chef without a password — `auth.admin.generateLink({ type: 'magiclink', email })` then `auth.verifyOtp({ type: 'magiclink', token_hash })` on the cookie-bound server client — and sets a signed cookie `kitchen_pin` = `{ device_id, user_id, signed_in_at }` (HMAC with the secret key). Redirect to `/kitchen`.
4. **Staying valid**: `/kitchen` and `/kitchen/stamp` check, when `kitchen_pin` is present, that the device is not revoked and the chef's `pin_set_at` is not after `signed_in_at`. If either fails: sign out, clear `kitchen_pin`, and go to `/kitchen/pin` (the stamp route answers 401, which the screen already treats as signed out).
5. **Switch chef / Sign out** on a registered tablet: sign out and return to `/kitchen/pin`, not `/login`.
6. `/login` on a registered tablet goes straight to `/kitchen/pin`; `/login?email=1` (linked from the PIN screen as "Sign in with email") still offers email and password, for an admin who needs to manage the tablet.

## 5. Screens

- Staff & Kitchens: per chef **Set PIN** / **Reset PIN** (shows "PIN set" with date, never the PIN); **Kitchen tablets** list (label, kitchen, registered, last used, wrong PINs, **Revoke**) and **Register this tablet**.
- `/kitchen/pin`: kitchen name, chef buttons, keypad, clear error text, "Not your tablet? Sign in with email" link.
- Kitchen header: **Switch chef** next to Sign out when signed in by PIN.

## 6. Testing

- `supabase/tests/pin_logic.sql` (PGlite): set/reset/clear PIN rules and roles; register/revoke rules; `verify_kitchen_pin` accepts only registered, unrevoked, same-kitchen, active chefs with the right PIN; wrong PIN increments `failed_pins` and success resets it; `authenticated` cannot execute the service-role functions or read `pin_hash`.
- Unit tests for the signed `kitchen_pin` cookie (sign, verify, tamper, PIN reset after sign-in).
- Typecheck, lint, build. Browser walk at the end with the other walkthroughs.

## 7. Out of scope

Lock-out and auto-lock (owner: none). Chef-chosen PINs. More than one kitchen per tablet.
