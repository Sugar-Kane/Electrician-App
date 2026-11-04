import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { revokeChatGptConnection } from "./chatgpt-actions";
import { ChatGptConnectionCard } from "./chatgpt-connection-card";

export const metadata: Metadata = { title: "Use in ChatGPT | Volteira" };

function dateLabel(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

/**
 * Running Volteira from ChatGPT: its own page, one tap from Settings and from
 * the Today screen, because it used to be a card among the other connected
 * apps that nobody found.
 */
export default async function ChatGptSettingsPage() {
  const context = await currentContext();
  const canManage = context?.role === "owner";
  let connections: { id: string; createdAt: string; expiresAt: string; lastUsedAt: string }[] = [];

  if (context && canManage) {
    const supabase = asFlexibleClient(await createClient());
    const { data } = await supabase
      .from("mcp_business_credentials")
      .select("id, created_at, expires_at, last_used_at")
      .eq("organization_id", context.organizationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false });
    connections = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      createdAt: dateLabel(row.created_at),
      expiresAt: dateLabel(row.expires_at),
      lastUsedAt: dateLabel(row.last_used_at),
    }));
  }

  return (
    <FieldPageShell
      backHref="/settings"
      title="Use in ChatGPT"
      eyebrow="Settings"
      description="Run your day by asking ChatGPT. About 5 minutes to set up."
    >
      <ChatGptConnectionCard connections={connections} canManage={canManage} revokeAction={revokeChatGptConnection} />
    </FieldPageShell>
  );
}
