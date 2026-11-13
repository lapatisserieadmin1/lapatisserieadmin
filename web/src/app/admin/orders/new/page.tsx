import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, zonedDayKey } from "@/lib/time";
import { EmptyState, PageHeader } from "@/components/ui";
import { loadCatalogue } from "@/lib/catalogue";
import { OrderEntry } from "./order-entry";

export const metadata: Metadata = { title: "In-store order" };

const TITLES = { IN_STORE: "In-store order", CALL: "Call order", CUSTOMER: "Customer order" } as const;

export default async function NewOrderPage({ searchParams }: PageProps<"/admin/orders/new">) {
  const staff = await requireRole(["admin", "counter"]);
  const { source: sourceParam } = await searchParams;
  const source = sourceParam === "CALL" || sourceParam === "CUSTOMER" ? sourceParam : "IN_STORE";
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const catalogue = await loadCatalogue(supabase);

  const tomorrow = addDays(zonedDayKey(new Date(), tz), 1);

  return (
    <>
      <PageHeader
        title={TITLES[source]}
        description={
          <>
            <Link href="/admin/orders" className="text-brand-strong hover:underline">Orders</Link> / {TITLES[source]}
          </>
        }
      />
      {catalogue.length === 0 ? (
        <EmptyState title="No products available to order">
          Add products with at least one available variant in <Link href="/admin/products" className="text-brand-strong underline">Products</Link>.
        </EmptyState>
      ) : (
        <OrderEntry
          key={source}
          source={source}
          catalogue={catalogue}
          canConfirm={staff.role === "admin" || source === "IN_STORE"}
          isAdmin={staff.role === "admin"}
          defaultDueLocal={`${tomorrow}T11:00`}
        />
      )}
    </>
  );
}
