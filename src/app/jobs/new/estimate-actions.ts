"use server";

import { draftWorkOrderLines, type DraftedLine } from "@/lib/claude";
import { currentContext } from "@/lib/request-context";

/**
 * Asking for a first draft of a work order.
 *
 * Called straight from the button rather than through `useActionState`, because
 * it sits inside the new-job form and a form cannot contain another one. It
 * takes an object and returns one — no `FormData`, no redirect, nothing
 * written.
 *
 * Reads nothing from the database and writes nothing to it. The only thing that
 * leaves this server is the sentence the owner typed describing the work.
 */

export type EstimateResult = {
  lines: DraftedLine[];
  /** One calm sentence when there is nothing to show, or empty. */
  problem: string;
};

export async function estimateWorkOrder(input: {
  description: string;
}): Promise<EstimateResult> {
  const context = await currentContext();
  if (!context) return { lines: [], problem: "Sign in again and try that once more." };

  const described = input.description.trim();
  if (described.length < 10) {
    return {
      lines: [],
      problem: "Say a bit more about the work first — a sentence is enough to draft from.",
    };
  }

  const lines = await draftWorkOrderLines({ description: described });

  if (!lines) {
    // The detail is already in the server log, from `draftWorkOrderLines`.
    return { lines: [], problem: "That draft could not be written just now. Add the lines below." };
  }

  if (lines.length === 0) {
    return { lines: [], problem: "Nothing came back to suggest. Add the lines below." };
  }

  return { lines, problem: "" };
}
