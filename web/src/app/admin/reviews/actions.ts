"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

const idSchema = z.uuid();
const statusSchema = z.enum(["pending", "approved", "hidden"]);

// Admins only (row-level security agrees). Approved reviews show on the website.
export async function setReviewStatus(id: string, status: string) {
  await assertRole(["admin"]);
  const parsedId = idSchema.parse(id);
  const parsedStatus = statusSchema.parse(status);
  const supabase = await createClient();
  const { error } = await supabase.from("reviews").update({ status: parsedStatus }).eq("id", parsedId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin", "layout");
}

export async function deleteReview(id: string) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase.from("reviews").delete().eq("id", idSchema.parse(id));
  if (error) throw new Error(error.message);
  revalidatePath("/admin", "layout");
}
