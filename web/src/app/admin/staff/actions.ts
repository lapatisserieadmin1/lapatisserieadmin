"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { checkbox, dbError, text, zodErrors } from "@/lib/form";
import type { ActionState } from "@/components/form-status";

const NO_SECRET_KEY: ActionState = {
  message: "Staff logins need SUPABASE_SECRET_KEY in web/.env.local. Add it and restart the app.",
};

// ---------------------------------------------------------------------------
// Kitchens
// ---------------------------------------------------------------------------

const kitchenSchema = z.object({
  name: z.string().min(1, "Enter a kitchen name.").max(60),
  is_active: z.boolean(),
});

export async function updateKitchen(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = kitchenSchema.safeParse({ name: text(formData, "name"), is_active: checkbox(formData, "is_active") });
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("kitchens").update(parsed.data).eq("id", id);
  if (error) return dbError(error, "kitchen");

  revalidatePath("/admin", "layout");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

// Chefs sign in to the kitchen screen (back on 2026-10-20) and see only their kitchen's orders. One
// kitchen per chef since 2026-10-24 (Kitchen 1: custom orders, Kitchen 2: web orders); the database agrees.
const roleSchema = z.enum(["admin", "counter", "chef"], { error: "Choose a role." });
const password = z.string().min(10, "Use at least 10 characters.").max(72, "Use at most 72 characters.");

function withKitchenRule<T extends { role: string; kitchen_ids: string[] }>(schema: z.ZodType<T>) {
  return schema.refine((v) => v.role !== "chef" || v.kitchen_ids.length === 1, {
    path: ["kitchen_ids"],
    message: "Choose the chef's kitchen.",
  });
}

const updateSchema = withKitchenRule(
  z.object({
    full_name: z.string().min(1, "Enter the staff member's name.").max(80),
    role: roleSchema,
    is_active: z.boolean(),
    kitchen_ids: z.array(z.uuid()),
  }),
);

// Kitchens matter only for chefs; other roles keep none.
function kitchenIds(formData: FormData) {
  if (text(formData, "role") !== "chef") return [];
  return formData.getAll("kitchen_ids").filter((v): v is string => typeof v === "string" && v !== "");
}

export async function updateStaff(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const me = await assertRole(["admin"]);
  const parsed = updateSchema.safeParse({
    full_name: text(formData, "full_name"),
    role: text(formData, "role"),
    is_active: checkbox(formData, "is_active"),
    kitchen_ids: kitchenIds(formData),
  });
  if (!parsed.success) return zodErrors(parsed.error);
  const { full_name, role, is_active, kitchen_ids } = parsed.data;

  if (userId === me.userId && (role !== "admin" || !is_active)) {
    return { message: "You cannot remove your own admin access. Ask another admin." };
  }

  const supabase = await createClient();
  const { data: before } = await supabase.from("staff_profiles").select("is_active").eq("user_id", userId).single();

  const { error } = await supabase.from("staff_profiles").update({ full_name, role, is_active }).eq("user_id", userId);
  if (error) {
    if (error.message.includes("At least one active admin")) {
      return { message: "At least one active admin is required." };
    }
    return dbError(error, "staff member");
  }

  const { data: current } = await supabase.from("staff_kitchens").select("kitchen_id").eq("user_id", userId);
  const currentIds = new Set((current ?? []).map((r) => r.kitchen_id));
  const wanted = new Set(kitchen_ids);
  const toRemove = [...currentIds].filter((id) => !wanted.has(id));
  const toAdd = [...wanted].filter((id) => !currentIds.has(id));
  // Remove first: a chef may have only one kitchen at a time.
  if (toRemove.length) {
    const { error: e } = await supabase.from("staff_kitchens").delete().eq("user_id", userId).in("kitchen_id", toRemove);
    if (e) return dbError(e, "kitchen assignment");
  }
  if (toAdd.length) {
    const { error: e } = await supabase.from("staff_kitchens").insert(toAdd.map((kitchen_id) => ({ user_id: userId, kitchen_id })));
    if (e) return dbError(e, "kitchen assignment");
  }

  // The inactive profile already blocks all data access; banning also stops new sign-ins.
  let note = "";
  if (before && before.is_active !== is_active) {
    if (env.supabaseSecretKey) {
      const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, {
        ban_duration: is_active ? "none" : "876000h",
      });
      if (banError) note = " Access is blocked, but the login could not be locked; check Supabase Auth.";
    } else {
      note = " Access is blocked. Add SUPABASE_SECRET_KEY to also lock the login.";
    }
  }

  revalidatePath("/admin/staff");
  return { ok: true, message: `Saved.${note}` };
}

// Soft delete (2026-10-24): the profile stays so old orders keep the name; the database ends access and
// every session (not yourself, never the last admin), then the login is locked in Supabase Auth.
export async function deleteStaff(userId: string): Promise<ActionState> {
  const me = await assertRole(["admin"]);
  if (!z.uuid().safeParse(userId).success) return { message: "Staff member not found." };
  if (userId === me.userId) return { message: "You cannot delete your own login. Ask another admin." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_staff", { p_user_id: userId });
  if (error) return { message: error.code === "P0001" ? error.message : dbError(error, "staff member").message };

  let note = "";
  if (env.supabaseSecretKey) {
    const { error: banError } = await createAdminClient().auth.admin.updateUserById(userId, { ban_duration: "876000h" });
    if (banError) note = " Access has ended, but the login could not be locked; check Supabase Auth.";
  } else {
    note = " Access has ended. Add SUPABASE_SECRET_KEY to also lock the login.";
  }

  revalidatePath("/admin/staff");
  return { ok: true, message: `Deleted.${note}` };
}

export async function resetStaffPassword(userId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  if (!env.supabaseSecretKey) return NO_SECRET_KEY;

  const parsed = password.safeParse(formData.get("password"));
  if (!parsed.success) return { message: parsed.error.issues[0]?.message, fieldErrors: { password: parsed.error.issues[0]?.message ?? "" } };

  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password: parsed.data });
  if (error) return { message: `Could not reset the password. ${error.message}` };
  return { ok: true, message: "Password reset. Share it with them privately." };
}
