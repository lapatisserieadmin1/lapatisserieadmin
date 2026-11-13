import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getBusinessTimezone } from "@/lib/settings";
import { formatPaise } from "@/lib/money";
import { formatDateTime } from "@/lib/time";
import { SHOP_ADDRESS_LINES } from "@/lib/brand";
import { LogoMark, Wordmark } from "@/components/ui";
import { PrintControls } from "../../print-controls";

export const metadata: Metadata = { title: "Credit note" };

export default async function CreditNotePrintPage({ params, searchParams }: PageProps<"/print/credit-note/[id]">) {
  await requireRole(["admin", "counter"]);
  const { id } = await params;
  const { size: sizeParam } = await searchParams;
  const size = sizeParam === "a4" ? "a4" : "80mm";
  if (!z.uuid().safeParse(id).success) notFound();
  const tz = await getBusinessTimezone();

  const supabase = await createClient();
  const { data: cn } = await supabase.from("credit_notes").select("*, bills(bill_number, issued_at, customer_name, customer_phone)").eq("id", id).maybeSingle();
  if (!cn || !cn.bills) notFound();
  const narrow = size === "80mm";

  return (
    <div className="min-h-screen bg-canvas print:bg-white">
      <style>{`@page { size: ${narrow ? "80mm auto" : "A4"}; margin: ${narrow ? "3mm" : "12mm"}; }`}</style>
      <PrintControls basePath={`/print/credit-note/${cn.id}`} size={size} />
      <article className={narrow
        ? "mx-auto w-[76mm] bg-white p-3 font-mono text-[11px] leading-snug text-black shadow print:w-full print:p-0 print:shadow-none"
        : "mx-auto max-w-3xl bg-white p-10 text-sm text-black shadow print:max-w-none print:p-0 print:shadow-none"}>
        <header className={narrow ? "flex flex-col items-center text-center" : ""}>
          <LogoMark className={narrow ? "size-16" : "size-20"} />
          <h1 className="mt-1"><Wordmark className={narrow ? "w-40" : "w-56"} /></h1>
          <address className="mt-1 font-sans not-italic">
            {SHOP_ADDRESS_LINES.map((line) => <span key={line} className="block">{line}</span>)}
          </address>
          <p className={narrow ? "mt-2 border-y border-dashed border-black py-1 font-bold" : "mt-6 text-lg font-bold"}>CREDIT NOTE</p>
        </header>
        <dl className="mt-3 flex flex-col gap-0.5">
          <div className="flex justify-between"><dt>Credit note No</dt><dd>{cn.credit_note_number}</dd></div>
          <div className="flex justify-between"><dt>Date</dt><dd>{formatDateTime(cn.issued_at, tz)}</dd></div>
          <div className="flex justify-between"><dt>Against bill</dt><dd>{cn.bills.bill_number}</dd></div>
          <div className="flex justify-between"><dt>Bill date</dt><dd>{formatDateTime(cn.bills.issued_at, tz)}</dd></div>
          {cn.bills.customer_name && <div className="flex justify-between"><dt>Customer</dt><dd>{cn.bills.customer_name}</dd></div>}
          <div className="mt-2"><dt className="font-semibold">Reason</dt><dd>{cn.reason}</dd></div>
        </dl>
        <dl className={narrow ? "mt-2 border-t border-dashed border-black pt-1" : "ml-auto mt-6 w-72"}>
          <div className="mt-1 flex justify-between border-t border-black pt-1 font-bold"><dt>Total credited</dt><dd>{formatPaise(cn.total_paise)}</dd></div>
        </dl>
      </article>
    </div>
  );
}
