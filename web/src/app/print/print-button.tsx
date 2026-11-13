"use client";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white shadow-sm shadow-brand/25 hover:bg-brand-strong">
      Print
    </button>
  );
}
