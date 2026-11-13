"use client";

import Link from "next/link";

// Hidden when printing. Browser print works with 80mm thermal printers and A4.
export function PrintControls({ basePath, size }: { basePath: string; size: "80mm" | "a4" }) {
  return (
    <div className="print:hidden mx-auto mb-4 flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 pt-4">
      <div className="flex gap-1 rounded-lg border border-line bg-surface p-1 text-sm">
        {(["80mm", "a4"] as const).map((s) => (
          <Link key={s} href={`${basePath}?size=${s}`} aria-current={size === s ? "page" : undefined}
            className={size === s ? "rounded-md bg-brand-soft px-3 py-1 font-medium text-brand-strong" : "rounded-md px-3 py-1 text-muted hover:text-ink"}>
            {s === "80mm" ? "80mm receipt" : "A4"}
          </Link>
        ))}
      </div>
      <button type="button" onClick={() => window.print()} className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong">
        Print
      </button>
    </div>
  );
}
