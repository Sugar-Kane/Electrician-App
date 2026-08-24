"use server";

import {
  readAddressParts,
  readSuggestions,
  shouldSearch,
  type AddressParts,
  type AddressSuggestion,
} from "@/lib/address-search";
import { currentContext } from "@/lib/request-context";

/**
 * Address suggestions, asked for by the server.
 *
 * Not in `jobs/new` because it is not only about jobs — a supply stop and a
 * customer's second property want the same box.
 *
 * The key stays here rather than going to the browser. `GOOGLE_MAPS_SERVER_KEY`
 * already geocodes properties, and putting it in a page would publish a billed
 * credential to anyone who opened dev tools. Every call is behind a session, so
 * this is not a free proxy to a paid API either.
 *
 * Nothing here throws and nothing here returns a Google error message. A
 * suggestion box that cannot reach Google is a text box, which is what it was
 * last week — the detail goes to the log, where somebody can act on it.
 */

const AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete";
const DETAILS_URL = "https://places.googleapis.com/v1/places";

/** Beyond this, the list is longer than the phone screen it drops into. */
const MAX_SUGGESTIONS = 5;

export type SuggestResult = { suggestions: AddressSuggestion[] };
export type ResolveResult = { parts: AddressParts | null };

export async function suggestAddresses(input: {
  query: string;
  /**
   * Groups the typing and the one lookup that follows into a single billed
   * session. Without it Google charges per keystroke.
   */
  sessionToken: string;
}): Promise<SuggestResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { suggestions: [] };

  const query = input.query.trim();
  if (!shouldSearch(query)) return { suggestions: [] };

  // Signed in, and a member of a business. Not a permission check on the
  // address — there is nothing private about a street — but this spends money,
  // so it is not open to the world.
  const context = await currentContext();
  if (!context) return { suggestions: [] };

  try {
    const response = await fetch(AUTOCOMPLETE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
      },
      body: JSON.stringify({
        input: query,
        sessionToken: input.sessionToken || undefined,
        // The business works in one country. Without this, "123 Main" matches
        // a hundred of them and the right answer is on page four.
        includedRegionCodes: ["us"],
      }),
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("address suggestions failed", {
        status: response.status,
        payload,
      });
      return { suggestions: [] };
    }

    return { suggestions: readSuggestions(payload).slice(0, MAX_SUGGESTIONS) };
  } catch (error) {
    console.error("address suggestions could not be fetched", error);
    return { suggestions: [] };
  }
}

/**
 * One suggestion, turned into the four fields the form posts.
 *
 * A second request rather than reading the components off the suggestion,
 * because autocomplete does not return them — and this is the call the session
 * token exists to pair with, so it is the cheap half.
 */
export async function resolveAddress(input: {
  placeId: string;
  sessionToken: string;
}): Promise<ResolveResult> {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (!key) return { parts: null };

  const placeId = input.placeId.trim();
  if (!placeId) return { parts: null };

  const context = await currentContext();
  if (!context) return { parts: null };

  const url = new URL(`${DETAILS_URL}/${encodeURIComponent(placeId)}`);
  if (input.sessionToken) url.searchParams.set("sessionToken", input.sessionToken);

  try {
    const response = await fetch(url, {
      headers: {
        "X-Goog-Api-Key": key,
        // Billed by field. Asking for the whole place to read four of its parts
        // is the expensive way to do this.
        "X-Goog-FieldMask": "addressComponents",
      },
      cache: "no-store",
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error("address lookup failed", { status: response.status, payload });
      return { parts: null };
    }

    return { parts: readAddressParts(payload) };
  } catch (error) {
    console.error("address lookup could not be fetched", error);
    return { parts: null };
  }
}
