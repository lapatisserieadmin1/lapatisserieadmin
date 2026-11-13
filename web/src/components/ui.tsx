import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { LOGO_SRC, SHOP_NAME, WORDMARK_SRC } from "@/lib/brand";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

const buttonVariants = {
  primary: "bg-linear-to-br from-rose to-brand font-semibold text-white shadow-md shadow-brand/30 hover:from-brand hover:to-brand-strong disabled:opacity-60",
  secondary: "bg-surface text-accent-strong border border-accent/50 hover:border-accent hover:bg-accent-soft disabled:opacity-60",
  danger: "bg-surface text-danger border border-danger/40 hover:bg-danger-soft disabled:opacity-60",
  ghost: "text-brand-strong hover:bg-brand-soft disabled:opacity-60",
};

type ButtonVariant = keyof typeof buttonVariants;

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed";

export function Button({
  variant = "primary",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant }) {
  return <button className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant }) {
  return <Link className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

const fieldBase =
  "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:bg-canvas";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cx(fieldBase, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(fieldBase, "pr-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldBase, "min-h-20", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" id={`${htmlFor}-error`}>
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

export function Checkbox({
  label,
  hint,
  ...props
}: ComponentProps<"input"> & { label: string; hint?: string }) {
  return (
    <label className="flex items-start gap-2.5 text-sm">
      <input type="checkbox" className="mt-0.5 size-4 accent-brand" {...props} />
      <span>
        <span className="font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cx("rounded-2xl border border-line/80 bg-surface p-5 shadow-[0_10px_30px_-18px_rgba(184,67,95,0.35)]", className)}
      {...props}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <span aria-hidden className="mt-2 block h-1 w-14 rounded-full bg-linear-to-r from-rose to-accent" />
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const badgeTones = {
  neutral: "bg-canvas text-muted border-line",
  brand: "bg-brand-soft text-brand-strong border-brand/20",
  accent: "bg-accent-soft text-accent-strong border-accent/30",
  info: "bg-info-soft text-info border-info/20",
  ok: "bg-ok-soft text-ok border-ok/20",
  warn: "bg-warn-soft text-warn border-warn/30",
  danger: "bg-danger-soft text-danger border-danger/20",
};

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: keyof typeof badgeTones;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium",
        badgeTones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "warn",
  title,
  children,
}: {
  tone?: "warn" | "danger" | "ok" | "brand";
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    warn: "border-warn/30 bg-warn-soft text-warn",
    danger: "border-danger/30 bg-danger-soft text-danger",
    ok: "border-ok/30 bg-ok-soft text-ok",
    brand: "border-brand/20 bg-brand-soft text-brand-strong",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-2xl border px-4 py-3 text-sm", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? "mt-1" : undefined}>{children}</div>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-brand/30 bg-surface px-6 py-10 text-center">
      <p className="font-display text-lg">{title}</p>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

// Accent lines ("All caught up"). Decorative: hidden from screen readers. The script font is kept for
// the shop name only (2026-10-28), so accents are the serif in italics.
export function ScriptText({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span aria-hidden className={cx("font-display italic text-script leading-tight", className)}>
      {children}
    </span>
  );
}

// The round logo (black linework on transparent, public/brand/logo-round.png).
export function LogoMark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- small static brand image, also used in print
  return <img src={LOGO_SRC} alt="" aria-hidden className={cx("aspect-square object-contain", className)} />;
}

// "MADRAS" in spaced flared capitals.
export function CityLine({ className }: { className?: string }) {
  return <span className={cx("block font-caps text-[11px] uppercase tracking-[0.35em] text-ink", className)}>Madras</span>;
}

// The shop's name in the logo's lettering, without the round badge.
export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <div className={cx("flex flex-col items-center text-center", className)}>
      <Wordmark className={compact ? "w-32" : "w-44"} />
    </div>
  );
}

// "La Patisserie" with its underline and "MADRAS", traced from the logo.
export function Wordmark({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- static vector, also used in print
  return <img src={WORDMARK_SRC} alt={SHOP_NAME} width={2135} height={770} className={cx("block h-auto w-72 max-w-full", className)} />;
}
