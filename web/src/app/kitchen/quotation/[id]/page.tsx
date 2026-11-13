import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadQuotation } from "@/lib/quotation-server";
import { quotationView, withoutPrices } from "@/lib/quotation";
import { getBusinessTimezone } from "@/lib/settings";
import { zonedDayKey } from "@/lib/time";
import { QuotationSheet } from "@/components/quotation-sheet";
import { PrintButton } from "@/app/print/print-button";

export const metadata: Metadata = { title: "Order in msg (kitchen)" };

// The price-free quotation for the kitchen. Chefs get only confirmed orders of their own kitchen (the
// database refuses the rest); admins and counter staff opening it see the same price-free version.
// The staff instructions (internal notes) sit above it here only, never on the customer's quotation (owner, 2026-11-07).
export default async function KitchenQuotationPage({ params }: PageProps<"/kitchen/quotation/[id]">) {
  await requireRole(["chef", "admin", "counter"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const result = await loadQuotation(supabase, id);
  if (!result.ok) notFound();
  const view = quotationView(withoutPrices(result.quotation));

  let staffNotes: string | null = null;
  const dueAt = result.quotation.order.dueAt;
  if (dueAt) {
    const day = zonedDayKey(dueAt, await getBusinessTimezone());
    const { data: rows } = await supabase.rpc("chef_work", { p_from: day, p_to: day });
    staffNotes = rows?.find((r) => r.order_id === id)?.internal_notes ?? null;
  }

  return (
    <div className="min-h-screen bg-canvas px-4 py-6 sm:py-10 print:bg-white print:p-0">
      <style>{"@page { size: A4; margin: 14mm; }"}</style>
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 print:hidden">
        <Link href="/kitchen" className="text-sm font-medium text-brand-strong hover:underline">← Kitchen</Link>
        <PrintButton />
      </div>
      {staffNotes && (
        <div className="mx-auto mb-4 max-w-3xl rounded-xl border border-warn/40 bg-warn-soft px-4 py-3 text-base print:mb-3">
          <p className="text-sm font-semibold uppercase tracking-wide text-warn">📝 Staff instructions</p>
          <p className="mt-1 break-words font-medium whitespace-pre-line">{staffNotes}</p>
        </div>
      )}
      <QuotationSheet view={view} />
    </div>
  );
}
