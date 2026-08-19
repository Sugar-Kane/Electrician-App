import Link from "next/link";
import { ChevronLeft, PhoneCall } from "lucide-react";

/**
 * Who you are texting, and the way back to everyone else.
 *
 * This screen used to say the customer's name three times before the first
 * message: once in the app's top bar, once in a bordered header panel, and once
 * more beside a second back link reading "All messages". Two of those were back
 * buttons pointing at different places, and together they spent the top third of
 * a phone screen on a name the person had just tapped.
 *
 * One bar now, pinned, holding the four things a conversation needs: out, who,
 * their number, and how to ring them instead.
 */
export function ConversationBar({
  customerName,
  initials,
  phone,
}: {
  customerName: string;
  initials: string;
  phone: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Link
        href="/messages"
        aria-label="Back to all messages"
        className="tap-target -ml-2 grid h-11 w-11 shrink-0 place-items-center text-ink"
      >
        <ChevronLeft className="h-6 w-6" aria-hidden />
      </Link>

      <span
        aria-hidden
        className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-raised text-xs font-bold text-ink-muted"
      >
        {initials}
      </span>

      <span className="ml-2 min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-5 text-ink">
          {customerName}
        </span>
        {phone ? (
          <span className="block truncate text-[11px] leading-4 text-ink-muted">{phone}</span>
        ) : null}
      </span>

      {phone ? (
        <a
          href={`tel:${phone}`}
          aria-label={`Call ${customerName}`}
          className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-full border border-line bg-raised"
        >
          <PhoneCall className="h-4 w-4 text-brand" aria-hidden />
        </a>
      ) : null}
    </div>
  );
}
