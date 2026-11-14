/**
 * Whether a contract may be texted to the customer for signature from a
 * ChatGPT connection, and why not when it may not.
 *
 * The rules the job page's "Text signing link" button follows, plus one the
 * button does not need: the customer must have a phone on file. Whether they
 * replied STOP is checked by sendSms, the one place every text is checked.
 * The business signs before the customer is asked to, with the saved
 * signature of the owner who connected ChatGPT, so that owner must have one.
 *
 * Import-free, so the rules can be tested without a database.
 */

export type ContractSendFacts = {
  /** The job's newest contract that is not cancelled, or null when it has none. */
  contract: {
    status: string;
    signedAt: string | null;
    signatureProvider: string | null;
    unfilled: string[];
    signatureSentAt: string | null;
  } | null;
  /** The owner who connected ChatGPT is a member of this business and has saved a signature. */
  signerReady: boolean;
  /** The customer has a phone number on file. */
  textingAllowed: boolean;
  textingRefusal?: string;
  /** Texting is set up for the business. */
  hasMessagingService: boolean;
  now: number;
};

/** How long after a signing link is texted before the same one can be texted again. */
export const RESEND_GAP_MS = 60_000;

export function contractSendRefusal(facts: ContractSendFacts): string {
  const contract = facts.contract;
  if (!contract) return "This job has no contract yet. Draft one first with draft_contract.";
  if (contract.signedAt) return "This contract has already been signed.";
  if (contract.status === "void") return "This contract was cancelled and can no longer be signed.";
  if (contract.signatureProvider === "documenso") return "This contract was sent for signature by email. It is signed from that email.";
  const blanks = contract.unfilled.length;
  if (blanks > 0) {
    return `This contract is not ready to sign yet — ${blanks} ${blanks === 1 ? "detail is" : "details are"} still to be filled in.`;
  }
  const lastSent = contract.signatureSentAt ? Date.parse(contract.signatureSentAt) : NaN;
  if (Number.isFinite(lastSent) && lastSent > facts.now - RESEND_GAP_MS) {
    return "The signing link was texted less than a minute ago, so it was not sent again.";
  }
  if (!facts.signerReady) {
    return "The owner who connected ChatGPT has no saved signature. Save one in Volteira under Settings → Contract, then ask again: the business signs before the customer does.";
  }
  if (!facts.textingAllowed) {
    return `${facts.textingRefusal || "The customer cannot be texted."} The signing link was not sent; the customer can sign in person on the job page.`;
  }
  if (!facts.hasMessagingService) return "Texting is not set up for this business yet, so the link could not be sent.";
  return "";
}
