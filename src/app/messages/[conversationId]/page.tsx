import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ConversationBar } from "@/components/conversation-bar";
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
    /*
     * `fill` rather than the usual scrolling column: the bar stays put, the
     * messages move under it, and the box you type into stays under your thumb.
     * `bar` puts the customer where the page title would have gone, so the name
     * is said once instead of three times.
     */
    <FieldPageShell
      title={thread.customerName}
      eyebrow="Conversation"
      backHref="/messages"
      fill
      bar={
        <ConversationBar
          customerName={thread.customerName}
          initials={thread.initials}
          phone={thread.phone}
        />
      }
    >
      <MessageThread thread={thread} />
    </FieldPageShell>
  );
}
