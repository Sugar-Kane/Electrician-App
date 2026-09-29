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
 *
 * The PDF is a rendering of that stored text, so rebuilding one is safe in a way
 * that redrafting is not: the same words, laid out again. That distinction is
 * the reason `rebuildContractPdf` exists and there is no "regenerate this
 * contract" anywhere.
 */

export type ContractState = {
  error: string;
  notice?: string;
  /** The draft just written, so the screen can open it without a round trip. */
  contractId?: string;
};

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

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "";
  if (!userId) return { error: "You are not signed in." };

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

  const { data: created, error } = await supabase
    .from("contracts")
    .insert({
      organization_id: organizationId,
      job_id: text(row.id),
      body: filled.body,
      // Kept alongside the filled body so the passage can be replaced later
      // without touching the terms around it. Empty when the model was not
      // reachable, which leaves {{scope}} standing in the body — visible, and
      // correctly refused by an edit rather than spliced into the wrong place.
      scope: scope ?? "",
      unfilled: filled.unfilled,
      status: "draft",
    })
    .select("id")
    .maybeSingle();

  if (error || !created) return { error: "That contract could not be saved." };

  const contractId = text(created.id);

  // Made now rather than when somebody asks to look at it, so the document on
  // screen is the same file the customer is sent rather than a second render of
  // it. A failure here is reported and does not undo the contract: the drafted
  // text is the work, and the PDF can be rebuilt from it at any point.
  const { generateContractPdf } = await import("@/lib/pdf/contract-data");
  const document = await generateContractPdf({
    database: supabase,
    organizationId,
    contractId,
    timeZone,
    uploadedBy: userId,
  });

  revalidatePath(`/jobs/${jobNumber}`);

  const blanks = filled.unfilled.length
    ? `Draft contract created, with ${filled.unfilled.length} ${filled.unfilled.length === 1 ? "blank" : "blanks"} to fill in: ${filled.unfilled.map((key) => `{{${key}}}`).join(", ")}.`
    : "Draft contract created. Read it before you send it.";

  return {
    error: "",
    contractId,
    notice: document.error
      ? `${blanks} The PDF could not be produced — open the draft to try again.`
      : blanks,
  };
}

/**
 * Build the PDF for a contract that has not got one.
 *
 * Every contract drafted before documents existed is in that state, and so is
 * one whose render failed. It is not a redraft: the stored text is read back
 * untouched and laid out again, which is why this is offered and "generate this
 * contract again" is not.
 */
export async function rebuildContractPdf(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const contractId = String(formData.get("contractId") ?? "").trim();
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  if (!contractId) return { error: "That contract could not be found." };

  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "";
  if (!userId) return { error: "You are not signed in." };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data: organization } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();

  const { generateContractPdf } = await import("@/lib/pdf/contract-data");
  const document = await generateContractPdf({
    database: supabase,
    organizationId,
    contractId,
    timeZone: text(organization?.timezone) || "America/Los_Angeles",
    uploadedBy: userId,
  });

  if (document.error) return { error: document.error };

  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);

  return { error: "", contractId, notice: "Contract PDF ready." };
}

/**
 * Text the customer a link to sign the contract on their own phone.
 *
 * The claim comes before the text, deliberately. The database already allows
 * only one contract per job out for signature at a time, and marking this one
 * `sent` first is what finds a conflict *before* a message has gone to a
 * customer — a text saying "sign this" for a contract that is then refused
 * is a customer who has been told the wrong thing. If the text then fails, the
 * claim is released, so a contract never reads as sent when nothing was sent.
 *
 * The link is built from the app's own URL and never the request's host. On a
 * business's own domain the proxy rewrites every page into its booking page,
 * so a signing link on that host would open the booking form instead.
 */
export async function sendSigningLink(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const contractId = String(formData.get("contractId") ?? "").trim();
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  if (!contractId) return { error: "That contract could not be found." };

  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return { error: "You are not signed in." };

  // Read through the owner's session, so RLS decides whose contract this is.
  const { data } = await supabase
    .from("contracts")
    .select(
      "id, organization_id, job_id, status, unfilled, public_token, signed_at, signature_provider, organizations ( name ), jobs ( job_number, customers ( phone ) )",
    )
    .eq("id", contractId)
    .maybeSingle();

  if (!data) return { error: "That contract could not be found." };

  const contract = data as Record<string, unknown>;
  const job = (contract.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;
  const business = (contract.organizations ?? null) as Record<string, unknown> | null;
  const jobId = text(contract.job_id);

  // Only the job's newest contract can be signed. The button is only offered on
  // that one; this is what stands behind it.
  let superseded = false;
  if (jobId) {
    const { data: newest } = await supabase
      .from("contracts")
      .select("id")
      .eq("job_id", jobId)
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    superseded = Boolean(newest) && text(newest?.id) !== contractId;
  }

  const { signingLinkMessage, unsignableBecause } = await import("@/lib/contract-signing");
  const blocked = unsignableBecause({
    status: text(contract.status) || "draft",
    unfilled: Array.isArray(contract.unfilled) ? (contract.unfilled as string[]) : [],
    signatureProvider: text(contract.signature_provider) || null,
    signedAt: text(contract.signed_at) || null,
    superseded,
  });
  if (blocked) return { error: blocked };

  const { toE164 } = await import("@/lib/phone-format");
  const phone = toE164(text(customer?.phone));
  if (!phone) {
    return {
      error:
        "This customer has no mobile number we can text. Add one to the customer, or have them sign here in person.",
    };
  }

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const token = text(contract.public_token);
  if (!origin || !token) return { error: "The signing link could not be built." };
  const link = `${origin}/contract/${token}`;

  const organizationId = text(contract.organization_id);
  const { data: messaging } = await supabase
    .from("messaging_settings")
    .select("messaging_service_sid")
    .eq("organization_id", organizationId)
    .maybeSingle();
  const messagingServiceSid = text(messaging?.messaging_service_sid);
  if (!messagingServiceSid) {
    return { error: "Texting is not set up for this business yet, so the link could not be sent." };
  }

  /*
   * An older contract on this job that is still out for signature has been
   * replaced by this one. Its link already refuses to sign, since it is no
   * longer the newest; taking it out of `sent` is what lets the database admit
   * this one. In-app ones only: a Documenso envelope is Documenso's to withdraw.
   */
  if (jobId) {
    await supabase
      .from("contracts")
      .update({ status: "draft" })
      .eq("job_id", jobId)
      .eq("status", "sent")
      .eq("signature_provider", "in_app")
      .is("signed_at", null)
      .neq("id", contractId);
  }

  // The claim. Another contract on this job still out for signature is refused
  // here by the unique index, before anybody is texted — and a claim that
  // matched no row, because it was signed a moment ago, texts nobody either.
  const previousStatus = text(contract.status) || "draft";
  const previousProvider = text(contract.signature_provider) || null;
  const { data: claimed, error: claimError } = await supabase
    .from("contracts")
    .update({ status: "sent", signature_provider: "in_app" })
    .eq("id", contractId)
    .is("signed_at", null)
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return {
      error:
        claimError?.code === "23505"
          ? "Another contract for this job is already out for signature, so this one was not sent."
          : "That contract could not be sent. Reload the page and try again.",
    };
  }

  const { sendSms } = await import("@/lib/twilio");
  const sent = await sendSms({
    to: phone,
    body: signingLinkMessage({ businessName: text(business?.name), jobNumber: job?.job_number, link }),
    messagingServiceSid,
  });

  if (!sent.ok) {
    // Released, so the contract does not read as sent when nothing was.
    await supabase
      .from("contracts")
      .update({ status: previousStatus, signature_provider: previousProvider })
      .eq("id", contractId)
      .is("signed_at", null);
    return { error: `The text could not be sent (${sent.errorDetail || sent.errorCode}).` };
  }

  await supabase
    .from("contracts")
    .update({ signature_sent_at: new Date().toISOString() })
    .eq("id", contractId);

  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);

  const { formatForDisplay } = await import("@/lib/phone-format");
  return { error: "", contractId, notice: `Signing link texted to ${formatForDisplay(phone)}.` };
}
