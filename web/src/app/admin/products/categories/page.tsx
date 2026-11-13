import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { createCategory, updateCategory } from "../actions";
import { CategoryRow, NewCategoryForm } from "./category-forms";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  await requireRole(["admin"]);
  const supabase = await createClient();
  const [{ data: categories }] = await Promise.all([
    supabase.from("categories").select("*").order("sort_order").order("name"),
  ]);

  return (
    <>
      <PageHeader
        title="Categories"
        description={
          <>
            <Link href="/admin/products" className="text-brand-strong hover:underline">Products</Link> / Categories.
          </>
        }
      />
      <div className="flex flex-col gap-6">
        <Card>
          <h2 className="mb-4 text-lg font-semibold">Add category</h2>
          <NewCategoryForm action={createCategory} />
        </Card>
        {categories && categories.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {categories.map((c) => (
              <CategoryRow key={c.id} category={c} action={updateCategory.bind(null, c.id)} />
            ))}
          </ul>
        ) : (
          <EmptyState title="No categories yet">For example: Cakes, Pastries, Breads, Cookies.</EmptyState>
        )}
      </div>
    </>
  );
}
