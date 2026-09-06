/** Translate provider events into Volteira's deliberately smaller lifecycle. */
export function documensoEventContractStatus(event: string):
  | "sent"
  | "signed"
  | "void"
  | null {
  if (["DOCUMENT_SENT", "DOCUMENT_OPENED", "DOCUMENT_SIGNED", "DOCUMENT_RECIPIENT_COMPLETED"].includes(event)) {
    return "sent";
  }
  if (event === "DOCUMENT_COMPLETED") return "signed";
  if (["DOCUMENT_REJECTED", "DOCUMENT_CANCELLED"].includes(event)) return "void";
  return null;
}

function instant(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Provider timestamps can spell the same instant with different offsets. */
export function sameDocumensoEvent(
  storedEvent: string | null | undefined,
  storedAt: string | null | undefined,
  incomingEvent: string,
  incomingAt: string,
): boolean {
  const storedInstant = instant(storedAt);
  const incomingInstant = instant(incomingAt);
  return storedEvent === incomingEvent &&
    storedInstant !== null &&
    incomingInstant !== null &&
    storedInstant === incomingInstant;
}

/** Ignore an older delivery so it cannot rewind the visible audit trail. */
export function isStaleDocumensoEvent(
  storedAt: string | null | undefined,
  incomingAt: string,
): boolean {
  const storedInstant = instant(storedAt);
  const incomingInstant = instant(incomingAt);
  return storedInstant !== null && incomingInstant !== null && incomingInstant < storedInstant;
}
