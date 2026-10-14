import { noteOpenAiKeyUse, openAiKeyFor } from "@/lib/ai-key";
import { normalizeMaterialList } from "@/lib/material-list";
import { currentContext, currentUser } from "@/lib/request-context";
import { lookUpStorePrices, MAX_PRICED_ITEMS } from "@/lib/store-prices";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Home Depot and Lowe's prices for items on a job's materials list.
 *
 * The browser sends the items it wants priced and gets back what was found
 * for each, then puts the prices on its list and saves it the way it saves
 * any edit: one writer, in order, against the version it holds. Nothing here
 * writes the list, so a lookup that takes a minute can never undo an edit
 * made meanwhile.
 *
 * Only on the business's own ChatGPT key, and only for signed-in members, on
 * their own business's jobs.
 */

export const maxDuration = 120;

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ jobNumber: string }> }) {
  const { jobNumber } = await context.params;
  const number = Number(jobNumber);
  if (!Number.isInteger(number) || number <= 0) return jsonError(404, "That job could not be found.");

  let rawItems: unknown;
  try {
    rawItems = ((await request.json()) as { items?: unknown }).items;
  } catch {
    return jsonError(400, "Say which items to price.");
  }
  // Read through the same checks as a saved list, so only real items go out.
  const checked = normalizeMaterialList({
    sections: [{ heading: "Items", blocks: [{ type: "items", items: Array.isArray(rawItems) ? rawItems.slice(0, MAX_PRICED_ITEMS) : [] }] }],
  });
  const block = checked?.sections[0]?.blocks[0];
  const items = block && block.type === "items" ? block.items : [];
  if (items.length === 0) return jsonError(400, "Say which items to price.");

  if (!(await currentUser())) return jsonError(401, "You are not signed in.");
  const caller = await currentContext();
  if (!caller) return jsonError(403, "You are not a member of a business.");
  const { organizationId } = caller;

  const supabase = asFlexibleClient(await createClient());
  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, properties ( city, state, postal_code )")
    .eq("organization_id", organizationId)
    .eq("job_number", number)
    .maybeSingle();
  const job = (jobRow ?? null) as Record<string, unknown> | null;
  if (typeof job?.id !== "string") return jsonError(404, "That job could not be found.");

  const stored = await openAiKeyFor(organizationId);
  if (!stored) {
    return jsonError(409, "Connect a ChatGPT key in Settings → Integrations to fill in Home Depot and Lowe's prices.");
  }
  if ("unavailable" in stored) {
    return jsonError(503, "The saved ChatGPT key could not be checked just now. Try again in a moment.");
  }
  if ("unreadable" in stored) {
    const reason = "The saved ChatGPT key could not be read. The owner can reconnect it in Settings → Integrations.";
    await noteOpenAiKeyUse(organizationId, stored.version, reason);
    return jsonError(503, reason);
  }

  const place = (Array.isArray(job.properties) ? job.properties[0] : job.properties) as
    | { city?: unknown; state?: unknown; postal_code?: unknown }
    | null;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

  const run = await lookUpStorePrices({
    key: stored.key,
    model: stored.model,
    items,
    place: { city: text(place?.city), region: text(place?.state), postalCode: text(place?.postal_code) },
    signal: request.signal,
  });
  if (request.signal.aborted) return new Response(null, { status: 499 });

  await noteOpenAiKeyUse(organizationId, stored.version, run.keyRefused ? run.error : null);
  return Response.json(
    { prices: run.prices, error: run.error },
    { status: Object.keys(run.prices).length === 0 && run.error ? 502 : 200, headers: { "cache-control": "no-store" } },
  );
}
