import Link from "next/link";

import { AI_LIMIT_MESSAGE } from "@/lib/ai-allowance-rules";

/**
 * The way out of a used-up built-in AI allowance, as buttons rather than
 * directions: Premium for unlimited, or ChatGPT/Claude for free.
 *
 * Shown under any message that carries the limit message, wherever the
 * feature put it (some prefix it, such as "That receipt was saved."), and
 * nothing at all otherwise, so it can sit under every AI feature's error.
 */
export function AiLimitActions({ message }: { message: string | null | undefined }) {
  if (!message || !message.includes(AI_LIMIT_MESSAGE)) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Link
        href="/account?section=subscription"
        className="tap-target inline-flex min-h-10 items-center rounded-chip bg-brand px-4 text-sm font-semibold text-on-brand"
      >
        Upgrade to Premium
      </Link>
      <Link
        href="/settings/chatgpt"
        className="tap-target inline-flex min-h-10 items-center rounded-chip border border-line px-4 text-sm font-semibold"
      >
        Use ChatGPT or Claude
      </Link>
    </div>
  );
}
