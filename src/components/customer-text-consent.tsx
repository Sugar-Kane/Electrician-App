import { MessageSquareText } from "lucide-react";

/**
 * Whether texts reach this customer, in one line beside "Messages in".
 *
 * Only a STOP stops a text, so that is the one thing worth saying: texts are
 * on, or the customer replied STOP and only they can turn them back on.
 */

export type TextConsentStatus = { state: "on" } | { state: "stopped"; label: string };

export function CustomerTextConsent({ hasPhone, status }: { hasPhone: boolean; status: TextConsentStatus }) {
  if (!hasPhone) return null;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText className="h-4 w-4 text-ink-faint" aria-hidden />
        Texts
      </h3>
      {status.state === "stopped" ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-caution">Replied STOP</span>
          <span className="text-ink-muted"> · {status.label}. No texts go to them until they text START.</span>
        </p>
      ) : (
        <p className="mt-2 text-sm text-ink-muted">On. Updates, invoices and links are texted to this number.</p>
      )}
    </div>
  );
}
