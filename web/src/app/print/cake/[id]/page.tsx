import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { cakeExtras } from "@/lib/custom-cake";
import { formatPaise } from "@/lib/money";
import { sourceLabel } from "@/lib/orders";
import { formatDateTime } from "@/lib/time";
import { loadQuotation } from "@/lib/quotation-server";
import { captionBill } from "@/lib/quotation";
import { whatsappNumber } from "@/lib/whatsapp";
import { cloudFormats, whatsappCloudConfig } from "@/lib/whatsapp-cloud";
import { Card, LogoMark, cx } from "@/components/ui";
import { CAKE_SHEET_TERMS } from "@/lib/brand";
import { TermsPanel } from "@/components/terms-panel";
import { CustomerWhatsAppSend } from "@/components/customer-whatsapp-send";
import { QuotationSend } from "@/app/admin/orders/[id]/quotation-send";
import { PrintControls } from "../../print-controls";

export const metadata: Metadata = { title: "Cake sheet" };

// The custom cake's details for whoever bakes and decorates it (owner, 2026-10-09). The id is the order's.
// Below it (not printed), the bill file goes to the customer on WhatsApp, as an image by default, with no text (2026-10-28).
export default async function CakeSheetPage({ params, searchParams }: PageProps<"/print/cake/[id]">) {
  await requireRole(["admin", "counter"]);
  const { id } = await params;
  const { size: sizeParam } = await searchParams;
  const size = sizeParam === "a4" ? "a4" : "80mm";
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const [{ data: order }, { data: cake }, quotation] = await Promise.all([
    supabase
      .from("order_summaries")
      .select("reference, source, status, customer_name, customer_phone, due_at, fulfilment, setup_address, setup_note, total_paise, balance_paise")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("custom_cakes").select("*").eq("order_id", id).maybeSingle(),
    loadQuotation(supabase, id),
  ]);
  if (!order || !cake) notFound();
  const photoUrls = cake.photo_paths.length
    ? ((await supabase.storage.from("custom-cake-photos").createSignedUrls(cake.photo_paths, 600)).data ?? []).flatMap((s) => (s.signedUrl ? [s.signedUrl] : []))
    : [];
  const narrow = size === "80mm";
  const bill = quotation.ok ? captionBill(quotation.quotation) : null;

  const rows: [string, string | null][] = [
    ["Flavour", cake.flavour],
    ["Size", `${Number(cake.weight_kg)} kg${cake.tiers > 1 ? ` · ${cake.tiers} tiers` : ""}`],
    ["Egg", cake.is_eggless ? "EGGLESS" : "With egg"],
    ["Theme", cake.theme],
    ["Colour", cake.design],
    ["Model", cake.model],
    ["Fondant", cake.fondant],
    ["Cream", cake.cream],
    ["Filling", cake.filling],
    ["Toppings", cake.toppings],
    ["Extras", cakeExtras(cake) || null],
    ["Instructions", cake.instructions],
    ["Add on", cake.addon_details],
  ];

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: ${narrow ? "80mm auto" : "A4"}; margin: ${narrow ? "3mm" : "12mm"}; }`}</style>
      <PrintControls basePath={`/print/cake/${id}`} size={size} />
      <article className={narrow
        ? "mx-auto w-[76mm] bg-white p-3 font-mono text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none"
        : "mx-auto max-w-3xl bg-white p-10 text-base text-black shadow print:max-w-none print:p-0 print:shadow-none"}>
        <header className={narrow ? "border-b border-dashed border-black pb-1 text-center" : "flex items-start justify-between gap-6 border-b-2 border-black pb-3"}>
          <div className={narrow ? "flex flex-col items-center" : "flex items-center gap-3"}>
            <LogoMark className={narrow ? "size-12" : "size-16"} />
            <div>
            <p className={narrow ? "font-sans text-sm font-bold" : "font-sans text-2xl font-bold"}>CUSTOMISED ORDER</p>
            <p>Order {order.reference} · {order.source ? sourceLabel[order.source] : ""}</p>
            </div>
          </div>
          <div className={narrow ? "" : "text-right"}>
            <p className="font-bold">
              {order.fulfilment === "setup" ? "SET UP" : "PICKUP"}: {order.due_at ? formatDateTime(order.due_at, tz) : "—"}
            </p>
            <p>{order.customer_name} {order.customer_phone && `· ${order.customer_phone}`}</p>
          </div>
        </header>

        {order.fulfilment === "setup" ? (
          <p className="mt-2 font-bold">
            SET UP at: {order.setup_address}
            {order.setup_note && <span className="block font-normal">Landmark: {order.setup_note}</span>}
          </p>
        ) : (
          <p className="mt-2 font-bold">
            PICKUP/CAB
            {order.setup_address && <span className="block font-normal">Cab to: {order.setup_address}</span>}
            {order.setup_note && <span className="block font-normal">Landmark: {order.setup_note}</span>}
          </p>
        )}

        {cake.message && (
          <p className={narrow ? "mt-2 border-y border-dashed border-black py-1 text-center text-sm font-bold" : "mt-4 border-2 border-black p-3 text-center text-2xl font-bold"}>
            “{cake.message}”
          </p>
        )}

        <dl className={narrow ? "mt-2" : "mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2"}>
          {rows
            .filter(([, v]) => v)
            .map(([k, v]) => (
              <div key={k} className={narrow ? "flex gap-2" : "contents"}>
                <dt className={narrow ? "shrink-0" : "font-semibold"}>{k}:</dt>
                <dd className={k === "Egg" && cake.is_eggless ? "font-bold" : ""}>{v}</dd>
              </div>
            ))}
        </dl>

        {photoUrls.length > 0 && (
          <div className={narrow ? "mt-2 flex flex-col gap-1" : photoUrls.length > 1 ? "mt-6 grid grid-cols-2 gap-3" : "mt-6"}>
            {photoUrls.map((url, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL from private storage
              <img
                key={url}
                src={url}
                alt={`Customer's reference photo ${i + 1}`}
                className={narrow ? "w-full" : photoUrls.length > 1 ? "max-h-[75mm] w-full object-contain" : "max-h-[110mm] w-auto"}
              />
            ))}
          </div>
        )}

        <footer className={narrow ? "mt-2 border-t border-dashed border-black pt-1" : "mt-6 border-t border-black pt-2 text-sm"}>
          {bill ? (
            <dl className={narrow ? "" : "grid grid-cols-[auto_auto] justify-end gap-x-6 gap-y-0.5"}>
              {[
                ...bill.lines.map((l) => [l.label, formatPaise(l.paise)] as const),
                ...(bill.discountPaise > 0 ? [["Discount", `−${formatPaise(bill.discountPaise)}`] as const] : []),
                ["Total", formatPaise(bill.totalPaise)] as const,
                ["Advance paid", formatPaise(bill.advancePaise)] as const,
                [bill.balancePaise < 0 ? "Refund due" : "Balance to pay", formatPaise(Math.abs(bill.balancePaise))] as const,
              ].map(([k, v]) => (
                <div key={k} className={narrow ? "flex justify-between gap-2" : "contents"}>
                  <dt className={k === "Total" || k === "Balance to pay" ? "font-bold" : ""}>{k}</dt>
                  <dd className={cx("text-right tabular-nums", (k === "Total" || k === "Balance to pay") && "font-bold")}>{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <>Price {formatPaise(order.total_paise ?? 0)} · {(order.balance_paise ?? 0) > 0 ? `Balance due ${formatPaise(order.balance_paise ?? 0)}` : "Paid"}</>
          )}
        </footer>

        <section aria-label="Terms and conditions" className={narrow ? "mt-2 border-t border-dashed border-black pt-1 text-[10px]" : "mt-4 border-t border-black pt-2 text-xs"}>
          <p className="font-bold">Terms and Conditions</p>
          <ul className="list-disc pl-4">
            {CAKE_SHEET_TERMS.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </section>
      </article>
      {quotation.ok && (
        <Card className="mx-auto mt-6 max-w-3xl border-2 border-[#1f9d55]/40 print:hidden">
          <h2 className="mb-1 text-lg font-semibold">Send the bill and Terms to the customer&rsquo;s WhatsApp</h2>
          <p className="mb-3 text-sm text-muted">Pick image or PDF, then one tap. Both go together as files.</p>
          <CustomerWhatsAppSend
            orderId={id}
            reference={order.reference ?? ""}
            phone={whatsappNumber(order.customer_phone)}
            cloud={Boolean(whatsappCloudConfig())}
            testMode={whatsappCloudConfig()?.testMode ?? false}
          />
        </Card>
      )}
      {quotation.ok && (
        <Card className="mx-auto mt-6 max-w-3xl print:hidden">
          <h2 className="mb-1 text-lg font-semibold">Send the bill to the customer on WhatsApp</h2>
          <p className="mb-3 text-sm text-muted">The bill goes as a file (image or PDF) with the cake details, total, advance and balance. No text message.</p>
          <QuotationSend
            orderId={id}
            phone={whatsappNumber(order.customer_phone)}
            caption=""
            cloudFormats={cloudFormats(whatsappCloudConfig())}
            defaultFormat="png"
            fileOnly
          />
        </Card>
      )}
      <Card className="mx-auto mt-6 max-w-3xl print:hidden">
        <h2 className="mb-1 text-lg font-semibold">Terms and Conditions for the customer</h2>
        <p className="mb-3 text-sm text-muted">
          Send them to the customer&rsquo;s WhatsApp as a file (PDF or image), or download them.
        </p>
        <TermsPanel orderId={id} reference={order.reference ?? ""} phone={whatsappNumber(order.customer_phone)} cloud={Boolean(whatsappCloudConfig())} testMode={whatsappCloudConfig()?.testMode ?? false} />
      </Card>
    </div>
  );
}
