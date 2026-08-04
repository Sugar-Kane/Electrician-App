import "server-only";

/**
 * Outbound SMS to the business owner.
 *
 * A lead sitting in the app is fine for a panel-upgrade quote. It is not fine
 * for a sparking panel at 9pm — nobody opens a dashboard at 9pm. Emergencies get
 * pushed to the owner's phone as a text.
 *
 * Sent through Twilio's REST API rather than the SDK, for the same reason the
 * signature check is hand-rolled: one endpoint does not justify the dependency.
 */
export async function sendOwnerAlert(input: {
  fromNumber: string;
  toNumber: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();

  if (!accountSid || !authToken) {
    return { ok: false, error: "Twilio credentials are not configured." };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`;
  const body = new URLSearchParams({
    From: input.fromNumber,
    To: input.toNumber,
    Body: input.body,
  });

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      // The caller is often still on the line. Give up rather than hold the
      // webhook open behind a slow provider.
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return { ok: false, error: `Twilio responded ${response.status}: ${(await response.text()).slice(0, 200)}` };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unknown send failure" };
  }
}

/** The text the owner actually receives. Written to be readable on a lock screen. */
export function buildEmergencyAlert(input: {
  businessName: string;
  contactName: string | null;
  contactPhone: string;
  serviceAddress: string | null;
  summary: string;
}) {
  const who = input.contactName ? `${input.contactName} (${input.contactPhone})` : input.contactPhone;
  const where = input.serviceAddress ?? "address not captured";
  // Twilio bills per 160-character segment; keep the common case to one or two.
  const summary = input.summary.length > 160 ? `${input.summary.slice(0, 157)}...` : input.summary;
  return `URGENT — ${input.businessName}\n${who}\n${where}\n${summary}`;
}
