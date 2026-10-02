"use server";

import { revalidatePath } from "next/cache";

import { draftScope } from "@/lib/claude";
import {
  completeDraftFields,
  placeholdersUsed,
  contractMoney,
  fillTemplate,
  STARTER_TEMPLATE,
  type ContractFacts,
} from "@/lib/contract-template";
import { creditSource } from "@/lib/follow-up-jobs";
import { formatMoney } from "@/lib/invoice-messages";
import { agreementChanges, changeOrderBody, unbilledLines, type ContractStanding } from "@/lib/job-billing";
import { lineTotalCents } from "@/lib/job-lines";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
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
      "id, organization_id, job_id, kind, status, unfilled, public_token, signed_at, signature_provider, organizations ( name, timezone ), jobs ( job_number, customers ( phone ) )",
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
       diagnostic_paid, follow_up_of,
       customers ( first_name, last_name, company_name ),
       properties ( address_line_1, city, state, postal_code ),
       organizations ( name, phone, timezone ),
       invoices ( id, status, total_cents, diagnostic_credit_cents ),
       job_line_items ( kind, quantity, unit_price_cents, invoice_id )`,
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
  const fee = creditSource(
    {
      diagnosticPaid: row.diagnostic_paid === true,
      diagnosticFeeCents: Number(row.diagnostic_fee_cents ?? 0),
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

  // Best effort. A model outage leaves {{scope}} standing in the draft, which
  // is visible and fixable; a paragraph invented to fill the gap is neither.
  const scope = await draftScope({
    description,
    workType,
    visitOnly: money.source === "diagnostic",
  });

  const facts: Partial<ContractFacts> = {
    business_name: text(organization?.name),
    business_phone: text(organization?.phone),
    customer_name: customerName,
    service_address: address,
    job_number: String(row.job_number ?? jobNumber),
    job_date: formatDate(text(row.scheduled_start)),
    work_type: workType,
    total: money.totalCents > 0 ? formatMoney(money.totalCents / 100) : "",
    // "Deposit due before work begins: $180.00 (paid)" — a customer who paid
    // when they booked is not asked for it again by their own contract.
    deposit:
      money.depositCents > 0
        ? `${formatMoney(money.depositCents / 100)}${money.depositPaid ? " (paid)" : ""}`
        : "",
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
 * A change order for what was added after the customer signed.
 *
 * A signed agreement is amended in writing, not edited. Everything written on
 * the job after the newest signed contract or change order was drawn up is
 * listed and priced in a document of its own, signed the same way the contract
 * was — the texted link, or the pad on the job page. The contract it adds to is
 * left exactly as the customer signed it.
 */
export async function generateChangeOrder(
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
      `id, job_number,
       customers ( first_name, last_name, company_name ),
       properties ( address_line_1, city, state, postal_code ),
       organizations ( name, phone, timezone ),
       contracts ( id, kind, status, created_at, signed_at ),
       job_line_items ( description, quantity, unit, unit_price_cents, created_at )`,
    )
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  const row = job as Record<string, unknown>;
  const customer = (row.customers ?? null) as Record<string, unknown> | null;
  const property = (row.properties ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;

  const contracts: ContractStanding[] = (Array.isArray(row.contracts) ? (row.contracts as Record<string, unknown>[]) : []).map(
    (contract) => ({
      id: text(contract.id),
      kind: contract.kind === "change_order" ? "change_order" : "agreement",
      status: text(contract.status) || "draft",
      createdAt: text(contract.created_at),
      signedAt: text(contract.signed_at) || null,
    }),
  );
  const lines = (Array.isArray(row.job_line_items) ? (row.job_line_items as Record<string, unknown>[]) : []).map(
    (line) => ({
      description: text(line.description),
      // numeric arrives as a string over PostgREST.
      quantity: Number(line.quantity ?? 0),
      unit: text(line.unit),
      unitPriceCents: Number(line.unit_price_cents ?? 0),
      createdAt: text(line.created_at),
    }),
  );

  const changes = agreementChanges(lines, contracts);
  if (!changes.signed) {
    return { error: "Nothing on this job has been signed yet, so there is nothing to change. Generate the contract instead." };
  }
  if (changes.added.length === 0) return { error: "Nothing has been added since the customer signed." };
  if (changes.waiting) {
    return { error: "", notice: "A change order for these is already waiting to be signed.", contractId: changes.waiting.id };
  }

  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const formatDate = (iso: string, weekday: boolean) =>
    iso
      ? new Intl.DateTimeFormat("en-US", {
          timeZone,
          ...(weekday ? { weekday: "short" as const } : {}),
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(iso))
      : "";

  const filled = changeOrderBody({
    facts: {
      business_name: text(organization?.name),
      business_phone: text(organization?.phone),
      customer_name:
        text(customer?.company_name) ||
        [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(" "),
      service_address: [
        text(property?.address_line_1),
        text(property?.city),
        text(property?.state),
        text(property?.postal_code),
      ]
        .filter(Boolean)
        .join(", "),
      job_number: String(row.job_number ?? jobNumber),
      today: formatDate(new Date().toISOString(), true),
    },
    signedOn: formatDate(changes.signed.signedAt ?? "", false),
    lines: changes.added,
  });

  const { data: created, error } = await supabase
    .from("contracts")
    .insert({
      organization_id: organizationId,
      job_id: text(row.id),
      kind: "change_order",
      body: filled.body,
      // A change order has no drafted passage: it is the list of additions,
      // written from the lines themselves.
      scope: "",
      unfilled: filled.unfilled,
      status: "draft",
    })
    .select("id")
    .maybeSingle();

  if (error || !created) return { error: "That change order could not be saved." };

  const contractId = text(created.id);
  const { generateContractPdf } = await import("@/lib/pdf/contract-data");
  const document = await generateContractPdf({
    database: supabase,
    organizationId,
    contractId,
    timeZone,
    uploadedBy: userId,
  });

  revalidatePath(`/jobs/${jobNumber}`);

  const count = changes.added.length;
  const said = `Change order drafted for ${count} ${count === 1 ? "addition" : "additions"} (${formatMoney(changes.addedCents / 100)}). Read it, then have the customer sign it.`;
  return {
    error: "",
    contractId,
    notice: document.error ? `${said} The PDF could not be produced — open the draft to try again.` : said,
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

  const signable = await loadSignable(supabase, contractId);
  if (!signable) return { error: "That contract could not be found." };
  const { contract, job, customer, business, jobId, blocked } = signable;
  if (blocked) return { error: blocked };

  const { signingLinkMessage } = await import("@/lib/contract-signing");

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
    body: signingLinkMessage({
      businessName: text(business?.name),
      jobNumber: job?.job_number,
      link,
      kind: contract.kind,
    }),
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
    .select("id, organization_id, job_id, kind, body, scope, status, signed_at, created_at, organizations ( timezone ), jobs ( job_number )")
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
