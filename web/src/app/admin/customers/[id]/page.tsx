import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { Alert, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { SourceBadge, StatusBadge } from "@/components/order-badges";
import { BlockForm } from "./block-form";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: PageProps<"/admin/customers/[id]">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const [{ data: customer }, { data: orders }, { data: events }, { data: staffRows }] = await Promise.all([
    supabase.from("customers").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("orders")
      .select("id, reference, status, source, due_at, total_paise, no_show_at, no_show_by")
      .eq("customer_id", id)
      .order("due_at", { ascending: false })
      .limit(200),
    supabase.from("customer_events").select("*").eq("customer_id", id).order("occurred_at", { ascending: false }),
    supabase.from("staff_profiles").select("user_id, full_name"),
  ]);
  if (!customer) notFound();

  const staffName = new Map((staffRows ?? []).map((s) => [s.user_id, s.full_name]));
  const who = (userId: string | null) => (userId ? staffName.get(userId) ?? "Staff" : "System");
  const lastBlock = (events ?? []).find((e) => e.event_type === "blocked");

  return (
    <>
      <PageHeader
        title={customer.full_name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/admin/customers" className="text-brand-strong hover:underline">Customers</Link>
            <span>/</span>
            {customer.phone && <a href={`tel:${customer.phone}`} className="text-brand-strong hover:underline">{customer.phone}</a>}
            {customer.is_blocked && <Badge tone="danger">Blocked</Badge>}
            {customer.no_show_count > 0 && (
              <Badge tone="warn">{customer.no_show_count} no-show{customer.no_show_count === 1 ? "" : "s"}</Badge>
            )}
          </span>
        }
      />

      <div className="flex flex-col gap-6">
        {customer.is_blocked && (
          <Alert tone="danger" title="Blocked">
            {customer.blocked_reason}
            {lastBlock && ` — ${who(lastBlock.actor_id)}, ${formatDateTime(lastBlock.occurred_at, tz)}`}. New orders from this
            number are refused unless an admin overrides with a reason.
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h2 className="mb-3 text-lg font-semibold">Orders</h2>
            {!orders || orders.length === 0 ? (
              <EmptyState title="No orders yet" />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {orders.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/orders/${o.id}`} className="font-mono font-medium hover:text-brand-strong hover:underline">{o.reference}</Link>
                      <SourceBadge source={o.source} />
                      <StatusBadge status={o.status} />
                      {o.no_show_at && <Badge tone="danger">No-show</Badge>}
                    </div>
                    <div className="text-right">
                      <p>{o.due_at ? formatDateTime(o.due_at, tz) : "—"}</p>
                      <p className="text-xs text-muted">
                        {formatPaise(o.total_paise)}
                        {o.no_show_at && ` · no-show recorded by ${who(o.no_show_by)}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 text-lg font-semibold">Blocking</h2>
            <p className="mb-4 text-sm text-muted">
              {customer.is_blocked ? "This customer is blocked." : "This customer can place orders."} No-shows are recorded on each order;
              blocking is always a separate decision.
            </p>
            {isAdmin ? (
              <BlockForm key={String(customer.is_blocked)} customerId={customer.id} isBlocked={customer.is_blocked} />
            ) : (
              <p className="text-sm text-muted">Only an admin can block or unblock a customer.</p>
            )}
            {events && events.length > 0 && (
              <ol className="mt-5 flex flex-col gap-3 border-l-2 border-line pl-4 text-sm">
                {events.map((e) => (
                  <li key={e.id}>
                    <p className="font-medium">{e.event_type === "blocked" ? "Blocked" : "Unblocked"}</p>
                    <p className="text-xs text-muted">{formatDateTime(e.occurred_at, tz)} · {who(e.actor_id)}</p>
                    <p className="text-xs">Reason: {e.reason}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
