"use server";

import { revalidatePath } from "next/cache";

import { recordActivity } from "@/lib/activity";
import { removeOpenAiKey, saveOpenAiKey, type AiKeyStatus } from "@/lib/ai-key";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Connecting the business's own ChatGPT (OpenAI) API key. Owner only: the key
 * spends the owner's money with OpenAI.
 */

export type OpenAiKeyState = { error: string; status?: AiKeyStatus };

export async function connectOpenAiKey(_previous: OpenAiKeyState, formData: FormData): Promise<OpenAiKeyState> {
  const context = await currentContext();
  if (!context || context.role !== "owner") return { error: "Only the business owner can connect a ChatGPT key." };

  const result = await saveOpenAiKey({
    organizationId: context.organizationId,
    userId: context.userId,
    key: String(formData.get("apiKey") ?? ""),
  });
  if (!result.ok) return { error: result.reason };

  await recordActivity(asFlexibleClient(await createClient()), {
    organizationId: context.organizationId,
    eventType: "integration.openai_connected",
    label: "ChatGPT API key connected",
    metadata: { model: result.status.model, key: result.status.hint },
  });
  revalidatePath("/settings/integrations");
  return { error: "", status: result.status };
}

export async function disconnectOpenAiKey(): Promise<void> {
  const context = await currentContext();
  if (!context || context.role !== "owner") return;
  await removeOpenAiKey(context.organizationId);
  await recordActivity(asFlexibleClient(await createClient()), {
    organizationId: context.organizationId,
    eventType: "integration.openai_disconnected",
    label: "ChatGPT API key removed",
  });
  revalidatePath("/settings/integrations");
}
