import "server-only";

import { createHash } from "node:crypto";

import { runBookingTool } from "@/lib/booking-tools";
import { authorizeBusinessMcpConnection, type BusinessConnectionLookups } from "@/lib/mcp-business-authorization";
import { approvalArgs, approvalIdempotencyKey, awaitingApprovalText, needsVolteiraApproval, proposalFromPreview } from "@/lib/mcp-approval";
import { BUSINESS_MCP_TOOLS, runBusinessMcpTool } from "@/lib/mcp-business-tools";
import { isChangeOrderTool, runChangeOrderTool } from "@/lib/mcp-change-order-tools";
import { isCustomerTool, runCustomerTool } from "@/lib/mcp-customer-tools";
import { logMcpCall } from "@/lib/mcp-log";
import { isPaidInvoiceTool, runPaidInvoiceTool } from "@/lib/mcp-paid-invoice-tools";
import type { ToolResult } from "@/lib/mcp-protocol";
import { isReleaseTool, runReleaseTool } from "@/lib/mcp-release-tools";
import type { McpSession } from "@/lib/mcp-session-token";
import { SUPPLIER_ORDER_MCP_TOOLS, runSupplierOrderMcpTool } from "@/lib/mcp-supplier-order-tools";
import { isSupervisedTool, runSupervisedTool, supervisedMcpEnabled } from "@/lib/mcp-supervised-tools";
import { isTextHistoryTool, runTextHistoryTool, type HistoryDatabase } from "@/lib/mcp-text-history";
import { WORKDAY_MCP_TOOLS, runWorkdayMcpTool } from "@/lib/mcp-workday-tools";
import { organizationTimeZone } from "@/lib/job-billing-server";
import { createSupervisedProposal } from "@/lib/supervised-actions-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/**
 * Running one MCP tool call, shared by the MCP route (ChatGPT calling) and the
 * supervised executor (an approved ChatGPT request being carried out).
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

export type DispatchContext = {
  database: Database;
  session: McpSession;
  /** The owner who made this business connection, verified by authorizeBusinessMcpConnection. */
  connectedBy: string;
};

const workdayNames = new Set(WORKDAY_MCP_TOOLS.map((tool) => tool.name));
const businessNames = new Set(BUSINESS_MCP_TOOLS.map((tool) => tool.name));
const supplierNames = new Set(SUPPLIER_ORDER_MCP_TOOLS.map((tool) => tool.name));

/** The service-role lookups authorizeBusinessMcpConnection needs, scoped by both ids. */
export function businessConnectionLookups(database: Database): BusinessConnectionLookups {
  return {
    credential: async (credentialId, organizationId) => {
      const { data } = await database
        .from("mcp_business_credentials")
        .select("created_by, revoked_at, expires_at")
        .eq("id", credentialId)
        .eq("organization_id", organizationId)
        .maybeSingle();
      const row = (data ?? null) as Record<string, unknown> | null;
      return row
        ? {
            createdBy: typeof row.created_by === "string" ? row.created_by : "",
            revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
            expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
          }
        : null;
    },
    memberRole: async (organizationId, userId) => {
      const { data } = await database
        .from("organization_members")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .maybeSingle();
      return typeof data?.role === "string" ? data.role : null;
    },
  };
}

/**
 * Who a tool that records a person acts as: the owner who created this
 * connection, but only while they are still a member of the business. Never
 * anything the request says.
 */
export async function connectionUserId(database: Database, organizationId: string, userId: string): Promise<string | null> {
  if (!userId) return null;
  const { data: member } = await database
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  return member ? userId : null;
}

/** Runs the named tool as it stands, with no approval step. */
export async function dispatchTool(context: DispatchContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const { database, session, connectedBy } = context;
  const business = session.scope === "business";
  const supervised = business && supervisedMcpEnabled();
  if (business && isReleaseTool(name)) return runReleaseTool(name, args, process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (supervised && isSupervisedTool(name)) {
    return runSupervisedTool({
      database: asFlexibleClient(database),
      organizationId: session.organizationId,
      // The owner this connection was verified for, never a model's claim.
      actorUserId: await connectionUserId(database, session.organizationId, connectedBy),
      credentialId: session.credentialId ?? "",
      name,
      args,
    });
  }
  if (business && workdayNames.has(name)) return runWorkdayMcpTool({ database, session, name, args });
  if (business && businessNames.has(name)) return runBusinessMcpTool({ database, session, name, args });
  if (business && isChangeOrderTool(name)) {
    return runChangeOrderTool({
      name,
      args,
      // Billing permission is the connected owner's own, checked again in the
      // database for anything that moves money.
      context: await (await import("@/lib/mcp-change-order-services")).changeOrderToolContext({
        database: asFlexibleClient(database),
        organizationId: session.organizationId,
        actorUserId: await connectionUserId(database, session.organizationId, connectedBy),
      }),
    });
  }
  if (business && isCustomerTool(name)) {
    return runCustomerTool({ database: asFlexibleClient(database), organizationId: session.organizationId, name, args });
  }
  if (business && isPaidInvoiceTool(name)) {
    return runPaidInvoiceTool({
      database: asFlexibleClient(database),
      organizationId: session.organizationId,
      actorUserId: await connectionUserId(database, session.organizationId, connectedBy),
      timeZone: await organizationTimeZone(asFlexibleClient(database), session.organizationId),
      name,
      args,
    });
  }
  if (business && isTextHistoryTool(name)) {
    return runTextHistoryTool({
      database: database as unknown as HistoryDatabase,
      organizationId: session.organizationId,
      timeZone: await organizationTimeZone(asFlexibleClient(database), session.organizationId),
      name,
      args,
    });
  }
  if (business && supplierNames.has(name)) return runSupplierOrderMcpTool({ database, session, name, args });
  return runBookingTool({ database, session, name, args });
}

function hashArgs(args: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(args)).digest("hex").slice(0, 32);
}

/**
 * A call from ChatGPT. A confirmed call to a tool that reaches a customer or
 * moves money is not run: the tool is asked what it would do (without
 * `confirmed`, so its own checks run and nothing changes) and that is recorded
 * as a proposal for the owner to approve in Volteira.
 */
export async function callToolFromChatGpt(context: DispatchContext, name: string, args: Record<string, unknown>): Promise<ToolResult> {
  if (context.session.scope !== "business" || !needsVolteiraApproval(name, args)) {
    return dispatchTool(context, name, args);
  }
  const preview = await dispatchTool(context, name, { ...args, confirmed: false });
  if (preview.isError) return preview;
  const proposal = proposalFromPreview(preview.text);
  // Not a confirmation request: show it as it is and run nothing.
  if (!proposal) return preview;

  const { database, session } = context;
  const proposer = await connectionUserId(database, session.organizationId, context.connectedBy);
  if (!proposer) return { isError: true, text: "This connection's owner could not be verified. Nothing was sent or changed." };
  const replay = approvalArgs(args);
  const created = await createSupervisedProposal({
    organizationId: session.organizationId,
    actionType: "chatgpt_tool",
    content: `ChatGPT asks to ${name.replace(/_/g, " ")}: ${proposal}`,
    reason: "Requested from ChatGPT. It runs only after the owner approves it here.",
    source: "chatgpt",
    proposedBy: proposer,
    proposedByKind: "ai",
    expiresInHours: 72,
    jobId: preview.record?.jobId ?? null,
    documentRef: name,
    payload: { tool: name, args: replay, credential_id: session.credentialId ?? "" },
    idempotencyKey: approvalIdempotencyKey(session.credentialId ?? "", name, hashArgs(replay), new Date()),
  });
  if (!created.ok) return { isError: true, text: `${created.message} Nothing was sent or changed.` };
  return { text: awaitingApprovalText(proposal, created.created ? "pending" : created.status), record: preview.record };
}

export type ApprovedRun = { ok: true; text: string } | { ok: false; error: string };

/**
 * Carries out an approved "chatgpt_tool" proposal: the connection must still be
 * live and its owner still an owner, then the original call runs with
 * `confirmed: true`. The tool's own checks run again at this moment (an
 * invoice paid since, a customer who texted STOP, a signed contract).
 */
export async function runApprovedChatGptCall(input: {
  organizationId: string;
  credentialId: string;
  tool: string;
  args: Record<string, unknown>;
}): Promise<ApprovedRun> {
  const database = getSupabaseAdmin();
  const session = { scope: "business", organizationId: input.organizationId, credentialId: input.credentialId } as McpSession;
  const verdict = await authorizeBusinessMcpConnection(session, businessConnectionLookups(database));
  if (!verdict.ok) return { ok: false, error: `${verdict.message}. Nothing was sent or changed.` };
  const args = { ...approvalArgs(input.args), confirmed: true };
  const startedAt = Date.now();
  const result = await dispatchTool({ database, session, connectedBy: verdict.connectedBy }, input.tool, args);
  await logMcpCall(database, {
    organizationId: input.organizationId,
    method: "tools/call",
    toolName: input.tool,
    arguments: args,
    resultText: result.logText ?? result.text,
    isError: result.isError === true,
    durationMs: Date.now() - startedAt,
    sessionKey: `approved:${input.credentialId.slice(0, 24)}`,
    bookingRequestId: result.record?.bookingRequestId,
    jobId: result.record?.jobId,
  });
  return result.isError ? { ok: false, error: result.text.slice(0, 500) } : { ok: true, text: result.text.slice(0, 2000) };
}
