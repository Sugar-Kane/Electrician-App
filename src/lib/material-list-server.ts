import "server-only";

import { EMPTY_LIST, keptTurns, normalizeMaterialList, type ChatTurn, type MaterialList } from "@/lib/material-list";
import { aiKeyStatus } from "@/lib/ai-key";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient, type FlexibleSupabaseClient as FlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Reading and writing a job's materials list, through the caller's own
 * session so the table's policies decide whose list it is.
 */

export type SavedMaterialList = {
  list: MaterialList;
  messages: ChatTurn[];
  source: "openai" | "claude" | null;
  model: string | null;
  updatedAt: string | null;
};

export const NO_LIST: SavedMaterialList = { list: EMPTY_LIST, messages: [], source: null, model: null, updatedAt: null };

function turnsFrom(raw: unknown): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((turn): turn is Record<string, unknown> => Boolean(turn) && typeof turn === "object")
    .map((turn) => ({
      role: turn.role === "assistant" ? ("assistant" as const) : ("user" as const),
      text: typeof turn.text === "string" ? turn.text : "",
      at: typeof turn.at === "string" ? turn.at : "",
    }))
    .filter((turn) => turn.text);
}

export async function readMaterialList(supabase: FlexibleClient, jobId: string): Promise<SavedMaterialList> {
  const { data } = await supabase
    .from("job_material_lists")
    .select("content, messages, source, model, updated_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data) return NO_LIST;
  return {
    list: normalizeMaterialList(data.content) ?? EMPTY_LIST,
    messages: turnsFrom(data.messages),
    source: data.source === "openai" || data.source === "claude" ? data.source : null,
    model: typeof data.model === "string" ? data.model : null,
    updatedAt: typeof data.updated_at === "string" ? data.updated_at : null,
  };
}

export async function writeMaterialList(
  supabase: FlexibleClient,
  input: {
    organizationId: string;
    jobId: string;
    userId: string;
    list: MaterialList;
    messages?: ChatTurn[];
    source?: "openai" | "claude";
    model?: string;
  },
): Promise<boolean> {
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    job_id: input.jobId,
    content: input.list,
    updated_at: new Date().toISOString(),
  };
  if (input.messages) row.messages = keptTurns(input.messages);
  if (input.source) row.source = input.source;
  if (input.model) row.model = input.model;
  if (input.userId) row.created_by = input.userId;

  const { error } = await supabase.from("job_material_lists").upsert(row, { onConflict: "job_id" });
  if (error) console.error("materials list was not saved", { jobId: input.jobId, code: error.code, message: error.message });
  return !error;
}

/** What the job page's materials chat starts from: the saved list, and which AI will answer. */
export async function loadJobMaterialChat(jobId: string): Promise<{
  saved: SavedMaterialList;
  ai: { connected: boolean; label: string };
  canConnect: boolean;
}> {
  const context = await currentContext();
  const [saved, key] = await Promise.all([
    readMaterialList(asFlexibleClient(await createClient()), jobId),
    context ? aiKeyStatus(context.organizationId) : Promise.resolve(null),
  ]);
  return {
    saved,
    ai: key ? { connected: true, label: `your ChatGPT key (${key.model})` } : { connected: false, label: "Volteira's built-in AI" },
    canConnect: context?.role === "owner",
  };
}
