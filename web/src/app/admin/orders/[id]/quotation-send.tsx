"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert, Textarea, cx } from "@/components/ui";
import { whatsappLink } from "@/lib/whatsapp";
import { chatOutcomeMessage, openChatWithFile } from "@/lib/share-file";
import { recordQuotationSendAction, sendQuotationNowAction } from "../actions";

type Format = "pdf" | "png";
type Prepared = { file: File; path: string; format: Format };

// "Send Order in msg on WhatsApp" (was "Send quotation") (2026-10-24). With WhatsApp Business (Cloud API) set up for the chosen
// format, one tap and the server sends it (Meta's approved template text goes with the file, not the caption).
// Otherwise, or as a backup, one tap opens the WhatsApp chat of the customer who placed the order, with the
// message filled in and the image copied to paste (a PDF is downloaded to attach; 2026-11-07). The file is made
// fresh on the server first: on the cake sheet as soon as it opens, on the order page with a first tap.
export function QuotationSend({
  orderId,
  phone,
  caption: initialCaption,
  cloudFormats = [],
  defaultFormat,
  fileOnly = false,
}: {
  orderId: string;
  phone: string | null;
  caption: string;
  cloudFormats?: Format[];
  defaultFormat?: Format;
  // Send just the bill file, with no typed message (cake sheet, 2026-10-28).
  fileOnly?: boolean;
}) {
  const what = fileOnly ? "bill" : "Order in msg";
  const router = useRouter();
  const [format, setFormat] = useState<Format>(defaultFormat ?? cloudFormats[0] ?? "pdf");
  const [caption, setCaption] = useState(fileOnly ? "" : initialCaption);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const cloud = Boolean(phone) && cloudFormats.includes(format);

  async function sendNow() {
    setSending(true);
    setError(null);
    setDone(null);
    setPrepared(null);
    const r = await sendQuotationNowAction({ orderId, format }).catch(() => null);
    setSending(false);
    if (r?.ok) {
      setDone(`Sent to the customer on WhatsApp (${format === "pdf" ? "PDF" : "image"}).`);
    } else {
      setError(r?.message ?? "Could not send on WhatsApp. Check the connection and try again.");
    }
    router.refresh();
  }

  async function makeFile(f: Format): Promise<Prepared> {
    const res = await fetch(`/api/orders/${orderId}/quotation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format: f }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; url?: string; path?: string; fileName?: string; contentType?: string };
    if (!res.ok || !data.ok || !data.url || !data.path || !data.fileName) throw new Error(data.message ?? `Could not make the ${what} file.`);
    const blob = await (await fetch(data.url)).blob();
    return { file: new File([blob], data.fileName, { type: data.contentType ?? blob.type }), path: data.path, format: f };
  }

  // The cake sheet makes the bill as soon as it opens, so the first tap opens the customer's chat.
  useEffect(() => {
    if (!fileOnly || !phone) return;
    let cancelled = false;
    makeFile(format)
      .then((made) => !cancelled && setPrepared(made))
      .catch((e: Error) => !cancelled && setError(e.message || `Could not make the ${what} file. Check the connection and reload the page.`));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- makeFile depends only on the order
  }, [format, fileOnly, phone]);

  async function prepare() {
    setBusy(true);
    setError(null);
    setDone(null);
    setChatUrl(null);
    setPrepared(null);
    try {
      setPrepared(await makeFile(format));
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : `Could not make the ${what} file. Check the connection and try again.`);
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!prepared || !phone) return;
    setError(null);
    const { file, path } = prepared;
    const outcome = await openChatWithFile(file, phone, caption);
    setChatUrl(whatsappLink(phone, caption));
    const r = await recordQuotationSendAction({ orderId, format: prepared.format, channel: "download_and_chat", path, caption }).catch(() => null);
    if (!fileOnly) setPrepared(null);
    setDone(chatOutcomeMessage(outcome, what, file.name));
    if (!r?.ok) setError(r?.message ?? "Sent, but not recorded on the order.");
    else router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
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
            <input
              type="radio"
              name="quotation-format"
              value={f}
              checked={format === f}
              onChange={() => {
                setFormat(f);
                setPrepared(null);
              }}
              className="sr-only"
            />
            {f === "pdf" ? "PDF" : "Image (PNG)"}
          </label>
        ))}
      </fieldset>
      {cloud && (
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-brand-soft/40 p-3">
          <button
            type="button"
            onClick={sendNow}
            disabled={sending || busy}
            className="inline-flex items-center justify-center gap-2 self-start rounded-xl bg-[#1f9d55] px-4 py-2 text-sm font-medium text-white shadow-sm shadow-[#1f9d55]/25 transition-colors hover:bg-[#14713c] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {sending ? "Sending on WhatsApp…" : "Send on WhatsApp now"}
          </button>
          <p className="text-xs text-muted">
            Sent straight to the customer from the bakery&rsquo;s WhatsApp Business number, with the approved Order in msg message. No need to open WhatsApp.
          </p>
        </div>
      )}
      {cloud && <p className="text-sm font-medium text-muted">Or send it from this device</p>}
      {!fileOnly && (
        <Textarea
          aria-label="Message sent with the Order in msg"
          rows={Math.min(10, caption.split("\n").length + 1)}
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          maxLength={2000}
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        {prepared ? (
          <button
            type="button"
            onClick={send}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f9d55] px-4 py-2 text-sm font-medium text-white shadow-sm shadow-[#1f9d55]/25 transition-colors hover:bg-[#14713c]"
          >
            Open customer&rsquo;s WhatsApp with the {what}
          </button>
        ) : fileOnly ? (
          <button type="button" disabled className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#1f9d55] px-4 py-2 text-sm font-medium text-white opacity-60">
            {phone ? `Preparing ${format === "pdf" ? "PDF" : "image"}…` : "No WhatsApp number on the order"}
          </button>
        ) : (
          <button
            type="button"
            onClick={prepare}
            disabled={busy || sending || (!fileOnly && !caption.trim())}
            className={cx(
              "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
              cloud
                ? "border border-line bg-surface text-ink hover:bg-brand-soft"
                : "bg-[#1f9d55] text-white shadow-sm shadow-[#1f9d55]/25 hover:bg-[#14713c]",
            )}
          >
            {busy ? `Preparing ${format === "pdf" ? "PDF" : "image"}…` : cloud ? "Share from this device" : `Send ${what} on WhatsApp`}
          </button>
        )}
        <p className="text-xs text-muted">
          {prepared
            ? prepared.format === "png"
              ? "Opens the chat of the customer who placed the order with the image copied: paste and send."
              : "Opens the customer\u2019s chat and downloads the PDF to attach."
            : "The file is made fresh from the order as it is now."}
        </p>
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
