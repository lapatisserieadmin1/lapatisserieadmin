import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Enums } from "@/lib/database.types";

export type StaffRole = Enums<"staff_role">;

export type Staff = {
  userId: string;
  sessionId: string | null; // Supabase login session
  email: string | null;
  fullName: string;
  role: StaffRole;
};

// The signed-in, active staff member for this request, or null.
export const getStaff = cache(async (): Promise<Staff | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;

  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("full_name, role, is_active")
    .eq("user_id", claims.sub)
    .maybeSingle();
  if (!profile || !profile.is_active) return null;

  return {
    userId: claims.sub,
    sessionId: typeof claims.session_id === "string" ? claims.session_id : null,
    email: typeof claims.email === "string" ? claims.email : null,
    fullName: profile.full_name,
    role: profile.role,
  };
});

export const HOME_PATH = "/admin";
export const KITCHEN_PATH = "/kitchen";

// Where a staff member lands after signing in: chefs have only the kitchen screen.
export function homeFor(role: StaffRole): string {
  return role === "chef" ? KITCHEN_PATH : HOME_PATH;
}

// For pages and layouts: redirects when the visitor lacks one of the allowed roles.
export async function requireRole(allowed: StaffRole[]): Promise<Staff> {
  const staff = await getStaff();
  if (!staff) redirect("/login");
  if (!allowed.includes(staff.role)) redirect(homeFor(staff.role));
  return staff;
}

// For server actions: returns the staff member or throws; never trust the page that rendered the form.
export async function assertRole(allowed: StaffRole[]): Promise<Staff> {
  const staff = await getStaff();
  if (!staff || !allowed.includes(staff.role)) {
    throw new Error("You do not have permission to do this.");
  }
  return staff;
}
