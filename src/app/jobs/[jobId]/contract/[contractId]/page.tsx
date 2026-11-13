import { notFound } from "next/navigation";

import { ContractPage } from "@/components/job-contract";
import { FieldPageShell } from "@/components/field-page-shell";
import { getJob, getJobContracts } from "@/lib/job-data";

/**
 * One contract on its own page, the way an invoice opens: the document to read
 * and zoom, Download, then Send for signing by text or Sign in person with the
 * customer right there.
 */

export const dynamic = "force-dynamic";

export default async function ContractDocumentPage({
  params,
}: {
  params: Promise<{ jobId: string; contractId: string }>;
}) {
  const { jobId, contractId } = await params;
  const [{ job }, contracts] = await Promise.all([getJob(jobId), getJobContracts(jobId)]);
  if (!job) notFound();
  const index = contracts.findIndex((contract) => contract.id === contractId);
  if (index < 0) notFound();
  const contract = contracts[index]!;

  return (
    <FieldPageShell
      compact
      title={contract.kind === "change_order" ? "Change order" : "Contract"}
      eyebrow={job.contactName || job.customer}
      backHref={`/jobs/${job.id}`}
    >
      <ContractPage
        contract={contract}
        jobNumber={job.id}
        customerName={job.contactName || job.customer}
        customerPhone={job.phone}
        // The newest one is the one that can be sent and signed.
        current={index === 0}
      />
    </FieldPageShell>
  );
}
