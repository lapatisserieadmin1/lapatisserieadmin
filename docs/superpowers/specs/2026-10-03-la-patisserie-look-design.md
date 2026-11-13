# Piece 1 — La Patisserie look and app shell

Date: 2026-10-03. Status: design approved in conversation (owner); spec for review.
Source: the owner's mock-up (pink "La Patisserie" orders screen, WhatsApp image of 22 Sep 2026).
Part of a sequence agreed with the owner: 1 look and shell → 2 Orders page like the mock-up → 3 product photos → 4 custom cake details → 5 notifications → 6 delivery; Offers & Banners and Reviews stay "coming soon" until the public website.

## 1. Goal

Every staff screen (login, admin, kitchen tablet, and the print pages' on-screen chrome) takes the mock-up's look and brand, without changing what any screen does.

## 2. Decisions (owner, 2026-10-03)

| Topic | Decision |
|---|---|
| Brand | **La Patisserie**, chef-hat logo, tagline "More than cakes, sweeter moments". Settings → business name set to "La Patisserie" (new bills carry it; issued bills never change). |
| Decoration | **Everywhere**, including the kitchen tablet; kitchen tickets keep large, high-contrast text. |
| Screens not built yet | **Shown as "Coming soon"** in the menu: Custom Cake Requests, Notifications, Offers & Banners, Reviews. |
| Approach | Change the shared theme tokens and the shell; restyle components; no page rewrites (piece 2 redoes Orders). |

## 3. Visual system

- **Colours** (Tailwind theme tokens in `globals.css`; existing token names kept so every screen follows):
  - brand (rose) `#d9577a`, brand-strong `#b83d61`, brand-soft `#fde7ee`;
  - canvas (blush) `#fdf5f6`, surface `#ffffff`, line `#f1dde3`;
  - ink `#3a2a30`, muted `#7d6870`;
  - danger, warn, ok and their soft tints kept (re-tuned to sit with pink); veg/non-veg marks unchanged;
  - new: `note` `#fff6c4` and `note-line` `#eedf93` (sticky-note yellow, used by piece 4), `script` `#c0466b`.
- **Fonts** (`next/font/google`): Playfair Display for headings and the wordmark (`--font-display`), Geist kept for body text, Great Vibes for script accents (`--font-script`).
- **Shape:** cards with 16 px radius and a soft pink shadow; pill-shaped status badges; primary buttons rose with white text, secondary white with a pink border.
- **Images:** the prototype's photos (`la pater/images/*.jpg`) copied to `web/public/brand/`, resized for web (sidebar cake, login hero).
- **Icons:** `lucide-react` (tree-shaken).

## 4. Shell (admin)

- **Sidebar** (desktop fixed, 240 px; phones: hidden behind a menu button in the top bar):
  - logo (chef hat + "La Patisserie" + tagline);
  - items with icons, active item filled rose: Dashboard, Orders (badge: orders awaiting confirmation), Counter Sale, Calendar, KOT (badge: kitchen alerts = unacknowledged changes + stop-work + open issues), Products, Customers, Analytics (the sales report, admins), Staff & Kitchens (admins), Shop Settings (admins);
  - "Coming soon" group: Custom Cake Requests, Notifications, Offers & Banners, Reviews → `/admin/soon/<slug>` placeholder pages;
  - footer: cake photo with "Baked with Love, Always ♥" in script.
  - Role rules as today (counter staff do not see admin-only items).
- **Top bar:** search field (submits to `/admin/orders?q=…&when=all`), bell with the number of things needing attention (awaiting confirmation + kitchen alerts + late pickups) linking to `/admin` (until piece 5), avatar with the staff member's initial, name and role, and a menu with Sign out.
- **Decoration:** "Good Cakes, Better Days ♥" script in the top-right corner (hidden on small screens); footer "Cakes don't just fill stomachs, they fill hearts. ♥ / La Patisserie" under every admin page.
- Badge counts come from one cached server helper (`getShellCounts`) so each page load makes three small count queries.

## 5. Other screens

- **Login:** split layout — cake photo and script line on one side, the sign-in card (with the demo buttons) on the other; stacks on phones.
- **Kitchen tablet** (`/kitchen`, `/kitchen/pin`): brand header (logo, kitchen name), blush background, script footer line; ticket cards keep their current sizes and high-contrast text; the "Changed" banner keeps its warning colours.
- **Print pages:** unchanged on paper (black and white); the on-screen Print button takes the new style.
- **All admin pages:** headings in Playfair Display; `Card`, `Button`, `Badge`, inputs and tables restyled through `components/ui.tsx`; pages that hard-code colours or spacing are adjusted where they clash.

## 6. Out of scope (later pieces)

Orders list/detail layout (2), photo upload (3), cake details (4), real notifications (5), delivery (6), Offers & Banners and Reviews (public website).

## 7. Testing

- `npm test`, typecheck, lint, production build.
- Unit test for the shell counts helper's arithmetic (pure function) and the nav item list per role.
- Screenshots of Login, Dashboard, Orders, an order page, KOT, Reports and the kitchen tablet at desktop and phone widths from a local browser, compared with the mock-up; contrast of text on pink checked (WCAG AA for body text).
