import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadQuotation } from "@/lib/quotation-server";
import { captionBill, quotationView } from "@/lib/quotation";
import { quotationCaption, whatsappNumber } from "@/lib/whatsapp";
import { cloudFormats, whatsappCloudConfig } from "@/lib/whatsapp-cloud";
import { QuotationSheet } from "@/components/quotation-sheet";
import { Alert, Card } from "@/components/ui";
import { PrintButton } from "../../print-button";
import { QuotationSend } from "@/app/admin/orders/[id]/quotation-send";

export const metadata: Metadata = { title: "Order in msg" };

// The full quotation (every amount) for admin and counter staff, with "Send quotation on WhatsApp".
// The kitchen's price-free version is /kitchen/quotation/[id].
export default async function QuotationPage({ params }: PageProps<"/print/quotation/[id]">) {
  await requireRole(["admin", "counter"]);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const supabase = await createClient();
  const [result, { data: order }] = await Promise.all([
    loadQuotation(supabase, id),
    supabase.from("orders").select("customer_phone, sticky_note, sticky_note_in_whatsapp").eq("id", id).maybeSingle(),
  ]);
  if (!result.ok) {
    if (result.status === 404) notFound();
    return <div className="mx-auto max-w-3xl p-6"><Alert tone="danger" title="Could not load the Order in msg">{result.message}</Alert></div>;
  }
  const q = result.quotation;
  const caption = quotationCaption(
    { reference: q.order.reference, note: order?.sticky_note_in_whatsapp ? order.sticky_note : null, bill: captionBill(q) },
    q.shop.name,
  );

  return (
    <div className="min-h-screen bg-canvas px-4 py-6 sm:py-10 print:bg-white print:p-0">
      <style>{"@page { size: A4; margin: 14mm; }"}</style>
      <div className="mx-auto mb-4 flex max-w-6xl items-center justify-between gap-3 print:hidden">
        <Link href={`/admin/orders/${id}`} className="text-sm font-medium text-brand-strong hover:underline">← Order {q.order.reference}</Link>
        <PrintButton />
      </div>
      <div className="mx-auto grid max-w-6xl items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <QuotationSheet view={quotationView(q)} />
        <Card className="print:hidden lg:sticky lg:top-6">
          <h2 className="mb-3 text-lg font-semibold">Send to the customer</h2>
          <QuotationSend orderId={id} phone={whatsappNumber(order?.customer_phone ?? null)} caption={caption} cloudFormats={cloudFormats(whatsappCloudConfig())} />
        </Card>
      </div>
    </div>
  );
}
