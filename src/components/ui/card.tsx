import type { ReactNode } from "react";

/**
 * The panel everything sits in.
 *
 * There was no such component, so every page invented one: `rounded-3xl` here,
 * `rounded-2xl` there, one-off `rounded-[28px]` in a third place, each with its
 * own border colour and padding. This is that panel, once.
 */

type Tone = "default" | "brand" | "positive" | "caution" | "critical";

const TONES: Record<Tone, string> = {
  default: "border-line bg-surface",
  brand: "border-brand/25 bg-brand/[0.06]",
  positive: "border-positive/25 bg-positive-bg",
  caution: "border-caution/25 bg-caution-bg",
  critical: "border-critical/30 bg-critical-bg",
};

export function Card({
  children,
  tone = "default",
  className = "",
  padded = true,
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
  /** Off for a card whose content manages its own edges, like a list. */
  padded?: boolean;
}) {
  return (
    <section
      className={`rounded-panel border ${TONES[tone]} ${padded ? "p-5 sm:p-6" : ""} ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * A card's title, and the one thing you can do to it.
 *
 * Kept together because a heading with an action floating somewhere near it was
 * the other thing every page did differently.
 */
export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-ink">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm leading-6 text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/** A labelled value, for the read-only rows that make up most settings. */
export function DataRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2.5 last:border-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}
