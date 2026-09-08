export type ContractSigningStatus = "draft" | "sent" | "signed" | "void";

type ContractSigningSectionInput = {
  current: boolean;
  status: ContractSigningStatus;
  hasDocument: boolean;
  unfilledCount: number;
  documentMatchesContract: boolean;
  signatureEnvelopeLinked: boolean;
};

export function canRebuildContractPdf(input: {
  status: ContractSigningStatus;
  signatureEnvelopeLinked: boolean;
}): boolean {
  return input.status === "draft" && !input.signatureEnvelopeLinked;
}

/**
 * Decide whether a contract row needs signing controls.
 *
 * A linked provider draft remains actionable even after a newer local draft is
 * generated. It may be holding the job-wide send lock after an ambiguous
 * provider response, and hiding its recovery action would strand every newer
 * draft behind that lock.
 */
export function showsContractSigningSection(input: ContractSigningSectionInput): boolean {
  if (input.status === "draft" && input.signatureEnvelopeLinked) return true;

  // A missing or temporarily unsigned storage URL must not hide the provider
  // status action. Sent contracts can still be checked, and completed ones can
  // still recover their sealed copy from Documenso.
  if (input.status === "sent" || input.status === "signed") return true;

  return Boolean(
    input.hasDocument &&
      input.unfilledCount === 0 &&
      input.current &&
      input.status === "draft" &&
      input.documentMatchesContract,
  );
}

export function isContractSignatureRecovery(input: {
  status: ContractSigningStatus;
  signatureEnvelopeLinked: boolean;
}): boolean {
  return input.status === "draft" && input.signatureEnvelopeLinked;
}

/** A provider-completed contract still needs an actionable sealed PDF. */
export function needsSignedCopyRecovery(input: {
  status: ContractSigningStatus;
  signedCopySaved: boolean;
  hasDocument: boolean;
}): boolean {
  return input.status === "signed" && (!input.signedCopySaved || !input.hasDocument);
}
