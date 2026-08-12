import "server-only";

import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * What the assistant has been told to remember, for one business.
 *
 * Explicit, not inferred. The chat remembers what somebody asks it to remember
 * and nothing else, and the list is visible and deletable. A rolling summary of
 * past conversations is more useful right up to the moment it recalls something
 * wrong in front of a customer, and there is no way to tell in advance which
 * conversation that will be.
 *
 * Scoped by organization in every query. This is the boundary that matters
 * most in this file: one deployment serves many electricians, and a memory
 * crossing it would put one business's working practice — its pricing, its
 * suppliers, how it handles a difficult customer — in front of another.
 */

export type Memory = { id: string; fact: string; createdLabel: string };

const MAX_MEMORIES = 40;

export async function getMemories(): Promise<Memory[]> {
  const context = await currentContext();
  if (!context) return [];

  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("assistant_memories")
    .select("id, fact, created_at")
    // Belt and braces: RLS already restricts this, and the filter is here so a
    // policy change can never silently widen it.
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(MAX_MEMORIES);

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    fact: typeof row.fact === "string" ? row.fact : "",
    createdLabel: new Intl.DateTimeFormat("en-US", {
      timeZone: context.timeZone || "America/Los_Angeles",
      month: "short",
      day: "numeric",
    }).format(new Date(String(row.created_at))),
  }));
}

export async function rememberFact(fact: string): Promise<boolean> {
  const trimmed = fact.trim().slice(0, 500);
  if (!trimmed) return false;

  const context = await currentContext();
  if (!context) return false;

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.from("assistant_memories").insert({
    organization_id: context.organizationId,
    fact: trimmed,
  });

  return !error;
}

export async function forgetFact(id: string): Promise<boolean> {
  const context = await currentContext();
  if (!context) return false;

  const supabase = asFlexibleClient(await createClient());
  // Archived rather than deleted, so "forget that" is recoverable when it was
  // the wrong memory.
  const { error } = await supabase
    .from("assistant_memories")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", context.organizationId);

  return !error;
}

/** The memories, as a block for the model. Empty string when there are none. */
export function memoryBrief(memories: Memory[]): string {
  if (memories.length === 0) return "";
  return [
    "",
    "<remembered>",
    ...memories.map((memory) => `- [${memory.id}] ${memory.fact}`),
    "</remembered>",
  ].join("\n");
}
