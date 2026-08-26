/**
 * What a finished job gives a writer, and whether it gives enough.
 *
 * Two jobs, and the second is the one that matters.
 *
 * ## It cannot leak a field it was never given
 *
 * A completed job is a named person at a street address with a description of
 * the electrical faults in their home. Posts publish automatically, so there is
 * no reviewer between this and the public web, and "the prompt says not to
 * mention the customer" is not a control — it is a hope.
 *
 * So the brief is built by listing what may go in rather than by removing what
 * may not. No name, no street, no phone, no email, no job number. The town and
 * the state stay, because the service area is public information about the
 * business and is the whole of the local search value. `forbidden` carries the
 * words that must not survive, for `blog-voice` to check afterwards, which is
 * the braces to this belt.
 *
 * ## Whether there is a post here at all
 *
 * Three outcomes, and the third is the reason this is a separate module:
 *
 * - **story** — somebody wrote down what they did. The post can tell it.
 * - **lesson** — only the complaint and the kind of work. The post explains what
 *   causes that fault and what an electrician checks, and claims no outcome.
 *   This is every job in the system today.
 * - **null** — nothing usable. No post is written.
 *
 * The junk test is a positive one: does the complaint contain any electrical
 * vocabulary at all? A blocklist of things people should not have typed is a
 * list somebody has to keep extending, and it fails open. Asking whether this
 * is a description of an electrical problem fails closed and needs no
 * maintenance.
 *
 * Import-free, so all of it can be tested without a database.
 */

export type JournalKind = "story" | "lesson";

export type JournalSource = {
  kind: JournalKind;
  /** "Nipomo". The service area, which is public and is the SEO. */
  town: string;
  state: string;
  /** "late August" — natural to write, and no more than the timestamp shows. */
  when: string;
  /** "Diagnostic", "Panel or breaker". */
  categoryLabel: string;
  /** What the customer described, stripped of anything that identifies them. */
  complaint: string;
  /** What the technician wrote. Empty on a `lesson`. */
  work: string;
  /** Line items, by description only. No prices. */
  parts: string[];
  /**
   * Words that must not appear in the finished post.
   *
   * Nothing here was passed to the model. This is what `houseStyle` checks the
   * draft against, so a name that reached it some other way is still caught.
   */
  forbidden: string[];
};

/*
 * Enough electrical vocabulary that a real complaint hits it and a stray
 * sentence does not.
 *
 * Written as whole words. "ac" and "amp" are short enough to appear inside
 * other words, and "a broken vacuum" containing "ac" would let anything
 * through.
 */
const ELECTRICAL = [
  "breaker", "breakers", "panel", "subpanel", "outlet", "outlets", "receptacle",
  "switch", "switches", "light", "lights", "lighting", "lamp", "fixture",
  "wire", "wires", "wiring", "power", "circuit", "circuits", "gfci", "afci",
  "volt", "volts", "voltage", "amp", "amps", "amperage", "watt", "watts",
  "spark", "sparks", "sparking", "shock", "shocked", "flicker", "flickering",
  "buzz", "buzzing", "hum", "humming", "trip", "trips", "tripping", "tripped",
  "fuse", "fuses", "socket", "electric", "electrical", "electricity",
  "dryer", "washer", "oven", "stove", "range", "dishwasher", "microwave",
  "heater", "furnace", "hvac", "fan", "meter", "ground", "grounded", "grounding",
  "neutral", "conduit", "romex", "generator", "surge", "short", "shorted",
  "burn", "burnt", "burning", "smoke", "smell", "dim", "dimming", "dead",
  "charger", "ev", "solar", "battery", "thermostat", "doorbell", "smoke detector",
  "extension", "cord", "junction", "box", "transformer", "capacitor", "motor",
  "pump", "pool", "spa", "well", "gate", "outage", "flick", "reset", "resetting",
];

const ELECTRICAL_WORDS = new Set(ELECTRICAL);

/** Whether this reads as a description of an electrical problem. */
export function soundsElectrical(value: string): boolean {
  const words = (value ?? "").toLowerCase().match(/[a-z]+/g) ?? [];
  return words.some((word) => ELECTRICAL_WORDS.has(word));
}

/*
 * Dictation left running, a keyboard being checked, a field filled in to see
 * what happens.
 *
 * Production has one of these right now: "Test test test test Can you hear me
 * hello hello Papa". It is in `technician_notes`, which means without this the
 * generator would treat that job as having a written-up repair and produce a
 * story from it.
 */
export function readsAsTestData(value: string): boolean {
  const whole = (value ?? "").toLowerCase();
  /*
   * `\b` on both sides, which is doing real work here.
   *
   * A bare `[a-z]+` pulls a phantom "a" out of "30A", so "26A on a 30A breaker"
   * reads as the stutter "a a" and a genuine set of notes gets thrown away as
   * test data. There is no word boundary inside "30a", so the anchors skip it.
   */
  const wordsIn = (part: string) => part.match(/\b[a-z]+\b/g) ?? [];

  const words = wordsIn(whole);
  if (words.length === 0) return true;

  if (words.filter((word) => word === "test" || word === "testing").length >= 3) return true;

  /*
   * Stuttering is repetition inside one sentence.
   *
   * Counted per sentence rather than across the whole text, because a word
   * ending one sentence and opening the next is ordinary writing: "…on a 30A
   * breaker. Breaker itself was warm" is how somebody actually types notes.
   */
  let repeats = 0;
  for (const sentence of whole.split(/[.!?\n]+/)) {
    const parts = wordsIn(sentence);
    for (let index = 1; index < parts.length; index += 1) {
      if (parts[index] === parts[index - 1]) repeats += 1;
    }
  }
  if (repeats >= 2) return true;

  // A microphone check is not notes about a job.
  if (/\bcan you hear me\b|\bis this thing on\b|\btesting one two\b/i.test(value)) return true;

  return false;
}

/*
 * Street words that identify nobody, and would wreck a post if guarded.
 *
 * The forbidden list is built from the tokens of a street address, and that is
 * right for "Tefft" and catastrophic for "Water". A customer at 88 Water Street
 * would have "water" stripped out of their own complaint by `deidentify`, and
 * then every draft containing it rejected by `houseStyle` — including one using
 * this app's own diagram label, "Through a person or into water". A correct post
 * about a wet GFCI would fail twice and be stored as a refusal.
 *
 * Three kinds of word are dropped:
 *
 * - **Street types, directions and unit words.** "Street", "North", "Apt". None
 *   of them narrows an address to a household.
 * - **Words this app writes about.** A house on Power Street or Well Road would
 *   otherwise censor the vocabulary of the trade. Taken from `ELECTRICAL`, so
 *   the two lists cannot drift apart.
 * - **The ordinary nouns street names are made of.** Oak, Church, Spring, Park.
 *   A street name shared with half the county is not an identifier, and the
 *   house number that would make it one is dropped separately for being numeric.
 *
 * What survives is the distinctive part, which is the part that identifies:
 * "Tefft", "Hilldale", a surname used as a street.
 */
const STREET_FURNITURE = new Set([
  "street", "st", "road", "rd", "avenue", "ave", "lane", "ln", "drive", "dr",
  "court", "ct", "place", "pl", "boulevard", "blvd", "way", "circle", "cir",
  "terrace", "ter", "trail", "highway", "hwy", "parkway", "pkwy", "alley",
  "loop", "run", "path", "row", "square", "sq", "crescent", "close",
  "north", "south", "east", "west", "northeast", "northwest", "southeast",
  "southwest", "upper", "lower", "old", "new",
  "apt", "apartment", "unit", "suite", "ste", "floor", "building", "bldg",
  "the", "and", "of",
  // Ordinary nouns that half the streets in America are named after.
  "water", "park", "hill", "mill", "spring", "oak", "elm", "pine", "maple",
  "cedar", "main", "first", "second", "third", "fourth", "fifth", "church",
  "school", "market", "mountain", "valley", "lake", "river", "forest",
  "garden", "gardens", "meadow", "ridge", "view", "sunset", "sunrise",
  "grove", "orchard", "vista", "bay", "beach", "ocean", "palm", "olive",
  "cypress", "willow", "birch", "walnut", "cherry", "apple", "rose",
  "laurel", "juniper", "aspen", "sycamore", "spruce", "union", "liberty",
  "washington", "lincoln", "franklin", "jackson", "madison", "monroe",
  "center", "central", "college", "high", "state", "county", "canyon",
  "mesa", "vale", "glen", "dale", "field", "fields", "wood", "woods",
]);

/**
 * The parts of a street address worth treating as identifying.
 *
 * Everything else in the line is dropped: house numbers because they are
 * numeric, short fragments because a two-letter term matches everywhere, and
 * the words above because guarding them costs a post and protects nobody.
 */
export function streetIdentifiers(addressLine: string): string[] {
  return (addressLine ?? "")
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z'\u2019-]/g, "").trim())
    .filter(
      (token) =>
        token.length >= 3 &&
        !STREET_FURNITURE.has(token.toLowerCase()) &&
        !ELECTRICAL_WORDS.has(token.toLowerCase()),
    );
}

/**
 * Anything that points at one household, taken out.
 *
 * Applied to the customer's own words, which are the one field where an address
 * or a phone number can turn up without anybody putting it there: "I'm at 412
 * Tefft and the kitchen is dead" is a perfectly ordinary thing to text.
 */
export function deidentify(value: string, forbidden: string[]): string {
  let text = value ?? "";

  text = text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "");
  // Phone numbers in the shapes people actually write them.
  text = text.replace(/\+?\d?[\s.(-]*\d{3}[\s.)-]*\d{3}[\s.-]*\d{4}\b/g, "");
  // A house number followed by a street word, with or without the suffix.
  text = text.replace(
    /\b\d{1,6}\s+[A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*){0,3}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|boulevard|ct|court|cir|circle|pl|place|ter|terrace|hwy|highway)\b\.?/gi,
    "",
  );
  // Anything we already know identifies them.
  for (const term of forbidden) {
    const trimmed = term.trim();
    if (trimmed.length < 3) continue;
    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Plural and possessive too: "the Hendersons" and "Henderson's" both name
    // the household that "Henderson" alone does, and a bare `\b` on the end
    // matches neither.
    text = text.replace(new RegExp(`\\b${escaped}(?:['\u2019]s|es|s)?\\b`, "gi"), "");
  }

  /*
   * The preposition the address was hanging off.
   *
   * Removing "412 Tefft Street" from "I live at 412 Tefft Street and the lights
   * flicker" leaves "I live at and the lights flicker", which is a sentence the
   * model then has to write around. Taking the stranded preposition with it
   * leaves prose somebody could have typed.
   */
  text = text.replace(/\b(?:at|on|in|near|off|over at|down at)\s+(?=(?:and|but|so)\b|[,.]|$)/gi, "");

  return text.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

/**
 * When a job was finished.
 *
 * **`jobs` has no `completed_at` column.** The timestamp lives on
 * `job_technician_progress`, one row per technician, written where the status
 * is set. Selecting it from `jobs` is not a wrong value, it is a PostgREST
 * error that fails the whole select, and every read then behaves as though the
 * job does not exist.
 *
 * The last technician to finish is when the job finished, so the newest
 * timestamp wins. A job can also carry no progress row at all, and the job's
 * own `updated_at` stands in there: for a completed job that is the moment the
 * status was written, which is the same event from the other side.
 */
export function completionTime(input: {
  progress?: readonly (string | null | undefined)[];
  updatedAt?: string | null;
}): string {
  const finished = (input.progress ?? [])
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value !== "" && !Number.isNaN(new Date(value).getTime()))
    .sort();

  const latest = finished[finished.length - 1] ?? "";
  if (latest) return latest;

  const updated = typeof input.updatedAt === "string" ? input.updatedAt.trim() : "";
  return Number.isNaN(new Date(updated).getTime()) ? "" : updated;
}

/** "late August". Vaguer than a date, and natural in a sentence. */
export function seasonOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" });
  const day = date.getUTCDate();
  const part = day <= 10 ? "early" : day <= 20 ? "the middle of" : "late";
  return part === "the middle of" ? `the middle of ${month}` : `${part} ${month}`;
}

/** The shortest complaint worth writing a whole post around. */
const MIN_COMPLAINT = 15;

/**
 * Everything the writer gets, or null when there is no post to write.
 *
 * The caller passes raw column values; nothing here assumes they are strings or
 * that they are present, because `ai_summary` and `technician_notes` are both
 * null on the only completed job in production.
 */
export function readJournalSource(job: {
  customerDescription?: unknown;
  aiSummary?: unknown;
  technicianNotes?: unknown;
  categoryLabel?: unknown;
  town?: unknown;
  state?: unknown;
  completedAt?: unknown;
  parts?: unknown;
  /** First name, last name, company, street. Never passed to the model. */
  identifiers?: unknown;
}): JournalSource | null {
  const forbidden = (Array.isArray(job.identifiers) ? job.identifiers : [])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length >= 3);

  const complaint = deidentify(text(job.customerDescription) || text(job.aiSummary), forbidden);

  // The gate. A complaint too short to describe anything, or with no electrical
  // content in it, is not a job anybody can write about honestly.
  if (complaint.length < MIN_COMPLAINT) return null;
  if (!soundsElectrical(complaint)) return null;
  if (readsAsTestData(complaint)) return null;

  const rawNotes = text(job.technicianNotes);
  // Junk notes make this a lesson, not a decline. The complaint is still real;
  // there is simply nothing written down about what was done.
  const work = readsAsTestData(rawNotes) ? "" : deidentify(rawNotes, forbidden);

  /*
   * De-identified like everything else, which the first version of this was
   * not.
   *
   * A line item is typed by hand and people write what is in front of them:
   * "rewire for the Hendersons", "panel swap at 412 Tefft". Passing those
   * through raw handed the model the exact name the rest of this module exists
   * to keep away from it.
   */
  const parts = (Array.isArray(job.parts) ? job.parts : [])
    .map((entry) => (typeof entry === "string" ? deidentify(entry, forbidden) : ""))
    .filter(Boolean)
    .slice(0, 20);

  return {
    kind: work.length >= MIN_COMPLAINT || parts.length > 0 ? "story" : "lesson",
    town: text(job.town),
    state: text(job.state).toUpperCase(),
    when: seasonOf(text(job.completedAt)),
    categoryLabel: text(job.categoryLabel) || "Service",
    complaint,
    work,
    parts,
    forbidden,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * The URL a post lives at, from its title.
 *
 * The title is the question a homeowner types, so the slug is that question,
 * which is exactly the URL that should rank for it. Lives here rather than in
 * the writer because it has to be reproducible: the same title must always give
 * the same slug, or a regenerated post lands at a second address and the first
 * one goes on being indexed.
 */
export function postSlug(title: string): string {
  const slug = (title ?? "")
    .toLowerCase()
    .normalize("NFD")
    // Accents off, so "año" and "ano" are not two different URLs.
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");

  return slug || "work-journal";
}

/**
 * The source as the model is handed it.
 *
 * A plain block rather than JSON, and it says out loud which of the two kinds
 * of post this is. The kind is repeated in the instructions too: a model that
 * has to infer "there are no notes, so do not claim an outcome" will infer it
 * most of the time, and `houseStyle` catches the rest.
 */
export function describeSource(source: JournalSource): string {
  const lines = [
    `Kind of post: ${source.kind}`,
    `Kind of work: ${source.categoryLabel}`,
    source.town ? `Where: a home in ${source.town}${source.state ? `, ${source.state}` : ""}` : "",
    source.when ? `When: ${source.when}` : "",
    "",
    "What the customer described:",
    source.complaint,
  ];

  if (source.kind === "story") {
    if (source.work) lines.push("", "What the electrician wrote down afterwards:", source.work);
    if (source.parts.length > 0) lines.push("", "Parts used:", ...source.parts.map((part) => `- ${part}`));
  } else {
    lines.push(
      "",
      "Nothing was written down about what was found or done on this visit.",
      "Do not say what the fault turned out to be, and do not describe a repair.",
    );
  }

  return lines.filter((line) => line !== undefined).join("\n");
}
