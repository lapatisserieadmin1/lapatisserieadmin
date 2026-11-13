import { ORDER_TERMS } from "@/lib/brand";
import { cx } from "@/components/ui";

export function OrderTerms({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cx("flex flex-col", compact ? "gap-1.5" : "gap-4", className)}>
      {ORDER_TERMS.map((s) => (
        <section key={s.title}>
          <h3 className={cx("font-bold uppercase", compact ? "text-[1em]" : "text-sm tracking-wide text-brand-strong")}>{s.title}</h3>
          {s.bullets && (
            <ul className={cx("list-disc", compact ? "pl-3.5" : "mt-1 pl-5")}>
              {s.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
          {s.paragraphs?.map((p) => <p key={p} className={compact ? "" : "mt-1"}>{p}</p>)}
        </section>
      ))}
    </div>
  );
}
