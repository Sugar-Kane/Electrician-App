"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, LoaderCircle, MessageSquare, Trash2 } from "lucide-react";

import { reviewContactAction, type ReviewContactState } from "@/app/customers/actions";
import type { PendingContact } from "@/lib/customer-list";
import { formatForDisplay } from "@/lib/phone-format";

/**
 * Numbers that called or texted and are not customers yet. Keep adds them to
 * the Customers list; Delete archives them and their conversation. Spam waits
 * here instead of filling the list and the New job picker.
 */

const initial: ReviewContactState = { error: "" };

function ChoiceButton({ choice }: { choice: "keep" | "delete" }) {
  const { pending, data } = useFormStatus();
  const mine = pending && data?.get("choice") === choice;
  const keep = choice === "keep";
  return (
    <button
      type="submit"
      name="choice"
      value={choice}
      disabled={pending}
      className={`tap-target inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control px-3 text-sm font-semibold disabled:opacity-60 ${
        keep ? "bg-brand text-on-brand" : "border border-critical/40 bg-critical-bg text-critical"
      }`}
    >
      {mine ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : keep ? (
        <Check className="h-4 w-4" aria-hidden />
      ) : (
        <Trash2 className="h-4 w-4" aria-hidden />
      )}
      {keep ? "Keep" : "Delete"}
    </button>
  );
}

function ContactRow({ contact }: { contact: PendingContact }) {
  const [state, action] = useActionState(reviewContactAction, initial);
  if (state.notice) {
    return (
      <li className="rounded-control border border-line p-3 text-sm text-ink-muted" role="status">
        {contact.phone ? formatForDisplay(contact.phone) : contact.name}: {state.notice}
      </li>
    );
  }
  return (
    <li className="rounded-control border border-line p-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="min-w-0 truncate font-semibold">{contact.phone ? formatForDisplay(contact.phone) : contact.name}</p>
        <p className="shrink-0 text-xs text-ink-muted">
          {contact.how} {contact.when}
        </p>
      </div>
      {contact.lastText ? (
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">“{contact.lastText}”</p>
      ) : null}
      {contact.conversationId ? (
        <Link
          href={`/messages/${contact.conversationId}`}
          className="tap-target mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
        >
          <MessageSquare className="h-4 w-4" aria-hidden />
          Open conversation
        </Link>
      ) : null}
      <form action={action} className="mt-2 flex gap-2">
        <input type="hidden" name="customerId" value={contact.id} />
        <ChoiceButton choice="keep" />
        <ChoiceButton choice="delete" />
      </form>
      {state.error ? (
        <p className="mt-2 text-sm text-critical" role="alert">
          {state.error}
        </p>
      ) : null}
    </li>
  );
}

export function PendingContacts({ contacts }: { contacts: PendingContact[] }) {
  if (contacts.length === 0) return null;
  return (
    <section aria-labelledby="pending-contacts-heading" className="mb-3 rounded-panel border border-brand/40 bg-surface p-3 sm:p-5">
      <h2 id="pending-contacts-heading" className="text-sm font-semibold">
        New contacts to review ({contacts.length})
      </h2>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        These numbers called or texted but aren&apos;t customers yet. Keep the real ones; delete spam and wrong numbers.
      </p>
      <ul className="mt-3 space-y-2">
        {contacts.map((contact) => (
          <ContactRow key={contact.id} contact={contact} />
        ))}
      </ul>
    </section>
  );
}
