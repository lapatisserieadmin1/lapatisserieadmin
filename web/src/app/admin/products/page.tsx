import type { Metadata } from "next";
import Link from "next/link";
import { ProductThumb } from "@/components/product-thumb";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatPaise } from "@/lib/money";
import { websiteMenuStatus } from "@/lib/website";
import { Alert, Badge, ButtonLink, EmptyState, Input, PageHeader, Select } from "@/components/ui";
import { DeleteProductButton } from "./delete-product";

export const metadata: Metadata = { title: "Products" };

type Status = "active" | "archived" | "all";

export default async function ProductsPage({ searchParams }: PageProps<"/admin/products">) {
  const staff = await requireRole(["admin", "counter"]);
  const isAdmin = staff.role === "admin";
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const categoryId = typeof params.category === "string" ? params.category : "";
  const status: Status = params.status === "archived" || params.status === "all" ? params.status : "active";

  const supabase = await createClient();

  let query = supabase
    .from("products")
    .select(
      "id, name, image_url, prep_type, contains_egg, is_available, archived_at, categories(name, is_active), product_variants(id, price_paise, is_eggless, is_available, archived_at, kitchens(name))",
    )
    .order("name");
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "\\$&")}%`);
  if (categoryId) query = query.eq("category_id", categoryId);
  if (status === "active") query = query.is("archived_at", null);
  if (status === "archived") query = query.not("archived_at", "is", null);

  const [{ data: products, error }, { data: categories }, { data: unmapped }] = await Promise.all([
    query,
    supabase.from("categories").select("id, name").order("sort_order").order("name"),
    supabase.from("unmapped_variants").select("product_id, product_name"),
  ]);
  const unmappedProducts = [...new Map((unmapped ?? []).map((u) => [u.product_id, u.product_name])).entries()];

  return (
    <>
      <PageHeader
        title="Products"
        description="Catalogue, variants and prices."
        actions={
          isAdmin && (
            <>
              <ButtonLink href="/admin/products/categories" variant="secondary">
                Categories
              </ButtonLink>
              <ButtonLink href="/admin/products/new">New product</ButtonLink>
            </>
          )
        }
      />

      {isAdmin && unmappedProducts.length > 0 && (
        <div className="mb-6">
          <Alert tone="warn" title={`${unmappedProducts.length} made-to-order product${unmappedProducts.length === 1 ? " has" : "s have"} no kitchen`}>
            Their orders show on every chef&apos;s screen until you choose a kitchen:{" "}
            {unmappedProducts.map(([id, name], i) => (
              <span key={id}>
                {i > 0 && ", "}
                <Link href={`/admin/products/${id}`} className="font-medium underline">{name}</Link>
              </span>
            ))}
          </Alert>
        </div>
      )}

      <form className="mb-4 flex flex-wrap items-end gap-3" role="search">
        <div className="min-w-48 flex-1">
          <label htmlFor="q" className="sr-only">
            Search products
          </label>
          <Input id="q" name="q" type="search" placeholder="Search by name" defaultValue={q} />
        </div>
        <div>
          <label htmlFor="category" className="sr-only">
            Category
          </label>
          <Select id="category" name="category" defaultValue={categoryId}>
            <option value="">All categories</option>
            {(categories ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="status" className="sr-only">
            Status
          </label>
          <Select id="status" name="status" defaultValue={status}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </Select>
        </div>
        <button type="submit" className="rounded-lg border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-brand-soft">
          Filter
        </button>
      </form>

      {error ? (
        <Alert tone="danger" title="Could not load products">
          {error.message}
        </Alert>
      ) : !products || products.length === 0 ? (
        <EmptyState title={q || categoryId || status !== "active" ? "No products match these filters" : "No products yet"}>
          {isAdmin && !q && !categoryId && status === "active" && (
            <>
              Start by adding <Link href="/admin/products/categories" className="text-brand-strong underline">categories</Link>, then{" "}
              <Link href="/admin/products/new" className="text-brand-strong underline">your first product</Link>.
            </>
          )}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase tracking-wider text-muted">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Product</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Category</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Price</th>
                <th scope="col" className="hidden px-4 py-3 font-medium md:table-cell">Kitchen</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
                <th scope="col" className="px-4 py-3 font-medium">Website</th>
                {isAdmin && <th scope="col" className="px-4 py-3 font-medium"><span className="sr-only">Delete</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {products.map((p) => {
                const variants = p.product_variants.filter((v) => !v.archived_at);
                const prices = variants.map((v) => v.price_paise);
                const hasEggless = variants.some((v) => v.is_eggless);
                const kitchenNames = [...new Set(variants.flatMap((v) => (v.kitchens ? [v.kitchens.name] : [])))];
                const onWebsite = websiteMenuStatus({
                  archived: Boolean(p.archived_at),
                  isAvailable: p.is_available,
                  categoryActive: Boolean(p.categories?.is_active),
                  variants: p.product_variants.map((v) => ({ archived: Boolean(v.archived_at), isAvailable: v.is_available })),
                }).shown;
                const needsKitchen = p.prep_type === "made_to_order" && variants.some((v) => !v.kitchens);
                const price = prices.length === 0
                  ? <span className="text-danger">No variants</span>
                  : Math.min(...prices) === Math.max(...prices)
                    ? formatPaise(prices[0])
                    : `${formatPaise(Math.min(...prices))} – ${formatPaise(Math.max(...prices))}`;
                return (
                  <tr key={p.id} className="hover:bg-canvas/60">
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-3">
                      <ProductThumb url={p.image_url} name={p.name} size="sm" />
                      <div>
                      <Link href={`/admin/products/${p.id}`} className="font-medium text-ink hover:text-brand-strong hover:underline">
                        {p.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {p.contains_egg && <Badge>Contains egg</Badge>}
                        {hasEggless && <Badge tone="ok">Eggless option</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-muted md:hidden">{p.categories?.name} · {price}</p>
                      </div>
                      </div>
                    </td>
                    <td className="hidden px-4 py-3 text-muted md:table-cell">{p.categories?.name}</td>
                    <td className="hidden px-4 py-3 md:table-cell">{p.prep_type === "made_to_order" ? "Made to order" : "Ready stock"}</td>
                    <td className="hidden px-4 py-3 whitespace-nowrap md:table-cell">{price}</td>
                    <td className="hidden px-4 py-3 md:table-cell">
                      {p.prep_type !== "made_to_order" ? (
                        <span className="text-muted">—</span>
                      ) : needsKitchen ? (
                        <Badge tone="warn">Choose kitchen</Badge>
                      ) : (
                        kitchenNames.join(", ")
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {p.archived_at ? (
                        <Badge>Archived</Badge>
                      ) : p.is_available ? (
                        <Badge tone="ok">Available</Badge>
                      ) : (
                        <Badge tone="warn">Unavailable</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {onWebsite ? <Badge tone="ok">On website</Badge> : <Badge tone="warn">Not shown</Badge>}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        <DeleteProductButton productId={p.id} name={p.name} />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
