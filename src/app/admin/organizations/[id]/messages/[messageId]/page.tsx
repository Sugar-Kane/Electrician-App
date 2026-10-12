import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, TriangleAlert } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Pill, RevealBar } from "@/components/admin-ui";
import {
  getMessageFacts,
  getOrganizationDetail,
  myAdminRole,
  recordOrganizationTab,
  revealIsValid,
  type MessageFacts,
} from "@/lib/admin-console";
import { maskBody, maskPhone } from "@/lib/admin-mask";
import { deliveryState, failureReason } from "@/lib/message-errors";
import { formatForDisplay } from "@/lib/phone-format";
import { hashed } from "@/lib/recovery/fingerprint";
import { retryRefusal, textFingerprint } from "@/lib/recovery/text-recovery";

import { applyRecipient, checkDelivery, previewRecipient, retryText } from "./actions";

export const metadata: Metadata = {
  title: "Text | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS: Record<string, string> = {
  confirm: "Tick the box to confirm that a text will be sent.",
  reason: "Say why. The reason goes on the record.",
  changed:
    "Something changed since the page was shown — a delivery report, the number, or the customer's consent. Look again before going ahead.",
  already: "That was already done, or is being done now.",
  role: "A support admin can look and check, not change.",
  missing: "That text isn't in this business.",
  refused: "That was refused.",
};

const TOOL_WORDS: Record<string, string> = {
  check_delivery: "Checked delivery",
  retry_text: "Sent again",
  fix_recipient: "Corrected the number",
};

const STATE_WORDS: Record<string, string> = {
  attempted: "Running",
  accepted: "Accepted by the provider",
  verified: "Done",
  failed: "Failed",
  unknown: "Outcome unknown",
};

function str(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

/** A database refusal as the end of a sentence, without a doubled full stop. */
function clause(value: string): string {
  return `${value.replace(/[.\s]+$/, "")}.`;
}

/** What an operation came to, in one sentence. */
function outcome(operation: MessageFacts["operationLog"][number]): { text: string; tone: "good" | "waiting" | "problem" } {
  const result = operation.result;
  if (operation.tool === "check_delivery") {
    if (operation.state === "unknown") return { text: `Couldn't tell: ${str(result.why)} The text's status stays as it was.`, tone: "waiting" };
    const before = str(result.status_before);
    const after = str(result.status_after);
    return {
      text: `Twilio says "${str(result.provider_status)}"${str(result.provider_error) ? ` (error ${str(result.provider_error)})` : ""}. ${before === after ? "The record already said so." : `The record went from ${before} to ${after}.`}`,
      tone: "good",
    };
  }
  if (operation.tool === "retry_text") {
    if (operation.state === "accepted")
      return { text: "Twilio accepted it; it isn't delivered until Twilio reports that it is.", tone: "good" };
    if (operation.state === "unknown")
      return { text: "Twilio didn't answer, so it may or may not have gone. Check the new text's delivery before trying again.", tone: "waiting" };
    return { text: `Didn't go: ${clause(str(result.stopped) || str(result.detail) || str(result.provider_error) || "refused")}`, tone: "problem" };
  }
  if (operation.tool === "fix_recipient") {
    if (operation.state === "verified")
      return {
        text: `Number corrected to one ending ${str(result.to_last4)}. The failed text keeps its record; sending it again is a separate step.`,
        tone: "good",
      };
    return { text: `Not changed: ${clause(str(result.stopped) || "refused")}`, tone: "problem" };
  }
  return { text: STATE_WORDS[operation.state] ?? operation.state, tone: "waiting" };
}

/**
 * One text, what became of it, and what support may do about it.
 *
 * Read-only until a tool is used. Each tool says first exactly what it will do
 * and to whom, and is refused when it would text somebody who asked not to be
 * texted, repeat something that already went, or send something no longer true.
 */
export default async function AdminMessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; messageId: string }>;
  searchParams: Promise<{ reveal?: string; op?: string; error?: string; why?: string; fix?: string }>;
}) {
  const [{ id, messageId }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id) || !UUID.test(messageId)) notFound();

  const [organization, facts, role] = await Promise.all([
    getOrganizationDetail(id),
    getMessageFacts(id, messageId),
    myAdminRole(),
  ]);
  if (!organization || !facts) notFound();

  const [, revealed] = await Promise.all([
    recordOrganizationTab(id, "Text"),
    UUID.test(query.reveal ?? "") ? revealIsValid(query.reveal!, id) : Promise.resolve(false),
  ]);

  const zone = organization.timeZone;
  const base = `/admin/organizations/${id}`;
  const here = `${base}/messages/${messageId}`;
  const keepReveal = revealed ? query.reveal! : "";
  const { message, customer } = facts;
  const state = deliveryState({ ...message, hasProviderRef: Boolean(message.providerMessageId) });
  const reason = failureReason(message.errorCode);
  const failed = message.status === "failed" || message.status === "undelivered";
  const outbound = message.direction === "outbound";
  const owner = role === "owner";
  const refusal = retryRefusal(facts);
  const fingerprint = hashed(textFingerprint(facts));
  const justDone = facts.operationLog.find((operation) => operation.id === query.op);
  const fix = query.fix && /^\+[1-9][0-9]{7,14}$/.test(query.fix) ? query.fix : "";
  const showRecipient = outbound && failed && Boolean(customer) && (reason.kind === "invalid_number" || reason.kind === "not_mobile");
  const phoneShown = customer ? (revealed ? formatForDisplay(customer.phone) || customer.phone : maskPhone(customer.phone)) : "";
  const consent = facts.consent.optedOutAt
    ? { label: "Replied STOP", at: facts.consent.optedOutAt, tone: "problem" as const }
    : facts.consent.optedInAt
      ? { label: "Agreed to texts", at: facts.consent.optedInAt, tone: "good" as const }
      : { label: "Never agreed to texts", at: "", tone: "waiting" as const };

  const hidden = (
    <>
      <input type="hidden" name="organizationId" value={id} />
      <input type="hidden" name="messageId" value={messageId} />
      <input type="hidden" name="reveal" value={keepReveal} />
    </>
  );
  const inputClass =
    "min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-20 -mx-3 border-b border-line bg-canvas/95 px-3 pb-3 pt-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <Link href={`${base}?tab=messages`} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
          <ChevronLeft className="h-4 w-4" aria-hidden />
          {organization.name} · Texts
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="min-w-0 text-xl font-semibold tracking-tight sm:text-2xl">
            {outbound ? "Text to" : "Text from"} {customer?.name ?? "unknown"}
          </h1>
          <Pill tone={state.tone}>{state.label}</Pill>
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">
          <AdminTime iso={message.createdAt} timeZone={zone} />
          {facts.job ? (
            <>
              {" · "}
              <Link href={`${base}/jobs/${facts.job.jobNumber}`} className="font-semibold text-brand">
                Job #{facts.job.jobNumber}
              </Link>
            </>
          ) : null}
        </p>
      </header>

      <RevealBar organizationId={id} scope="Text" returnTo={here} revealed={revealed} hideHref={here} />

      {query.error ? (
        <p className="flex items-start gap-2 rounded-control border border-critical/30 bg-critical-bg p-3 text-sm text-critical">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {query.error === "number" ? query.why ?? "That number can't be used." : ERRORS[query.error] ?? ERRORS.refused}
        </p>
      ) : null}
      {justDone ? (
        <p
          className={`rounded-control border p-3 text-sm ${
            outcome(justDone).tone === "good"
              ? "border-positive/25 bg-positive-bg text-positive"
              : outcome(justDone).tone === "problem"
                ? "border-critical/30 bg-critical-bg text-critical"
                : "border-caution/25 bg-caution-bg text-caution"
          }`}
          role="status"
        >
          <span className="font-semibold">{TOOL_WORDS[justDone.tool] ?? justDone.tool}: </span>
          {outcome(justDone).text}
        </p>
      ) : null}

      <Card title="What happened">
        <dl className="space-y-1 text-sm">
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Status</dt>
            <dd className="text-right">
              {message.status || "unknown"}
              {failed ? ` · ${reason.words}${message.errorCode ? ` (${message.errorCode})` : ""}` : ""}
            </dd>
          </div>
          {failed ? (
            <div className="flex flex-wrap justify-between gap-2">
              <dt className="text-ink-muted">Can sending again fix it?</dt>
              <dd className="text-right">{reason.retryable ? "It might" : "No — it would fail the same way"}</dd>
            </div>
          ) : null}
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Sent to Twilio</dt>
            <dd className="text-right">
              {message.sentAt ? <AdminTime iso={message.sentAt} timeZone={zone} /> : message.providerMessageId ? "Yes" : "No"}
              {message.providerMessageId ? ` · ref …${message.providerMessageId.slice(-6)}` : ""}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Delivered</dt>
            <dd className="text-right">
              {message.deliveredAt ? <AdminTime iso={message.deliveredAt} timeZone={zone} /> : "No delivery report"}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Customer</dt>
            <dd className="text-right">
              {customer?.name ?? "unknown"} {phoneShown ? `· ${phoneShown}` : ""}
            </dd>
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            <dt className="text-ink-muted">Consent now</dt>
            <dd className="text-right">
              <Pill tone={consent.tone}>{consent.label}</Pill>
              {consent.at ? (
                <span className="ml-2 text-xs text-ink-faint">
                  <AdminTime iso={consent.at} timeZone={zone} dateOnly />
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
        <p className={`mt-3 rounded-control border border-line p-3 text-sm ${revealed ? "whitespace-pre-wrap break-words" : "text-ink-faint"}`}>
          {revealed ? message.body || "Empty" : maskBody(message.body)}
        </p>
      </Card>

      {outbound ? (
        <Card title="Check delivery">
          <p className="text-sm leading-6 text-ink-muted">
            Asks Twilio what happened to this text and brings the record in line. Nothing is sent to the customer.
          </p>
          {message.providerMessageId ? (
            <form action={checkDelivery} className="mt-3">
              {hidden}
              <button type="submit" className="tap-target rounded-control border border-line px-4 text-sm font-semibold">
                Ask Twilio
              </button>
            </form>
          ) : (
            <p className="mt-3 text-sm text-ink-faint">No Twilio reference was saved for this text, so there is nothing to ask.</p>
          )}
        </Card>
      ) : null}

      {outbound && failed ? (
        <Card title="Send it again">
          {!owner ? (
            <p className="text-sm text-ink-muted">A support admin can look and check, not change.</p>
          ) : refusal ? (
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
              {refusal}
            </p>
          ) : (
            <form action={retryText} className="space-y-3">
              {hidden}
              <input type="hidden" name="fingerprint" value={fingerprint} />
              <dl className="space-y-1 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-ink-muted">To</dt>
                  <dd>{phoneShown} · the number on file now</dd>
                </div>
                <div className="flex flex-wrap justify-between gap-2">
                  <dt className="text-ink-muted">Words</dt>
                  <dd>{revealed ? "The same words as above" : `The same words (${maskBody(message.body)})`}</dd>
                </div>
              </dl>
              <label className="block">
                <span className="text-sm font-medium">Why</span>
                <input name="reason" required minLength={3} maxLength={300} placeholder="e.g. customer says the reminder never came" className={`mt-1 ${inputClass}`} />
              </label>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" name="confirm" value="yes" required className="mt-1 h-4 w-4" />
                <span>One text will be sent to the customer. Twilio accepting it doesn&rsquo;t mean it arrived; the result will say which.</span>
              </label>
              <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
                Send it again
              </button>
            </form>
          )}
        </Card>
      ) : null}

      {showRecipient ? (
        <Card title="Correct the customer's number" id="recipient">
          {!owner ? (
            <p className="text-sm text-ink-muted">A support admin can look and check, not change.</p>
          ) : fix && customer ? (
            <form action={applyRecipient} className="space-y-3">
              {hidden}
              <input type="hidden" name="phone" value={fix} />
              <input type="hidden" name="current" value={hashed(customer.phone)} />
              <p className="text-sm">
                {customer.name}: <span className="text-ink-muted">{maskPhone(customer.phone) || "no number"}</span> →{" "}
                <span className="font-semibold">{formatForDisplay(fix)}</span>
              </p>
              <p className="text-sm text-ink-muted">
                Only this customer changes. The failed text keeps its record, and their history will show the change, made
                by Volteira support, with the number it replaced. Nothing is sent.
              </p>
              <label className="block">
                <span className="text-sm font-medium">Why</span>
                <input name="reason" required minLength={3} maxLength={300} placeholder="e.g. owner read the right number off the work order" className={`mt-1 ${inputClass}`} />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
                  Save the new number
                </button>
                <Link href={`${here}${keepReveal ? `?reveal=${keepReveal}` : ""}#recipient`} className="tap-target inline-flex items-center rounded-control border border-line px-4 text-sm font-semibold">
                  Cancel
                </Link>
              </div>
            </form>
          ) : (
            <form action={previewRecipient} className="space-y-3">
              {hidden}
              <p className="text-sm text-ink-muted">
                {reason.words}. If the business has the right number, check it here first; nothing changes until you
                confirm.
              </p>
              <label className="block">
                <span className="text-sm font-medium">Right number</span>
                <input name="phone" inputMode="tel" autoComplete="off" required placeholder="(805) 555-0199" className={`mt-1 ${inputClass}`} />
              </label>
              <button type="submit" className="tap-target rounded-control border border-line px-4 text-sm font-semibold">
                Check it
              </button>
            </form>
          )}
        </Card>
      ) : null}

      <Card title="What support has done with this text">
        {facts.operationLog.length === 0 ? (
          <p className="text-sm text-ink-muted">Nothing yet.</p>
        ) : (
          <ul className="space-y-2">
            {facts.operationLog.map((operation) => (
              <li key={operation.id} className="rounded-control border border-line p-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-semibold">{TOOL_WORDS[operation.tool] ?? operation.tool}</p>
                  <Pill tone={outcome(operation).tone}>{STATE_WORDS[operation.state] ?? operation.state}</Pill>
                </div>
                <p className="mt-1 text-ink-muted">{outcome(operation).text}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {operation.actor || "unknown"} · <AdminTime iso={operation.createdAt} timeZone={zone} />
                  {operation.reason ? ` · “${operation.reason}”` : ""}
                </p>
                {operation.tool === "retry_text" && str(operation.result.new_message) ? (
                  <Link href={`${base}/messages/${str(operation.result.new_message)}`} className="mt-1 inline-block text-xs font-semibold text-brand">
                    The new text
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
