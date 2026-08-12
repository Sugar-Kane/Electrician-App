"use server";

import { revalidatePath } from "next/cache";

import { runReadOnlyTool } from "@/lib/assistant-handlers";
import { getMemories, memoryBrief } from "@/lib/assistant-memory";
import {
  ASSISTANT_TOOLS,
  assistantToolPrompt,
  describeProposal,
  requiresConfirmation,
  type Proposal,
} from "@/lib/assistant-tools";
import { buildBrief, type BriefInvoice, type BriefJob } from "@/lib/assistant-brief";
import { todayInZone } from "@/lib/calendar";
import { claudeIsConfigured, runAssistantTurn } from "@/lib/claude";
import { getInvoices, getJobs } from "@/lib/job-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { currentContext, currentUser } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { timezoneLabel } from "@/lib/timezones";

/**
 * One turn of the chat.
 *
 * Read-only tools are run here and fed back to the model, up to a small number
 * of rounds. Anything that sends or changes something is not run: it comes back
 * as a proposal for the person to approve, and the model is told it is pending
 * rather than done.
 *
 * The round limit is not a performance guard. A model that can keep calling
 * tools until it is satisfied will occasionally not be satisfied, and an
 * unbounded loop on somebody's phone bill is a worse failure than a truncated
 * answer.
 */

export type ChatTurn = { role: "user" | "assistant"; text: string };

export type ChatState = {
  turns: ChatTurn[];
  /** Waiting for a tap. At most one at a time, so nothing queues up unread. */
  proposal?: Proposal;
  error: string;
};

const MAX_ROUNDS = 4;
const MAX_HISTORY = 12;
const MAX_QUESTION = 800;

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

async function buildContext() {
  const [user, context] = await Promise.all([currentUser(), currentContext()]);
  if (!user || !context) return null;

  const supabase = asFlexibleClient(await createClient());
  const [timeZone, { jobs }, { invoices }, { data: organization }, memories] = await Promise.all([
    getOrganizationTimezone(),
    getJobs(),
    getInvoices(),
    supabase.from("organizations").select("name").eq("id", context.organizationId).maybeSingle(),
    getMemories(),
  ]);

  const businessName =
    typeof organization?.name === "string" && organization.name
      ? organization.name
      : "this business";

  const briefJobs: BriefJob[] = jobs.map((job) => ({
    id: job.id,
    dateLabel: job.dateLabel,
    time: job.time,
    customer: job.customer,
    city: job.city,
    workType: job.workType,
    status: job.status,
    technician: job.technician,
  }));

  const briefInvoices: BriefInvoice[] = invoices.map((invoice) => ({
    id: invoice.id,
    customer: invoice.customer,
    amount: invoice.amount,
    status: invoice.status,
    due: invoice.due,
  }));

  const brief =
    buildBrief({
      businessName,
      today: todayInZone(timeZone),
      timeZoneLabel: timezoneLabel(timeZone),
      askedBy: user.email ?? "someone at the business",
      jobs: briefJobs,
      invoices: briefInvoices,
    }) + memoryBrief(memories);

  return { businessName, brief };
}

/**
 * Every interaction with the chat, through one action.
 *
 * Asking, confirming and cancelling were three separate actions with three
 * separate `useActionState` hooks, and the confirm hook's result was written
 * into state nothing rendered — so tapping Confirm did the work and then showed
 * the person absolutely nothing. One action and one state means an outcome
 * cannot be produced without appearing.
 */
export async function chatAction(previous: ChatState, formData: FormData): Promise<ChatState> {
  const intent = String(formData.get("intent") ?? "ask");
  if (intent === "cancel") {
    return {
      turns: [...previous.turns, { role: "assistant", text: "Cancelled — nothing was sent." }],
      proposal: undefined,
      error: "",
    };
  }
  if (intent === "confirm") return confirmProposal(previous, formData);
  return sendChatMessage(previous, formData);
}

async function sendChatMessage(
  previous: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const question = String(formData.get("question") ?? "").trim().slice(0, MAX_QUESTION);
  if (!question) return { ...previous, error: "" };

  const asked: ChatTurn[] = [...previous.turns, { role: "user", text: question }];

  if (!claudeIsConfigured()) {
    return {
      turns: asked,
      error: "The assistant is not switched on for this deployment (ANTHROPIC_API_KEY is unset).",
    };
  }

  const context = await buildContext();
  if (!context) return { turns: asked, error: "You are not signed in to a business." };

  // The conversation as the API wants it. Earlier turns are plain text; only
  // the current round carries tool blocks.
  const messages: { role: "user" | "assistant"; content: unknown }[] = asked
    .slice(-MAX_HISTORY)
    .map((turn) => ({ role: turn.role, content: turn.text }));

  let spoken = "";
  let proposal: Proposal | undefined;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await runAssistantTurn({
      system: assistantToolPrompt(context.businessName),
      brief: context.brief,
      turns: messages,
      tools: ASSISTANT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
    });

    if (!reply) {
      return { turns: asked, error: "The assistant could not answer just now. Nothing was changed." };
    }

    if (reply.text) spoken = reply.text;
    if (reply.calls.length === 0) break;

    // A confirmable call ends the turn. Running the read-only calls beside it
    // first would be defensible, but it makes the answer depend on work done
    // for an action the person may then decline.
    const needsTap = reply.calls.find((call) => requiresConfirmation(call.name));
    if (needsTap) {
      proposal = {
        tool: needsTap.name as Proposal["tool"],
        input: needsTap.input,
        summary: describeProposal(needsTap.name, needsTap.input),
      };
      break;
    }

    const assistantBlocks: Block[] = [
      ...(reply.text ? [{ type: "text" as const, text: reply.text }] : []),
      ...reply.calls.map((call) => ({
        type: "tool_use" as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ];

    const results: Block[] = [];
    for (const call of reply.calls) {
      const output = await runReadOnlyTool(call.name, call.input);
      results.push({ type: "tool_result", tool_use_id: call.id, content: output });
    }

    messages.push({ role: "assistant", content: assistantBlocks });
    messages.push({ role: "user", content: results });
  }

  revalidatePath("/assistant");

  const closing = proposal
    ? spoken || "Ready when you are — check it and tap to confirm."
    : spoken || "I could not work that out.";

  return {
    turns: [...asked, { role: "assistant", text: closing }],
    proposal,
    error: "",
  };
}

/**
 * Carrying out a proposal the person has approved.
 *
 * Re-reads nothing from the model. The approved input is executed directly, so
 * what happens is what was on the screen when they tapped — a second model call
 * here could produce a different action from the one they read.
 */
async function confirmProposal(
  previous: ChatState,
  formData: FormData,
): Promise<ChatState> {
  const raw = String(formData.get("proposal") ?? "");
  if (!raw) return { ...previous, proposal: undefined, error: "" };

  let proposal: Proposal;
  try {
    proposal = JSON.parse(raw) as Proposal;
  } catch {
    return { ...previous, proposal: undefined, error: "That action could not be read." };
  }

  const { runConfirmedTool } = await import("@/lib/assistant-confirmed");
  const outcome = await runConfirmedTool(proposal.tool, proposal.input);

  revalidatePath("/assistant");
  revalidatePath("/invoices");
  revalidatePath("/schedule");

  return {
    turns: [...previous.turns, { role: "assistant", text: outcome }],
    proposal: undefined,
    error: "",
  };
}

