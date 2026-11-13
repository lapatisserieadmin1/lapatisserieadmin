"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkbox, dbError, optionalText, text, zodErrors } from "@/lib/form";
import { parseRupeesToPaise } from "@/lib/money";
import type { ActionState } from "@/components/form-status";
import { productPhotoPath } from "@/lib/product-photo";

const uuid = z.uuid("Choose a valid option.");

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const categorySchema = z.object({
  name: z.string().min(1, "Enter a category name.").max(60, "Keep the name under 60 characters."),
  sort_order: z.coerce.number().int().min(0).max(9999),
  is_active: z.boolean(),
});

function readCategory(formData: FormData) {
  return categorySchema.safeParse({
    name: text(formData, "name"),
    sort_order: text(formData, "sort_order") || "0",
    is_active: checkbox(formData, "is_active"),
  });
}

export async function createCategory(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readCategory(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert(parsed.data);
  if (error) return dbError(error, "category");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: `Added “${parsed.data.name}”.` };
}

export async function updateCategory(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readCategory(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("categories").update(parsed.data).eq("id", id);
  if (error) return dbError(error, "category");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Saved." };
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

const productSchema = z.object({
  name: z.string().min(1, "Enter a product name.").max(100, "Keep the name under 100 characters."),
  category_id: uuid,
  description: z.string().max(2000).nullable(),
  prep_type: z.enum(["made_to_order", "ready_stock"]),
  contains_egg: z.boolean(),
  hsn_code: z
    .string()
    .regex(/^\d{4,8}$/, "HSN code is 4 to 8 digits.")
    .nullable(),
  // GST was removed (2026-10-28): the price is the total.
  tax_rate_bps: z.literal(0),
  is_available: z.boolean(),
});

function readProduct(formData: FormData) {
  return productSchema.safeParse({
    name: text(formData, "name"),
    category_id: text(formData, "category_id"),
    description: optionalText(formData, "description"),
    prep_type: text(formData, "prep_type"),
    contains_egg: checkbox(formData, "contains_egg"),
    hsn_code: optionalText(formData, "hsn_code"),
    tax_rate_bps: 0,
    is_available: checkbox(formData, "is_available"),
  });
}

export async function createProduct(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readProduct(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase.from("products").insert(parsed.data).select("id").single();
  if (error) return dbError(error, "product");

  revalidatePath("/admin/products");
  redirect(`/admin/products/${data.id}?created=1`);
}

export async function updateProduct(id: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readProduct(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("products").update(parsed.data).eq("id", id);
  if (error) return dbError(error, "product");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Product saved." };
}

export async function setProductArchived(id: string, archived: boolean) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", id);
  if (error) throw new Error(dbError(error, "product").message);
  revalidatePath("/admin/products", "layout");
}

// Delete for good (owner, 2026-10-24), with its sizes and photo. Old orders keep the name and price.
export async function deleteProductAction(id: string): Promise<ActionState> {
  await assertRole(["admin"]);
  if (!uuid.safeParse(id).success) return { message: "Invalid product." };
  const supabase = await createClient();
  const { data: product } = await supabase.from("products").select("image_url").eq("id", id).maybeSingle();
  const { error } = await supabase.rpc("delete_product", { p_product_id: id });
  if (error) return { message: error.code === "P0001" ? error.message : dbError(error, "product").message };
  const path = productPhotoPath(product?.image_url);
  if (path) await supabase.storage.from("product-photos").remove([path]);
  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Product deleted." };
}

// Which kitchen makes the product: stored on every size, so orders keep it (chef screen, 2026-10-20).
export async function setProductKitchen(productId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const raw = text(formData, "kitchen_id");
  const parsed = z.union([z.literal("").transform(() => null), uuid]).safeParse(raw);
  if (!parsed.success) return { message: "Choose a kitchen." };

  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").update({ kitchen_id: parsed.data }).eq("product_id", productId);
  if (error) return dbError(error, "kitchen");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Saved. New orders go to this kitchen; orders already taken keep theirs." };
}

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const variantSchema = z.object({
  name: z.string().min(1, "Enter a variant name, e.g. 500 g or Regular.").max(60),
  price_paise: z.number({ error: "Enter a price in rupees, e.g. 450 or 450.50." }).int().min(0),
  lead_time_minutes: z
    .number({ error: "Enter the lead time in hours and minutes." })
    .int()
    .min(0)
    .max(43200, "Lead time cannot exceed 30 days."),
  is_eggless: z.boolean(),
  is_available: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(9999),
});

function readVariant(formData: FormData) {
  const hours = Number(text(formData, "lead_hours") || "0");
  const minutes = Number(text(formData, "lead_minutes") || "0");
  const lead =
    Number.isInteger(hours) && Number.isInteger(minutes) && hours >= 0 && minutes >= 0 && minutes < 60
      ? hours * 60 + minutes
      : NaN;
  return variantSchema.safeParse({
    name: text(formData, "name"),
    price_paise: parseRupeesToPaise(text(formData, "price")) ?? NaN,
    lead_time_minutes: lead,
    is_eggless: checkbox(formData, "is_eggless"),
    is_available: checkbox(formData, "is_available"),
    sort_order: text(formData, "sort_order") || "0",
  });
}

export async function createVariant(productId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readVariant(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  // A new size goes to the same kitchen as the product's other sizes.
  const { data: sibling } = await supabase
    .from("product_variants")
    .select("kitchen_id")
    .eq("product_id", productId)
    .is("archived_at", null)
    .not("kitchen_id", "is", null)
    .limit(1)
    .maybeSingle();
  const { error } = await supabase
    .from("product_variants")
    .insert({ ...parsed.data, product_id: productId, kitchen_id: sibling?.kitchen_id ?? null });
  if (error) return dbError(error, "variant");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: `Added variant “${parsed.data.name}”.` };
}

export async function updateVariant(variantId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = readVariant(formData);
  if (!parsed.success) return zodErrors(parsed.error);

  const supabase = await createClient();
  const { error } = await supabase.from("product_variants").update(parsed.data).eq("id", variantId);
  if (error) return dbError(error, "variant");

  revalidatePath("/admin/products", "layout");
  return { ok: true, message: "Variant saved." };
}

export async function setVariantArchived(variantId: string, archived: boolean) {
  await assertRole(["admin"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("product_variants")
    .update({ archived_at: archived ? new Date().toISOString() : null })
    .eq("id", variantId);
  if (error) throw new Error(dbError(error, "variant").message);
  revalidatePath("/admin/products", "layout");
}

// ---------------------------------------------------------------------------
// Product photo (2026-10-09). Uploaded from the browser to the public product-photos bucket first.
// ---------------------------------------------------------------------------

const photoSchema = z.object({ productId: uuid, path: z.string().max(300).nullable() });

export async function setProductPhotoAction(input: z.input<typeof photoSchema>): Promise<ActionState> {
  await assertRole(["admin"]);
  const parsed = photoSchema.safeParse(input);
  if (!parsed.success) return { message: "Invalid photo." };
  const { productId, path } = parsed.data;
  if (path && !path.startsWith(`${productId}/`)) return { message: "The photo is not stored under this product." };

  const supabase = await createClient();
  const { data: before } = await supabase.from("products").select("image_url").eq("id", productId).maybeSingle();
  const url = path ? supabase.storage.from("product-photos").getPublicUrl(path).data.publicUrl : null;
  const { error } = await supabase.rpc("set_product_image", { p_product_id: productId, p_image_url: url });
  if (error) return { message: error.message };

  const oldPath = productPhotoPath(before?.image_url);
  if (oldPath && oldPath !== path) await supabase.storage.from("product-photos").remove([oldPath]);
  revalidatePath("/admin", "layout");
  return { ok: true, message: path ? "Photo saved." : "Photo removed." };
}
