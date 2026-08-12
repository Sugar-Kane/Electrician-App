import type { ReactNode } from "react";
import { Check, Info, TriangleAlert } from "lucide-react";

/**
 * The message at the top of a screen that went right or wrong.
 *
 * This existed twenty-nine times, written out by hand in twelve files, as some
 * arrangement of:
 *
 *   border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-200
 *
 * Which is a problem beyond the repetition. `red-400` is #f87171 and the
 * `critical` token is #fb7185 — so an error in a banner and an error under a
 * form field were two different reds, and neither was wrong enough for anybody
 * to notice while being different enough to look unconsidered.
 *
 * The tones are the four the design tokens already define. There is no fifth,
 * because a fifth is how the seven yellows happened.
 */

export type BannerTone = "critical" | "positive" | "caution" | "info";

const TONES: Record<BannerTone, { className: string; Icon: typeof Check }> = {
  critical: { className: "border-critical/20 bg-critical-bg text-critical", Icon: TriangleAlert },
  positive: { className: "border-positive/20 bg-positive-bg text-positive", Icon: Check },
  caution: { className: "border-caution/20 bg-caution-bg text-caution", Icon: TriangleAlert },
  info: { className: "border-info/20 bg-info-bg text-info", Icon: Info },
};

/**
 * `role` is not derived from the tone.
 *
 * A screen reader announces `alert` immediately and interrupts; `status` waits
 * for a pause. Which is right depends on what the message is for, not on what
 * colour it is — a caution that the customer was not texted deserves an
 * interruption, and a green "Saved." does not.
 */
export function Banner({
  tone,
  children,
  role = tone === "critical" ? "alert" : "status",
  icon = true,
  className = "",
}: {
  tone: BannerTone;
  children: ReactNode;
  role?: "alert" | "status";
  /** Off for a banner whose content carries its own. */
  icon?: boolean;
  /** Spacing only. The caller owns where it sits; this owns how it looks. */
  className?: string;
}) {
  const { className: toneClass, Icon } = TONES[tone];

  return (
    <p
      role={role}
      className={`flex items-start gap-2 rounded-control border p-4 text-sm leading-6 ${toneClass} ${className}`}
    >
      {icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}
