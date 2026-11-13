"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getStaff, homeFor } from "@/lib/auth";
import { resetRedirectUrl, trustedOrigin } from "@/lib/password-reset";
import type { ActionState } from "@/components/form-status";

const emailSchema = z.email("Enter a valid email address.");

// Never built from the request's Host header alone (password-reset poisoning); see trustedOrigin.
async function siteOrigin() {
  const h = await headers();
  return trustedOrigin(process.env.SITE_URL, h.get("host"), process.env.NODE_ENV !== "production");
}

// Emails a reset link. Says the same thing whether or not the email has a login, so the page cannot be
// used to find out who works here.
export async function requestPasswordReset(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = emailSchema.safeParse(String(formData.get("email") ?? "").trim().toLowerCase());
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: resetRedirectUrl(await siteOrigin()) });
  if (error && error.status === 429) {
    return { message: "Too many reset emails were sent. Wait a few minutes and try again." };
  }
  if (error) console.error("resetPasswordForEmail failed", error.status, error.message);
  return {
    ok: true,
    message: "If that email has a staff login, a reset link is on its way. Check your inbox and spam folder; the link works once, for one hour.",
  };
}

const newPasswordSchema = z
  .object({
    password: z.string().min(10, "Use at least 10 characters.").max(72, "Use at most 72 characters."),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "The two passwords do not match." });

// Sets the new password for the person the reset link signed in, then takes them to their screen.
export async function setNewPassword(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = newPasswordSchema.safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });
  if (!parsed.success) return { message: parsed.error.issues[0]?.message };

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { message: "This reset link has expired. Ask for a new one on the sign-in page." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    return { message: error.code === "same_password" ? "Choose a password different from the old one." : `Could not save the password. ${error.message}` };
  }
  const staff = await getStaff();
  if (!staff) {
    await supabase.auth.signOut({ scope: "local" });
    redirect("/login");
  }
  redirect(homeFor(staff.role));
}
