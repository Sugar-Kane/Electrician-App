import "server-only";

/**
 * Telling the platform about a domain an electrician has pointed at us.
 *
 * A CNAME on its own reaches the edge and gets a certificate error, because the
 * platform will not terminate TLS for a name it has not been told to expect. So
 * adding the domain here is not bookkeeping — it is the step that makes the
 * subdomain work at all.
 *
 * Every call is best-effort and returns a sentence rather than throwing. The
 * domain row is the source of truth for what the tenant asked for; this is the
 * platform catching up with it, and a platform outage must not lose the request
 * or leave the settings screen showing an error the electrician cannot act on.
 */

export type DomainStatus = {
  /** Configured and serving. */
  ready: boolean;
  /** What to tell the electrician to do next, empty when there is nothing. */
  instruction: string;
  /** The CNAME target, when the platform names one. */
  target: string;
};

/** What the electrician types into their DNS provider. */
export const CNAME_TARGET = "cname.vercel-dns.com";

function credentials() {
  const token = process.env.VERCEL_TOKEN ?? "";
  const projectId = process.env.VERCEL_PROJECT_ID ?? "";
  const teamId = process.env.VERCEL_TEAM_ID ?? "";
  if (!token || !projectId) return null;
  return { token, projectId, teamId };
}

/** Whether domain automation is configured at all. */
export function domainAutomationReady(): boolean {
  return credentials() !== null;
}

async function call(
  path: string,
  init: RequestInit,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const creds = credentials();
  if (!creds) return { ok: false, error: "Domain hosting is not configured." };

  const query = creds.teamId ? `${path.includes("?") ? "&" : "?"}teamId=${creds.teamId}` : "";

  try {
    const response = await fetch(`https://api.vercel.com${path}${query}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${creds.token}`,
        "Content-Type": "application/json",
      },
      // Never cached. The whole point of reading this is that it changes when
      // somebody edits their DNS.
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

    if (!response.ok) {
      const error = (body.error ?? {}) as Record<string, unknown>;
      const code = typeof error.code === "string" ? error.code : "";
      // The one failure that is not a failure: asking for a domain that is
      // already attached to this project.
      if (code === "domain_already_in_use" || code === "domain_already_exists") {
        return { ok: true, body };
      }
      console.error("vercel domains: request failed", { path, status: response.status, body });
      return { ok: false, error: platformMessage(code) };
    }

    return { ok: true, body };
  } catch (error) {
    console.error("vercel domains: could not reach the platform", error);
    return { ok: false, error: "The hosting platform could not be reached. Try again shortly." };
  }
}

/** Their words, turned into ours. */
function platformMessage(code: string): string {
  if (code === "forbidden" || code === "not_authorized") {
    return "This app is not allowed to add domains. Check the hosting token.";
  }
  if (code === "invalid_domain") return "That domain was rejected as invalid.";
  if (code === "domain_taken") {
    return "That domain is already attached to another project.";
  }
  return "That domain could not be set up. Try again shortly.";
}

export async function addDomain(hostname: string): Promise<{ error: string }> {
  const creds = credentials();
  if (!creds) return { error: "" }; // Not configured; the row still stands.

  const result = await call(`/v10/projects/${creds.projectId}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: hostname }),
  });

  return { error: result.ok ? "" : result.error };
}

export async function removeDomain(hostname: string): Promise<{ error: string }> {
  const creds = credentials();
  if (!creds) return { error: "" };

  const result = await call(
    `/v9/projects/${creds.projectId}/domains/${encodeURIComponent(hostname)}`,
    { method: "DELETE" },
  );

  return { error: result.ok ? "" : result.error };
}

/**
 * Whether the DNS an electrician was asked to set is actually in place.
 *
 * `misconfigured` is the platform's own verdict on the live records, which is
 * worth more than anything this app could infer — it has already resolved the
 * name and compared it against what it expects.
 */
export async function domainStatus(hostname: string): Promise<DomainStatus> {
  const creds = credentials();
  if (!creds) {
    return {
      ready: false,
      target: CNAME_TARGET,
      instruction: "Domain hosting is not configured for this app yet.",
    };
  }

  const result = await call(
    `/v6/domains/${encodeURIComponent(hostname)}/config`,
    { method: "GET" },
  );

  if (!result.ok) {
    return { ready: false, target: CNAME_TARGET, instruction: result.error };
  }

  const misconfigured = result.body.misconfigured === true;

  return {
    ready: !misconfigured,
    target: CNAME_TARGET,
    instruction: misconfigured
      ? `Add a CNAME record for this subdomain pointing to ${CNAME_TARGET}, then check again. DNS can take up to an hour.`
      : "",
  };
}
