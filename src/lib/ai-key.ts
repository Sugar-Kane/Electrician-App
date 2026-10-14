import "server-only";

import { keyHint, looksLikeOpenAiKey, pickOpenAiModel } from "@/lib/ai-key-rules";
import { decryptDocumentSecret, encryptDocumentSecret } from "@/lib/document-secrets";
import { listOpenAiModels, OpenAiRefusal } from "@/lib/openai";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * A business's own OpenAI key: checked against OpenAI, encrypted with the
 * app's secret-storage key (the same AES-GCM key that guards document sync
 * tokens), and kept where only the server can read it.
 *
 * Callers decide who may do what. Saving and removing are the owner's; using
 * the key to write a list is any member's, on their own business's jobs.
 */

export type AiKeyStatus = {
  hint: string;
  model: string;
  savedAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
};

/**
 * The key as Settings shows it, and the version of the business's key record
 * the page is showing. Removing a key keeps the record, emptied, with a new
 * version: so a page that showed "no key" before someone connected and then
 * removed one elsewhere is still recognised as showing an older state.
 */
export async function aiKeyState(organizationId: string): Promise<{ status: AiKeyStatus | null; version: string }> {
  const { data } = await getSupabaseAdmin()
    .from("organization_ai_keys")
    .select("key_hint, model, updated_at, last_used_at, last_error")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!data) return { status: null, version: "" };
  const version = String(data.updated_at ?? "");
  // An emptied record: the key was removed.
  if (!data.key_hint) return { status: null, version };
  return {
    status: {
      hint: String(data.key_hint),
      model: String(data.model ?? ""),
      savedAt: version,
      lastUsedAt: data.last_used_at ? String(data.last_used_at) : null,
      lastError: data.last_error ? String(data.last_error) : null,
    },
    version,
  };
}

export async function aiKeyStatus(organizationId: string): Promise<AiKeyStatus | null> {
  return (await aiKeyState(organizationId)).status;
}

const CHANGED_ELSEWHERE = "The key was changed in another window while this was being done. This page now shows it as it is; try again if you still want to.";

/**
 * Check a key with OpenAI and keep it. Nothing is stored unless OpenAI accepts
 * it and it can use a model that writes text, and only over the record the
 * page showed (`expectedVersion`, null when the business never had one): a
 * key connected, replaced or removed in another window meanwhile is not
 * overwritten.
 */
export async function saveOpenAiKey(input: {
  organizationId: string;
  userId: string;
  key: string;
  expectedVersion: string | null;
}): Promise<{ ok: true; status: AiKeyStatus } | { ok: false; reason: string }> {
  const key = input.key.trim();
  if (!looksLikeOpenAiKey(key)) {
    return { ok: false, reason: "That does not look like an OpenAI API key. It starts with sk- and is one long line." };
  }

  let models: string[];
  try {
    models = await listOpenAiModels(key);
  } catch (error) {
    return { ok: false, reason: error instanceof OpenAiRefusal ? error.message : "OpenAI could not be reached. Try again." };
  }
  const model = pickOpenAiModel(models);
  if (!model) return { ok: false, reason: "That key works, but it cannot use any GPT model that writes text." };

  let encrypted: string;
  try {
    encrypted = encryptDocumentSecret(key);
  } catch {
    return { ok: false, reason: "This deployment has no secret-storage key set, so the key could not be kept safely." };
  }

  const now = new Date().toISOString();
  const row = {
    organization_id: input.organizationId,
    provider: "openai",
    encrypted_key: encrypted,
    key_hint: keyHint(key),
    model,
    created_by: input.userId || null,
    updated_at: now,
    last_used_at: null,
    last_error: null,
  };
  const table = getSupabaseAdmin().from("organization_ai_keys");
  if (input.expectedVersion === null) {
    const { error } = await table.insert(row);
    // Connected in another window first.
    if (error?.code === "23505") return { ok: false, reason: CHANGED_ELSEWHERE };
    if (error) return { ok: false, reason: "The key could not be saved. Try again." };
  } else {
    const { data, error } = await table
      .update(row)
      .eq("organization_id", input.organizationId)
      .eq("updated_at", input.expectedVersion)
      .select("organization_id");
    if (error) return { ok: false, reason: "The key could not be saved. Try again." };
    if (!Array.isArray(data) || data.length === 0) return { ok: false, reason: CHANGED_ELSEWHERE };
  }

  return { ok: true, status: { hint: keyHint(key), model, savedAt: now, lastUsedAt: null, lastError: null } };
}

/**
 * Forget the key the page showed (`expectedVersion`). The record stays,
 * emptied of the key, with a new version, so a slower connect started before
 * this can't bring a key back. A key replaced in another window since is left
 * alone. Nobody is told a key is gone when the database refused, or when it
 * is not the key they meant.
 */
export async function removeOpenAiKey(
  organizationId: string,
  expectedVersion: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("organization_ai_keys")
    .update({
      encrypted_key: "",
      key_hint: "",
      model: "none",
      updated_at: new Date().toISOString(),
      last_used_at: null,
      last_error: null,
    })
    .eq("organization_id", organizationId)
    .eq("updated_at", expectedVersion)
    .select("organization_id");
  if (error) {
    console.error("OpenAI key was not removed", { organizationId, code: error.code, message: error.message });
    return { ok: false, reason: "The key could not be removed. Try again." };
  }
  if (Array.isArray(data) && data.length > 0) return { ok: true };
  // Nothing matched: already gone is fine; a different key now is not.
  const { data: current, error: lookup } = await admin
    .from("organization_ai_keys")
    .select("key_hint")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (lookup) return { ok: false, reason: "The key could not be removed. Try again." };
  return current?.key_hint ? { ok: false, reason: CHANGED_ELSEWHERE } : { ok: true };
}

/**
 * The key itself, for a server call on this business's behalf. Never sent to
 * a browser. "unreadable" when a key is saved but cannot be decrypted, and
 * "unavailable" when the lookup itself failed: either way the caller says so
 * rather than quietly using another AI. Null only when there is no key.
 */
export async function openAiKeyFor(
  organizationId: string,
): Promise<
  | { key: string; model: string; version: string }
  | { unreadable: true; version: string }
  | { unavailable: true }
  | null
> {
  const { data, error } = await getSupabaseAdmin()
    .from("organization_ai_keys")
    .select("encrypted_key, model, updated_at")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) {
    console.error("OpenAI key lookup failed", { organizationId, code: error.code, message: error.message });
    return { unavailable: true };
  }
  if (!data?.encrypted_key) return null;
  // Which saved key this is, so how it went is never written onto a key
  // connected in its place while the request was running.
  const version = String(data.updated_at ?? "");
  try {
    return { key: decryptDocumentSecret(String(data.encrypted_key)), model: String(data.model), version };
  } catch (error) {
    console.error("stored OpenAI key could not be decrypted", { organizationId, error: String(error) });
    return { unreadable: true, version };
  }
}

/**
 * Record how the last use went, so Settings can say the key still works.
 * Only onto the key that was used: one replaced since is left as it is.
 */
export async function noteOpenAiKeyUse(organizationId: string, version: string, error: string | null): Promise<void> {
  await getSupabaseAdmin()
    .from("organization_ai_keys")
    .update(error ? { last_error: error.slice(0, 300) } : { last_used_at: new Date().toISOString(), last_error: null })
    .eq("organization_id", organizationId)
    .eq("updated_at", version);
}
