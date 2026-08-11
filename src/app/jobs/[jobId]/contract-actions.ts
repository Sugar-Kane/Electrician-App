"use server";

import { revalidatePath } from "next/cache";

import { draftScope } from "@/lib/claude";
import { fillTemplate, STARTER_TEMPLATE, type ContractFacts } from "@/lib/contract-template";
import { formatMoney } from "@/lib/invoice-messages";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Turning a job into the contract the customer signs.
 *
 * Everything that costs money if it is wrong — the name, the address, the date,
 * the price — is substituted from the job's own rows. The model writes one
 * paragraph, the scope of work, and if it cannot the placeholder is left
 * standing rather than the contract shipping with an invented paragraph.
 *
 * The result is stored as text and never regenerated. A contract that changes
 * after it was agreed is the one thing a contract may not do.
 */

export type ContractState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function generateContract(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return { error: "That job could not be found." };

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data: job } = await supabase
    .from("jobs")
    .select(
      `id, job_number, category, customer_description, scheduled_start, diagnostic_fee_cents,
       customers ( first_name, last_name, company_name ),
       properties ( address_line_1, city, state, postal_code ),
       organizations ( name, phone, timezone ),
       invoices ( total_cents )`,
    )
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  const row = job as Record<string, unknown>;
  const customer = (row.customers ?? null) as Record<string, unknown> | null;
  const property = (row.properties ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;
  const invoices = Array.isArray(row.invoices) ? (row.invoices as Record<string, unknown>[]) : [];

  const { data: template } = await supabase
    .from("contract_templates")
    .select("body")
    .eq("organization_id", organizationId)
    .maybeSingle();

  const body = text(template?.body).trim() || STARTER_TEMPLATE;

  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const formatDate = (iso: string) =>
    iso
      ? new Intl.DateTimeFormat("en-US", {
          timeZone,
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(iso))
      : "";

  const customerName =
    text(customer?.company_name) ||
    [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(" ");

  const address = [
    text(property?.address_line_1),
    text(property?.city),
    text(property?.state),
    text(property?.postal_code),
  ]
    .filter(Boolean)
    .join(", ");

  const totalCents = invoices.reduce(
    (sum, invoice) => sum + Number(invoice.total_cents ?? 0),
    0,
  );
  const depositCents = Number(row.diagnostic_fee_cents ?? 0);
  const workType = text(row.category).replace(/_/g, " ");
  const description = text(row.customer_description);

  // Best effort. A model outage leaves {{scope}} standing in the draft, which
  // is visible and fixable; a paragraph invented to fill the gap is neither.
  const scope = await draftScope({ description, workType });

  const facts: Partial<ContractFacts> = {
    business_name: text(organization?.name),
    business_phone: text(organization?.phone),
    customer_name: customerName,
    service_address: address,
    job_number: String(row.job_number ?? jobNumber),
    job_date: formatDate(text(row.scheduled_start)),
    work_type: workType,
    total: totalCents > 0 ? formatMoney(totalCents / 100) : "",
    deposit: depositCents > 0 ? formatMoney(depositCents / 100) : "",
    scope: scope ?? "",
    today: formatDate(new Date().toISOString()),
  };

  const filled = fillTemplate(body, facts);

  const { error } = await supabase.from("contracts").insert({
    organization_id: organizationId,
    job_id: text(row.id),
    body: filled.body,
    unfilled: filled.unfilled,
    status: "draft",
  });

  if (error) return { error: "That contract could not be saved." };

  revalidatePath(`/jobs/${jobNumber}`);

  return {
    error: "",
    notice: filled.unfilled.length
      ? `Draft contract created, with ${filled.unfilled.length} ${filled.unfilled.length === 1 ? "blank" : "blanks"} to fill in: ${filled.unfilled.map((key) => `{{${key}}}`).join(", ")}.`
      : "Draft contract created. Read it before you send it.",
  };
}
