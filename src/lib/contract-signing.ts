/**
 * What makes a signature a signature, and a contract signable.
 *
 * The database is the guarantee: `sign_contract_in_app` refuses every case
 * below in its own `where` clause, so no request can talk its way past these
 * rules. This module exists so the page can say *why* before anybody tries, and
 * so the rules can be read and tested without a database or a PDF.
 *
 * Import-free, and uses only `atob` for decoding — a global in Node and in every
 * browser — so the same check can run on the phone before the signature is sent
 * and on the server after it arrives.
 */

export type SignatureMethod = "drawn" | "typed";

export type Signature = {
  method: SignatureMethod;
  /** The printed name. Always present: the PDF has a "Printed name" line. */
  name: string;
  /** A PNG data URI, for a drawn signature only. */
  image: string;
};

export type SignatureResult =
  | { ok: true; signature: Signature }
  | { ok: false; reason: string };

const PNG_PREFIX = "data:image/png;base64,";

/** The eight bytes every PNG file starts with. */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Bounds on a drawn signature, as the length of its data URI.
 *
 * A finger-drawn signature from the pad is a few tens of kilobytes. The ceiling
 * is generous on purpose — a detailed signature must never be refused — but it
 * exists, because this is stored in a row and posted by an anonymous page, and
 * an unbounded field is an invitation to post a photograph.
 */
export const MAX_SIGNATURE_LENGTH = 400_000;
const MIN_SIGNATURE_LENGTH = PNG_PREFIX.length + 16;

const MAX_NAME_LENGTH = 120;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * The printed name, or empty when it is not a name.
 *
 * Has to contain at least one letter. "---" and "123" are things people type to
 * get past a required field, not their name, and a contract signed "..." proves
 * nothing about who agreed to it.
 */
export function readPrintedName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = squash(value);
  if (!name || name.length > MAX_NAME_LENGTH) return "";
  return /\p{L}/u.test(name) ? name : "";
}

/**
 * Whether this really is a PNG, rather than something labelled as one.
 *
 * The data URI's own `image/png` is just a claim the sender makes. The bytes
 * are checked too, because the image is later drawn into a PDF, and a renderer
 * handed something that is not the format it was promised is a renderer having
 * a bad day in front of a customer.
 */
export function isPngDataUri(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (!value.startsWith(PNG_PREFIX)) return false;
  if (value.length < MIN_SIGNATURE_LENGTH || value.length > MAX_SIGNATURE_LENGTH) return false;

  const payload = value.slice(PNG_PREFIX.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) return false;

  let head: string;
  try {
    // Only the first twelve characters are needed for the first eight bytes.
    head = atob(payload.slice(0, 12));
  } catch {
    return false;
  }

  return PNG_MAGIC.every((byte, index) => head.charCodeAt(index) === byte);
}

/**
 * A signature as submitted, checked and normalised.
 *
 * A drawn signature needs its drawing *and* a printed name, the same as the
 * paper version: the signature line and the "Printed name" line under it are
 * two different things, and a scrawl with no name beside it identifies nobody.
 */
export function readSignature(input: {
  method: unknown;
  name: unknown;
  image?: unknown;
}): SignatureResult {
  const name = readPrintedName(input.name);

  if (input.method === "typed") {
    if (!name) return { ok: false, reason: "Type your full name to sign." };
    return { ok: true, signature: { method: "typed", name, image: "" } };
  }

  if (input.method === "drawn") {
    if (!isPngDataUri(input.image)) {
      return { ok: false, reason: "Draw your signature in the box, or type your name instead." };
    }
    if (!name) return { ok: false, reason: "Type your full name under your signature." };
    return { ok: true, signature: { method: "drawn", name, image: input.image as string } };
  }

  return { ok: false, reason: "That signature could not be read. Try again." };
}

export type SignableContract = {
  status: string;
  unfilled: readonly string[];
  signatureProvider: string | null;
  signedAt: string | null;
  /**
   * A newer contract has been drafted for the same job. Only the newest can be
   * signed — the job page already calls the others superseded — so a customer
   * holding an old link cannot sign the old terms.
   */
  superseded?: boolean;
};

/**
 * Why this contract cannot be signed right now, or empty when it can.
 *
 * The same refusals `sign_contract_in_app` makes, written for the person
 * looking at the screen. Signed comes first, so a contract signed before a newer
 * one was drafted still reads as signed rather than as replaced.
 */
export function unsignableBecause(contract: SignableContract): string {
  if (contract.signedAt) return "This contract has already been signed.";

  if (contract.status === "void") {
    return "This contract was cancelled and can no longer be signed.";
  }

  if (contract.superseded) {
    return "This contract has been replaced by a newer version, so it can no longer be signed.";
  }

  if (contract.signatureProvider === "documenso") {
    return "This contract was sent for signature by email. Sign it from that email.";
  }

  const blanks = contract.unfilled.length;
  if (blanks > 0) {
    return `This contract is not ready to sign yet — ${blanks} ${blanks === 1 ? "detail is" : "details are"} still to be filled in.`;
  }

  return "";
}

/**
 * The start of a body hash, laid out to be read aloud or compared by eye.
 *
 * Sixteen hex characters in groups of four. Enough that two different
 * documents will not share one by accident, short enough to print under a
 * signature and check against the record without a magnifying glass.
 */
export function fingerprintOf(hash: string): string {
  const clean = (hash ?? "").toLowerCase().replace(/[^a-f0-9]/g, "").slice(0, 16);
  return clean.match(/.{1,4}/g)?.join(" ") ?? "";
}

export type DocumentSignature = {
  method: SignatureMethod;
  name: string;
  image: string;
  signedLabel: string;
  fingerprint: string;
};

/**
 * The signature to print on a contract, if it has one this app took.
 *
 * Only `in_app`. A contract signed through Documenso gets its sealed PDF from
 * Documenso, and drawing our block over it would replace the copy that carries
 * their seal with one that does not.
 *
 * Nothing is printed unless every part is there. The database refuses to store
 * a partial in-app signature, but a PDF is not the place to find out it failed
 * to: a signature line with a name and no date is worse than a blank one.
 */
export function documentSignature(
  row: {
    signature_provider?: unknown;
    signed_at?: unknown;
    signature_method?: unknown;
    signature_name?: unknown;
    signature_image?: unknown;
    signed_body_hash?: unknown;
  },
  timeZone: string,
): DocumentSignature | undefined {
  if (row.signature_provider !== "in_app") return undefined;

  const method = row.signature_method;
  if (method !== "drawn" && method !== "typed") return undefined;

  const name = typeof row.signature_name === "string" ? row.signature_name.trim() : "";
  const hash = typeof row.signed_body_hash === "string" ? row.signed_body_hash : "";
  const image = typeof row.signature_image === "string" ? row.signature_image : "";
  const at = typeof row.signed_at === "string" ? new Date(row.signed_at) : null;

  if (!name || !hash || !at || Number.isNaN(at.getTime())) return undefined;
  if (method === "drawn" && !isPngDataUri(image)) return undefined;

  return {
    method,
    name,
    image: method === "drawn" ? image : "",
    signedLabel: signatureMoment(at, timeZone),
    fingerprint: fingerprintOf(hash),
  };
}

/**
 * When a signature was given, in the business's timezone.
 *
 * The time as well as the day. A contract date is a day; a signature is a
 * moment, and "which came first" is exactly the question it answers — which
 * is the business's signature and the customer's, on the same page.
 */
function signatureMoment(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

export type ContractorSignature = {
  method: SignatureMethod;
  name: string;
  /** "Owner", say. Empty when they gave none. */
  title: string;
  image: string;
  signedLabel: string;
};

/**
 * The business's signature on a contract, if it has been given.
 *
 * Signed by whoever sent the contract or handed it over, with the signature
 * they adopted, through `sign_contract_as_contractor` — the only way these
 * columns get written. As with the customer's, nothing is printed unless
 * every part is there.
 */
export function contractorSignature(
  row: {
    contractor_signed_at?: unknown;
    contractor_signature_method?: unknown;
    contractor_signature_name?: unknown;
    contractor_signature_title?: unknown;
    contractor_signature_image?: unknown;
  },
  timeZone: string,
): ContractorSignature | undefined {
  const method = row.contractor_signature_method;
  if (method !== "drawn" && method !== "typed") return undefined;

  const name =
    typeof row.contractor_signature_name === "string" ? row.contractor_signature_name.trim() : "";
  const title =
    typeof row.contractor_signature_title === "string" ? row.contractor_signature_title.trim() : "";
  const image =
    typeof row.contractor_signature_image === "string" ? row.contractor_signature_image : "";
  const at = typeof row.contractor_signed_at === "string" ? new Date(row.contractor_signed_at) : null;

  if (!name || !at || Number.isNaN(at.getTime())) return undefined;
  if (method === "drawn" && !isPngDataUri(image)) return undefined;

  return {
    method,
    name,
    title,
    image: method === "drawn" ? image : "",
    signedLabel: signatureMoment(at, timeZone),
  };
}

/** A signer's title, tidied: one line, and short enough for a signature line. */
export function readSignerTitle(value: unknown): string {
  return squash(typeof value === "string" ? value : "").slice(0, 80);
}

/**
 * The text that takes a signing link to the customer.
 *
 * The job number is whatever the database handed back — a number, not a
 * string. It used to pass through a helper that keeps strings only, so every
 * link went out without saying which job it was for, which is the first thing
 * somebody with two quotes open wants to know.
 */
export function signingLinkMessage(input: { businessName: string; jobNumber: unknown; link: string }): string {
  const business = input.businessName.trim() || "Your electrician";
  const job =
    typeof input.jobNumber === "number" && Number.isFinite(input.jobNumber)
      ? String(input.jobNumber)
      : typeof input.jobNumber === "string"
        ? input.jobNumber.trim()
        : "";
  return `${business}: here is your contract${job ? ` for job #${job}` : ""} to read and sign: ${input.link}`;
}
