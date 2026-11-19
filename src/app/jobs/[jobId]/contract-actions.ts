"use server";

import { billingParty } from "@/lib/customer-details";
import { revalidatePath } from "next/cache";

import { recordActivity } from "@/lib/activity";

import { takeAiUse } from "@/lib/ai-allowance";
import { draftScope } from "@/lib/claude";
import { withContinuation, workItemLabel } from "@/lib/job-scope";
import { jobContinuationLine } from "@/lib/job-scope-server";
import {
  completeDraftFields,
  placeholdersUsed,
  contractMoney,
  fillTemplate,
  plainScope,
  serviceAddress,
  STARTER_TEMPLATE,
  type ContractFacts,
} from "@/lib/contract-template";
import { creditSource } from "@/lib/follow-up-jobs";
import { formatMoney } from "@/lib/invoice-messages";
import { unbilledLines } from "@/lib/job-billing";
import { lineTotalCents } from "@/lib/job-lines";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { activeMembership } from "@/lib/request-context";

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
  /** The person sending has not adopted a signature yet; the screen links to where they can. */
  needsSignature?: boolean;
  /** Signed for the business, so the customer can be handed the pad. */
  signedForBusiness?: boolean;
};

type Signable = {
  contract: Record<string, unknown>;
  job: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  business: Record<string, unknown> | null;
  jobId: string;
  /** Why it cannot be signed right now, or empty when it can. */
  blocked: string;
};

/**
 * A contract about to be put in front of its customer, and whether it can be.
 *
 * Read through the member's session, so RLS decides whose contract this is,
 * with the same refusals the customer's page makes. Only the job's newest
 * contract can be signed: the buttons are only offered on that one, and this
 * is what stands behind them.
 */
async function loadSignable(supabase: FlexibleSupabaseClient, contractId: string): Promise<Signable | null> {
  const { data } = await supabase
    .from("contracts")
    .select(
      "id, organization_id, job_id, kind, status, unfilled, public_token, signed_at, signature_provider, signature_sent_at, organizations ( name, timezone ), jobs ( job_number, customers ( id, phone, email ) )",
    )
    .eq("id", contractId)
    .maybeSingle();

  if (!data) return null;

  const contract = data as Record<string, unknown>;
  const job = (contract.jobs ?? null) as Record<string, unknown> | null;
  const jobId = text(contract.job_id);

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

  const { unsignableBecause } = await import("@/lib/contract-signing");
  return {
    contract,
    job,
    customer: (job?.customers ?? null) as Record<string, unknown> | null,
    business: (contract.organizations ?? null) as Record<string, unknown> | null,
    jobId,
    blocked: unsignableBecause({
      status: text(contract.status) || "draft",
      unfilled: Array.isArray(contract.unfilled) ? (contract.unfilled as string[]) : [],
      signatureProvider: text(contract.signature_provider) || null,
      signedAt: text(contract.signed_at) || null,
      superseded,
    }),
  };
}

const NEEDS_SIGNATURE =
  "Save your signature first, under Settings → Contract. It goes on the contract for the business before the customer sees it.";

/**
 * Sign the contract for the business, as the person sending it, if nobody has.
 *
 * Through `sign_contract_as_contractor`, which uses the caller's own adopted
 * signature and nothing else — the only way the business's signature gets on
 * a contract. Signed once: a contract sent again keeps the signature it went
 * out with the first time, whoever sends it again.
 *
 * The PDF is rebuilt straight afterwards, so the copy the customer opens or
 * downloads carries the business's signature too. A failed rebuild does not
 * undo the signature; the job page can build the PDF again.
 */
async function signForBusinessFirst(input: {
  supabase: FlexibleSupabaseClient;
  contractId: string;
  organizationId: string;
  userId: string;
  timeZone: string;
}): Promise<{ ok: true } | { ok: false; error: string; needsSignature?: boolean }> {
  const { supabase, contractId, organizationId, userId } = input;

  const { data: current } = await supabase
    .from("contracts")
    .select("contractor_signed_at")
    .eq("id", contractId)
    .maybeSingle();
  if (current?.contractor_signed_at) return { ok: true };

  const { data: signer } = await supabase
    .from("contract_signers")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!signer) return { ok: false, error: NEEDS_SIGNATURE, needsSignature: true };

  const { data: signedAt, error } = await supabase.rpc("sign_contract_as_contractor", {
    p_contract_id: contractId,
  });
  if (error || !signedAt) {
    return { ok: false, error: "The contract could not be signed for the business. Reload the page and try again." };
  }

  try {
    const { generateContractPdf } = await import("@/lib/pdf/contract-data");
    const result = await generateContractPdf({
      database: supabase,
      organizationId,
      contractId,
      timeZone: input.timeZone,
      uploadedBy: userId,
    });
    if (result.error) console.error("business-signed contract PDF failed", { contractId, error: result.error });
  } catch (error) {
    console.error("business-signed contract PDF failed", { contractId, error });
  }

  return { ok: true };
}

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

  const { data: membership } = await activeMembership();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data: job } = await supabase
    .from("jobs")
    .select(
      `id, job_number, category, customer_description, scope_of_work, scheduled_start, diagnostic_fee_cents,
       diagnostic_paid, follow_up_of,
       customers ( first_name, last_name, company_name, bill_to, address_line_1, city, state, postal_code ),
       properties ( address_line_1, city, state, postal_code ),
       organizations ( name, phone, timezone ),
       invoices ( id, status, total_cents, diagnostic_credit_cents ),
       job_line_items ( kind, description, quantity, unit, unit_price_cents, invoice_id )`,
    )
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  const row = job as Record<string, unknown>;
  const customer = (row.customers ?? null) as Record<string, unknown> | null;
  const property = (row.properties ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;
  // A voided invoice billed nothing, so it is not part of the price.
  const invoices = (Array.isArray(row.invoices) ? (row.invoices as Record<string, unknown>[]) : []).filter(
    (invoice) => invoice.status !== "void",
  );
  const lines = Array.isArray(row.job_line_items)
    ? (row.job_line_items as Record<string, unknown>[])
    : [];

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

  // The party the contract is made with: the business or the person, as the customer is set.
  const customerName = billingParty(customer, null).name;

  // The job's address, or the customer's when the job was saved without one.
  const address = serviceAddress(property, customer);

  /*
   * Whose diagnostic the deposit line is about.
   *
   * A work order booked from a diagnostic has no fee of its own; the customer
   * paid it for the visit before, and it comes off this work. Without this the
   * work order's contract had no deposit line at all, and its invoice — which
   * does take the fee off — would not have matched it.
   */
  const followUpOf = text(row.follow_up_of);
  const { data: followedRow } = followUpOf
    ? await supabase
        .from("jobs")
        .select("diagnostic_paid, diagnostic_fee_cents")
        .eq("organization_id", organizationId)
        .eq("id", followUpOf)
        .maybeSingle()
    : { data: null };
  const followed = followedRow as Record<string, unknown> | null;
  /*
   * A work order that no diagnostic came before has no diagnostic fee. The
   * column holds the business's default fee on every job, so read bare it
   * put "Diagnostic fee: $180.00, due before work begins" on a quote for a
   * panel swap nobody had visited for.
   */
  // One whose fee was paid all the same — booked online as a diagnostic, then
  // made a work order — keeps it, and it still comes off.
  const noVisitFirst = text(row.category) === "work_order" && !followUpOf && row.diagnostic_paid !== true;
  const fee = creditSource(
    {
      diagnosticPaid: row.diagnostic_paid === true,
      diagnosticFeeCents: noVisitFirst ? 0 : Number(row.diagnostic_fee_cents ?? 0),
      followUpOf: followUpOf || null,
    },
    followed
      ? {
          diagnosticPaid: followed.diagnostic_paid === true,
          diagnosticFeeCents: Number(followed.diagnostic_fee_cents ?? 0),
        }
      : null,
  );

  const money = contractMoney({
    category: text(row.category),
    diagnosticFeeCents: fee.diagnosticFeeCents,
    diagnosticPaid: fee.diagnosticPaid,
    invoices: invoices.map((invoice) => ({
      totalCents: Number(invoice.total_cents ?? 0),
      diagnosticCreditCents: Number(invoice.diagnostic_credit_cents ?? 0),
    })),
    // numeric arrives as a string over PostgREST, so it is read as a number
    // before anything multiplies it.
    pricedLineCount: lines.filter(
      (line) =>
        lineTotalCents({
          quantity: Number(line.quantity ?? 0),
          unitPriceCents: Number(line.unit_price_cents ?? 0),
        }) > 0,
    ).length,
    // Lines no live invoice has billed yet. The contract covers everything on
    // the job as it stands, and anything written after the customer signs
    // goes on a change order instead.
    unbilledCents: unbilledLines(
      lines.map((line) => ({ invoiceId: text(line.invoice_id) || null, line })),
      invoices.map((invoice) => ({ id: text(invoice.id), status: text(invoice.status) })),
    ).reduce(
      (sum, { line }) =>
        sum +
        lineTotalCents({
          quantity: Number(line.quantity ?? 0),
          unitPriceCents: Number(line.unit_price_cents ?? 0),
        }),
      0,
    ),
  });
  const workType = text(row.category).replace(/_/g, " ");
  const description = text(row.customer_description);

  // Best effort. A model outage, or a business past this month's built-in AI,
  // leaves {{scope}} standing in the draft, which is visible and fixable; a
  // paragraph invented to fill the gap is neither.
  // The scope written on the job's Estimate card comes first: the
  // electrician's own words, already read. Otherwise a draft from the request
  // and the work and materials lines.
  const writtenScope = text(row.scope_of_work).replace(/\s+/g, " ").trim();
  const aiScope = writtenScope
    ? null
    : (await takeAiUse(organizationId, "contract_scope")).ok
      ? await draftScope({
          description,
          workType,
          visitOnly: money.source === "diagnostic",
          workItems: lines.map(workItemLabel),
        })
      : null;
  // Without the AI, a plain paragraph from what the job itself says: the
  // request and the work written on it. Still a draft, read before sending.
  const baseScope =
    writtenScope ||
    aiScope ||
    plainScope({
      workType,
      description,
      workItems: lines.map((line) => text(line.description)),
      visitOnly: money.source === "diagnostic",
    }) ||
    null;
  // A follow-up says which job it continues, in front of its scope.
  const continuation = await jobContinuationLine(supabase, {
    organizationId,
    jobId: text(row.id),
    timeZone: text(organization?.timezone) || "America/Los_Angeles",
  });
  const scope = baseScope || continuation ? withContinuation(baseScope ?? "", continuation) : null;

  const facts: Partial<ContractFacts> = {
    business_name: text(organization?.name),
    business_phone: text(organization?.phone),
    customer_name: customerName,
    service_address: address,
    job_number: String(row.job_number ?? jobNumber),
    // A quote has no time yet, and that is not a blank to fill before it can
    // be sent: the date is agreed once the work is.
    job_date: formatDate(text(row.scheduled_start)) || "a date to be agreed",
    work_type: workType,
    total: money.totalCents > 0 ? formatMoney(money.totalCents / 100) : "",
    // "Diagnostic fee: $180.00 (already paid)" — a customer who paid when they
    // booked is not asked for it again by their own contract. Called the
    // diagnostic fee here, on the signing summary and on the invoice alike.
    deposit:
      money.depositCents > 0
        ? `${formatMoney(money.depositCents / 100)}${money.depositPaid ? " (already paid)" : ", due before work begins"}`
        : // No visit came first, so there is no fee — said, rather than left
          // as a blank that stops a quote being sent until somebody types "none".
          "None",
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
      // The same figures the words above were filled from, for the summary
      // the customer sees above them.
      total_cents: money.totalCents,
      deposit_cents: money.depositCents,
      deposit_paid: money.depositPaid,
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
 * A change order for what was added after the customer signed.
 *
 * A signed agreement is amended in writing, not edited. Everything written on
 * the job since the customer last signed is swept into a change order of its
 * own — the same structured change order the Change orders card makes, so
 * there is one list of them and one contract total — and its document is
 * drawn up for the customer to sign the way the contract was: the texted link,
 * or the pad on the job page. The contract it adds to is left exactly as the
 * customer signed it.
 */
export async function generateChangeOrder(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  if (!Number.isFinite(Number(jobNumber))) return { error: "That job could not be found." };

  const { billingRefusal } = await import("@/lib/billing-permission-server");
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };

  const { currentContext } = await import("@/lib/request-context");
  const context = await currentContext();
  if (!context) return { error: "You are not signed in." };
  const supabase = asFlexibleClient(await createClient());

  const { loadJobChangeOrders, createChangeOrder, requestChangeOrderApproval } = await import("@/lib/change-orders-server");
  const loaded = await loadJobChangeOrders(supabase, context.organizationId, { jobNumber });
  if (!loaded) return { error: "That job could not be found." };
  if (!loaded.agreement?.signed) {
    return { error: "Nothing on this job has been signed yet, so there is nothing to change. Generate the contract instead." };
  }
  const waiting = loaded.changeOrders.find((order) => order.status === "pending_approval");
  if (waiting) {
    return { error: "", notice: `Change order #${waiting.number} is already waiting to be signed.`, contractId: waiting.documentContractId ?? undefined };
  }

  const created = await createChangeOrder(supabase, {
    organizationId: context.organizationId,
    job: { jobNumber },
    userId: context.userId,
    description: "Work added since the contract was signed",
  });
  if (!created.ok) return { error: created.error };
  if (created.swept === 0) {
    const { cancelChangeOrder } = await import("@/lib/change-orders-server");
    await cancelChangeOrder(supabase, { organizationId: context.organizationId, changeOrderId: created.changeOrderId, userId: context.userId });
    return { error: "Nothing has been added since the customer signed." };
  }

  const requested = await requestChangeOrderApproval(supabase, {
    organizationId: context.organizationId,
    changeOrderId: created.changeOrderId,
    userId: context.userId,
  });
  revalidatePath(`/jobs/${jobNumber}`);
  if (!requested.ok) return { error: requested.error };

  const said = `Change order #${created.number} drafted for ${created.swept} ${created.swept === 1 ? "addition" : "additions"} (${formatMoney(requested.netCents / 100)}). Read it, then have the customer sign it.`;
  return {
    error: "",
    contractId: requested.contractId,
    notice: requested.pdfError ? `${said} The PDF could not be produced — open the draft to try again.` : said,
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

  const { data: membership } = await activeMembership();

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
 * Writing a send attempt onto the job's history, whether or not it went.
 *
 * A failure used to exist only as the red line under the button, gone on the
 * next page load, so "did they get the link?" had no answer anywhere. Now it
 * is on the job, with the reason and a way to try again.
 */
async function noteApprovalSend(
  supabase: FlexibleSupabaseClient,
  contract: Record<string, unknown>,
  jobId: string,
  outcome: { ok: true } | { ok: false; reason: string },
) {
  await recordActivity(supabase, {
    organizationId: text(contract.organization_id),
    eventType: outcome.ok ? "estimate.sent" : "estimate.send_failed",
    label: outcome.ok ? "Sent for approval" : "Approval text not sent",
    jobId: jobId || null,
    metadata: outcome.ok
      ? { via: "sms", contract_id: text(contract.id) }
      : { via: "sms", contract_id: text(contract.id), reason: outcome.reason },
  });
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

  const signable = await loadSignable(supabase, contractId);
  if (!signable) return { error: "That contract could not be found." };
  const { contract, job, customer, business, jobId, blocked } = signable;
  if (blocked) return { error: blocked };

  // Before anything is signed or changed: a link texted under a minute ago is
  // not texted again. The claim below holds the same line when two taps race.
  const lastSent = Date.parse(text(contract.signature_sent_at));
  if (Number.isFinite(lastSent) && lastSent > Date.now() - RESEND_GAP_MS) {
    return { error: "The signing link was texted less than a minute ago, so it was not sent again." };
  }

  const { signingLinkMessage } = await import("@/lib/contract-signing");
  const { emailSender, looksLikeEmail } = await import("@/lib/booking-confirmation");

  // How to send it. The contract card texts, as it always has; a change order
  // sent from its own sheet says which of text and email were ticked.
  const chosen = formData.get("channels") === "chosen";
  const wantText = chosen ? formData.get("sendSms") === "on" : true;
  const wantEmail = chosen ? formData.get("sendEmail") === "on" : false;
  if (!wantText && !wantEmail) return { error: "Tick text, email or both to send it." };

  const { toE164 } = await import("@/lib/phone-format");
  const phone = wantText ? toE164(text(customer?.phone)) : "";
  const email = wantEmail ? text(customer?.email).trim() : "";
  const emailOk = wantEmail && looksLikeEmail(email);

  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const token = text(contract.public_token);
  if (!origin || !token) return { error: "The signing link could not be built." };
  const link = `${origin}/contract/${token}`;

  const organizationId = text(contract.organization_id);
  let messagingServiceSid = "";
  if (wantText && phone) {
    const { data: messaging } = await supabase
      .from("messaging_settings")
      .select("messaging_service_sid")
      .eq("organization_id", organizationId)
      .maybeSingle();
    messagingServiceSid = text(messaging?.messaging_service_sid);
  }
  const textOk = wantText && Boolean(phone) && Boolean(messagingServiceSid);

  // Why a channel that was asked for cannot be used, said when nothing can go.
  const textProblem = !wantText
    ? ""
    : !phone
      ? "This customer has no mobile number we can text."
      : !messagingServiceSid
        ? "Texting is not set up for this business yet."
        : "";
  const emailProblem = !wantEmail ? "" : emailOk ? "" : "This customer has no email address on file.";
  if (!textOk && !emailOk) {
    const reason = [textProblem, emailProblem].filter(Boolean).join(" ");
    await noteApprovalSend(supabase, contract, jobId, { ok: false, reason: reason || "Nothing to send it by" });
    if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
    return { error: `${reason} Add it to the customer, or have them sign here in person.` };
  }

  // The business signs before the customer is asked to: the contract they open
  // already carries the sender's signature.
  const signedForBusiness = await signForBusinessFirst({
    supabase,
    contractId,
    organizationId,
    userId: auth.user.id,
    timeZone: text(business?.timezone) || "America/Los_Angeles",
  });
  if (!signedForBusiness.ok) {
    return { error: signedForBusiness.error, needsSignature: signedForBusiness.needsSignature };
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

  // The claim: refused when another contract on this job is out for signature,
  // and matched only once by two taps at the same moment, before anybody is
  // sent anything.
  const previousStatus = text(contract.status) || "draft";
  const previousProvider = text(contract.signature_provider) || null;
  const previousSentAt = text(contract.signature_sent_at) || null;
  const sentAt = new Date();
  const claim = supabase
    .from("contracts")
    .update({ status: "sent", signature_provider: "in_app", signature_sent_at: sentAt.toISOString() })
    .eq("id", contractId)
    .is("signed_at", null);
  const { data: claimed, error: claimError } = await (previousSentAt
    ? claim.eq("signature_sent_at", previousSentAt)
    : claim.is("signature_sent_at", null)
  )
    .select("id")
    .maybeSingle();

  if (claimError || !claimed) {
    return {
      error:
        claimError?.code === "23505"
          ? "Another contract for this job is already out for signature, so this one was not sent."
          : claimError
            ? "That contract could not be sent. Reload the page and try again."
            : "That contract changed a moment ago — it may have just been sent or signed. Reload the page to see.",
    };
  }

  const message = signingLinkMessage({
    businessName: text(business?.name),
    jobNumber: job?.job_number,
    link,
    kind: contract.kind,
  });
  const failures: string[] = [];
  let texted = false;
  let emailed = false;

  // The text goes the way the inbox sends: saved in the customer's
  // conversation first, with Twilio reporting back whether it arrived.
  if (textOk) {
    const { sendSms } = await import("@/lib/twilio");
    const { sendCustomerText } = await import("@/lib/customer-text");
    const outcome = await sendCustomerText(supabase, {
      organizationId,
      customerId: text(customer?.id),
      to: phone,
      body: message,
      send: sendSms,
      pauseAssistant: false,
    });
    if (outcome.ok) texted = true;
    else failures.push(`the text could not be sent (${outcome.message || outcome.code})`);
  }

  if (emailOk) {
    const { sendEmail } = await import("@/lib/email");
    const businessName = text(business?.name) || "Your electrician";
    const what = contract.kind === "change_order" ? "change order" : "contract";
    const jobLabel = job?.job_number ? ` for job #${String(job.job_number)}` : "";
    const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const sent = await sendEmail({
      organizationId,
      contactButtons: true,
      to: email,
      subject: `Please sign: ${what}${jobLabel} from ${businessName}`,
      text: `${message}\n\n${businessName}`,
      html: [
        `<p>${escape(businessName)} has sent you a ${what}${escape(jobLabel)} to read and sign.</p>`,
        `<p><a href="${escape(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#f5c542;color:#111827;font-weight:700;text-decoration:none">Read and sign the ${what}</a></p>`,
        `<p style="font-size:13px;color:#475569">Or open this link: ${escape(link)}</p>`,
        `<p style="color:#475569">${escape(businessName)}</p>`,
      ].join(""),
      from: emailSender(businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
      idempotencyKey: `signing-${contractId}-${sentAt.getTime()}`,
    });
    if (sent.ok) emailed = true;
    else failures.push(`the email could not be sent (${sent.errorDetail || sent.errorCode})`);
  }

  if (!texted && !emailed) {
    // Released, so the contract does not read as sent when nothing was.
    await supabase
      .from("contracts")
      .update({ status: previousStatus, signature_provider: previousProvider, signature_sent_at: previousSentAt })
      .eq("id", contractId)
      .is("signed_at", null);
    const reason = failures.join("; ") || "nothing could be sent";
    await noteApprovalSend(supabase, contract, jobId, { ok: false, reason });
    if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
    return { error: `${reason.charAt(0).toUpperCase()}${reason.slice(1)}.` };
  }

  await noteApprovalSend(supabase, contract, jobId, { ok: true });
  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);

  const { formatForDisplay } = await import("@/lib/phone-format");
  const said = [texted ? `texted to ${formatForDisplay(phone)}` : "", emailed ? `emailed to ${email}` : ""].filter(Boolean).join(" and ");
  const missed = [
    wantText && !texted ? textProblem || "the text did not go" : "",
    wantEmail && !emailed ? emailProblem || "the email did not go" : "",
  ].filter(Boolean);
  return {
    error: "",
    contractId,
    notice: `Signing link ${said}.${missed.length ? ` Not sent: ${missed.join(" ")}` : ""}`,
  };
}

/** How long after a signing link is texted before the same one can be texted again. */
const RESEND_GAP_MS = 60_000;

/** Complete missing fields as a new draft; never alter an existing agreement. */
export async function completeContractDetails(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const supabase = asFlexibleClient(await createClient());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return { error: "You are not signed in." };
  const contractId = String(formData.get("contractId") ?? "");
  const { data: sourceData } = await supabase.from("contracts")
    .select("id, organization_id, job_id, kind, body, scope, status, signed_at, created_at, total_cents, deposit_cents, deposit_paid, organizations ( timezone ), jobs ( job_number )")
    .eq("id", contractId).maybeSingle();
  if (!sourceData) return { error: "That contract could not be found." };
  const source = sourceData as Record<string, unknown>;
  if (source.status !== "draft" || source.signed_at) return { error: "Only an unsigned draft can be completed. Reload the job." };
  const { data: newest } = await supabase.from("contracts").select("id")
    .eq("job_id", text(source.job_id)).neq("status", "void")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (newest?.id !== contractId) return { error: "A newer draft exists. Reload the job to complete it." };
  // The completed copy keeps this draft's wording, so it must not be dated
  // after work this draft never listed: a line written since would read as
  // covered by a document that does not mention it.
  const { count: writtenSince } = await supabase.from("job_line_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", text(source.job_id))
    .gt("created_at", text(source.created_at));
  if (writtenSince) {
    return {
      error: source.kind === "change_order"
        ? "Items were added after this change order was made. Generate a new change order so it includes them."
        : "Items were added after this draft was made. Generate another draft so it includes them.",
    };
  }
  const body = text(source.body);
  const fields = placeholdersUsed(body);
  if (!fields.length) return { error: "This draft has no missing information." };
  const values: Record<string, string> = Object.create(null);
  for (const field of fields) {
    const value = String(formData.get(`field:${field}`) ?? "").trim();
    if (!value || value.length > 5000 || value.includes("{{") || value.includes("}}")) {
      return { error: `Enter ${field.replace(/_/g, " ")} (up to 5,000 characters, without template brackets).` };
    }
    values[field] = value;
  }
  const filled = completeDraftFields(body, values);
  if (filled.unfilled.length) return { error: "Complete all missing information before saving." };
  const { data: created, error } = await supabase.from("contracts").insert({
    organization_id: source.organization_id, job_id: source.job_id,
    // A change order completed is still a change order.
    kind: source.kind === "change_order" ? "change_order" : "agreement",
    body: filled.body, scope: values.scope ?? text(source.scope), unfilled: [], status: "draft",
    // Kept, unless the money itself was typed in by hand: then only the words
    // know it, and the summary points at them instead of guessing.
    ...("total" in values || "deposit" in values
      ? { total_cents: null, deposit_cents: null, deposit_paid: null }
      : { total_cents: source.total_cents ?? null, deposit_cents: source.deposit_cents ?? null, deposit_paid: source.deposit_paid ?? null }),
  }).select("id").maybeSingle();
  if (error || !created) return { error: "The completed draft could not be saved. Try again." };
  const organization = source.organizations as Record<string, unknown> | null;
  const job = source.jobs as Record<string, unknown> | null;
  const { generateContractPdf } = await import("@/lib/pdf/contract-data");
  const document = await generateContractPdf({
    database: supabase, organizationId: text(source.organization_id), contractId: text(created.id),
    timeZone: text(organization?.timezone) || "America/Los_Angeles", uploadedBy: auth.user.id,
  });
  revalidatePath(`/jobs/${job?.job_number}`);
  return { error: "", contractId: text(created.id), notice: document.error
    ? "Details saved. Open Preview and choose Build the PDF to retry the document."
    : "Details saved. Preview the completed contract, then send it for signing." };
}

/**
 * Before the customer signs on this phone, the business signs.
 *
 * The in-person sheet hands the pad to the customer; this is what runs first,
 * so the contract in front of them already carries the signature of the person
 * holding the phone out — the same as a contract sent by text.
 */
export async function signForBusiness(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const contractId = String(formData.get("contractId") ?? "").trim();
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  if (!contractId) return { error: "That contract could not be found." };

  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return { error: "You are not signed in." };

  const signable = await loadSignable(supabase, contractId);
  if (!signable) return { error: "That contract could not be found." };
  if (signable.blocked) return { error: signable.blocked };

  const signed = await signForBusinessFirst({
    supabase,
    contractId,
    organizationId: text(signable.contract.organization_id),
    userId: auth.user.id,
    timeZone: text(signable.business?.timezone) || "America/Los_Angeles",
  });
  if (!signed.ok) return { error: signed.error, needsSignature: signed.needsSignature };

  if (jobNumber) revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", contractId, signedForBusiness: true };
}
