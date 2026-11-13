"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, text } from "@/lib/form";
import { rpcError } from "@/lib/orders";
import { getBusinessTimezone } from "@/lib/settings";
import { zonedDayKey } from "@/lib/time";
import type { WindowInput } from "@/lib/capacity";
import type { ActionState } from "@/components/form-status";

const clock = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM.");
const rowSchema = z
  .object({ start: clock, end: clock, max: z.string().trim().regex(/^\d{0,4}$/, "Limits are whole numbers.") })
  .refine((r) => r.end > r.start, { message: "Each window must end after it starts." });

export type WindowRowInput = z.input<typeof rowSchema>;

function toWindows(rows: z.output<typeof rowSchema>[]): WindowInput[] {
  return rows.map((r) => ({ starts_at: r.start, ends_at: r.end, max_orders: r.max === "" ? null : Number(r.max) }));
}

function done(message: string): ActionState {
  revalidatePath("/admin/settings");
  revalidatePath("/admin/orders", "layout");
  return { ok: true, message };
}

export async function saveWeekdayWindows(input: { weekdays: number[]; windows: WindowRowInput[] }): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = z
    .object({ weekdays: z.array(z.number().int().min(0).max(6)).min(1), windows: z.array(rowSchema).max(24) })
    .safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the windows." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pickup_windows", {
    p_weekdays: parsed.data.weekdays,
    p_windows: toWindows(parsed.data.windows),
  });
  if (error) return { message: rpcError(error).message };
  return done(parsed.data.weekdays.length > 1 ? "Windows saved for all days." : "Windows saved.");
}

export async function saveCategoryCaps(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const ids = formData.getAll("category_id").filter((v): v is string => typeof v === "string");
  const upserts: { category_id: string; max_orders: number }[] = [];
  const removals: string[] = [];
  for (const id of ids) {
    if (!z.uuid().safeParse(id).success) return { message: "Invalid category." };
    const value = text(formData, `cap_${id}`);
    if (value === "") removals.push(id);
    else if (/^\d{1,4}$/.test(value)) upserts.push({ category_id: id, max_orders: Number(value) });
    else return { message: "Caps must be whole numbers of 0 or more.", fieldErrors: { [`cap_${id}`]: "Whole number" } };
  }

  const supabase = await createClient();
  if (upserts.length > 0) {
    const { error } = await supabase.from("category_daily_caps").upsert(upserts);
    if (error) return dbError(error, "category cap");
  }
  if (removals.length > 0) {
    const { error } = await supabase.from("category_daily_caps").delete().in("category_id", removals);
    if (error) return dbError(error, "category cap");
  }
  return done("Category caps saved.");
}

const dateOverrideSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("window"),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    note: z.string().trim().min(1, "Give a short note, e.g. Diwali.").max(120),
    windows: z.array(rowSchema).min(1, "Add at least one window.").max(24),
  }),
  z.object({
    kind: z.literal("category"),
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
    note: z.string().trim().min(1, "Give a short note, e.g. Diwali.").max(120),
    categoryId: z.uuid("Choose a category."),
    max: z.string().trim().regex(/^\d{1,4}$/, "Enter a whole number (0 closes the category that day)."),
  }),
]);

export type DateOverrideInput = z.input<typeof dateOverrideSchema>;

export async function addDateOverride(input: DateOverrideInput): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = dateOverrideSchema.safeParse(input);
  if (!parsed.success) return { message: parsed.error.issues[0]?.message ?? "Check the override." };
  const data = parsed.data;
  if (data.onDate < zonedDayKey(new Date(), await getBusinessTimezone())) return { message: "Choose today or a later date." };

  const supabase = await createClient();
  if (data.kind === "window") {
    const { error } = await supabase.rpc("set_date_windows", { p_date: data.onDate, p_note: data.note, p_windows: toWindows(data.windows) });
    if (error) return { message: rpcError(error).message };
  } else {
    const { error } = await supabase.from("capacity_overrides").insert({
      on_date: data.onDate,
      kind: "category",
      category_id: data.categoryId,
      max_orders: Number(data.max),
      note: data.note,
    });
    if (error) return error.code === "23505" ? { message: "That category already has an override on this date." } : dbError(error, "override");
  }
  return done("Date override added.");
}

export async function removeDateOverride(input: { onDate: string; kind: "window" | "category"; id?: string }) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const query = supabase.from("capacity_overrides").delete().eq("on_date", input.onDate).eq("kind", input.kind);
  const { error } = input.kind === "category" && input.id ? await query.eq("id", input.id) : await query;
  if (error) throw new Error(dbError(error, "override").message);
  revalidatePath("/admin/settings");
  revalidatePath("/admin/orders", "layout");
}
