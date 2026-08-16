import "server-only";

import { ContractDocument, contractFileName } from "@/lib/pdf/contract-document";
import { documentFolderId } from "@/lib/document-folders";
import { businessLetterhead, storeGeneratedPdf } from "@/lib/pdf/store";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Everything a contract PDF needs, gathered from the job it covers.
 *
 * The body is not built here. It was filled in and frozen when the contract row
 * was written, and this reads it back verbatim — the whole point of storing the
 * text rather than the template is that the document can be reproduced years
 * later without the template, the prices or the model having to still agree with
 * what they said that day.
 *
 * So everything around the body is the only thing that is looked up fresh, and
 * only ever the parts that identify the document: who, where, which job. If the
 * business changes its phone number, a reprint carries the new one, which is
 * correct — it is a way to reach them, not a term of the agreement.
 */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function dateLabel(iso: unknown, timeZone: string): string {
  const value = str(iso);
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(at);
}

/**
 * Build and file the PDF for a contract that already exists.
 *
 * Returns the error rather than throwing, for the same reason the invoice
 * version does: a contract that could not be turned into a nice copy is still a
 * contract, and losing the drafted text because the renderer had a bad day
 * would be worse than having no PDF for a minute.
 */
export async function generateContractPdf(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  contractId: string;
  timeZone: string;
  uploadedBy: string;
}): Promise<{ error: string } | { error: "" }> {
  const { data } = await input.database
    .from("contracts")
    .select(
      `id, body, unfilled, created_at,
       jobs (
         id, job_number, scheduled_start,
         customers ( first_name, last_name, company_name, phone, email ),
         properties ( address_line_1, address_line_2, city, state, postal_code )
       )`,
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.contractId)
    .maybeSingle();

  if (!data) return { error: "That contract could not be found." };

  const contract = data as Record<string, unknown>;
  const job = (contract.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;
  const property = (job?.properties ?? null) as Record<string, unknown> | null;

  const jobId = str(job?.id);
  const jobNumber = String(job?.job_number ?? "");

  const business = await businessLetterhead(input.database, input.organizationId);

  const addressLines = [
    str(property?.address_line_1),
    str(property?.address_line_2),
    [
      [str(property?.city), str(property?.state)].filter(Boolean).join(", "),
      str(property?.postal_code),
    ]
      .filter(Boolean)
      .join(" "),
  ].filter((line) => line.trim() !== "");

  const customerName =
    str(customer?.company_name) ||
    [str(customer?.first_name), str(customer?.last_name)].filter(Boolean).join(" ") ||
    "Customer";

  const scheduled = dateLabel(job?.scheduled_start, input.timeZone);
  const unfilled = Array.isArray(contract.unfilled)
    ? (contract.unfilled as unknown[]).map((key) => `{{${str(key)}}}`)
    : [];

  // The contracts table has no number of its own, and inventing a sequence for
  // one would be a second identifier for a thing the business already refers to
  // by its job. So the job number is the reference, on the document and in the
  // file name both.
  const reference = jobNumber ? `Job #${jobNumber}` : "Draft";

  return storeGeneratedPdf({
    database: input.database,
    organizationId: input.organizationId,
    jobId: jobId || null,
    folderId: await documentFolderId({
      database: input.database,
      organizationId: input.organizationId,
      jobId,
      jobNumber,
      fallbackKey: "contracts",
      fallbackName: "Contracts",
    }),
    contractId: input.contractId,
    documentType: "contract",
    displayName: jobNumber ? `Contract for job #${jobNumber}` : "Contract",
    fileName: contractFileName(jobNumber ? `job-${jobNumber}` : "", business.name),
    uploadedBy: input.uploadedBy,
    element: ContractDocument({
      data: {
        business,
        reference,
        createdLabel: dateLabel(contract.created_at, input.timeZone),
        customer: {
          name: customerName,
          addressLines,
          phone: str(customer?.phone),
          email: str(customer?.email),
        },
        job: {
          number: jobNumber,
          addressLines,
          scheduledLabel: scheduled ? `Scheduled ${scheduled}` : "",
        },
        body: str(contract.body),
        unfilled,
      },
    }),
  }).then((result) => ("error" in result ? { error: result.error } : { error: "" as const }));
}
