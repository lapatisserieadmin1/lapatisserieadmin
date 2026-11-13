"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, cx } from "@/components/ui";
import { whatsappLink } from "@/lib/whatsapp";
import { chatOutcomeMessage, openChatWithFile } from "@/lib/share-file";
import { sendTermsAction } from "@/app/admin/orders/actions";

type Format = "pdf" | "png";

function WhatsAppIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

// The Terms and Conditions for a cake order (owner, 2026-11-07): sent to the customer's WhatsApp as a file,
// image or PDF as staff choose, never as a link. The file is made as soon as the page opens, so one tap opens
// the chat of the customer who placed the order with the image copied to paste (a PDF is downloaded to attach).
// With WhatsApp Business set up, the server sends both files itself (automatically for cake orders on confirming).
export function TermsPanel({ orderId, reference, phone, cloud, testMode = false }: {
  orderId: string;
  reference: string;
  phone: string | null;
  cloud: boolean;
  testMode?: boolean;
}) {
  const router = useRouter();
  const [format, setFormat] = useState<Format>("png");
  const [files, setFiles] = useState<Partial<Record<Format, File>>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const url = (f: Format) => `/api/terms?${new URLSearchParams({ format: f, ref: reference })}`;
  const button = "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";
  const green = "bg-[#1f9d55] text-white shadow-sm shadow-[#1f9d55]/25 hover:bg-[#14713c]";
  const label = format === "pdf" ? "PDF" : "image";
  const file = files[format] ?? null;
  const preparing = Boolean(phone) && !file && !error;

  useEffect(() => {
    if (!phone || files[format]) return;
    let cancelled = false;
    fetch(url(format))
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (cancelled) return;
        const made = new File([blob], `LaPatisserieMadras-Terms-${reference}.${format}`, { type: format === "pdf" ? "application/pdf" : "image/png" });
        setFiles((prev) => ({ ...prev, [format]: made }));
      })
      .catch(() => !cancelled && setError("Could not make the Terms file. Check the connection and reload the page."));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- url() depends only on format and reference
  }, [format, reference, phone]);

  async function shareNow() {
    if (!file || !phone) return;
    setError(null);
    const outcome = await openChatWithFile(file, phone);
    setChatUrl(whatsappLink(phone, ""));
    setDone(chatOutcomeMessage(outcome, "Terms", file.name));
  }

  async function sendNow() {
    setSending(true);
    setError(null);
    setDone(null);
    setChatUrl(null);
    const r = await sendTermsAction({ orderId }).catch(() => null);
    setSending(false);
    if (r?.ok) {
      setDone(testMode
        ? "Sent to the local WhatsApp test phone (PDF and image). Open http://localhost:4010 to see it; the ticks update here."
        : "Sent to the customer's WhatsApp (PDF and image). The ticks update when WhatsApp reports delivered and read.");
      // WhatsApp reports delivered and read a few seconds later, through the webhook.
      for (const ms of [2500, 6000]) setTimeout(() => router.refresh(), ms);
    } else setError(r?.message ?? "Could not send on WhatsApp. Check the connection and try again.");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {testMode && (
        <Alert tone="warn" title="WhatsApp test mode">
          Sends go to the local WhatsApp test phone at http://localhost:4010, never to the customer.
        </Alert>
      )}
      {phone ? (
        <>
          {cloud && (
            <div className="flex flex-col gap-2 rounded-xl border border-line bg-brand-soft/40 p-3">
              <button type="button" onClick={sendNow} disabled={sending} className={cx(button, green, "self-start")}>
                <WhatsAppIcon />
                {sending ? "Sending…" : "Send Terms on WhatsApp now"}
              </button>
              <p className="text-xs text-muted">Sent straight to the customer&rsquo;s saved number as a PDF and an image. No need to open WhatsApp.</p>
            </div>
          )}
          {cloud && <p className="text-sm font-medium text-muted">Or send it from this device</p>}
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
                <input type="radio" name={`terms-format-${orderId}`} value={f} checked={format === f} onChange={() => setFormat(f)} className="sr-only" />
                {f === "pdf" ? "PDF" : "Image (PNG)"}
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={shareNow} disabled={!file} className={cx(button, cloud ? "border border-line bg-surface text-ink hover:bg-brand-soft" : green)}>
              <WhatsAppIcon />
              {preparing ? `Preparing ${label}…` : "Open customer's WhatsApp with the Terms"}
            </button>
            <p className="text-xs text-muted">{format === "png" ? "Opens the chat of the customer who placed the order with the image copied: paste and send." : "Opens the customer\u2019s chat and downloads the PDF to attach."}</p>
          </div>
        </>
      ) : (
        <p className="text-sm text-muted">Add the customer&rsquo;s phone number to send the Terms on WhatsApp.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">Download</span>
        <a href={url("pdf")} download className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-brand-strong hover:bg-brand-soft">PDF</a>
        <a href={url("png")} download className="rounded-full border border-line px-3 py-1.5 text-sm font-medium text-brand-strong hover:bg-brand-soft">Image (PNG)</a>
      </div>
      {done && <Alert tone="ok">{done}</Alert>}
      {chatUrl && (
        <a href={chatUrl} target="_blank" rel="noreferrer" className="self-start text-sm font-medium text-brand-strong underline-offset-2 hover:underline">
          WhatsApp did not open? Open the customer&rsquo;s chat →
        </a>
      )}
      {error && <Alert tone="warn">{error}</Alert>}
    </div>
  );
}
