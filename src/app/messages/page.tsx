import type { Metadata } from "next";
import Link from "next/link";
import { MessagesSquare, PenSquare } from "lucide-react";

import { ConversationRow } from "@/components/conversation-row";
import { FieldPageShell } from "@/components/field-page-shell";
import {
  getMessagingContext,
  listConversations,
  type ConversationView,
} from "@/lib/messaging";

export const metadata: Metadata = { title: "Messages | Volteira" };

/**
 * Rendered on the server, so the timezone has to be explicit: without it these
 * are UTC, which shows the wrong clock time and buckets "today" on the wrong
 * day for anyone west of Greenwich.
 */
function formatWhen(iso: string | null, timeZone: string) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();

  const dayKey = (value: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);

  if (dayKey(date) === dayKey(now)) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  const week = 7 * 24 * 60 * 60 * 1000;
  if (now.getTime() - date.getTime() < week) {
    return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "numeric",
    day: "numeric",
  }).format(date);
}

const VIEWS = [
  { value: "active", label: "Inbox" },
  { value: "archived", label: "Archived" },
  { value: "deleted", label: "Deleted" },
] as const;

function asView(value: string): ConversationView {
  return VIEWS.some((view) => view.value === value) ? (value as ConversationView) : "active";
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ view: requested }, context] = await Promise.all([searchParams, getMessagingContext()]);
  const view = asView(requested ?? "");
  const conversations = context ? await listConversations(context, view) : [];
  const timeZone = context?.timezone ?? "America/Los_Angeles";

  return (
    <FieldPageShell
      title="Messages"
      eyebrow="Customer conversations"
      description="Texts with customers about their appointments."
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        {/*
          Archived and deleted are views of the same table, not fates. A thread
          cleared out of the inbox is still here, still whole, and still on its
          job — these tabs are how somebody finds that out rather than assuming
          the worst.
        */}
        <div
          className="inline-flex rounded-control border border-line p-1"
          role="tablist"
          aria-label="Which conversations to show"
        >
          {VIEWS.map((option) => (
            <Link
              key={option.value}
              href={option.value === "active" ? "/messages" : `/messages?view=${option.value}`}
              role="tab"
              aria-selected={view === option.value}
              className={`tap-target inline-flex min-h-11 min-w-16 items-center justify-center rounded-chip px-3 text-xs font-semibold ${
                view === option.value ? "bg-brand text-on-brand" : "text-ink-muted"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        <Link
          href="/messages/new"
          className="tap-target inline-flex min-h-12 items-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
        >
          <PenSquare className="h-4 w-4" aria-hidden /> New message
        </Link>
      </div>

      {conversations.length === 0 ? (
        <section className="rounded-panel border border-line bg-surface p-8 text-center">
          <MessagesSquare className="mx-auto h-8 w-8 text-ink-faint" aria-hidden />
          <h2 className="mt-4 font-semibold">
            {view === "archived"
              ? "Nothing archived"
              : view === "deleted"
                ? "Nothing deleted"
                : "No conversations yet"}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
            {view === "active"
              ? "Start one with any customer who has opted in to text messages, or wait for someone to text your business number — an incoming text opens a thread here on its own."
              : "Swipe a conversation in the inbox to put it here. Nothing is destroyed either way — the messages stay on the customer and on their job."}
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-panel border border-line bg-surface">
          <ul>
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <ConversationRow
                  conversation={conversation}
                  when={formatWhen(conversation.lastMessageAt, timeZone)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-3 px-1 text-xs leading-5 text-ink-faint">
        Swipe a conversation left to delete it or right to archive it. Neither one destroys
        anything: the messages, the customer and the job keep every link they had, and a thread
        that belongs to a job stays readable on that job.
      </p>
    </FieldPageShell>
  );
}
