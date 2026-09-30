import {
  asConversationView,
  getInboxFingerprint,
  getMessagingContext,
  getThreadFingerprint,
} from "@/lib/messaging";

/**
 * "Has anything changed?" for a screen that is showing messages.
 *
 * `?conversation=<id>` answers for one open thread, and `?view=` for the inbox.
 * The screen compares the answer with the fingerprint it was rendered with and
 * refreshes only when they differ, so a reply appears on its own while the
 * page itself is only re-rendered when there is something new to show.
 *
 * Scoped by the signed-in member's organization like every other messaging
 * read. All it gives away is a hash of rows the caller could already open.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const context = await getMessagingContext();
  if (!context) {
    return Response.json(
      { error: "Authentication required." },
      { status: 401, headers: NO_STORE },
    );
  }

  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversation");

  if (conversationId !== null && !UUID.test(conversationId)) {
    return Response.json({ error: "Unknown conversation." }, { status: 404, headers: NO_STORE });
  }

  const fingerprint = conversationId
    ? await getThreadFingerprint(context, conversationId)
    : await getInboxFingerprint(context, asConversationView(params.get("view")));

  // A failed read is "don't know", never a change: the screen keeps what it has
  // and asks again on its next check.
  if (fingerprint === null) {
    return Response.json({ error: "Try again shortly." }, { status: 503, headers: NO_STORE });
  }

  return Response.json({ fingerprint }, { headers: NO_STORE });
}
