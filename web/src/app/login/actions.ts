"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { homeFor } from "@/lib/auth";
import type { ActionState } from "@/components/form-status";

const schema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
  next: z.string().optional(),
});

// Only allow redirects back into the staff area; chefs only into the kitchen screen.
function safeNext(next: string | undefined, role: string) {
  const area = role === "chef" ? /^\/kitchen(\/|$)/ : /^\/(admin|print|kitchen)(\/|$)/;
  return next && area.test(next) ? next : null;
}

export async function signIn(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { message: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error || !data.user) {
    return { message: "Email or password is incorrect." };
  }

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("role, is_active")
    .eq("user_id", data.user.id)
    .maybeSingle();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    return { message: "This account does not have active staff access. Ask an admin." };
  }
  redirect(safeNext(parsed.data.next, profile.role) ?? homeFor(profile.role));
}

export async function signOut() {
  const supabase = await createClient();
  // This device only.
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
