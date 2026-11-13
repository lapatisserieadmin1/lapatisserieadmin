"use client";

import { useMemo, useState } from "react";
import { Badge, Button, Input } from "@/components/ui";
import { formatLeadTime, formatPaise } from "@/lib/money";
import type { CatalogueProduct } from "@/lib/catalogue";
import { ProductThumb } from "@/components/product-thumb";

// Searchable product list; picking a variant calls onAdd. Used by the new-order form and item editing.
export function CataloguePicker({
  catalogue,
  onAdd,
  autoFocus,
  listClassName = "max-h-[32rem]",
}: {
  catalogue: CatalogueProduct[];
  onAdd: (productId: string, variantId: string) => void;
  autoFocus?: boolean;
  listClassName?: string;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? catalogue.filter((p) => p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q)) : catalogue;
  }, [catalogue, query]);

  return (
    <>
      <label htmlFor="product-search" className="sr-only">Search products</label>
      <Input
        id="product-search"
        type="search"
        placeholder="Search products or categories"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus={autoFocus}
      />
      <ul className={`mt-4 flex flex-col gap-3 overflow-y-auto pr-1 ${listClassName}`}>
        {filtered.length === 0 && <li className="py-6 text-center text-sm text-muted">No available products match.</li>}
        {filtered.map((p) => (
          <li key={p.id} className="flex gap-3 rounded-lg border border-line p-3">
            <ProductThumb url={p.imageUrl} name={p.name} />
            <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted">{p.category}</span>
              {p.prepType === "ready_stock" && <Badge>Ready stock</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {p.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onAdd(p.id, v.id)}
                  className="rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-sm hover:border-brand hover:bg-brand-soft"
                >
                  <span className="font-medium">{v.name}</span> · {formatPaise(v.pricePaise)}
                  {v.isEggless && <span className="ml-1 text-xs text-ok">Eggless</span>}
                  {p.prepType === "made_to_order" && v.leadTimeMinutes > 0 && (
                    <span className="ml-1 text-xs text-muted">({formatLeadTime(v.leadTimeMinutes)})</span>
                  )}
                </button>
              ))}
            </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// − / quantity / + / Remove controls for one order line (1 to 999).
export function QuantityStepper({
  id,
  label,
  quantity,
  onChange,
  onRemove,
}: {
  id: string;
  label: string;
  quantity: number;
  onChange: (quantity: number) => void;
  onRemove: () => void;
}) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <Button type="button" variant="secondary" className="px-2.5 py-1" aria-label={`Decrease ${label}`}
        onClick={() => onChange(Math.max(1, quantity - 1))}>−</Button>
      <label className="sr-only" htmlFor={`qty-${id}`}>Quantity</label>
      <Input id={`qty-${id}`} inputMode="numeric" className="w-16 text-center" value={quantity}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ""));
          onChange(Math.min(999, Math.max(1, n || 1)));
        }} />
      <Button type="button" variant="secondary" className="px-2.5 py-1" aria-label={`Increase ${label}`}
        onClick={() => onChange(Math.min(999, quantity + 1))}>+</Button>
      <Button type="button" variant="ghost" className="ml-auto" onClick={onRemove}>
        Remove
      </Button>
    </div>
  );
}
