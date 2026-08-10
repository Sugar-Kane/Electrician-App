import "server-only";

/**
 * Sending one transactional email.
 *
 * Resend over fetch, for the same reason Twilio is fetch and not the SDK:
 * sending a message is a few lines, and a dependency that only does that is not
 * worth carrying.
 *
 * Never throws, and returns rather than reports. A confirmation email failing
 * must not undo a booking that is already in the calendar — the appointment is
 * the thing the customer actually needs.
 */

export type EmailResult =
  | { ok: true; id: string }
  | { ok: false; errorCode: string; errorDetail: string };

function credentials(): { apiKey: string; from: string } | null {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.BOOKING_EMAIL_FROM;
  if (!apiKey || !from) return null;
  return { apiKey, from };
}

export function isEmailConfigured(): boolean {
  return credentials() !== null;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
  /** Overrides the configured From line, for a tenant-named sender. */
  from?: string;
}): Promise<EmailResult> {
  const auth = credentials();
  if (!auth) {
    return {
      ok: false,
      errorCode: "not_configured",
      errorDetail: "RESEND_API_KEY and BOOKING_EMAIL_FROM are not set on this deployment.",
    };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${auth.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: input.from || auth.from,
        to: [input.to],
        subject: input.subject,
        text: input.text,
        html: input.html,
        // So a customer replying to a confirmation reaches the business rather
        // than a no-reply mailbox nobody watches.
        ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      }),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!response.ok || !payload.id) {
      return {
        ok: false,
        errorCode: payload.name ?? String(response.status),
        errorDetail: payload.message ?? "The email provider rejected the message.",
      };
    }

    return { ok: true, id: payload.id };
  } catch {
    return { ok: false, errorCode: "network_error", errorDetail: "Could not reach the email provider." };
  }
}
