import "server-only";

import { deliverInvoice } from "@/lib/invoice-delivery";
import { describeDelivery, formatMoney } from "@/lib/invoice-messages";
import { invoiceTotals } from "@/lib/invoice-math";
import { parseCostToCents } from "@/lib/new-job-input";
import { currentContext } from "@/lib/request-context";
import { zonedWallClockToIso } from "@/lib/schedule-labels";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { sendSms } from "@/lib/twilio";

/**
 * The actions somebody has actually approved.
 *
 * Reached only from `confirmProposal`, with the input the person read on the
 * screen. Nothing here asks a model anything: a second model call at this point
 * could produce a different action from the one that was approved, which would
 * make the confirmation meaningless.
 *
 * Every write goes through the caller's session, so RLS decides what may be
 * touched. Each returns a sentence saying what happened, including when it did
 * not happen — a confirmation that silently fails is worse than one that
 * refuses, because the person believes it went out.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function runConfirmedTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const context = await currentContext();
  if (!context) return "You are not signed in to a business, so nothing was done.";

  const supabase = asFlexibleClient(await createClient());
  const organizationId = context.organizationId;

  switch (name) {
    case "send_invoice": {
      const number = text(input.invoice_number).replace(/^INV-/i, "");
      const channel = text(input.channel);
      const channels =
        channel === "both" ? (["sms", "email"] as const) : channel === "email" ? (["email"] as const) : (["sms"] as const);

      const { data } = await supabase
        .from("invoices")
        .select(
          `id, invoice_number, status, total_cents, due_at, stripe_hosted_invoice_url,
           jobs ( customer_description, customers ( first_name, last_name, company_name, phone, email ) ),
           organizations ( name, phone, timezone )`,
        )
        .eq("organization_id", organizationId)
        .eq("invoice_number", Number(number))
        .maybeSingle();

      if (!data) return `Invoice ${text(input.invoice_number)} could not be found. Nothing was sent.`;

      const row = data as Record<string, unknown>;
      const job = (row.jobs ?? null) as Record<string, unknown> | null;
      const customer = (job?.customers ?? null) as Record<string, unknown> | null;
      const organization = (row.organizations ?? null) as Record<string, unknown> | null;
      const amount = Number(row.total_cents ?? 0) / 100;

      const attempts = await deliverInvoice({
        invoiceId: text(row.id),
        organizationId,
        channels: [...channels],
        customerPhone: text(customer?.phone),
        customerEmail: text(customer?.email),
        facts: {
          businessName: text(organization?.name) || "Your electrician",
          businessPhone: text(organization?.phone) || "our office",
          contactName:
            text(customer?.company_name) ||
            [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(" "),
          invoiceNumber: `INV-${text(row.invoice_number) || number}`,
          amountDue: amount,
          dueLabel: "",
          payUrl: text(row.stripe_hosted_invoice_url) || undefined,
          workSummary: text(job?.customer_description) || undefined,
        },
      });

      return describeDelivery(attempts).message;
    }

    case "send_text": {
      const who = text(input.customer).toLowerCase();
      const body = text(input.message).slice(0, 300);
      if (!body) return "There was no message to send, so nothing was sent.";

      const { data } = await supabase
        .from("customers")
        .select("first_name, last_name, company_name, phone")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .limit(200);

      const match = ((data ?? []) as Record<string, unknown>[]).find((row) => {
        const name = [
          text(row.company_name),
          text(row.first_name),
          text(row.last_name),
        ]
          .join(" ")
          .toLowerCase();
        return name.includes(who) || text(row.phone).includes(who);
      });

      const phone = text(match?.phone);
      if (!phone) return `No customer matching "${text(input.customer)}" has a mobile number. Nothing was sent.`;

      const { data: settings } = await supabase
        .from("messaging_settings")
        .select("messaging_service_sid")
        .eq("organization_id", organizationId)
        .maybeSingle();

      const sid = text(settings?.messaging_service_sid);
      if (!sid) return "This business has no messaging service, so no text could be sent.";

      const result = await sendSms({ to: phone, body, messagingServiceSid: sid });
      return result.ok
        ? `Text sent to ${phone}.`
        : `The text could not be sent (${result.errorCode}: ${result.errorDetail}).`;
    }

    case "schedule_job": {
      const jobNumber = Number(text(input.job_number));
      const startLocal = text(input.start_local);
      if (!Number.isFinite(jobNumber) || !startLocal) {
        return "That job or time could not be read, so nothing was changed.";
      }

      const hours = Number(text(input.duration_hours) || "2");
      const minutes = Number.isFinite(hours) && hours > 0 ? Math.round(hours * 60) : 120;

      // Wall clock in the business's zone, not the server's — the fault that
      // once had windows offered in UTC.
      const start = zonedWallClockToIso(startLocal, context.timeZone);
      const end = new Date(new Date(start).getTime() + minutes * 60_000).toISOString();

      const { error } = await supabase
        .from("jobs")
        .update({
          scheduled_start: start,
          scheduled_end: end,
          arrival_window_start: start,
          arrival_window_end: end,
        })
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber);

      if (error) return "That job could not be moved.";
      return `Job #${jobNumber} moved. The customer has not been told — send them a text if they should know.`;
    }

    case "assign_technician": {
      const jobNumber = Number(text(input.job_number));
      if (!Number.isFinite(jobNumber)) return "That job could not be read, so nothing was changed.";

      const who = text(input.technician);

      // An empty name is "take them off", which is a real instruction and not a
      // failed lookup. Treating the two the same would silently unassign a job
      // whenever a name was misheard.
      let technicianId: string | null = null;
      if (who) {
        const { data } = await supabase
          .from("technicians")
          .select("id, display_name")
          .eq("organization_id", organizationId)
          .limit(100);

        const rows = (data ?? []) as Record<string, unknown>[];
        const needle = who.toLowerCase();
        const exact = rows.find((row) => text(row.display_name).toLowerCase() === needle);
        const partial = rows.filter((row) => text(row.display_name).toLowerCase().includes(needle));

        const match = exact ?? (partial.length === 1 ? partial[0] : undefined);
        if (!match) {
          // Ambiguity is reported rather than guessed. Two people called Nick
          // and picking one is how the wrong person drives to Nipomo.
          return partial.length > 1
            ? `More than one technician matches "${who}": ${partial.map((row) => text(row.display_name)).join(", ")}. Nothing was changed.`
            : `No technician called "${who}" is on this crew. Nothing was changed.`;
        }
        technicianId = text(match.id);
      }

      const { data: updated, error } = await supabase
        .from("jobs")
        .update({ technician_id: technicianId })
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber)
        .select("job_number")
        .maybeSingle();

      if (error) return "That job could not be updated.";
      if (!updated) return `Job #${jobNumber} could not be found. Nothing was changed.`;

      return who
        ? `${who} is now on job #${jobNumber}. The customer has not been told.`
        : `Job #${jobNumber} has nobody assigned now.`;
    }

    case "set_invoice_amount": {
      const jobNumber = Number(text(input.job_number));
      const cents = parseCostToCents(text(input.amount));
      if (!Number.isFinite(jobNumber)) return "That job could not be read.";
      if (cents === null || cents <= 0) return "That amount could not be read, so no invoice was raised.";

      const { data: job } = await supabase
        .from("jobs")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber)
        .maybeSingle();

      if (!job) return `Job #${jobNumber} could not be found.`;

      const totals = invoiceTotals({ subtotalCents: cents });
      const { error } = await supabase.from("invoices").insert({
        organization_id: organizationId,
        job_id: text((job as Record<string, unknown>).id),
        status: "draft",
        subtotal_cents: totals.subtotalCents,
        diagnostic_credit_cents: totals.diagnosticCreditCents,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents,
        balance_due_cents: totals.totalCents,
        stripe_application_fee_cents: totals.applicationFeeCents,
      });

      if (error) return "That invoice could not be created.";
      return `Draft invoice for ${formatMoney(totals.totalCents / 100)} created on job #${jobNumber}. It has not been sent.`;
    }

    case "draft_contract": {
      const jobNumber = text(input.job_number);
      if (!jobNumber) return "That job could not be read, so no contract was drafted.";

      // The job page's own generator, called rather than reimplemented. Two
      // code paths for the same document is how the two drift, and a contract
      // that differs depending on where it was raised is the worst version of
      // that.
      const { generateContract } = await import("@/app/jobs/[jobId]/contract-actions");
      const form = new FormData();
      form.set("jobNumber", jobNumber);

      const result = await generateContract({ error: "" }, form);
      if (result.error) return result.error;
      return `${result.notice ?? "Draft contract created."} Open job #${jobNumber} to read it — it has not been sent.`;
    }

    default:
      return `Nothing happened: ${name} is not something this can do.`;
  }
}
