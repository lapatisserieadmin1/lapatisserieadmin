import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { ButtonLink, Card, EmptyState, PageHeader, ScriptText } from "@/components/ui";
import { ContactBadge, FulfilmentBadge } from "@/components/order-badges";
import type { Fulfilment, OrderSource } from "@/lib/orders";
import { LiveRefresh } from "@/components/live-refresh";

export const metadata: Metadata = { title: "Notifications" };

type Row = {
  id: string;
  reference: string;
  source: OrderSource;
  customer_name: string | null;
  customer_phone: string | null;
  due_at: string;
  created_at: string;
  total_paise: number;
  fulfilment: Fulfilment;
};

const COLUMNS = "id, reference, source, customer_name, customer_phone, due_at, created_at, total_paise, fulfilment";

// Everything that needs someone: orders to confirm (newest first, so website orders stand out), packed
// orders past their pickup time, and (admins) reviews to approve. The bell counts the same things.
export default async function NotificationsPage() {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const tz = await getBusinessTimezone();
  const supabase = await createClient();
  const nowIso = new Date().toISOString();
  const [pending, late, reviews] = await Promise.all([
    supabase.from("order_summaries").select(COLUMNS).eq("status", "pending_confirmation").order("created_at", { ascending: false }).limit(100),
    supabase.from("order_summaries").select(COLUMNS).eq("status", "ready").lt("due_at", nowIso).order("due_at").limit(100),
    isAdmin
      ? supabase.from("reviews").select("id, customer_name, rating, comment, created_at").eq("status", "pending").order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] }),
  ]);
  const pendingRows = (pending.data ?? []) as Row[];
  const lateRows = (late.data ?? []) as Row[];
  const reviewRows = reviews.data ?? [];
  const nothing = pendingRows.length === 0 && lateRows.length === 0 && reviewRows.length === 0;

  return (
    <>
      <LiveRefresh />
      <PageHeader title="Notifications" description="Orders to confirm, late pickups and reviews to approve." />
      {nothing ? (
        <Card className="flex flex-col items-center gap-2 px-8 py-14 text-center">
          <ScriptText className="text-4xl">All caught up ♥</ScriptText>
          <p className="text-muted">Nothing needs attention right now.</p>
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          <Section title="Waiting for confirmation" count={pendingRows.length} empty="No orders waiting.">
            {pendingRows.map((o) => (
              <OrderLine key={o.id} order={o} tz={tz} detail={`Received ${formatDateTime(o.created_at, tz)} · due ${formatDateTime(o.due_at, tz)}`} />
            ))}
          </Section>
          <Section title="Late pickups" count={lateRows.length} empty="No packed orders past their pickup time.">
            {lateRows.map((o) => (
              <OrderLine key={o.id} order={o} tz={tz} detail={`Was due ${formatDateTime(o.due_at, tz)}`} />
            ))}
          </Section>
          {isAdmin && (
            <Section
              title="Reviews to approve"
              count={reviewRows.length}
              empty="No reviews waiting."
              action={reviewRows.length > 0 && <ButtonLink href="/admin/reviews" variant="secondary">Open Reviews</ButtonLink>}
            >
              {reviewRows.map((r) => (
                <li key={r.id} className="py-3">
                  <Link href="/admin/reviews" className="block hover:text-brand-strong">
                    <span className="font-medium">{r.customer_name}</span>{" "}
                    <span className="text-amber-600" aria-label={`${r.rating} stars`}>{"★".repeat(r.rating)}</span>
                    <span className="mt-0.5 block truncate text-sm text-muted">{r.comment}</span>
                  </Link>
                </li>
              ))}
            </Section>
          )}
        </div>
      )}
    </>
  );
}

function Section({
  title,
  count,
  empty,
  action,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          {title}
          {count > 0 && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-white">{count}</span>}
        </h2>
        {action}
      </div>
      {count === 0 ? <EmptyState title={empty} /> : <ul className="divide-y divide-line/70">{children}</ul>}
    </Card>
  );
}

function OrderLine({ order, detail }: { order: Row; tz: string; detail: string }) {
  return (
    <li className="relative flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
      <Link href={`/admin/orders/${order.id}`} className="font-semibold text-ink after:absolute after:inset-0 hover:text-brand-strong">
        {order.reference}
      </Link>
      <span className="text-sm">{order.customer_name ?? "Walk-in"}</span>
      <ContactBadge source={order.source} phone={order.customer_phone} />
      <FulfilmentBadge fulfilment={order.fulfilment} />
      <span className="ml-auto text-sm font-medium tabular-nums">{formatPaise(order.total_paise)}</span>
      <span className="w-full text-xs text-muted">{detail}</span>
    </li>
  );
}
