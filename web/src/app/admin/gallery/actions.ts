"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkbox, dbError, text, zodErrors } from "@/lib/form";
import { GALLERY_MAX_UPLOAD, GALLERY_PHOTO_FOLDER, galleryPhotoSchema, isGalleryPhotoUrl } from "@/lib/gallery";
import { productPhotoPath } from "@/lib/product-photo";
import type { ActionState } from "@/components/form-status";

// Admins only (row-level security agrees). The browser has already uploaded the photos to Storage.
export async function addGalleryPhotos(urls: string[]): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = z.array(z.string().max(500).refine(isGalleryPhotoUrl)).min(1).max(GALLERY_MAX_UPLOAD).safeParse(urls);
  if (!parsed.success) return { message: "Upload the photos again." };
  const supabase = await createClient();
  const { error } = await supabase.from("gallery_photos").insert(parsed.data.map((image_url) => ({ image_url })));
  if (error) return dbError(error, "photo");
  revalidatePath("/admin/gallery");
  return { ok: true, message: `Added ${parsed.data.length} photo${parsed.data.length === 1 ? "" : "s"}. The website shows them within 5 minutes.` };
}

export async function saveGalleryPhoto(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = galleryPhotoSchema.safeParse({
    caption: text(formData, "caption"),
    sort_order: text(formData, "sort_order") || "0",
    is_active: checkbox(formData, "is_active"),
  });
  if (!parsed.success) return zodErrors(parsed.error);
  const supabase = await createClient();
  const { error } = await supabase.from("gallery_photos").update(parsed.data).eq("id", z.uuid().parse(id));
  if (error) return dbError(error, "photo");
  revalidatePath("/admin/gallery");
  return { ok: true, message: "Saved." };
}

export async function deleteGalleryPhoto(id: string) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const photoId = z.uuid().parse(id);
  const { data: before } = await supabase.from("gallery_photos").select("image_url").eq("id", photoId).maybeSingle();
  const { error } = await supabase.from("gallery_photos").delete().eq("id", photoId);
  if (error) throw new Error(error.message);
  const path = productPhotoPath(before?.image_url);
  if (path?.startsWith(`${GALLERY_PHOTO_FOLDER}/`)) await supabase.storage.from("product-photos").remove([path]);
  revalidatePath("/admin/gallery");
}
