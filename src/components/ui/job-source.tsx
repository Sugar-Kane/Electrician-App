import { Globe, MessageSquare, PencilLine, Phone } from "lucide-react";

import type { PilotJob } from "@/lib/pilot-data";

/**
 * How the job came in, said quietly.
 *
 * Worth knowing and never the point: an electrician standing at a door does not
 * care whether the customer rang or texted, and an owner deciding where the
 * work comes from very much does. So it is secondary metadata — a small icon
 * and a word, in muted ink, never a coloured badge competing with the status.
 *
 * A phone call handled by the AI reads as a call. Who did the talking is a
 * separate column and deliberately not shown here: "Phone" is the fact, and
 * "AI phone" would be the business's own plumbing on a customer's job card.
 */

const SOURCES: Record<PilotJob["channel"], { label: string; icon: typeof Phone }> = {
  phone: { label: "Phone", icon: Phone },
  sms: { label: "Text", icon: MessageSquare },
  web: { label: "Web", icon: Globe },
  manual: { label: "Added by hand", icon: PencilLine },
};

export function JobSource({
  channel,
  className = "",
}: {
  channel: PilotJob["channel"];
  className?: string;
}) {
  const source = SOURCES[channel] ?? SOURCES.manual;
  const Icon = source.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-xs text-ink-muted ${className}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {source.label}
    </span>
  );
}
