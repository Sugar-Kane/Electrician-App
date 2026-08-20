"use server";

import { revalidatePath } from "next/cache";

import { prepareAttachments } from "@/lib/assistant-attachments";
import { runReadOnlyTool } from "@/lib/assistant-handlers";
import { storedOnlyNote } from "@/lib/attachment-kinds";
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

/*
 * Two budgets, because the round limit was never a time limit.
 *
 * Four rounds of model call and database lookup can outlast the function they
 * run in. A killed function never returns an action, and an action that never
 * returns leaves `useActionState` pending for good — the spinner on the phone
 * span until somebody gave up, which reads as a button that does nothing.
 *
 * `TURN_BUDGET_MS` sits comfortably inside the page's `maxDuration` so the turn
 * gives up on its own terms and can still say something. `ROUND_TIMEOUT_MS`
 * stops any single request eating the lot.
 */
const TURN_BUDGET_MS = 45_000;
const ROUND_TIMEOUT_MS = 20_000;

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

  // The client and the organization come back too: attachments need both, and
  // building a second client to re-answer questions already answered here is
  // two more round trips for nothing.
  return { businessName, brief, supabase, organizationId: context.organizationId };
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
  const documentIds = formData.getAll("attachment").map((value) => String(value));

  // A question with a photo and no words is a real question — "look at this" —
  // so an empty box only ends the turn when nothing came with it.
  if (!question && documentIds.length === 0) return { ...previous, error: "" };

  const asked: ChatTurn[] = [
    ...previous.turns,
    { role: "user", text: question || "Have a look at this." },
  ];

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

  /*
   * Anything attached rides on the question it was attached to.
   *
   * The blocks go before the text, which is what the API documentation asks
   * for, and only on the newest turn: re-sending a photo with every follow-up
   * would re-upload it on each round of the loop for no gain.
   *
   * `prepareAttachments` re-checks every id against this organization, because
   * an id posted in a form is a claim rather than a fact.
   */
  const attached = await prepareAttachments({
    database: context.supabase,
    organizationId: context.organizationId,
    documentIds,
  });

  if (attached.blocks.length > 0) {
    messages[messages.length - 1] = {
      role: "user",
      content: [...attached.blocks, { type: "text", text: question || "Have a look at this." }],
    };
  }

  let spoken = "";
  let proposal: Proposal | undefined;
  let ranOut = false;
  const deadline = Date.now() + TURN_BUDGET_MS;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // Checked before starting a round rather than after finishing one: the
    // point is never to begin work there is no time to finish.
    if (Date.now() >= deadline) {
      ranOut = true;
      console.warn("assistant turn ran out of time", { round, question: question.slice(0, 80) });
      break;
    }

    const reply = await runAssistantTurn({
      system: assistantToolPrompt(context.businessName),
      brief: context.brief,
      turns: messages,
      tools: ASSISTANT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      timeoutMs: Math.max(1_000, Math.min(ROUND_TIMEOUT_MS, deadline - Date.now())),
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

  /*
   * Running out of time gets its own words.
   *
   * "I could not work that out" is what the model says about a question it
   * understood and could not answer. A turn cut short did not fail at the
   * question, it never got to finish — and telling somebody to ask again is
   * useful, where telling them their question was unanswerable is not.
   */
  const said = proposal
    ? spoken || "Ready when you are — check it and tap to confirm."
    : spoken ||
      (ranOut
        ? "That one took longer than I have. Ask me again, or narrow it down a bit."
        : "I could not work that out.");

  /*
   * A file that was kept but not read gets said out loud.
   *
   * Appended here rather than mentioned in the prompt, because the model does
   * not know which of the attachments reached it — from where it sits, a video
   * that was filtered out simply never existed. Left to itself it would answer
   * about the photo and never mention the video, and the person would
   * reasonably believe it had watched one.
   */
  const note = storedOnlyNote(attached.storedOnly);
  const closing = note ? `${said}\n\n${note}` : said;

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

