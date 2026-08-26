/**
 * The diagrams a post may carry, as a catalogue the model chooses from.
 *
 * The model picks a key and supplies the labels. It never writes markup.
 *
 * That is the same shape as `draftWorkOrderLines` and `readReceipt`: the model
 * proposes, deterministic code renders. Three reasons it has to be that way
 * here rather than letting it draw:
 *
 * - **Geometry.** A model writing raw SVG produces overlapping labels, arrows
 *   that miss, and boxes off the edge of the viewBox. Nobody is looking at the
 *   result before it publishes.
 * - **Injection.** Model-authored markup dropped into a public page with
 *   `dangerouslySetInnerHTML` is a script tag waiting to happen, and the model's
 *   input is partly the customer's own words.
 * - **Consistency.** Six diagrams drawn by one person look like a house style.
 *   Six drawn per post look like six different websites.
 *
 * Six covers most of what a residential electrician explains to a homeowner. A
 * post that needs none says so and gets none; a picture bolted onto prose it
 * does not illustrate is worse than no picture.
 *
 * Import-free, so the catalogue can be validated without React.
 */

export type DiagramKey =
  | "panel-trip"
  | "circuit-path"
  | "ground-fault"
  | "series-parallel"
  | "load-vs-rating"
  | "three-wire";

export type DiagramSpec = {
  key: DiagramKey;
  /** What it shows, for the model to choose by. */
  shows: string;
  /** How many labels it needs. Fewer is a hole; more is ignored. */
  slots: number;
  /** What each slot is, in order, so the model knows what it is writing. */
  slotNames: string[];
  /** Used when a slot is left empty, so a diagram is never half-drawn. */
  defaults: string[];
};

export const DIAGRAMS: DiagramSpec[] = [
  {
    key: "panel-trip",
    shows:
      "A breaker panel with one breaker tripped, and what tripping is actually for. Use for anything about breakers going off, resetting, or a panel.",
    slots: 3,
    slotNames: ["what the tripped breaker feeds", "why it tripped", "what the panel protects"],
    defaults: ["The circuit that keeps going off", "More current than it is rated for", "The wiring in the walls"],
  },
  {
    key: "circuit-path",
    shows:
      "The path from the panel through the wall to an outlet and whatever is plugged into it. Use for dead outlets, half a room out, or explaining where a fault can sit.",
    slots: 4,
    slotNames: ["the panel", "the cable in the wall", "the outlet", "the appliance"],
    defaults: ["Breaker panel", "Cable in the wall", "Outlet", "What is plugged in"],
  },
  {
    key: "ground-fault",
    shows:
      "Where current goes when it escapes the circuit, and why a GFCI opens. Use for shocks, bathrooms, kitchens, outdoors, or a GFCI that keeps popping.",
    slots: 3,
    slotNames: ["the normal path out", "the normal path back", "the path that should not exist"],
    defaults: ["Power out", "Power back", "Through a person or into water"],
  },
  {
    key: "series-parallel",
    shows:
      "Why one dead bulb can kill a whole string but not a whole house. Use for lighting, holiday lights, or explaining why one thing failing takes others with it.",
    slots: 2,
    slotNames: ["the string that all goes out", "the wiring that does not"],
    defaults: ["One breaks, all go dark", "One breaks, the rest stay on"],
  },
  {
    key: "load-vs-rating",
    shows:
      "What a circuit is drawing against what the breaker is rated for. Use whenever the answer is that something is asking for more than the circuit has.",
    slots: 3,
    slotNames: ["what it is drawing", "what the breaker allows", "where the safe limit sits"],
    defaults: ["What it is pulling", "Breaker rating", "Safe continuous limit"],
  },
  {
    key: "three-wire",
    shows:
      "Hot, neutral and ground at an outlet, and what each one is for. Use for anything about grounding, two-prong outlets, or old wiring.",
    slots: 3,
    slotNames: ["hot", "neutral", "ground"],
    defaults: ["Hot: carries the power in", "Neutral: carries it back", "Ground: the escape route"],
  },
];

const BY_KEY = new Map(DIAGRAMS.map((entry) => [entry.key, entry]));

export function isDiagramKey(value: string): value is DiagramKey {
  return BY_KEY.has(value as DiagramKey);
}

export function diagramSpec(key: string): DiagramSpec | null {
  return BY_KEY.get(key as DiagramKey) ?? null;
}

/**
 * The labels a diagram will actually be drawn with.
 *
 * Pads with the defaults and trims the extras, so a model that returned two
 * labels for a three-slot diagram gets a complete picture rather than one with a
 * blank in it. Labels are capped in length because the SVG has a fixed amount of
 * room and a long one overlaps the next.
 */
export function diagramLabels(key: string, supplied: unknown): string[] {
  const spec = diagramSpec(key);
  if (!spec) return [];

  const given = (Array.isArray(supplied) ? supplied : [])
    .map((entry) => (typeof entry === "string" ? entry.trim().replace(/\s+/g, " ") : ""))
    .slice(0, spec.slots);

  return Array.from({ length: spec.slots }, (_unused, index) => {
    const label = given[index] ?? "";
    return (label || spec.defaults[index] || "").slice(0, 42);
  });
}

/** The catalogue as the model is shown it, so it picks by what a diagram shows. */
export function describeDiagrams(): string {
  return DIAGRAMS.map(
    (entry) =>
      `- ${entry.key} (${entry.slots} labels: ${entry.slotNames.join("; ")})\n  ${entry.shows}`,
  ).join("\n");
}
