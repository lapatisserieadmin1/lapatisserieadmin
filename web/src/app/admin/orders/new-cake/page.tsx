import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { getBusinessTimezone } from "@/lib/settings";
import { addDays, zonedDayKey } from "@/lib/time";
import { PageHeader } from "@/components/ui";
import { CakeOrderForm } from "./cake-form";

export const metadata: Metadata = { title: "Customised order" };

export default async function NewCakeOrderPage() {
  const staff = await requireRole(["admin", "counter"]);
  const tz = await getBusinessTimezone();
  const tomorrow = addDays(zonedDayKey(new Date(), tz), 1);

  return (
    <>
      <PageHeader
        title="Customised order"
        description={
          <>
            <Link href="/admin/orders?list=custom" className="text-brand-strong hover:underline">Orders</Link> / Customised order / New.
          </>
        }
      />
      <CakeOrderForm
        isAdmin={staff.role === "admin"}
        defaultDueLocal={`${tomorrow}T11:00`}
        today={zonedDayKey(new Date(), tz)}
      />
    </>
  );
}
