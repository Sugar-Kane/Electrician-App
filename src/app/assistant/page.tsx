import { AssistantChat } from "@/components/assistant-chat";
import { FieldPageShell } from "@/components/field-page-shell";

/**
 * The assistant, for the business rather than for one screen.
 *
 * Everything it can read is the same data the person asking could already open
 * in the app — it is a faster way to read what they have, not a wider one.
 */
export const dynamic = "force-dynamic";

export default function AssistantPage() {
  return (
    /*
     * No description, and no header panel on a phone.
     *
     * The screen said "Assistant" in the app bar, said it again in a bordered
     * panel underneath, and then explained itself twice — once in that panel's
     * description and once more in the card below it that lists what it can
     * read. That is three quarters of a phone screen before the first
     * suggestion. The card is the one worth keeping: it says what the assistant
     * does *and* gives you something to tap.
     *
     * `fill` makes this a chat window rather than a page — the answers scroll
     * inside their own frame and the question box stays at the bottom.
     */
    <FieldPageShell title="Assistant" eyebrow="Ask the business" fill>
      <AssistantChat />
    </FieldPageShell>
  );
}
