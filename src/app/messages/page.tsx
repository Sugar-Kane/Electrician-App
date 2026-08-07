import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MessageSquare, MessagesSquare, PenSquare } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getMessagingContext, listConversations } from "@/lib/messaging";

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

export default async function MessagesPage() {
  const context = await getMessagingContext();
  const conversations = context ? await listConversations(context) : [];
  const timeZone = context?.timezone ?? "America/Los_Angeles";

  return (
    <FieldPageShell
      title="Messages"
      eyebrow="Customer conversations"
      description="Texts with customers about their appointments."
      active="Messages"
    >
      <div className="mb-4 flex justify-end">
        <Link
          href="/messages/new"
          className="tap-target inline-flex min-h-12 items-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-bold text-[#071723]"
        >
          <PenSquare className="h-4 w-4" aria-hidden /> New message
        </Link>
      </div>

      {conversations.length === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-8 text-center">
          <MessagesSquare className="mx-auto h-8 w-8 text-slate-600" aria-hidden />
          <h2 className="mt-4 font-semibold">No conversations yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            Start one with any customer who has opted in to text messages, or wait for
            someone to text your business number — an incoming text opens a thread here
            on its own.
          </p>
        </section>
      ) : (
        <section className="overflow-hidden rounded-3xl border border-white/10 bg-[#0b1b27]">
          <ul>
            {conversations.map((conversation, index) => (
              <li key={conversation.id}>
                <Link
                  href={`/messages/${conversation.id}`}
                  className={`tap-row flex min-h-[76px] items-center gap-3 px-4 py-3 hover:bg-white/[0.03] ${index > 0 ? "border-t border-white/[0.06]" : ""}`}
                >
                  <span
                    className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-bold ${
                      conversation.unread
                        ? "bg-[#ffc21c] text-[#071723]"
                        : "bg-white/[0.06] text-slate-300"
                    }`}
                    aria-hidden
                  >
                    {conversation.initials}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span
                        className={`truncate text-sm ${conversation.unread ? "font-bold text-white" : "font-semibold text-slate-200"}`}
                      >
                        {conversation.customerName}
                      </span>
                      <span className="shrink-0 text-[11px] text-slate-500">
                        {formatWhen(conversation.lastMessageAt, timeZone)}
                      </span>
                    </span>
                    <span className="mt-1 flex items-center gap-1.5">
                      {conversation.lastMessageDirection === "outbound" ? (
                        <MessageSquare className="h-3 w-3 shrink-0 text-slate-600" aria-hidden />
                      ) : null}
                      <span
                        className={`truncate text-xs ${conversation.unread ? "text-slate-200" : "text-slate-500"}`}
                      >
                        {conversation.lastMessageBody || "No messages yet"}
                      </span>
                    </span>
                  </span>

                  {conversation.unread ? (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ffc21c]"
                      aria-label="Waiting on a reply"
                    />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-slate-600" aria-hidden />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </FieldPageShell>
  );
}
