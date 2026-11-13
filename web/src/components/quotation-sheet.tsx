import type { QuotationView } from "@/lib/quotation";
import { Wordmark, cx } from "@/components/ui";

// The "Order in msg" as a page (A4 when printed). Draws only what the view holds: a kitchen view has no amounts.
export function QuotationSheet({ view }: { view: QuotationView }) {
  return (
    <article className="mx-auto max-w-3xl rounded-3xl bg-white p-6 text-ink shadow-[0_18px_50px_-24px_rgba(74,36,24,0.25)] ring-1 ring-brand/10 sm:p-10 print:max-w-none print:rounded-none print:p-0 print:shadow-none print:ring-0">
      <header className="flex flex-col items-center gap-2 border-b border-brand/15 pb-6 text-center">
        <Wordmark className="w-64" />
        {view.shopContact.length > 0 && <p className="mt-1 text-xs text-muted">{view.shopContact.join(" · ")}</p>}
      </header>

      <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-2xl font-semibold text-brand-strong">{view.title}</h1>
        {!view.priced && (
          <span className="rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-strong">For the kitchen · no prices</span>
        )}
      </div>

      <dl className="mt-4 grid gap-x-6 gap-y-3 rounded-2xl bg-canvas p-4 text-sm sm:grid-cols-2">
        {view.facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs uppercase tracking-[0.12em] text-muted">{f.label}</dt>
            <dd className="font-medium">{f.value}</dd>
          </div>
        ))}
      </dl>

      {view.cake.length > 0 && (
        <section className="mt-6">
          <h2 className="font-display text-lg font-semibold">Custom cake</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            {view.cake.map((r) => (
              <div key={r.label} className="contents">
                <dt className="text-muted">{r.label}</dt>
                <dd className={cx(r.label === "Message on cake" && "font-display text-base italic")}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section className="mt-6">
        <h2 className="font-display text-lg font-semibold">Items</h2>
        <table className="mt-2 w-full text-sm">
          <thead>
            <tr className="border-b border-brand/20 text-left text-xs uppercase tracking-[0.12em] text-muted">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Qty</th>
              {view.priced && <th className="hidden py-2 text-right font-medium sm:table-cell">Rate</th>}
              {view.priced && <th className="py-2 text-right font-medium">Amount</th>}
            </tr>
          </thead>
          <tbody>
            {view.lines.map((l) => (
              <tr key={l.key} className="border-b border-line align-top">
                <td className="py-2.5 pr-3">
                  <p className="font-medium">{l.title}</p>
                  {l.detail && <p className="text-xs text-muted">{l.detail}</p>}
                </td>
                <td className="py-2.5 text-right tabular-nums">{l.quantity}</td>
                {view.priced && <td className="hidden py-2.5 pl-3 text-right tabular-nums sm:table-cell">{l.unit}</td>}
                {view.priced && <td className="py-2.5 pl-3 text-right tabular-nums">{l.total}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        {view.totals.length > 0 && (
          <dl className="ml-auto mt-3 flex max-w-xs flex-col gap-1 text-sm">
            {view.totals.map((t) => (
              <div key={t.label} className={cx("flex justify-between gap-6 tabular-nums", t.strong && "text-base font-semibold text-brand-strong")}>
                <dt>{t.label}</dt>
                <dd>{t.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {view.notes.length > 0 && (
        <section className="mt-6 flex flex-col gap-2 text-sm">
          {view.notes.map((n) => (
            <p key={n.label}><span className="text-muted">{n.label}: </span>{n.value}</p>
          ))}
        </section>
      )}

      <footer className="mt-8 border-t border-brand/15 pt-4 text-center">
        <p className="font-display text-sm italic text-brand-strong">Thank you for choosing {view.shopName}</p>
      </footer>
    </article>
  );
}
