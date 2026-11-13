import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Alert, Card, PageHeader } from "@/components/ui";
import { ProductForm } from "../product-form";
import { createProduct } from "../actions";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const { data: categories } = await supabase
    .from("categories")
    .select("id, name, is_active")
    .order("sort_order")
    .order("name");

  return (
    <>
      <PageHeader
        title="New product"
        description={
          <>
            <Link href="/admin/products" className="text-brand-strong hover:underline">Products</Link> / New. You will add sizes and prices on the next screen.
          </>
        }
      />
      {!categories || categories.length === 0 ? (
        <Alert title="Add a category first">
          Products belong to a category. <Link href="/admin/products/categories" className="font-medium underline">Create a category</Link>.
        </Alert>
      ) : (
        <Card>
          <ProductForm action={createProduct} categories={categories} submitLabel="Create product" />
        </Card>
      )}
    </>
  );
}
