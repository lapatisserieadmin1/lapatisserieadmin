"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbError, optionalText, text, zodErrors } from "@/lib/form";
import type { ActionState } from "@/components/form-status";

const schema = z.object({
  business_name: z.string().min(1, "Enter the business name.").max(80),
  phone: z.string().max(20).nullable(),
  email: z.email("Enter a valid email address.").nullable(),
  bill_prefix: z.string().regex(/^[A-Z0-9]{1,6}$/, "Use 1 to 6 capital letters or digits."),
  counter_discount_limit_bps: z.number({ error: "Enter a percentage." }).int().min(0).max(10000, "Maximum is 100%."),
  custom_cake_hsn_code: z.string().regex(/^\d{4,8}$/, "HSN code is 4 to 8 digits.").nullable(),
});

export async function updateSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = schema.safeParse({
    business_name: text(formData, "business_name"),
    phone: optionalText(formData, "phone"),
    email: optionalText(formData, "email"),
    bill_prefix: text(formData, "bill_prefix").toUpperCase(),
    counter_discount_limit_bps: /^\d+(\.\d{1,2})?$/.test(text(formData, "counter_discount_limit"))
      ? Math.round(Number(text(formData, "counter_discount_limit")) * 100)
      : NaN,
    custom_cake_hsn_code: optionalText(formData, "custom_cake_hsn_code")?.replace(/\s/g, "") ?? null,
  });
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("business_settings").update(parsed.data).eq("id", true);
  if (error) return dbError(error, "settings");

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Settings saved." };
}

const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:MM.");

export async function updateHours(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const rows = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    const parsed = z
      .object({ opens_at: time, closes_at: time, is_closed: z.boolean() })
      .refine((r) => r.is_closed || r.closes_at > r.opens_at, { message: "Closing time must be after opening time." })
      .safeParse({
        opens_at: text(formData, `opens_${weekday}`),
        closes_at: text(formData, `closes_${weekday}`),
        is_closed: formData.get(`closed_${weekday}`) === "on",
      });
    if (!parsed.success) return { message: parsed.error.issues[0]?.message, fieldErrors: { [`day_${weekday}`]: parsed.error.issues[0]?.message ?? "" } };
    // Closed days keep a valid time range so the table constraint holds.
    const row = parsed.data.is_closed && parsed.data.closes_at <= parsed.data.opens_at
      ? { ...parsed.data, opens_at: "09:00", closes_at: "21:00" }
      : parsed.data;
    rows.push({ weekday, ...row });
  }

  const supabase = await createClient();
  for (const { weekday, ...row } of rows) {
    const { error } = await supabase.from("business_hours").update(row).eq("weekday", weekday);
    if (error) return dbError(error, "opening hours");
  }
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Opening hours saved." };
}

export async function addClosure(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = z
    .object({
      closed_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
      reason: z.string().min(1, "Give a reason, e.g. Diwali.").max(120),
    })
    .safeParse({ closed_on: text(formData, "closed_on"), reason: text(formData, "reason") });
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("closures").insert(parsed.data);
  if (error) return error.code === "23505" ? { message: "That date is already marked closed." } : dbError(error, "closure");
  revalidatePath("/admin", "layout");
  return { ok: true, message: "Closure added." };
}

export async function removeClosure(closedOn: string) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.from("closures").delete().eq("closed_on", closedOn);
  if (error) throw new Error(dbError(error, "closure").message);
  revalidatePath("/admin", "layout");
}
