import type { PostgrestError } from "@supabase/supabase-js";
import type { z } from "zod";
import type { ActionState } from "@/components/form-status";

export function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function optionalText(formData: FormData, name: string): string | null {
  return text(formData, name) || null;
}

export function zodErrors(error: z.ZodError): ActionState {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return { message: "Please fix the highlighted fields.", fieldErrors };
}

// Turns database errors into messages staff can act on.
export function dbError(error: PostgrestError, what = "record"): ActionState {
  switch (error.code) {
    case "23505":
      return { message: `A ${what} with that name already exists.` };
    case "23503":
      return { message: `This ${what} is linked to other records and cannot be changed that way.` };
    case "23514":
      return { message: `Some values are not allowed for this ${what}. Check the fields and try again.` };
    case "42501":
      return { message: "You do not have permission to do this." };
    default:
      return { message: `Could not save the ${what}. ${error.message}` };
  }
}
