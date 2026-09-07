export type ContractSigningStatus = "draft" | "sent" | "signed" | "void";

type ContractSigningSectionInput = {
  current: boolean;
  status: ContractSigningStatus;
  hasDocument: boolean;
  unfilledCount: number;
  documentMatchesContract: boolean;
  signatureEnvelopeLinked: boolean;
};

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

  return Boolean(
    input.hasDocument &&
      input.unfilledCount === 0 &&
      ((input.current && input.status === "draft" && input.documentMatchesContract) ||
        input.status === "sent" ||
        input.status === "signed"),
  );
}

export function isContractSignatureRecovery(input: {
  status: ContractSigningStatus;
  signatureEnvelopeLinked: boolean;
}): boolean {
  return input.status === "draft" && input.signatureEnvelopeLinked;
}
