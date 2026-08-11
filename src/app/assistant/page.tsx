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
    <FieldPageShell
      title="Assistant"
      eyebrow="Ask the business"
      description="Questions about jobs and invoices, answered from this business's own records."
    >
      <AssistantChat />
    </FieldPageShell>
  );
}
