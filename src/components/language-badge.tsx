import { Languages } from "lucide-react";

/**
 * Marks a customer who speaks Spanish, wherever their name is shown, so whoever
 * calls or visits knows before they say hello.
 *
 * The language is the one on the customer's record: detected from how they
 * write or speak to the assistant, or set by the owner on the customer page.
 * Nothing is shown for English, the default.
 */
export function SpanishBadge({ language, className = "" }: { language?: string | null; className?: string }) {
  if (language !== "es") return null;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border border-info/30 bg-info-bg px-2 py-0.5 text-[10px] font-semibold text-info ${className}`}
      title="Speaks Spanish"
    >
      <Languages className="h-3 w-3" aria-hidden />
      Spanish
    </span>
  );
}
