"use client";

import { useRef, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bell,
  CalendarDays,
  ChartLine,
  ChefHat,
  ChevronDown,
  Images,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Search,
  Settings,
  ShoppingCart,
  Star,
  Table2,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Brand, cx } from "@/components/ui";
import { SHOP_NAME } from "@/lib/brand";
import { isActivePath, type NavIcon, type NavSection } from "@/lib/shell";
import { signOut } from "@/app/login/actions";

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  orders: ShoppingCart,
  calendar: CalendarDays,
  products: Package,
  customers: Users,
  analytics: ChartLine,
  staff: UserCog,
  settings: Settings,
  bell: Bell,
  reviews: Star,
  kitchen: ChefHat,
  gallery: Images,
  reports: Table2,
};

type Counts = { pending: number; reviews: number; attention: number };

function SidebarContent({ sections, counts, onNavigate }: { sections: NavSection[]; counts: Counts; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <Link href="/admin" onClick={onNavigate} className="px-4 pb-5 pt-6" aria-label={`${SHOP_NAME}, Dashboard`}>
        <Brand />
      </Link>
      <nav aria-label="Admin" className="flex flex-1 flex-col gap-4 px-3">
        {sections.map((section) => (
          <div key={section.title ?? "main"}>
            {section.title && <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-widest text-accent-strong">{section.title}</p>}
            <ul className="flex flex-col gap-1">
              {section.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = isActivePath(pathname, item.href);
                const badge = item.badge ? counts[item.badge] : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cx(
                        "flex items-center gap-3 rounded-xl px-3 py-2 text-[15px] transition-colors",
                        active ? "bg-linear-to-r from-rose to-brand font-semibold text-white shadow-md shadow-brand/30" : "text-ink hover:bg-brand-soft hover:text-brand-strong",
                      )}
                    >
                      <Icon aria-hidden className="size-5 shrink-0" strokeWidth={1.75} />
                      <span className="flex-1">{item.label}</span>
                      {badge > 0 && (
                        <span
                          className={cx(
                            "min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold",
                            active ? "bg-white text-brand-strong" : "bg-accent text-white",
                          )}
                        >
                          {badge}
                          <span className="sr-only"> waiting</span>
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="h-6 shrink-0" />
    </div>
  );
}

function UserMenu({ name, roleLabel }: { name: string; roleLabel: string }) {
  return (
    <details className="group relative">
      <summary
        aria-label={`Account menu, ${name}`}
        className="flex cursor-pointer list-none items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-brand-soft [&::-webkit-details-marker]:hidden"
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent-strong font-display text-lg text-white">{name.slice(0, 1).toUpperCase()}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-medium leading-tight">{name}</span>
          <span className="block text-xs text-muted">{roleLabel}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 text-muted transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 z-30 mt-2 w-48 rounded-2xl border border-line bg-surface p-2 shadow-lg">
        <form action={signOut}>
          <button type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-brand-soft">
            <LogOut aria-hidden className="size-4" /> Sign out
          </button>
        </form>
      </div>
    </details>
  );
}

export function AdminShell({
  sections,
  counts,
  name,
  roleLabel,
  children,
}: {
  sections: NavSection[];
  counts: Counts;
  name: string;
  roleLabel: string;
  children: ReactNode;
}) {
  // Phone and tablet menu: a modal <dialog>, so focus moves into it, Escape closes it and the page
  // behind is inert. It also closes when a menu link is tapped.
  const menu = useRef<HTMLDialogElement>(null);
  const openMenu = () => menu.current?.showModal();
  const closeMenu = () => menu.current?.close();

  return (
    <div className="relative min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-line bg-linear-to-b from-surface via-surface to-brand-soft/70 lg:block">
        <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-linear-to-r from-rose via-brand to-accent" />
        <SidebarContent sections={sections} counts={counts} />
      </aside>

      {/* Phone and tablet menu */}
      <dialog
        ref={menu}
        aria-label="Menu"
        onClick={(e) => {
          if (e.target === e.currentTarget) closeMenu(); // a tap on the dimmed backdrop
        }}
        className="m-0 h-dvh max-h-none w-72 max-w-[85vw] bg-surface p-0 shadow-xl backdrop:bg-ink/30 lg:hidden"
      >
        <button type="button" aria-label="Close menu" onClick={closeMenu} className="absolute right-3 top-3 z-10 rounded-full p-2 hover:bg-brand-soft">
          <X aria-hidden className="size-5" />
        </button>
        <SidebarContent sections={sections} counts={counts} onNavigate={closeMenu} />
      </dialog>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-line/70 bg-surface/80 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 md:px-8">
            <button type="button" aria-label="Open menu" onClick={openMenu} className="rounded-xl p-2 hover:bg-brand-soft lg:hidden">
              <Menu aria-hidden className="size-6" />
            </button>
            <form action="/admin/orders" role="search" className="relative max-w-xl flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              {/* Searches both order lists, every status and date (see searchEverywhere). */}
              <input type="hidden" name="scope" value="all" />
              <input type="hidden" name="when" value="all" />
              <input
                name="q"
                type="search"
                aria-label="Search orders by number, customer name or phone"
                placeholder="Search orders, customers, phone…"
                className="w-full rounded-2xl border border-line bg-surface py-2.5 pl-10 pr-4 text-sm placeholder:text-muted/80 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
              />
            </form>
            <div className="ml-auto flex items-center gap-2">
              <Link
                href="/admin/notifications"
                aria-label={counts.attention > 0 ? `${counts.attention} things need attention` : "Nothing needs attention"}
                className="relative rounded-full p-2.5 hover:bg-brand-soft"
              >
                <Bell aria-hidden className="size-6 text-ink" strokeWidth={1.75} />
                {counts.attention > 0 && (
                  <span className="absolute right-1 top-1 flex min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
                    {counts.attention > 99 ? "99+" : counts.attention}
                  </span>
                )}
              </Link>
              <UserMenu name={name} roleLabel={roleLabel} />
            </div>
          </div>
        </header>

        <main className="px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>

        <footer className="px-4 pb-8 pt-4 text-center">
          <p className="font-caps text-sm uppercase tracking-[0.3em] text-ink">{SHOP_NAME}</p>
        </footer>
      </div>
    </div>
  );
}
