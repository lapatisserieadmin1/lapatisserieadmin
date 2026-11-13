// The "Order in msg" (was "Quotation", renamed 2026-10-28): one model, read from public.order_quotation, drawn three ways — the page,
// the PDF and the PNG. "full" (admin, counter) carries every amount; "kitchen" (chefs) carries none: the
// database leaves the amount keys out, and parseQuotation drops them again so no view can show one.
import { z } from "zod";
import { cakeRows, type CakeInfo } from "./kitchen.ts";
import { formatPaise } from "./money.ts";
import { formatDateTime } from "./time.ts";
import type { CaptionBill } from "./whatsapp.ts";
import { SHOP_ADDRESS, SHOP_NAME } from "./brand.ts";

// The brand palette (globals.css) for the PDF and PNG, which cannot read CSS variables: black on white,
// the drip's pink and teal, chocolate for emphasis.
export const QUOTATION_COLOURS = {
  ink: "#111111", muted: "#6f625c", brand: "#e8838a", brandStrong: "#4a2418", soft: "#fbe4e5", canvas: "#f7f3ee", line: "#eadfd6", gold: "#26c6bc",
};

export type QuotationMode = "full" | "kitchen";
export type LineKind = "cake" | "setup" | "delivery" | "addon" | "item";

export type QuotationLine = {
  lineNo: number;
  name: string;
  variant: string;
  quantity: number;
  kind: LineKind;
  isEggless: boolean;
  notes: string | null;
  unitPricePaise: number | null; // null in kitchen mode
  lineTotalPaise: number | null;
};

export type QuotationAmounts = {
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  creditedPaise: number;
  advancePaise: number;
  balancePaise: number;
};

export type Quotation = {
  mode: QuotationMode;
  timeZone: string;
  shop: { name: string; phone: string | null; email: string | null; address: string | null };
  order: {
    id: string;
    reference: string;
    status: string;
    createdAt: string;
    dueAt: string | null;
    isImmediate: boolean;
    fulfilment: "collect" | "setup";
    setupAddress: string | null;
    setupNote: string | null;
    customerNotes: string | null;
    kitchen: string | null;
  };
  cake: CakeInfo | null;
  lines: QuotationLine[];
  amounts: QuotationAmounts | null; // null in kitchen mode
};

const paise = z.coerce.number().int();
const text = z.string().nullish().transform((v) => (v && v.trim() ? v.trim() : null));
const raw = z.object({
  mode: z.enum(["full", "kitchen"]),
  timezone: z.string().default("Asia/Kolkata"),
  shop: z.object({ name: z.string().default("La Patisserie"), phone: text, email: text, address: text }),
  order: z.object({
    id: z.string(),
    reference: z.string(),
    status: z.string(),
    created_at: z.string(),
    due_at: z.string().nullish(),
    is_immediate: z.boolean().default(false),
    fulfilment: z.enum(["collect", "setup"]).default("collect"),
    setup_address: text,
    setup_note: text,
    customer_notes: text,
    kitchen: text,
  }),
  cake: z.record(z.string(), z.unknown()).nullish(),
  items: z.array(
    z.object({
      line_no: z.number(),
      name: z.string(),
      variant: z.string(),
      quantity: z.number(),
      kind: z.enum(["cake", "setup", "delivery", "addon", "item"]),
      is_eggless: z.boolean().default(false),
      notes: text,
      unit_price_paise: paise.optional(),
      line_total_paise: paise.optional(),
    }),
  ),
  amounts: z
    .object({
      subtotal_paise: paise,
      discount_paise: paise,
      tax_paise: paise,
      total_paise: paise,
      credited_paise: paise,
      advance_paise: paise,
      balance_paise: paise,
    })
    .optional(),
});

export function parseQuotation(value: unknown): Quotation {
  const q = raw.parse(value);
  const full = q.mode === "full";
  if (full && !q.amounts) throw new Error("The Order in msg has no amounts.");
  return {
    mode: q.mode,
    timeZone: q.timezone,
    shop: q.shop,
    order: {
      id: q.order.id,
      reference: q.order.reference,
      status: q.order.status,
      createdAt: q.order.created_at,
      dueAt: q.order.due_at ?? null,
      isImmediate: q.order.is_immediate,
      fulfilment: q.order.fulfilment,
      setupAddress: q.order.setup_address,
      setupNote: q.order.setup_note,
      customerNotes: q.order.customer_notes,
      kitchen: q.order.kitchen,
    },
    cake: (q.cake as CakeInfo | null | undefined) ?? null,
    lines: q.items.map((i) => ({
      lineNo: i.line_no,
      name: i.name,
      variant: i.variant,
      quantity: i.quantity,
      kind: i.kind,
      isEggless: i.is_eggless,
      notes: i.notes,
      unitPricePaise: full ? (i.unit_price_paise ?? 0) : null,
      lineTotalPaise: full ? (i.line_total_paise ?? 0) : null,
    })),
    amounts:
      full && q.amounts
        ? {
            subtotalPaise: q.amounts.subtotal_paise,
            discountPaise: q.amounts.discount_paise,
            taxPaise: q.amounts.tax_paise,
            totalPaise: q.amounts.total_paise,
            creditedPaise: q.amounts.credited_paise,
            advancePaise: q.amounts.advance_paise,
            balancePaise: q.amounts.balance_paise,
          }
        : null,
  };
}

// The kitchen version of any quotation: what /kitchen/quotation shows, whoever opens it.
export function withoutPrices(q: Quotation): Quotation {
  return {
    ...q,
    mode: "kitchen",
    amounts: null,
    lines: q.lines.map((l) => ({ ...l, unitPricePaise: null, lineTotalPaise: null })),
  };
}

// The amounts for the WhatsApp caption; null for the price-free kitchen version. Long item lists end
// with one "Other items" line so the message stays short.
const CAPTION_ITEM_LINES = 8;
export function captionBill(q: Quotation): CaptionBill | null {
  if (q.mode !== "full" || !q.amounts) return null;
  const priced = q.lines.filter((l) => (l.lineTotalPaise ?? 0) > 0 || l.kind === "cake" || l.kind === "item");
  const label = (l: QuotationLine) =>
    l.kind === "setup" || l.kind === "delivery" || l.kind === "addon" ? l.name : `${l.kind === "item" ? `${l.quantity} × ` : ""}${l.name}${l.variant ? ` (${l.variant})` : ""}`;
  const shown = priced.slice(0, CAPTION_ITEM_LINES).map((l) => ({ label: label(l), paise: l.lineTotalPaise ?? 0 }));
  const rest = priced.slice(CAPTION_ITEM_LINES);
  if (rest.length) shown.push({ label: `Other items (${rest.length})`, paise: rest.reduce((s, l) => s + (l.lineTotalPaise ?? 0), 0) });
  return {
    lines: shown,
    discountPaise: q.amounts.discountPaise,
    totalPaise: q.amounts.totalPaise,
    advancePaise: q.amounts.advancePaise,
    balancePaise: q.amounts.balancePaise,
  };
}

// File names never carry the customer's name.
export function quotationFileName(reference: string, format: "pdf" | "png"): string {
  return `LaPatisserieMadras-Order-in-msg-${reference.replace(/[^A-Za-z0-9-]/g, "")}.${format}`;
}

export const LINE_KIND_LABEL: Record<LineKind, string> = { cake: "Custom cake", setup: "Set-up", delivery: "Delivery", addon: "Add on", item: "Item" };

// Everything a quotation shows, already as text, so the three renderers draw the same thing.
export type QuotationView = {
  priced: boolean;
  title: string;
  shopName: string;
  shopContact: string[];
  facts: { label: string; value: string }[];
  cake: { label: string; value: string }[];
  lines: { key: number; title: string; detail: string | null; quantity: string; unit: string | null; total: string | null }[];
  totals: { label: string; value: string; strong?: boolean }[];
  notes: { label: string; value: string }[];
};

export function quotationView(q: Quotation): QuotationView {
  const tz = q.timeZone;
  const priced = q.mode === "full" && q.amounts !== null;
  const facts = [
    { label: "Order no.", value: q.order.reference },
    {
      label: q.order.fulfilment === "setup" ? "Set-up date & time" : "Pickup date & time",
      value: q.order.dueAt ? formatDateTime(q.order.dueAt, tz) : "To be confirmed",
    },
    {
      label: "Venue",
      value: q.order.fulfilment === "setup"
        ? (q.order.setupAddress ?? "To be confirmed")
        : q.order.setupAddress ? `Pickup/Cab · Cab to: ${q.order.setupAddress}` : "Pickup/Cab",
    },
  ];
  if (!priced && q.order.kitchen) facts.push({ label: "Kitchen", value: q.order.kitchen });

  const lines = q.lines.map((l) => ({
    key: l.lineNo,
    title: l.kind === "setup" || l.kind === "delivery" || l.kind === "addon" ? `${LINE_KIND_LABEL[l.kind]} — ${l.variant}` : `${l.name} — ${l.variant}`,
    detail: [l.isEggless ? "Eggless" : null, l.notes].filter(Boolean).join(" · ") || null,
    quantity: String(l.quantity),
    unit: priced && l.unitPricePaise !== null ? formatPaise(l.unitPricePaise) : null,
    total: priced && l.lineTotalPaise !== null ? formatPaise(l.lineTotalPaise) : null,
  }));

  const totals: QuotationView["totals"] = [];
  const a = priced ? q.amounts : null;
  if (a) {
    if (a.discountPaise > 0) {
      totals.push({ label: "Subtotal", value: formatPaise(a.subtotalPaise) });
      totals.push({ label: "Discount", value: `−${formatPaise(a.discountPaise)}` });
    }
    totals.push({ label: "Total", value: formatPaise(a.totalPaise), strong: true });
    if (a.creditedPaise > 0) totals.push({ label: "Credited", value: `−${formatPaise(a.creditedPaise)}` });
    totals.push({ label: "Advance paid", value: formatPaise(a.advancePaise) });
    totals.push({ label: a.balancePaise < 0 ? "Refund due" : "Balance", value: formatPaise(Math.abs(a.balancePaise)), strong: true });
  }

  const notes: { label: string; value: string }[] = [];
  if (q.order.setupNote) notes.push({ label: "Landmark", value: q.order.setupNote });
  if (q.order.customerNotes) notes.push({ label: "Notes", value: q.order.customerNotes });

  return {
    priced,
    title: priced ? "Order in msg" : "Order in msg (kitchen)",
    shopName: SHOP_NAME,
    shopContact: [SHOP_ADDRESS, q.shop.phone, q.shop.email].filter((v): v is string => Boolean(v)),
    facts,
    cake: q.cake ? cakeRows(q.cake) : [],
    lines,
    totals,
    notes,
  };
}
