import type { Metadata } from "next";
import { TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { MessageTemplateEditor } from "@/components/message-template-editor";
import { getMessagingContext } from "@/lib/messaging";
import { TEMPLATE_TRIGGERS } from "@/lib/message-templates";

export const metadata: Metadata = { title: "Automatic messages | Volteira" };

const TRIGGER_COPY: Record<string, { label: string; description: string }> = {
  job_confirmed: {
    label: "Booking confirmed",
    description: "Sent when a customer pays for a diagnostic visit.",
  },
  job_reminder: {
    label: "Appointment reminder",
    description: "Ahead of a scheduled visit.",
  },
  job_en_route: {
    label: "Technician on the way",
    description: "When the technician sets off.",
  },
  job_arrived: { label: "Technician arrived", description: "On arrival at the property." },
  job_completed: { label: "Work complete", description: "When the job is finished." },
  job_rescheduled: { label: "Appointment moved", description: "When the time changes." },
  job_canceled: { label: "Appointment canceled", description: "When a visit is called off." },
  job_awaiting_payment: {
    label: "Holding the slot",
    description: "While a booking is unpaid.",
  },
  estimate_sent: { label: "Estimate ready", description: "When an estimate goes out." },
  invoice_sent: { label: "Invoice ready", description: "When an invoice goes out." },
  invoice_overdue: { label: "Invoice overdue", description: "When payment is late." },
  review_request: { label: "Review request", description: "After the work is done." },
};

export default async function AutomaticMessagesPage() {
  const context = await getMessagingContext();

  const { data } = context
    ? await context.database
        .from("message_templates")
        .select("trigger_event, body, is_active")
        .eq("organization_id", context.organizationId)
        .eq("channel", "sms")
    : { data: null };

  const templates = new Map(
    ((data ?? []) as Record<string, unknown>[]).map((row) => [
      String(row.trigger_event),
      { body: String(row.body ?? ""), isActive: row.is_active === true },
    ]),
  );

  return (
    <FieldPageShell
      title="Automatic messages"
      eyebrow="Messaging"
      description="What gets texted to customers, and when."
      active="Messages"
    >
      <section className="mb-4 rounded-3xl border border-white/10 bg-[#0b1b27] p-5 text-sm leading-6 text-slate-300 sm:p-6">
        <p>
          These only go to customers who opted in to text messages, and never to anyone who
          replied STOP. Words in <code className="text-[#ffc21c]">{"{{braces}}"}</code> are
          filled in when the message is sent — an unknown one is left out rather than shown
          to the customer.
        </p>
        <p className="mt-3 flex items-start gap-2 text-xs text-amber-100">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
          Keep &ldquo;Reply STOP to opt out&rdquo; in these. It matches the sample messages
          filed with the carrier, and traffic that does not match the registration is what
          gets a messaging campaign pulled.
        </p>
      </section>

      {templates.size === 0 ? (
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-8 text-center">
          <h2 className="font-semibold">No templates yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            These are created with your business workspace. If this is empty, the messaging
            migration has not been applied to this environment.
          </p>
        </section>
      ) : (
        <div className="space-y-3">
          {TEMPLATE_TRIGGERS.filter((trigger) => templates.has(trigger)).map((trigger) => {
            const template = templates.get(trigger);
            const copy = TRIGGER_COPY[trigger] ?? { label: trigger, description: "" };
            return (
              <MessageTemplateEditor
                key={trigger}
                trigger={trigger}
                label={copy.label}
                description={copy.description}
                body={template?.body ?? ""}
                isActive={template?.isActive ?? false}
              />
            );
          })}
        </div>
      )}
    </FieldPageShell>
  );
}
