// Orders sent from the public website (2026-10-16). Pure: imported by unit tests, so keep any imports
// from "@/" type-only. The database (submit_website_order) checks everything again.
import { z } from "zod";
import { zonedLocalToDate } from "./time.ts";

export const ORDER_TYPES = ["birthday", "wedding", "custom", "macarons", "pastries", "other"] as const;

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const websiteOrderSchema = z.object({
  idempotencyKey: z.uuid("Please reload the page and try again."),
  name: z.string().trim().min(1, "Please enter your name.").max(80, "Please keep your name under 80 characters."),
  phone: z.string().trim().min(10, "Please enter a valid phone number.").max(20, "Please enter a valid phone number."),
  email: z.preprocess(blankToUndefined, z.email("Please enter a valid email address.").max(120).optional()),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Please choose a pickup date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Please choose a pickup time."),
  orderType: z.preprocess(blankToUndefined, z.enum(ORDER_TYPES).optional()),
  message: z.preprocess(blankToUndefined, z.string().trim().max(800, "Please keep your message under 800 characters.").optional()),
  items: z
    .array(z.object({ variantId: z.uuid(), quantity: z.number().int().min(1).max(50) }))
    .max(10, "An online order can have at most 10 items.")
    .default([]),
  fulfilment: z.enum(["collect", "setup"]).default("collect"),
  setupAddress: z.preprocess(blankToUndefined, z.string().trim().max(300, "Please keep the address under 300 characters.").optional()),
  setupNote: z.preprocess(blankToUndefined, z.string().trim().max(300, "Please keep the landmark under 300 characters.").optional()),
  // Hidden field people never see; bots fill it in.
  website: z.string().optional(),
});

export type WebsiteOrder = z.infer<typeof websiteOrderSchema>;

export type SubmitArgs = {
  p_idempotency_key: string;
  p_name: string;
  p_phone: string;
  p_due_at: string;
  p_message: string | null;
  p_order_type: string | null;
  p_email: string | null;
  p_items: { variant_id: string; quantity: number }[];
  p_fulfilment: "collect" | "setup";
  p_setup_address: string | null;
  p_setup_note: string | null;
};

// Arguments for public.submit_website_order, or the message to show the customer.
export function submitArgs(order: WebsiteOrder, timeZone: string): { args: SubmitArgs } | { error: string } {
  const due = zonedLocalToDate(`${order.date}T${order.time}`, timeZone);
  if (!due || Number.isNaN(due.getTime())) return { error: "Please choose a pickup date and time." };
  if (!order.message && order.items.length === 0) return { error: "Please tell us what you would like to order." };
  if (order.fulfilment === "setup" && !order.setupAddress) return { error: "Please enter the address where we should set up." };
  return {
    args: {
      p_idempotency_key: order.idempotencyKey,
      p_name: order.name,
      p_phone: order.phone,
      p_due_at: due.toISOString(),
      p_message: order.message ?? null,
      p_order_type: order.orderType ?? null,
      p_email: order.email ?? null,
      p_items: order.items.map((i) => ({ variant_id: i.variantId, quantity: i.quantity })),
      p_fulfilment: order.fulfilment,
      p_setup_address: order.setupAddress ?? null,
      p_setup_note: order.setupNote ?? null,
    },
  };
}

// Whether a product is listed on the website's menu. Mirrors the filter in public.website_catalogue():
// not archived, available, in a shown category, with at least one available size (2026-10-20).
export type MenuCheck = {
  archived: boolean;
  isAvailable: boolean;
  categoryActive: boolean;
  variants: { archived: boolean; isAvailable: boolean }[];
};

export function websiteMenuStatus(p: MenuCheck): { shown: true } | { shown: false; reason: string } {
  if (p.archived) return { shown: false, reason: "It is archived." };
  if (!p.isAvailable) return { shown: false, reason: "It is marked unavailable." };
  if (!p.categoryActive) return { shown: false, reason: "Its category is hidden." };
  const live = p.variants.filter((v) => !v.archived);
  if (live.length === 0) return { shown: false, reason: "It has no size and price yet. Add one below." };
  if (!live.some((v) => v.isAvailable)) return { shown: false, reason: "None of its sizes are available." };
  return { shown: true };
}
