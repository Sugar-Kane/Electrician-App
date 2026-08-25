"use server";

import { revalidatePath } from "next/cache";

import { mcpSessionUrl } from "@/lib/mcp-session";
import { STATIC_SESSION_TTL_SECONDS } from "@/lib/mcp-session-token";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type ChatGptConnectionState = { error: string; url?: string };

export async function createChatGptConnection(): Promise<ChatGptConnectionState> {
  const context = await currentContext();
  if (!context || context.role !== "owner") return { error: "Only the business owner can connect ChatGPT." };

  const supabase = asFlexibleClient(await createClient());
  const expiresAt = new Date(Date.now() + STATIC_SESSION_TTL_SECONDS * 1000).toISOString();
  const { data, error } = await supabase
    .from("mcp_business_credentials")
    .insert({ organization_id: context.organizationId, created_by: context.userId, expires_at: expiresAt, label: "ChatGPT" })
    .select("id")
    .maybeSingle();

  const id = typeof data?.id === "string" ? data.id : "";
  if (error || !id) return { error: "The ChatGPT connection could not be created." };

  const origin = (process.env.NEXT_PUBLIC_APP_URL || "https://volteira.com").replace(/\/+$/, "");
  const url = mcpSessionUrl({
    origin,
    session: { organizationId: context.organizationId, scope: "business", credentialId: id },
    ttlSeconds: STATIC_SESSION_TTL_SECONDS,
  });

  if (!url) {
    await supabase.from("mcp_business_credentials").update({ revoked_at: new Date().toISOString() }).eq("id", id);
    return { error: "MCP is not configured on this deployment." };
  }

  revalidatePath("/settings/integrations");
  return { error: "", url };
}

export async function revokeChatGptConnection(formData: FormData) {
  const context = await currentContext();
  if (!context || context.role !== "owner") return;
  const id = String(formData.get("credentialId") ?? "");
  if (!id) return;
  const supabase = asFlexibleClient(await createClient());
  await supabase
    .from("mcp_business_credentials")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", context.organizationId);
  revalidatePath("/settings/integrations");
}
