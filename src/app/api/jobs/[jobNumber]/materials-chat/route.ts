import { noteOpenAiKeyUse, openAiKeyFor } from "@/lib/ai-key";
import { claudeIsConfigured, streamMaterialList } from "@/lib/claude";
import {
  carryPrices,
  hasContent,
  materialListInstructions,
  materialListMarkdown,
  parseMaterialList,
  type ChatTurn,
} from "@/lib/material-list";
import { readMaterialList, writeMaterialList } from "@/lib/material-list-server";
import { OpenAiRefusal, streamOpenAiChat } from "@/lib/openai";
import { ReplyCutOff } from "@/lib/reply-cut-off";
import { currentContext, currentUser } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The materials chat: a request in, the list written back as it is written.
 *
 * Runs on the business's own ChatGPT key when the owner has connected one,
 * and on the app's built-in AI otherwise. The reply streams as plain text in
 * the list's format; when it ends, the list is read, saved on the job, and a
 * record separator (U+001E) followed by JSON closes the stream with the saved
 * list, or with why nothing was saved.
 *
 * Signed-in members only, on their own business's jobs: the session decides,
 * and the job is looked up by number within the caller's business.
 */

export const maxDuration = 120;

const END = "\u001e";

function jsonError(status: number, error: string) {
  return Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request, context: { params: Promise<{ jobNumber: string }> }) {
  const { jobNumber } = await context.params;
  const number = Number(jobNumber);
  if (!Number.isInteger(number) || number <= 0) return jsonError(404, "That job could not be found.");

  let prompt = "";
  try {
    const body = (await request.json()) as { prompt?: unknown };
    prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  } catch {
    return jsonError(400, "Say what the job is.");
  }
  if (!prompt) return jsonError(400, "Say what the job is, or what to change.");
  if (prompt.length > 4000) return jsonError(400, "That is too long for one message. Try a shorter one.");

  // The same answer to "who is asking, for which business" as every page.
  if (!(await currentUser())) return jsonError(401, "You are not signed in.");
  const caller = await currentContext();
  if (!caller) return jsonError(403, "You are not a member of a business.");
  const { organizationId, userId } = caller;

  const supabase = asFlexibleClient(await createClient());
  const { data: organization } = await supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle();
  const businessName = typeof organization?.name === "string" ? organization.name : "";

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("id, category, customer_description, technician_notes, properties ( city, state )")
    .eq("organization_id", organizationId)
    .eq("job_number", number)
    .maybeSingle();
  const job = (jobRow ?? null) as Record<string, unknown> | null;
  const jobId = typeof job?.id === "string" ? job.id : "";
  if (!jobId) return jsonError(404, "That job could not be found.");

  const saved = await readMaterialList(supabase, jobId);
  const stored = await openAiKeyFor(organizationId);
  if (stored && "unavailable" in stored) {
    return jsonError(503, "The saved ChatGPT key could not be checked just now. Try again in a moment.");
  }
  if (stored && "unreadable" in stored) {
    const reason = "The saved ChatGPT key could not be read. The owner can reconnect it in Settings → Integrations.";
    await noteOpenAiKeyUse(organizationId, stored.version, reason);
    return jsonError(503, reason);
  }
  const ownKey = stored;
  if (!ownKey && !claudeIsConfigured()) {
    return jsonError(503, "No AI is connected. The owner can add a ChatGPT API key in Settings → Integrations.");
  }

  // What the job page already knows, so the first message can be short.
  const place = (Array.isArray(job?.properties) ? job.properties[0] : job?.properties) as
    | { city?: unknown; state?: unknown }
    | null;
  const facts = [
    job?.category ? `Kind of job: ${String(job.category).replace(/_/g, " ")}` : "",
    job?.customer_description ? `What the customer asked for: ${String(job.customer_description).slice(0, 1500)}` : "",
    job?.technician_notes ? `The electrician's notes: ${String(job.technician_notes).slice(0, 1500)}` : "",
    place?.city ? `Where: ${[place.city, place.state].filter(Boolean).join(", ")}` : "",
  ].filter(Boolean);
  const system = [materialListInstructions(businessName), facts.length ? `\nThis job, from the job record:\n${facts.join("\n")}` : ""].join("\n");

  // A revision sees the list as it stands now, hand edits and all, and what
  // was asked before; a first list sees only the request.
  const earlier = saved.messages.filter((turn) => turn.role === "user").map((turn) => turn.text);
  const turns: { role: "user" | "assistant"; content: string }[] = hasContent(saved.list)
    ? [
        { role: "user", content: earlier.length ? earlier.join("\n\n") : "Write the materials list for this job." },
        { role: "assistant", content: materialListMarkdown(saved.list) },
        { role: "user", content: prompt },
      ]
    : [{ role: "user", content: prompt }];

  const source: "openai" | "claude" = ownKey ? "openai" : "claude";
  const model = ownKey ? ownKey.model : "volteira";
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let written = "";
      const finish = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${END}${JSON.stringify(payload)}`));
        controller.close();
      };

      try {
        const chunks = ownKey
          ? streamOpenAiChat({
              key: ownKey.key,
              model: ownKey.model,
              messages: [{ role: "system", content: system }, ...turns],
              maxTokens: 8000,
              signal: request.signal,
            })
          : streamMaterialList({ system, turns, signal: request.signal });
        for await (const chunk of chunks) {
          written += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
      } catch (error) {
        if (request.signal.aborted) {
          controller.close();
          return;
        }
        // A reply that ran out of room is not the key's fault: the key worked.
        const cutOff = error instanceof ReplyCutOff;
        const reason = cutOff
          ? "The list was too long to finish in one answer, so it was not kept. Ask for a shorter list, or for one part of the job at a time."
          : error instanceof OpenAiRefusal
            ? error.message
            : ownKey
              ? "ChatGPT stopped before the list was finished. Try again."
              : "The list could not be written just now. Try again.";
        console.error("materials chat failed", { jobId, source, error: String(error) });
        if (ownKey) await noteOpenAiKeyUse(organizationId, ownKey.version, cutOff ? null : reason);
        finish({ error: reason });
        return;
      }

      // What did not change keeps its store prices; only the rest is looked up again.
      const list = carryPrices(saved.list, parseMaterialList(written, `g${Date.now().toString(36)}`));
      if (!hasContent(list)) {
        finish({ error: "The reply did not include a list. Try saying what the job is in a little more detail." });
        return;
      }

      const now = new Date().toISOString();
      const messages: ChatTurn[] = [
        ...saved.messages,
        { role: "user", text: prompt, at: now },
        { role: "assistant", text: list.intro || "Here is the list.", at: now },
      ];
      // Only over the list this answer started from: one edited or cleared
      // somewhere else while it was being written is not replaced.
      const write = await writeMaterialList(supabase, {
        organizationId,
        jobId,
        userId,
        list,
        messages,
        source,
        model,
        expectedUpdatedAt: saved.updatedAt,
      });
      if (ownKey) await noteOpenAiKeyUse(organizationId, ownKey.version, null);
      if (write.status === "saved") {
        finish({ list, messages, source, model, updatedAt: write.updatedAt });
      } else if (write.status === "changed") {
        const current = await readMaterialList(supabase, jobId);
        finish({
          error: "The list was changed somewhere else while this answer was being written, so it was not kept. This is the list as it is now; ask again to change it.",
          list: current.list,
          messages: current.messages,
          updatedAt: current.updatedAt,
        });
      } else {
        finish({ error: "The list was written but could not be saved. Try again." });
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}
