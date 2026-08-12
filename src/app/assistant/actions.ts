"use server";

import {
  assistantSystemPrompt,
  buildBrief,
  type BriefInvoice,
  type BriefJob,
} from "@/lib/assistant-brief";
import { todayInZone } from "@/lib/calendar";
import {
  buildReferenceBrief,
  findReferences,
  referenceSystemPrompt,
} from "@/lib/code-reference";
import { askAboutBusiness, claudeIsConfigured, type AssistantTurn } from "@/lib/claude";
import { getInvoices, getJobs } from "@/lib/job-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import { getMemories, memoryBrief } from "@/lib/assistant-memory";
import { currentContext, currentUser } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { timezoneLabel } from "@/lib/timezones";

/**
 * Answering a question about the business.
 *
 * The data comes from `getJobs` and `getInvoices`, the same functions every
 * page uses, which resolve the organization from the caller's own session and
 * go through RLS. Under impersonation that is the impersonated business and
 * nothing else. The assistant therefore cannot see a row the person asking
 * could not already open in the app — it is a faster way to read what they have,
 * not a wider one.
 */

export type AssistantState = {
  turns: { role: "user" | "assistant"; text: string }[];
  error: string;
};

const MAX_QUESTION = 500;
/** Enough to follow up on an answer, not enough to be a storage medium. */
const MAX_HISTORY = 12;

export async function askAssistant(
  previous: AssistantState,
  formData: FormData,
): Promise<AssistantState> {
  const question = String(formData.get("question") ?? "").trim().slice(0, MAX_QUESTION);
  if (!question) return { ...previous, error: "" };

  const asked = [...previous.turns, { role: "user" as const, text: question }];

  if (!claudeIsConfigured()) {
    return {
      turns: asked,
      error: "The assistant is not switched on for this deployment (ANTHROPIC_API_KEY is unset).",
    };
  }

  const [user, context] = await Promise.all([currentUser(), currentContext()]);
  if (!user || !context) {
    return { turns: asked, error: "You are not signed in to a business." };
  }

  const supabase = asFlexibleClient(await createClient());
  const [timeZone, { jobs }, { invoices }, { data: organization }] = await Promise.all([
    getOrganizationTimezone(),
    getJobs(),
    getInvoices(),
    // Read through the session, so the name is the one this caller may see.
    supabase.from("organizations").select("name").eq("id", context.organizationId).maybeSingle(),
  ]);

  const businessName =
    typeof organization?.name === "string" && organization.name ? organization.name : "this business";

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

  const brief = buildBrief({
    businessName,
    today: todayInZone(timeZone),
    timeZoneLabel: timezoneLabel(timeZone),
    askedBy: user.email ?? "someone at the business",
    jobs: briefJobs,
    invoices: briefInvoices,
  });

  // Only this business's memories, ever. The query is organization-scoped and
  // so is the RLS behind it.
  const memories = await getMemories();

  const turns: AssistantTurn[] = asked.slice(-MAX_HISTORY);

  // Code, licensing and permit questions are answered from the reference index
  // rather than from what the model remembers. A confident invented CEC article
  // is worse than no answer — somebody pulls a permit against it.
  const references = findReferences(question);
  const referenceBrief = references.length
    ? `\n\n<code_reference>\n${buildReferenceBrief(references)}\n</code_reference>`
    : "";

  const answer = await askAboutBusiness({
    system: references.length
      ? `${assistantSystemPrompt(businessName)}\n\n${referenceSystemPrompt()}`
      : assistantSystemPrompt(businessName),
    brief: `${brief}${memoryBrief(memories)}${referenceBrief}`,
    turns,
  });

  if (!answer) {
    return {
      turns: asked,
      error: "The assistant could not answer just now. Nothing was changed.",
    };
  }

  return { turns: [...asked, { role: "assistant", text: answer }], error: "" };
}
