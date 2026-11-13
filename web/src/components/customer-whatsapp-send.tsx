"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, cx } from "@/components/ui";
import { whatsappLink } from "@/lib/whatsapp";
import { recordQuotationSendAction, sendBillAndTermsAction } from "@/app/admin/orders/actions";

type Format = "pdf" | "png";
type Prepared = { files: File[]; billPath: string };

function shownNumber(phone: string): string {
  const local = phone.startsWith("91") && phone.length === 12 ? phone.slice(2) : phone;
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

function download(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// The bill and the Terms and Conditions to the customer's WhatsApp (owner, 2026-11-07), as image or PDF as the
// admin picks. With WhatsApp Business set up, the server sends both. Otherwise one tap opens WhatsApp on this
// phone with both files already attached (staff tap the customer, then Send): WhatsApp lets no website choose
// the chat. Both files are made when the page opens, because the share must run straight after the tap.
export function CustomerWhatsAppSend({ orderId, reference, phone, cloud, testMode }: {
  orderId: string;
  reference: string;
  phone: string | null;
  cloud: boolean;
  testMode: boolean;
}) {
  const router = useRouter();
  const [format, setFormat] = useState<Format>("png");
  const [prepared, setPrepared] = useState<Partial<Record<Format, Prepared>>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ready = prepared[format] ?? null;

  useEffect(() => {
    if (cloud || !phone || prepared[format]) return;
    let cancelled = false;
    const type = format === "pdf" ? "application/pdf" : "image/png";
    const bill = fetch(`/api/orders/${orderId}/quotation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format }),
    })
      .then((res) => res.json())
      .then(async (d: { ok?: boolean; url?: string; path?: string; fileName?: string; message?: string }) => {
        if (!d.ok || !d.url || !d.path || !d.fileName) throw new Error(d.message ?? "Could not make the bill.");
        const blob = await (await fetch(d.url)).blob();
        return { file: new File([blob], d.fileName, { type }), path: d.path };
      });
    const terms = fetch(`/api/terms?${new URLSearchParams({ format, ref: reference })}`)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error("Could not make the Terms."))))
      .then((blob) => new File([blob], `LaPatisserieMadras-Terms-${reference}.${format}`, { type }));
    Promise.all([bill, terms])
      .then(([b, t]) => !cancelled && setPrepared((prev) => ({ ...prev, [format]: { files: [b.file, t], billPath: b.path } })))
      .catch((e: Error) => !cancelled && setError(`${e.message || "Could not make the files."} Check the connection and reload the page.`));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-made only when the format changes
  }, [format, cloud, phone, orderId, reference]);

  async function sendFromServer() {
    setSending(true);
    setDone(null);
    setError(null);
    const r = await sendBillAndTermsAction({ orderId, format }).catch(() => null);
    setSending(false);
    const kind = format === "pdf" ? "PDF" : "image";
    if (r?.ok) {
      setDone(testMode
        ? `Bill and Terms sent as ${kind}s to the local WhatsApp test phone. Open http://localhost:4010 to see them.`
        : `Bill and Terms sent as ${kind}s to the customer's WhatsApp.`);
      for (const ms of [2500, 6000]) setTimeout(() => router.refresh(), ms);
    } else setError(r?.message ?? "Could not send on WhatsApp. Check the connection and try again.");
    router.refresh();
  }

  async function openWhatsApp() {
    if (!ready || !phone) return;
    setDone(null);
    setError(null);
    const { files, billPath } = ready;
    if (navigator.canShare?.({ files })) {
      try {
        await navigator.share({ files });
      } catch (e) {
        if ((e as Error).name !== "AbortError") setError("Could not open WhatsApp. Try again.");
        return;
      }
      setDone(`In WhatsApp, tap the customer (${shownNumber(phone)}), then Send. Both files are already attached.`);
      await recordQuotationSendAction({ orderId, format, channel: "share_sheet", path: billPath, caption: "" }).catch(() => null);
    } else {
      files.forEach(download);
      window.open(whatsappLink(phone, ""), "_blank", "noopener,noreferrer");
      setDone("This computer cannot hand files to WhatsApp, so both files were downloaded and the customer's chat is open. Attach them (📎) and press Send. On a phone, this button attaches them for you.");
      await recordQuotationSendAction({ orderId, format, channel: "download_and_chat", path: billPath, caption: "" }).catch(() => null);
    }
    router.refresh();
  }

  if (!phone) return <p className="text-sm text-muted">Add the customer&rsquo;s phone number to the order to send on WhatsApp.</p>;

  const label = format === "pdf" ? "PDF" : "PNG";
  return (
    <div className="flex flex-col gap-3">
      {testMode && (
        <Alert tone="warn" title="WhatsApp test mode">
          Sends go to the local WhatsApp test phone at http://localhost:4010, never to the customer.
        </Alert>
      )}
      <p className="text-sm">
        To the customer&rsquo;s WhatsApp: <span className="font-semibold tabular-nums">{shownNumber(phone)}</span>
      </p>
      <fieldset className="flex flex-wrap items-center gap-2">
        <legend className="mb-1 text-sm text-muted">Send as</legend>
        {(["png", "pdf"] as const).map((f) => (
          <label
            key={f}
            className={cx(
              "cursor-pointer rounded-full border px-3 py-1.5 text-sm font-medium has-focus-visible:ring-4 has-focus-visible:ring-brand/15",
              format === f ? "border-brand bg-brand-soft text-brand-strong" : "border-line bg-surface hover:bg-brand-soft",
            )}
          >
            <input type="radio" name={`customer-send-${orderId}`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
            {f === "pdf" ? "PDF" : "Image (PNG)"}
          </label>
        ))}
      </fieldset>
      <button
        type="button"
        onClick={cloud ? sendFromServer : openWhatsApp}
        disabled={cloud ? sending : !ready}
        className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-[#1f9d55] px-5 py-2.5 text-base font-semibold text-white shadow-sm shadow-[#1f9d55]/25 transition-colors hover:bg-[#14713c] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {cloud
          ? sending ? "Sending…" : `Send bill and Terms on WhatsApp (${label})`
          : ready ? `Send bill and Terms on WhatsApp (${label})` : `Preparing bill and Terms (${label})…`}
      </button>
      <p className="text-xs text-muted">
        {cloud
          ? "Both go straight to the customer\u2019s WhatsApp chat as files. Nothing opens here; nothing to attach."
          : "Opens WhatsApp with the bill and the Terms already attached. Tap the customer, then Send."}
      </p>
      {done && <Alert tone="ok">{done}</Alert>}
      {error && <Alert tone="warn">{error}</Alert>}
    </div>
  );
}
