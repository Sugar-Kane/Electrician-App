"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { recordActivity } from "@/lib/activity";
import { draftScope } from "@/lib/claude";
import { fillTemplate, STARTER_TEMPLATE, type ContractFacts } from "@/lib/contract-template";
import {
  createDocumensoEnvelope,
  deleteDocumensoEnvelope,
  distributeDocumensoEnvelope,
  DocumensoError,
  getDocumensoEnvelope,
  isDocumensoConfigured,
} from "@/lib/documenso";
import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { formatMoney } from "@/lib/invoice-messages";
import { locateContractSignatureFields } from "@/lib/pdf/signature-fields";
import { fileSignedContract } from "@/lib/signed-contract";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Send the frozen PDF to the customer, then to the contractor, for signature.
 *
 * The checks here are the pre-signature checklist that can be proved from the
 * record: no template blanks, a final PDF, both parties named, working email
 * addresses and a signature block for each party.  Sending is a separate click
 * from generating precisely because a newly drafted legal document is not
 * final merely because a model finished writing one paragraph of it.
 */
export async function sendContractForSignature(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const contractId = String(formData.get("contractId") ?? "").trim();
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  if (!contractId || !jobNumber) return { error: "That contract could not be found." };
  if (!isDocumensoConfigured()) {
    return { error: "Document signing is not connected yet." };
  }

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

  const { data } = await supabase
    .from("contracts")
    .select(
      `id, status, unfilled, signature_envelope_id, signature_sent_at,
       jobs (
         id, job_number,
         customers ( first_name, last_name, company_name, email )
       ),
       organizations ( name, owner_notification_email, timezone )`,
    )
    .eq("organization_id", organizationId)
    .eq("id", contractId)
    .maybeSingle();

  if (!data) return { error: "That contract could not be found." };
  const contract = data as Record<string, unknown>;
  const status = text(contract.status);
  const job = (contract.jobs ?? null) as Record<string, unknown> | null;
  const jobId = text(job?.id);
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;
  const organization = (contract.organizations ?? null) as Record<string, unknown> | null;

  if (status === "signed") return { error: "", notice: "This contract is already signed." };
  if (status === "sent") {
    return { error: "", notice: "This contract is already waiting for signatures." };
  }
  if (status === "void") {
    return { error: "This signature request was canceled or declined. Generate a new draft." };
  }
  if (!jobId) return { error: "This contract is not attached to a job." };

  const { data: otherPending, error: pendingError } = await supabase
    .from("contracts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("status", "sent")
    .neq("id", contractId)
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    return { error: "The other contracts for this job could not be checked. Try again." };
  }
  if (otherPending) {
    return {
      error: "Another contract for this job is already waiting for signatures. Finish or cancel it first.",
    };
  }

  const unfilled = Array.isArray(contract.unfilled) ? contract.unfilled : [];
  if (unfilled.length > 0) {
    return {
      error: `Fill in the ${unfilled.length === 1 ? "blank" : "blanks"} before sending this contract.`,
    };
  }

  const customerName =
    text(customer?.company_name) ||
    [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(" ");
  const customerEmail = text(customer?.email).trim();
  const businessName = text(organization?.name).trim();
  const contractorEmail = text(organization?.owner_notification_email).trim();

  if (!customerName) return { error: "Add the customer's name before sending the contract." };
  if (!validEmail(customerEmail)) {
    return { error: "Add a valid customer email address before sending the contract." };
  }
  if (!businessName || !validEmail(contractorEmail)) {
    return { error: "Add the business name and owner notification email before sending." };
  }

  let envelopeId = text(contract.signature_envelope_id);
  const sendToken = randomUUID();
  const sendStartedAt = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();

  /** Release only this request's claim; a newer retry must remain untouched. */
  const releaseClaim = async () => {
    await supabase
      .from("contracts")
      .update({ signature_send_token: null, signature_send_started_at: null })
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .eq("signature_send_token", sendToken);
  };

  /** One request owns creation, distribution, the status transition and activity. */
  const claimSend = async (expectedEnvelopeId: string | null) => {
    let query = supabase
      .from("contracts")
      .update({
        signature_send_token: sendToken,
        signature_send_started_at: sendStartedAt,
      })
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .eq("status", "draft")
      .or(`signature_send_token.is.null,signature_send_started_at.lt.${staleBefore}`);
    query = expectedEnvelopeId
      ? query.eq("signature_envelope_id", expectedEnvelopeId)
      : query.is("signature_envelope_id", null);
    return query.select("id").maybeSingle();
  };

  // Claim before reading the PDF. Version restoration takes the same row-level
  // claim, so the file inspected here cannot be swapped out between inspection
  // and the provider upload.
  const { data: claimed, error: claimError } = await claimSend(envelopeId || null);
  if (claimError) {
    if ((claimError as { code?: string }).code === "23505") {
      return {
        error: "Another contract for this job is already being sent or waiting for signatures.",
      };
    }
    return { error: "The signature request could not be prepared. Try again." };
  }
  if (!claimed) {
    const { data: latest } = await supabase
      .from("contracts")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .maybeSingle();
    return {
      error: text(latest?.status) === "sent"
        ? "This contract is already waiting for signatures."
        : "Another signature request is being prepared. Refresh in a moment.",
    };
  }

  let document: Record<string, unknown> | null = null;
  let pdf: Buffer | null = null;
  let fields: Awaited<ReturnType<typeof locateContractSignatureFields>> | null = null;

  if (!envelopeId) {
    const { data: documentData } = await supabase
      .from("documents")
      .select("storage_path, file_name")
      .eq("organization_id", organizationId)
      .eq("contract_id", contractId)
      .is("archived_at", null)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    document = (documentData ?? null) as Record<string, unknown> | null;

    const storagePath = text(document?.storage_path);
    if (!storagePath) {
      await releaseClaim();
      return { error: "Build the contract PDF before sending it." };
    }

    const downloaded = await getSupabaseAdmin().storage
      .from(DOCUMENTS_BUCKET)
      .download(storagePath);
    if (downloaded.error || !downloaded.data) {
      await releaseClaim();
      return { error: "The contract PDF could not be opened. Rebuild it and try again." };
    }

    pdf = Buffer.from(await downloaded.data.arrayBuffer());
    try {
      fields = await locateContractSignatureFields(pdf);
    } catch (error) {
      console.error("contract: could not inspect signature fields", error);
      await releaseClaim();
      return { error: "The signing places could not be read from this PDF. Rebuild it and try again." };
    }

    if (!fields.customer.some((field) => field.type === "SIGNATURE")) {
      await releaseClaim();
      return { error: "This PDF has no customer signing place. Rebuild it and try again." };
    }
    if (!fields.contractor.some((field) => field.type === "SIGNATURE")) {
      await releaseClaim();
      return { error: "This PDF has no contractor signing place. Rebuild it and try again." };
    }
  }

  if (!envelopeId && pdf && fields) {
    try {
      envelopeId = await createDocumensoEnvelope({
        pdf,
        fileName: text(document?.file_name) || `contract-job-${jobNumber}.pdf`,
        title: `${businessName} work agreement — job #${jobNumber}`,
        externalId: `volteira-contract:${contractId}`,
        timeZone: text(organization?.timezone) || "America/Los_Angeles",
        businessName,
        recipients: [
          {
            email: customerEmail,
            name: customerName,
            role: "SIGNER",
            signingOrder: 1,
            fields: fields.customer,
          },
          {
            email: contractorEmail,
            name: businessName,
            role: "SIGNER",
            signingOrder: 2,
            fields: fields.contractor,
          },
        ],
      });
    } catch (error) {
      await releaseClaim();
      return {
        error: error instanceof DocumensoError ? error.message : "The contract could not be prepared for signing.",
      };
    }

    const { data: linked, error: linkedError } = await supabase
      .from("contracts")
      .update({
        signature_provider: "documenso",
        signature_envelope_id: envelopeId,
        signature_recipient_email: customerEmail,
        signature_contractor_email: contractorEmail,
      })
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .eq("signature_send_token", sendToken)
      .select("id")
      .maybeSingle();

    let linkConfirmed = Boolean(linked);
    if (linkedError) {
      // A timeout can be reported after Postgres committed the update. Never
      // delete the external draft until a fresh read proves it is not linked.
      const { data: rechecked, error: recheckError } = await supabase
        .from("contracts")
        .select("signature_envelope_id, signature_send_token")
        .eq("organization_id", organizationId)
        .eq("id", contractId)
        .maybeSingle();
      if (recheckError || !rechecked) {
        return { error: "The signature request could not be confirmed. Refresh shortly." };
      }
      const recheckedEnvelope = text(rechecked.signature_envelope_id);
      if (recheckedEnvelope === envelopeId) {
        if (text(rechecked.signature_send_token) !== sendToken) {
          return { error: "Another signature request is being prepared. Refresh in a moment." };
        }
        linkConfirmed = true;
      }
    }

    if (!linkConfirmed) {
      // The provider draft contains customer details, so do not knowingly leave
      // it orphaned if Volteira could not link it to its contract.
      try {
        await deleteDocumensoEnvelope(envelopeId);
      } catch (cleanupError) {
        console.error("contract: could not remove orphaned signature envelope", cleanupError);
      }
      await releaseClaim();
      return { error: "The signature request could not be saved. Try again." };
    }
  } else {
    // A linked envelope is a recovery, not permission to blindly POST again.
    // Reading its provider state first prevents duplicate signing emails after
    // a prior distribute succeeded but the local status write was interrupted.
    let providerEnvelope: Awaited<ReturnType<typeof getDocumensoEnvelope>>;
    try {
      providerEnvelope = await getDocumensoEnvelope(envelopeId);
    } catch (error) {
      await releaseClaim();
      return {
        error: error instanceof DocumensoError ? error.message : "The signing status could not be checked.",
      };
    }

    if (providerEnvelope.status === "COMPLETED") {
      await releaseClaim();
      const filed = await fileSignedContract({ envelopeId, actorUserId: userId });
      if (!filed.ok) return { error: filed.error };
      revalidatePath(`/jobs/${jobNumber}`);
      return { error: "", contractId, notice: "Signed contract saved to this job." };
    }
    if (["REJECTED", "CANCELLED"].includes(providerEnvelope.status)) {
      const { data: voided, error: voidError } = await supabase
        .from("contracts")
        .update({
          status: "void",
          signature_rejected_at: new Date().toISOString(),
          signature_send_token: null,
          signature_send_started_at: null,
        })
        .eq("organization_id", organizationId)
        .eq("id", contractId)
        .eq("signature_send_token", sendToken)
        .in("status", ["draft", "sent"])
        .select("id")
        .maybeSingle();
      if (voidError) {
        return { error: "The request was declined or canceled, but its status could not be saved. Refresh shortly." };
      }
      if (voided) {
        await recordActivity(supabase, {
          organizationId,
          jobId,
          actorUserId: userId,
          eventType: "contract.declined",
          label: "Contract signature request declined or canceled",
          metadata: { envelope_id: envelopeId },
        });
      }
      revalidatePath(`/jobs/${jobNumber}`);
      return { error: "This signature request was declined or canceled. Generate a new draft." };
    }
    if (providerEnvelope.status === "PENDING") {
      const sentAt = text(contract.signature_sent_at) || new Date().toISOString();
      const { data: recovered, error: recoveryError } = await supabase
        .from("contracts")
        .update({
          status: "sent",
          signature_sent_at: sentAt,
          signature_send_token: null,
          signature_send_started_at: null,
        })
        .eq("organization_id", organizationId)
        .eq("id", contractId)
        .eq("signature_send_token", sendToken)
        .select("id")
        .maybeSingle();
      if (recoveryError || !recovered) {
        return { error: "The contract was sent, but its status could not be recovered. Refresh shortly." };
      }
      await recordActivity(supabase, {
        organizationId,
        jobId,
        actorUserId: userId,
        eventType: "contract.sent",
        label: "Contract sent for signature",
        metadata: { via: "email", envelope_id: envelopeId },
      });
      revalidatePath(`/jobs/${jobNumber}`);
      return { error: "", contractId, notice: "This contract was already sent and is waiting for signatures." };
    }
    if (providerEnvelope.status !== "DRAFT") {
      await releaseClaim();
      return { error: "The signing service returned an unfamiliar document status. Try again." };
    }
  }

  try {
    await distributeDocumensoEnvelope(envelopeId);
  } catch (error) {
    await releaseClaim();
    return {
      error: error instanceof DocumensoError ? error.message : "The contract could not be sent for signing.",
    };
  }

  const sentAt = new Date().toISOString();
  const { data: saved, error: savedError } = await supabase
    .from("contracts")
    .update({
      status: "sent",
      signature_sent_at: sentAt,
      signature_send_token: null,
      signature_send_started_at: null,
    })
    .eq("organization_id", organizationId)
    .eq("id", contractId)
    .eq("signature_send_token", sendToken)
    .in("status", ["draft", "sent"])
    .select("id")
    .maybeSingle();

  if (!saved && !savedError) {
    const { data: latest } = await supabase
      .from("contracts")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .maybeSingle();
    const latestStatus = text(latest?.status);
    if (["signed", "void"].includes(latestStatus)) {
      await releaseClaim();
      revalidatePath(`/jobs/${jobNumber}`);
      return latestStatus === "signed"
        ? { error: "", contractId, notice: "The contract has already been signed." }
        : { error: "This signature request was declined or canceled. Generate a new draft." };
    }
  }

  if (savedError || !saved) {
    // The provider did send it. Retaining the claim on a database error blocks
    // a duplicate POST; a later retry checks provider state before doing more.
    return {
      error: "The contract was sent, but its status did not save. Do not send it again; refresh shortly.",
    };
  }

  await recordActivity(supabase, {
    organizationId,
    jobId,
    actorUserId: userId,
    eventType: "contract.sent",
    label: "Contract sent for signature",
    metadata: { via: "email", envelope_id: envelopeId },
  });

  revalidatePath(`/jobs/${jobNumber}`);
  return {
    error: "",
    contractId,
    notice: `Sent to ${customerEmail}. The customer signs first, then ${contractorEmail}.`,
  };
}

/**
 * Polling fallback for a missed webhook, also useful when the owner wants a
 * current answer without waiting for the page to refresh itself.
 */
export async function refreshContractSignature(
  _previous: ContractState,
  formData: FormData,
): Promise<ContractState> {
  const contractId = String(formData.get("contractId") ?? "").trim();
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  if (!contractId || !jobNumber) return { error: "That contract could not be found." };
  if (!isDocumensoConfigured()) return { error: "Document signing is not connected yet." };

  const supabase = asFlexibleClient(await createClient());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return { error: "You are not signed in." };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data } = await supabase
    .from("contracts")
    .select("id, job_id, signature_envelope_id")
    .eq("organization_id", organizationId)
    .eq("id", contractId)
    .maybeSingle();
  const envelopeId = text(data?.signature_envelope_id);
  if (!envelopeId) return { error: "This contract has not been sent for signature." };

  let envelope: Awaited<ReturnType<typeof getDocumensoEnvelope>>;
  try {
    envelope = await getDocumensoEnvelope(envelopeId);
  } catch (error) {
    return { error: error instanceof DocumensoError ? error.message : "The signing status could not be checked." };
  }

  if (envelope.status === "COMPLETED") {
    try {
      const filed = await fileSignedContract({
        envelopeId,
        actorUserId: auth.user.id,
      });
      if (!filed.ok) return { error: filed.error };
    } catch (error) {
      console.error("contract: could not file signed copy", error);
      return { error: "The contract is signed, but the signed PDF could not be saved. Try again." };
    }

    revalidatePath(`/jobs/${jobNumber}`);
    return { error: "", contractId, notice: "Signed contract saved to this job." };
  }

  if (["REJECTED", "CANCELLED"].includes(envelope.status)) {
    const { data: voided, error: voidError } = await supabase
      .from("contracts")
      .update({
        status: "void",
        signature_rejected_at: new Date().toISOString(),
        signature_send_token: null,
        signature_send_started_at: null,
      })
      .eq("organization_id", organizationId)
      .eq("id", contractId)
      .in("status", ["draft", "sent"])
      .select("id")
      .maybeSingle();
    if (voidError) {
      return { error: "The request was declined or canceled, but its status could not be saved. Try again." };
    }
    if (voided) {
      await recordActivity(supabase, {
        organizationId,
        jobId: text(data?.job_id) || null,
        actorUserId: auth.user.id,
        eventType: "contract.declined",
        label: "Contract signature request declined or canceled",
        metadata: { envelope_id: envelopeId },
      });
    }
    revalidatePath(`/jobs/${jobNumber}`);
    return { error: "This signature request was declined or canceled. Generate a new draft." };
  }

  if (envelope.status === "PENDING") {
    return { error: "", contractId, notice: "Still waiting for signatures." };
  }

  return { error: "", contractId, notice: "The contract is prepared but has not been sent yet." };
}
