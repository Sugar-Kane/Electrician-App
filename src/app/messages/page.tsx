import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, MessageSquare, MessagesSquare } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getMessagingContext, listConversations } from "@/lib/messaging";

export const metadata: Metadata = { title: "Messages | Volteira" };

function formatWhen(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
  }
  const week = 7 * 24 * 60 * 60 * 1000;
  if (now.getTime() - date.getTime() < week) {
    return new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric" }).format(date);
}

export default async function MessagesPage() {
  const context = await getMessagingContext();
  const conversations = context ? await listConversations(context) : [];

  return (
    <FieldPageShell
      title="Messages"
      eyebrow="Customer conversations"
      description="Texts with customers about their appointments."
      active="More"
    >
      {conversations.length === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-8 text-center">
          <MessagesSquare className="mx-auto h-8 w-8 text-slate-600" aria-hidden />
          <h2 className="mt-4 font-semibold">No conversations yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            A thread appears here once a customer who has opted in books a job, or once
            someone texts your business number.
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
                        {formatWhen(conversation.lastMessageAt)}
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
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#ffc21c]" aria-label="Unanswered" />
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
