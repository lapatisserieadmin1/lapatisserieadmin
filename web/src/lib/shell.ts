// Admin shell: the sidebar's menu per role and the bell's count. Pure: imported by unit tests, so
// keep any imports from "@/" type-only.
import type { Enums } from "@/lib/database.types";

type Role = Exclude<Enums<"staff_role">, "chef">;

export type NavIcon =
  | "dashboard" | "orders" | "calendar" | "products" | "customers" | "analytics"
  | "staff" | "settings" | "bell" | "reviews" | "kitchen" | "gallery" | "reports";

export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  roles: Role[];
  badge?: "pending" | "attention" | "reviews"; // filled from the shell counts
};

export type NavSection = { title: string | null; items: NavItem[] };

const BOTH: Role[] = ["admin", "counter"];
const ADMIN: Role[] = ["admin"];

const SECTIONS: NavSection[] = [
  {
    title: null,
    items: [
      { href: "/admin", label: "Dashboard", icon: "dashboard", roles: BOTH },
      { href: "/admin/orders", label: "Orders", icon: "orders", roles: BOTH, badge: "pending" },
      { href: "/admin/calendar", label: "Calendar", icon: "calendar", roles: BOTH },
      { href: "/admin/customers", label: "Customers", icon: "customers", roles: BOTH },
      { href: "/admin/products", label: "Products", icon: "products", roles: BOTH },
      // What the chefs see (2026-10-20); chefs themselves land there and have no sidebar.
      { href: "/kitchen", label: "Chef screen", icon: "kitchen", roles: BOTH },
      { href: "/admin/notifications", label: "Notifications", icon: "bell", roles: BOTH, badge: "attention" },
      { href: "/admin/gallery", label: "Gallery", icon: "gallery", roles: ADMIN },
      { href: "/admin/reviews", label: "Reviews", icon: "reviews", roles: ADMIN, badge: "reviews" },
      { href: "/admin/reports", label: "Analytics", icon: "analytics", roles: ADMIN },
      { href: "/admin/sales-report", label: "Reports", icon: "reports", roles: ADMIN },
      { href: "/admin/staff", label: "Staff", icon: "staff", roles: ADMIN },
      { href: "/admin/settings", label: "Shop Settings", icon: "settings", roles: ADMIN },
    ],
  },
];

export function navSections(role: Role): NavSection[] {
  return SECTIONS.map((s) => ({ ...s, items: s.items.filter((i) => i.roles.includes(role)) })).filter((s) => s.items.length > 0);
}

export function isActivePath(pathname: string, href: string): boolean {
  return href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

// What the bell and Notifications count: orders awaiting confirmation, late pickups and (admins) reviews
// waiting for approval.
export function attentionCount(c: { pending?: number | null; latePickups?: number | null; reviews?: number | null }): number {
  return [c.pending, c.latePickups, c.reviews].reduce<number>((sum, n) => sum + Math.max(0, n ?? 0), 0);
}
