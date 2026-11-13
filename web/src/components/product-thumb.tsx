import { cx } from "@/components/ui";

// A product's photo, or a soft pink placeholder with a cake when it has none.
export function ProductThumb({ url, name, size = "md", className }: { url: string | null | undefined; name: string; size?: "sm" | "md" | "lg" | "fill"; className?: string }) {
  const box = { sm: "h-10 w-10 text-base", md: "h-14 w-14 text-xl", lg: "h-40 w-40 text-5xl", fill: "aspect-square w-full text-3xl" }[size];
  if (!url) {
    return (
      <span aria-hidden className={cx("flex shrink-0 items-center justify-center rounded-lg bg-brand-soft", box, className)}>
        🎂
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small public thumbnails; not worth image optimisation
    <img src={url} alt={name} loading="lazy" className={cx("shrink-0 rounded-lg border border-line bg-surface object-cover", box, className)} />
  );
}
