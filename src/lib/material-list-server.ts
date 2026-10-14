import "server-only";

import { EMPTY_LIST, keptTurns, normalizeMaterialList, type ChatTurn, type MaterialList } from "@/lib/material-list";
import { aiKeyStatus } from "@/lib/ai-key";
import { currentContext } from "@/lib/request-context";
import { readMarkupPercent } from "@/lib/store-price-rules";
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

export type MaterialListWrite = { status: "saved"; updatedAt: string } | { status: "changed" } | { status: "failed" };

/**
 * Keep a job's list. With `expectedUpdatedAt`, only over the version the
 * writer started from: null means there was no list yet. When someone else
 * has saved or cleared it since, nothing is written and the answer is
 * "changed", so a slow reply or an edit made on an old copy never replaces
 * a newer list.
 */
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
    expectedUpdatedAt?: string | null;
  },
): Promise<MaterialListWrite> {
  const updatedAt = new Date().toISOString();
  const row: Record<string, unknown> = {
    organization_id: input.organizationId,
    job_id: input.jobId,
    content: input.list,
    updated_at: updatedAt,
  };
  if (input.messages) row.messages = keptTurns(input.messages);
  if (input.source) row.source = input.source;
  if (input.model) row.model = input.model;
  if (input.userId) row.created_by = input.userId;

  const table = supabase.from("job_material_lists");
  let error: { code?: string; message?: string } | null = null;
  if (input.expectedUpdatedAt === undefined) {
    ({ error } = await table.upsert(row, { onConflict: "job_id" }));
  } else if (input.expectedUpdatedAt === null) {
    ({ error } = await table.insert(row));
    // A list made by someone else in the meantime.
    if (error?.code === "23505") return { status: "changed" };
  } else {
    const result = await table
      .update(row)
      .eq("job_id", input.jobId)
      .eq("organization_id", input.organizationId)
      .eq("updated_at", input.expectedUpdatedAt)
      .select("id");
    error = result.error;
    if (!error && (!Array.isArray(result.data) || result.data.length === 0)) return { status: "changed" };
  }
  if (error) {
    console.error("materials list was not saved", { jobId: input.jobId, code: error.code, message: error.message });
    return { status: "failed" };
  }
  return { status: "saved", updatedAt };
}

/**
 * What the job page's materials chat starts from: the saved list, which AI
 * will answer, and the markup that turns a store price into the customer's.
 */
export async function loadJobMaterialChat(jobId: string): Promise<{
  saved: SavedMaterialList;
  ai: { connected: boolean; label: string };
  canConnect: boolean;
  markupPercent: number;
}> {
  const context = await currentContext();
  const supabase = asFlexibleClient(await createClient());
  const [saved, key, organization] = await Promise.all([
    readMaterialList(supabase, jobId),
    context ? aiKeyStatus(context.organizationId) : Promise.resolve(null),
    context
      ? supabase.from("organizations").select("materials_markup_percent").eq("id", context.organizationId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const markup = readMarkupPercent((organization.data as Record<string, unknown> | null)?.materials_markup_percent);
  return {
    saved,
    ai: key ? { connected: true, label: `your ChatGPT key (${key.model})` } : { connected: false, label: "Volteira's built-in AI" },
    canConnect: context?.role === "owner",
    markupPercent: markup ?? 20,
  };
}
