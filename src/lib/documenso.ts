import "server-only";

/**
 * The small part of Documenso's envelope API Volteira needs.
 *
 * Kept behind one module so a self-hosted Documenso instance is only an
 * environment-variable change, and so provider error bodies never get shown to
 * a customer or written into a contract.
 */

const DEFAULT_BASE_URL = "https://app.documenso.com/api/v2";
const REQUEST_TIMEOUT_MS = 20_000;

export type DocumensoField = {
  identifier: number;
  type: "SIGNATURE" | "NAME" | "DATE";
  page: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
};

export type DocumensoRecipient = {
  email: string;
  name: string;
  role: "SIGNER";
  signingOrder: number;
  fields: DocumensoField[];
};

type EnvelopeRecipient = {
  email?: unknown;
  name?: unknown;
  signingUrl?: unknown;
};

type EnvelopeResponse = {
  id?: unknown;
  envelopeId?: unknown;
  status?: unknown;
  completedAt?: unknown;
  recipients?: unknown;
  envelopeItems?: unknown;
};

export class DocumensoError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "DocumensoError";
  }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function baseUrl(): string {
  const configured = (process.env.DOCUMENSO_API_URL ?? DEFAULT_BASE_URL).trim();
  return configured.replace(/\/+$/, "");
}

function token(): string {
  return (process.env.DOCUMENSO_API_TOKEN ?? "").trim();
}

export function isDocumensoConfigured(): boolean {
  return Boolean(token());
}

export function isDocumensoWebhookConfigured(): boolean {
  return Boolean((process.env.DOCUMENSO_WEBHOOK_SECRET ?? "").trim());
}

/** Sending is safe only when completed envelopes can also return to Volteira. */
export function isDocumensoReady(): boolean {
  return isDocumensoConfigured() && isDocumensoWebhookConfigured();
}

async function providerRequest(path: string, init: RequestInit): Promise<Response> {
  const authorization = token();
  if (!authorization) {
    throw new DocumensoError("Document signing is not connected yet.");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        ...init.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("documenso: request failed", error);
    throw new DocumensoError("The signing service could not be reached. Try again.");
  }

  if (!response.ok) {
    // Provider messages can include an email address or implementation detail.
    // The status is enough for logs and the screen gets a stable, useful line.
    console.error(`documenso: provider returned ${response.status} for ${path}`);
    throw new DocumensoError("The signing service refused that request. Try again.", response.status);
  }

  return response;
}

async function jsonRequest(path: string, body: Record<string, unknown>): Promise<EnvelopeResponse> {
  const response = await providerRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return (await response.json()) as EnvelopeResponse;
}

export async function createDocumensoEnvelope(input: {
  pdf: Buffer;
  fileName: string;
  title: string;
  externalId: string;
  recipients: DocumensoRecipient[];
  timeZone: string;
  businessName: string;
}): Promise<string> {
  const form = new FormData();
  form.append(
    "payload",
    JSON.stringify({
      type: "DOCUMENT",
      title: input.title,
      externalId: input.externalId,
      visibility: "MANAGER_AND_ABOVE",
      recipients: input.recipients,
      meta: {
        subject: `Please sign: ${input.title}`,
        message: `${input.businessName} has sent your electrical work agreement for review and signature.`,
        timezone: input.timeZone,
        typedSignatureEnabled: true,
        uploadSignatureEnabled: true,
        drawSignatureEnabled: true,
      },
    }),
  );
  form.append(
    "files",
    new Blob([new Uint8Array(input.pdf)], { type: "application/pdf" }),
    input.fileName,
  );

  const response = await providerRequest("/envelope/create", {
    method: "POST",
    body: form,
  });
  const result = (await response.json()) as EnvelopeResponse;
  const id = string(result.id) || string(result.envelopeId);
  if (!id) throw new DocumensoError("The signing service did not return a document ID.");
  return id;
}

export async function distributeDocumensoEnvelope(envelopeId: string): Promise<{
  customerSigningUrl: string;
}> {
  const result = await jsonRequest("/envelope/distribute", { envelopeId });
  const recipients = Array.isArray(result.recipients)
    ? (result.recipients as EnvelopeRecipient[])
    : [];

  return {
    customerSigningUrl: string(recipients[0]?.signingUrl),
  };
}

/** Best-effort cleanup when the local row could not be linked to a new draft. */
export async function deleteDocumensoEnvelope(envelopeId: string): Promise<void> {
  await jsonRequest("/envelope/delete", { envelopeId });
}

export type DocumensoEnvelope = {
  id: string;
  status: string;
  completedAt: string;
  itemIds: string[];
};

export async function getDocumensoEnvelope(envelopeId: string): Promise<DocumensoEnvelope> {
  const response = await providerRequest(`/envelope/${encodeURIComponent(envelopeId)}`, {
    method: "GET",
  });
  const result = (await response.json()) as EnvelopeResponse;
  const items = Array.isArray(result.envelopeItems)
    ? (result.envelopeItems as { id?: unknown }[])
    : [];

  return {
    id: string(result.id) || string(result.envelopeId) || envelopeId,
    status: string(result.status),
    completedAt: string(result.completedAt),
    itemIds: items.map((item) => string(item.id)).filter(Boolean),
  };
}

export async function downloadDocumensoItem(itemId: string): Promise<Buffer> {
  // Be explicit: the endpoint can also return the unsigned original.  Only the
  // sealed, completed PDF belongs in the customer's permanent job record.
  const response = await providerRequest(
    `/envelope/item/${encodeURIComponent(itemId)}/download?version=signed`,
    {
      method: "GET",
      headers: { Accept: "application/pdf" },
    },
  );
  return Buffer.from(await response.arrayBuffer());
}
