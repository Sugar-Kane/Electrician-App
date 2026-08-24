/**
 * Reading Google's address suggestions.
 *
 * The four address boxes on the new-job form used to be four plain inputs, and
 * they were all-or-nothing: give the street and forget the ZIP and the whole
 * job is refused. Somebody standing in a driveway typing an address they were
 * told over the phone gets it wrong in a different way every time — "Ln" for
 * "Lane", the wrong of two Nipomo ZIPs, the city of the nearest town rather
 * than the one the county thinks it is.
 *
 * Picking a suggestion fills all four at once, from the same source the map
 * geocodes against, so the address in the database is one Google already agrees
 * with.
 *
 * Import-free on purpose: the shapes below are the only part that can be got
 * subtly wrong, and they are worth testing without a network or a key.
 */

/** The four columns `properties` actually has. */
export type AddressParts = {
  line1: string;
  city: string;
  state: string;
  postalCode: string;
};

export type AddressSuggestion = {
  /** Google's place id, passed back to look the full address up. */
  id: string;
  /** The whole thing on one line, for the list. */
  label: string;
  /** The street on its own, so the list reads street-first. */
  primary: string;
  /** Town, state — the part that tells two identical streets apart. */
  secondary: string;
};

/**
 * Short queries are not worth a request.
 *
 * Autocomplete is billed per session and a single letter matches most of the
 * country. Three characters is where a suggestion starts being about the place
 * somebody has in mind.
 */
export const MIN_QUERY_LENGTH = 3;

export function shouldSearch(query: string): boolean {
  return query.trim().length >= MIN_QUERY_LENGTH;
}

type PredictionText = { text?: unknown } | undefined;

function readText(value: PredictionText): string {
  if (!value || typeof value !== "object") return "";
  const text = (value as { text?: unknown }).text;
  return typeof text === "string" ? text : "";
}

/**
 * Suggestions out of a Places autocomplete response.
 *
 * Anything without a place id is dropped rather than shown: a row that cannot
 * be resolved into an address is a row that does nothing when tapped.
 */
export function readSuggestions(payload: unknown): AddressSuggestion[] {
  if (!payload || typeof payload !== "object") return [];
  const suggestions = (payload as { suggestions?: unknown }).suggestions;
  if (!Array.isArray(suggestions)) return [];

  const out: AddressSuggestion[] = [];

  for (const entry of suggestions) {
    if (!entry || typeof entry !== "object") continue;
    const prediction = (entry as { placePrediction?: unknown }).placePrediction;
    if (!prediction || typeof prediction !== "object") continue;

    const shaped = prediction as {
      placeId?: unknown;
      text?: PredictionText;
      structuredFormat?: { mainText?: PredictionText; secondaryText?: PredictionText };
    };

    const id = typeof shaped.placeId === "string" ? shaped.placeId : "";
    if (!id) continue;

    const label = readText(shaped.text);
    const primary = readText(shaped.structuredFormat?.mainText) || label;
    const secondary = readText(shaped.structuredFormat?.secondaryText);
    if (!primary) continue;

    out.push({ id, label: label || primary, primary, secondary });
  }

  return out;
}

type Component = { longText?: unknown; shortText?: unknown; types?: unknown };

function pick(components: Component[], type: string, form: "long" | "short"): string {
  for (const component of components) {
    const types = Array.isArray(component.types) ? component.types : [];
    if (!types.includes(type)) continue;

    // The wanted form first, then the other one. Both are always present in a
    // real response, and a house number that came back with only one of them is
    // still the house number — dropping it would leave a street with no number
    // on it, which is worse than a long form where a short one was asked for.
    const preferred = form === "short" ? component.shortText : component.longText;
    const fallback = form === "short" ? component.longText : component.shortText;

    for (const value of [preferred, fallback]) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return "";
}

/**
 * The four fields, out of a Places details response.
 *
 * The city is the fiddly one. `locality` is right for most of the US and absent
 * for the rest, which is how an address in an unincorporated area comes back
 * with no town at all — so the fallbacks are in the order Google's own docs put
 * them, and an empty string is returned rather than a guess.
 *
 * The street name is the long form ("Red Gum Lane") because that is what people
 * read back to each other, and the state is the short form because the column
 * holds two characters.
 */
export function readAddressParts(payload: unknown): AddressParts {
  const empty: AddressParts = { line1: "", city: "", state: "", postalCode: "" };
  if (!payload || typeof payload !== "object") return empty;

  const raw = (payload as { addressComponents?: unknown }).addressComponents;
  if (!Array.isArray(raw)) return empty;

  const components = raw.filter(
    (entry): entry is Component => Boolean(entry) && typeof entry === "object",
  );

  const number = pick(components, "street_number", "short");
  const street = pick(components, "route", "long");
  const line1 = [number, street].filter(Boolean).join(" ");

  const city =
    pick(components, "locality", "long") ||
    pick(components, "postal_town", "long") ||
    pick(components, "sublocality_level_1", "long") ||
    pick(components, "administrative_area_level_3", "long");

  const state = pick(components, "administrative_area_level_1", "short");

  // The five-digit part only. `postal_code_suffix` is a separate component, and
  // a ZIP+4 in a five-character habit of a column is a truncation waiting to
  // happen.
  const postalCode = pick(components, "postal_code", "short");

  return { line1, city, state, postalCode };
}

/** True when there is enough here to save a property row. */
export function isCompleteAddress(parts: AddressParts): boolean {
  return Boolean(parts.line1 && parts.city && parts.state && parts.postalCode);
}
