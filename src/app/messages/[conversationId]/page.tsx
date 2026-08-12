import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PhoneCall } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { MessageThread } from "@/components/message-thread";
import { getConversationThread, getMessagingContext } from "@/lib/messaging";

export const metadata: Metadata = { title: "Conversation | Volteira" };

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  const context = await getMessagingContext();
  if (!context) notFound();

  const thread = await getConversationThread(context, conversationId);
  if (!thread) notFound();

  return (
    <FieldPageShell
      title={thread.customerName}
      eyebrow="Conversation"
      description={thread.phone}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/messages"
          className="tap-target inline-flex min-h-11 items-center gap-2 text-sm text-ink-muted hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> All messages
        </Link>
        {thread.phone ? (
          <a
            href={`tel:${thread.phone}`}
            className="tap-target inline-flex min-h-11 items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold text-white"
          >
            <PhoneCall className="h-4 w-4 text-brand" aria-hidden /> Call
          </a>
        ) : null}
      </div>

      <MessageThread thread={thread} />
    </FieldPageShell>
  );
}
