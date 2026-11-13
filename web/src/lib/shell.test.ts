import { test } from "node:test";
import assert from "node:assert/strict";
import { attentionCount, navSections } from "./shell.ts";

const hrefs = (role: "admin" | "counter") => navSections(role).flatMap((s) => s.items.map((i) => i.href));

test("admins see every screen, including Notifications, Reviews and Reports", () => {
  const h = hrefs("admin");
  for (const href of ["/admin", "/admin/orders", "/admin/calendar", "/admin/customers", "/admin/products",
    "/admin/notifications", "/admin/gallery", "/admin/reviews", "/admin/reports", "/admin/sales-report", "/admin/staff", "/admin/settings"]) assert.ok(h.includes(href), href);
  assert.ok(!h.includes("/admin/todo"));
  assert.ok(!h.includes("/admin/offers"));
});

test("KOT and Counter Sale are gone and custom cakes are no longer coming soon", () => {
  for (const role of ["admin", "counter"] as const) {
    const h = hrefs(role);
    assert.ok(!h.includes("/admin/kot"));
    assert.ok(!h.includes("/admin/counter"));
  }
});

test("Customers takes KOT's place, right after Calendar, for counter staff too", () => {
  for (const role of ["admin", "counter"] as const) {
    const h = hrefs(role);
    assert.equal(h[h.indexOf("/admin/calendar") + 1], "/admin/customers", role);
  }
});

test("counter staff never see admin-only screens", () => {
  const h = hrefs("counter");
  for (const href of ["/admin/reports", "/admin/sales-report", "/admin/staff", "/admin/settings", "/admin/gallery", "/admin/reviews"]) assert.ok(!h.includes(href), href);
  for (const href of ["/admin", "/admin/orders", "/admin/calendar", "/admin/customers", "/admin/products", "/admin/notifications"]) assert.ok(h.includes(href), href);
  assert.ok(!h.includes("/admin/todo"));
});

test("admins and counter staff can open the chef screen", () => {
  for (const role of ["admin", "counter"] as const) assert.ok(hrefs(role).includes("/kitchen"), role);
});

test("the staff screen is called Staff", () => {
  assert.equal(navSections("admin").flatMap((s) => s.items).find((i) => i.href === "/admin/staff")?.label, "Staff");
});

test("nothing is left as coming soon", () => {
  for (const role of ["admin", "counter"] as const) {
    assert.ok(navSections(role).every((s) => s.title !== "Coming soon"));
    assert.ok(hrefs(role).every((h) => !h.startsWith("/admin/soon/")));
  }
});

test("the bell counts orders awaiting confirmation, late pickups and reviews, ignoring missing or negative values", () => {
  assert.equal(attentionCount({ pending: 2, latePickups: 1 }), 3);
  assert.equal(attentionCount({ pending: 2, latePickups: 1, reviews: 4 }), 7);
  assert.equal(attentionCount({ pending: null, latePickups: -1 }), 0);
});
