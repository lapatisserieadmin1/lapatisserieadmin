import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatDateTime } from "@/lib/time";
import { Button, Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { deleteReview, setReviewStatus } from "./actions";

export const metadata: Metadata = { title: "Reviews" };

const TABS = {
  pending: { label: "Waiting", empty: "No reviews waiting. New ones from the website appear here first." },
  approved: { label: "On the website", empty: "No approved reviews yet." },
  hidden: { label: "Hidden", empty: "No hidden reviews." },
} as const;
type Tab = keyof typeof TABS;

// Reviews customers send from the website. Nothing shows on the website until an admin approves it.
export default async function ReviewsPage({ searchParams }: PageProps<"/admin/reviews">) {
  await requireRole(["admin"]);
  const params = await searchParams;
  const tab: Tab = (Object.keys(TABS) as Tab[]).find((t) => t === params.status) ?? "pending";
  const tz = await getBusinessTimezone();
  const supabase = await createClient();
  const head = { count: "exact" as const, head: true };
  const [list, pending, approved, hidden] = await Promise.all([
    supabase.from("reviews").select("*").eq("status", tab).order("created_at", { ascending: false }).limit(200),
    supabase.from("reviews").select("id", head).eq("status", "pending"),
    supabase.from("reviews").select("id", head).eq("status", "approved"),
    supabase.from("reviews").select("id", head).eq("status", "hidden"),
  ]);
  const counts: Record<Tab, number> = { pending: pending.count ?? 0, approved: approved.count ?? 0, hidden: hidden.count ?? 0 };
  const reviews = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Reviews"
        description="Customers leave reviews on the website. Approve the ones to show there; the newest 12 approved are shown."
      />
      <nav aria-label="Review status" className="mb-4 flex flex-wrap gap-2">
        {(Object.keys(TABS) as Tab[]).map((t) => (
          <Link
            key={t}
            href={t === "pending" ? "/admin/reviews" : `/admin/reviews?status=${t}`}
            aria-current={t === tab ? "page" : undefined}
            className={cx(
              "rounded-full border px-4 py-1.5 text-sm font-medium",
              t === tab ? "border-brand bg-brand text-white" : "border-line bg-surface text-ink hover:bg-brand-soft",
            )}
          >
            {TABS[t].label} <span className="tabular-nums opacity-80">({counts[t]})</span>
          </Link>
        ))}
      </nav>
      {reviews.length === 0 ? (
        <EmptyState title={TABS[tab].empty} />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {reviews.map((r) => (
            <li key={r.id}>
              <Card className="flex h-full flex-col gap-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{r.customer_name}</p>
                  <p className="text-lg leading-none text-amber-500" aria-label={`${r.rating} out of 5 stars`}>
                    {"★".repeat(r.rating)}
                    <span className="text-line">{"★".repeat(5 - r.rating)}</span>
                  </p>
                </div>
                <p className="whitespace-pre-line text-sm">{r.comment}</p>
                <p className="text-xs text-muted">Sent {formatDateTime(r.created_at, tz)}</p>
                <div className="mt-auto flex flex-wrap gap-2 pt-1">
                  {r.status !== "approved" && (
                    <form action={setReviewStatus.bind(null, r.id, "approved")}>
                      <Button type="submit">Approve</Button>
                    </form>
                  )}
                  {r.status !== "hidden" && (
                    <form action={setReviewStatus.bind(null, r.id, "hidden")}>
                      <Button type="submit" variant="secondary">{r.status === "approved" ? "Take off the website" : "Hide"}</Button>
                    </form>
                  )}
                  <form action={deleteReview.bind(null, r.id)}>
                    <Button type="submit" variant="ghost">Delete</Button>
                  </form>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
