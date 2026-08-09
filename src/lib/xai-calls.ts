import "server-only";

/**
 * Call control on a live SIP session.
 *
 * Two operations, both plain HTTPS, so the worker holding the WebSocket does
 * not have to own them: hand the caller to a person, or end the call. Keeping
 * them here means the escalation number and the failure handling live with the
 * rest of the app rather than in a deployment nobody looks at.
 */

const API_ROOT = "https://api.x.ai/v1/realtime/calls";

function apiKey(): string {
  return process.env.XAI_API_KEY ?? "";
}

export function isXaiConfigured(): boolean {
  return apiKey().length > 0;
}

async function post(path: string, body?: unknown): Promise<boolean> {
  const key = apiKey();
  if (!key) return false;

  try {
    const response = await fetch(`${API_ROOT}/${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Transfer the caller to a person.
 *
 * `target` is a SIP URI or a phone number; a bare number is turned into one,
 * because the escalation number is configured as a phone number everywhere else
 * in this app and requiring a different spelling here is a trap.
 */
export async function referCall(input: { callId: string; target: string }): Promise<boolean> {
  const target = input.target.trim();
  if (!input.callId || !target) return false;

  const targetUri = target.startsWith("sip:") || target.startsWith("tel:")
    ? target
    : `tel:${target.replace(/[^\d+]/g, "")}`;

  return post(`${encodeURIComponent(input.callId)}/refer`, { target_uri: targetUri });
}

export async function hangupCall(callId: string): Promise<boolean> {
  if (!callId) return false;
  return post(`${encodeURIComponent(callId)}/hangup`);
}
