// WhatsApp messages to customers (owner, 2026-10-19): ready-made texts that staff open in WhatsApp
// (click-to-chat) and send themselves. Pure: imported by unit tests, so keep any imports from "@/" type-only.
import { formatDateTime } from "./time.ts";
import type { Enums } from "./database.types";

export type MessageKind = "received" | "confirmed" | "ready" | "balance" | "thanks";

export const MESSAGE_LABEL: Record<MessageKind, string> = {
  received: "Order received",
  confirmed: "Order confirmed",
  ready: "Ready",
  balance: "Balance reminder",
  thanks: "Thank you + review",
};

// No customer name: every message greets "Sir / Madam" (owner, 2026-10-24).
export type MessageOrder = {
  reference: string;
  status: Enums<"order_status">;
  fulfilment: Enums<"fulfilment_type">;
  setupAddress: string | null;
  dueAt: string | null;
  totalPaise: number;
  balancePaise: number;
  items: { name: string; quantity: number }[];
  // The order's sticky note when "Include in WhatsApp message" is on, else null.
  note?: string | null;
};

export const GREETING = "Hello Sir / Madam!";

export type MessageContext = { shop: string; timeZone: string; reviewUrl: string };

// A number WhatsApp accepts: digits with the country code. Indian 10-digit numbers get 91. Null if unusable.
export function whatsappNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

export function whatsappLink(phone: string, text: string): string {
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}


// Which messages fit the order now, most likely first. Cancelled and rejected orders get none: staff call.
export function availableMessages(o: Pick<MessageOrder, "status" | "balancePaise">): MessageKind[] {
  const balance: MessageKind[] = o.balancePaise > 0 ? ["balance"] : [];
  switch (o.status) {
    case "draft":
    case "pending_confirmation":
      return ["received"];
    case "confirmed":
    case "preparing":
      return ["confirmed", ...balance];
    case "ready":
      return ["ready", ...balance];
    case "completed":
      return ["thanks", ...balance];
    default:
      return [];
  }
}

function rupees(paise: number): string {
  const value = paise / 100;
  return "₹" + value.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(value) ? 0 : 2, maximumFractionDigits: 2 });
}

function itemLines(items: MessageOrder["items"]): string {
  const shown = items.slice(0, 8).map((i) => `• ${i.quantity} × ${i.name}`);
  if (items.length > 8) shown.push(`• and ${items.length - 8} more`);
  return shown.join("\n");
}

export function messageText(kind: MessageKind, o: MessageOrder, ctx: MessageContext): string {
  return withNote(baseText(kind, o, ctx), o.note);
}

function withNote(text: string, note: string | null | undefined): string {
  const n = note?.trim();
  return n ? `${text}\n\nNote: ${n}` : text;
}

// The bill written under the quotation caption (owner, 2026-10-24): each charge (cake, items, set-up,
// delivery), then total, advance and balance. Amounts in paise.
export type CaptionBill = {
  lines: { label: string; paise: number }[];
  discountPaise: number;
  totalPaise: number;
  advancePaise: number;
  balancePaise: number;
};

function billText(b: CaptionBill): string {
  return [
    ...b.lines.map((l) => `${l.label}: ${rupees(l.paise)}`),
    b.discountPaise > 0 ? `Discount: −${rupees(b.discountPaise)}` : null,
    `*Total: ${rupees(b.totalPaise)}*`,
    `Advance paid: ${rupees(b.advancePaise)}`,
    b.balancePaise < 0 ? `Refund due: ${rupees(-b.balancePaise)}` : b.balancePaise > 0 ? `*Balance to pay: ${rupees(b.balancePaise)}*` : "Fully paid ✅",
  ].filter(Boolean).join("\n");
}

// The caption sent with the quotation file. Staff can edit it before sending.
export function quotationCaption(o: { reference: string; note?: string | null; bill?: CaptionBill | null }, shop: string): string {
  const bill = o.bill ? `\n\n${billText(o.bill)}` : "";
  return withNote(`${GREETING}\nPlease find attached the order in msg for your order ${o.reference}.${bill}\n\n— ${shop}`, o.note);
}

function baseText(kind: MessageKind, o: MessageOrder, ctx: MessageContext): string {
  const hello = GREETING;
  const when = o.dueAt ? formatDateTime(o.dueAt, ctx.timeZone) : null;
  const setup = o.fulfilment === "setup";
  const where = setup ? `Set-up at ${o.setupAddress ?? "your place"}` : `Pickup at ${ctx.shop}`;
  const items = itemLines(o.items);
  const toPay = o.balancePaise > 0 ? `Balance to pay: ${rupees(o.balancePaise)}` : "Fully paid ✅";

  switch (kind) {
    case "received":
      return [
        `${hello} 🎂 Thank you for your order ${o.reference} with ${ctx.shop}.`,
        items,
        `We have received it and will confirm it shortly.${when ? `\n${setup ? "Set-up" : "Pickup"} requested: ${when}` : ""}`,
      ].filter(Boolean).join("\n\n");
    case "confirmed":
      return [
        `${hello} ✅ Your order ${o.reference} is confirmed.`,
        items,
        [when ? `${where}: ${when}` : where, `Total: ${rupees(o.totalPaise)}`, toPay].join("\n"),
        `Thank you for choosing ${ctx.shop}!`,
      ].filter(Boolean).join("\n\n");
    case "ready":
      return setup
        ? `${hello} 🎉 Your order ${o.reference} is ready. We will be at ${o.setupAddress ?? "your place"}${when ? ` on ${when}` : ""} to set it up.\n\n${toPay}`
        : `${hello} 🎉 Your order ${o.reference} is ready for pickup at ${ctx.shop}.\n\n${toPay}\n\nSee you soon!`;
    case "balance":
      return `${hello} A gentle reminder: ${rupees(o.balancePaise)} is still to be paid for your order ${o.reference}${when ? ` (${when})` : ""}. You can pay at the store, or reply here for our payment details. Thank you!`;
    case "thanks":
      return `${hello} 💖 Thank you for choosing ${ctx.shop}. We hope you loved your order ${o.reference}!\n\nWe would be grateful for a review: ${ctx.reviewUrl}`;
  }
}
