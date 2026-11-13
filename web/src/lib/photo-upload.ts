"use client";

import { browserClient } from "@/lib/supabase/browser";
import { cakePhotoProblem, photoExtension } from "@/lib/custom-cake";

export type PhotoBucket = "product-photos" | "custom-cake-photos";

// Uploads a photo to `<folder>/<random>.<ext>` in the bucket. Returns the object path, or the reason it failed.
export async function uploadPhoto(bucket: PhotoBucket, folder: string, file: File): Promise<{ path: string } | { error: string }> {
  const problem = cakePhotoProblem(file);
  if (problem) return { error: problem };
  const path = `${folder}/${crypto.randomUUID()}.${photoExtension(file.type)}`;
  const { error } = await browserClient().storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
  if (error) return { error: `The photo was not uploaded: ${error.message}` };
  return { path };
}
