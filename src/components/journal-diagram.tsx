import { diagramLabels, diagramSpec, type DiagramKey } from "@/lib/journal-diagrams";

/**
 * The six drawings, by hand.
 *
 * Every one of them explains something to a person who is not an electrician,
 * which is the whole brief: a homeowner reading about a breaker that keeps
 * tripping should come away knowing what a breaker is *for*. A photograph of a
 * panel does not teach that. A drawing with three words on it does.
 *
 * Written as plain inline SVG rather than a chart library: they are diagrams,
 * not data, and a library that ships 90kB to draw six fixed pictures is 90kB
 * on a page whose whole purpose is to load fast for a stranger.
 *
 * ## How they survive both themes
 *
 * Strokes and text use `currentColor` and the app's own tokens, so the drawing
 * takes the colour of the prose around it. The one exception is the accent —
 * the tripped breaker, the fault path, the bar over the line — which uses the
 * semantic tokens, because "the bad one is the red one" has to survive a theme
 * change to mean anything.
 *
 * ## Accessibility, and the crawler
 *
 * `role="img"` with a real `<title>` and `<desc>`. The title is the accessible
 * name and the description is the explanation somebody would get if they could
 * see it. Both are also text a search engine reads, which is not the reason
 * they are there but is a reason to write them properly.
 */

const SURFACE = "var(--color-raised)";
const LINE = "var(--color-line-strong)";
const MUTED = "var(--color-ink-muted)";
const ACCENT = "var(--color-brand)";
const BAD = "var(--color-critical)";
const GOOD = "var(--color-positive)";

/** Wraps a label onto as many lines as it needs, since SVG text will not. */
function Caption({
  x,
  y,
  children,
  anchor = "middle",
  width = 18,
  size = 11,
  fill = MUTED,
  anchorY = "top",
}: {
  x: number;
  y: number;
  children: string;
  anchor?: "start" | "middle" | "end";
  /** Roughly how many characters fit on one line at this size. */
  width?: number;
  size?: number;
  fill?: string;
  /**
   * Which end of the wrapped block `y` refers to.
   *
   * SVG text grows downwards from its baseline, so a label that wraps ends up
   * lower than it was placed, and how much lower depends on words nobody
   * controls: the model supplies these. Both non-default modes exist because a
   * two-line label broke something at 390px that a one-line label did not.
   *
   * - `top` (the default) starts the first line at `y`.
   * - `middle` centres the block, for a label inside a shape. The load bar read
   *   "What the dryer is / pulling" with "pulling" hanging below the bar.
   * - `bottom` puts the *last* line at `y` and stacks earlier ones above it, for
   *   a label that must clear something underneath. "What the breaker / allows"
   *   landed its second line on the rating line it was labelling.
   */
  anchorY?: "top" | "middle" | "bottom";
}) {
  const words = children.split(" ");
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);

  const spread = (lines.length - 1) * (size + 2);
  const top = anchorY === "middle" ? y - spread / 2 : anchorY === "bottom" ? y - spread : y;

  return (
    <text x={x} y={top} textAnchor={anchor} fontSize={size} fill={fill}>
      {lines.map((entry, index) => (
        <tspan key={entry + index} x={x} dy={index === 0 ? 0 : size + 2}>
          {entry}
        </tspan>
      ))}
    </text>
  );
}

function PanelTrip({ labels }: { labels: string[] }) {
  const [feeds, why, protects] = labels;
  return (
    <>
      <rect x={16} y={16} width={104} height={148} rx={8} fill={SURFACE} stroke={LINE} />
      {[0, 1, 2, 3, 4].map((row) => {
        const tripped = row === 2;
        return (
          <g key={row}>
            <rect
              x={28}
              y={32 + row * 26}
              width={36}
              height={18}
              rx={3}
              fill={tripped ? BAD : "currentColor"}
              opacity={tripped ? 1 : 0.25}
            />
            <rect
              x={72}
              y={32 + row * 26}
              width={36}
              height={18}
              rx={3}
              fill="currentColor"
              opacity={0.25}
            />
          </g>
        );
      })}
      {/* The one that went. */}
      <path d="M118 93 L152 93" stroke={BAD} strokeWidth={2} strokeDasharray="4 3" fill="none" />
      <Caption x={158} y={88} anchor="start" width={22} fill={BAD}>
        {feeds ?? ""}
      </Caption>
      <Caption x={158} y={124} anchor="start" width={22}>
        {why ?? ""}
      </Caption>
      <Caption x={68} y={182} width={26}>
        {protects ?? ""}
      </Caption>
    </>
  );
}

function CircuitPath({ labels }: { labels: string[] }) {
  const [panel, cable, outlet, appliance] = labels;
  return (
    <>
      <rect x={16} y={48} width={54} height={72} rx={6} fill={SURFACE} stroke={LINE} />
      <rect x={26} y={62} width={34} height={12} rx={2} fill={ACCENT} />
      <rect x={26} y={80} width={34} height={12} rx={2} fill="currentColor" opacity={0.25} />
      <rect x={26} y={98} width={34} height={12} rx={2} fill="currentColor" opacity={0.25} />

      <path d="M70 84 L150 84" stroke={ACCENT} strokeWidth={2.5} fill="none" />

      <rect x={150} y={56} width={46} height={56} rx={6} fill={SURFACE} stroke={LINE} />
      <circle cx={165} cy={78} r={3} fill="currentColor" opacity={0.5} />
      <circle cx={181} cy={78} r={3} fill="currentColor" opacity={0.5} />
      <circle cx={173} cy={94} r={3.5} fill="currentColor" opacity={0.5} />

      <path d="M196 84 L246 84" stroke={ACCENT} strokeWidth={2.5} fill="none" />
      <rect x={246} y={58} width={54} height={52} rx={6} fill={SURFACE} stroke={LINE} />
      {/*
        A power symbol, not a clock face. The first drawing of this had a circle
        with two hands on it and read as a wall clock, which is a different
        appliance entirely and taught the reader nothing.
      */}
      <circle
        cx={273}
        cy={86}
        r={14}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        opacity={0.55}
        strokeDasharray="62 26"
        transform="rotate(-90 273 86)"
      />
      <path d="M273 68 L273 84" stroke="currentColor" strokeWidth={2} opacity={0.55} />

      <Caption x={43} y={140} width={14}>{panel ?? ""}</Caption>
      {/* Above the panel's top edge at y=48, not beside its rounded corner. */}
      <Caption x={116} y={40} width={22}>{cable ?? ""}</Caption>
      <Caption x={173} y={132} width={14}>{outlet ?? ""}</Caption>
      <Caption x={273} y={132} width={14}>{appliance ?? ""}</Caption>
    </>
  );
}

function GroundFault({ labels }: { labels: string[] }) {
  const [out, back, escape] = labels;
  return (
    <>
      {/* The panel, with breakers in it. An empty rectangle is not a panel. */}
      <rect x={16} y={44} width={50} height={90} rx={6} fill={SURFACE} stroke={LINE} />
      {[0, 1, 2].map((row) => (
        <g key={row}>
          <rect x={24} y={56 + row * 24} width={15} height={13} rx={2} fill="currentColor" opacity={0.28} />
          <rect x={43} y={56 + row * 24} width={15} height={13} rx={2} fill="currentColor" opacity={0.28} />
        </g>
      ))}

      <rect x={250} y={54} width={54} height={70} rx={6} fill={SURFACE} stroke={LINE} />
      <circle cx={277} cy={82} r={3} fill="currentColor" opacity={0.5} />
      <circle cx={277} cy={98} r={3} fill="currentColor" opacity={0.5} />

      {/* Out, and back. The two that should be equal, and a GFCI compares them. */}
      <path d="M66 74 L250 74" stroke={GOOD} strokeWidth={2.5} fill="none" />
      <path d="M66 104 L250 104" stroke={GOOD} strokeWidth={2.5} fill="none" />

      {/*
        The one that should not exist.

        It leaves the hot conductor and goes to earth. The little hop where it
        passes the return wire is the schematic convention for crossing without
        joining, and it is the whole point of the picture: the current that
        leaves never comes back on the neutral, and that difference is what
        trips the device.
      */}
      <path
        d="M206 74 L206 96 A 7 7 0 0 1 206 112 L206 150"
        stroke={BAD}
        strokeWidth={2.5}
        strokeDasharray="5 4"
        fill="none"
      />
      <path d="M196 144 L206 158 L216 144" stroke={BAD} strokeWidth={2} fill="none" />

      <Caption x={132} y={62} width={20} fill={GOOD}>{out ?? ""}</Caption>
      <Caption x={132} y={124} width={20} fill={GOOD}>{back ?? ""}</Caption>
      <Caption x={224} y={140} anchor="start" width={13} fill={BAD}>{escape ?? ""}</Caption>
    </>
  );
}

function SeriesParallel({ labels }: { labels: string[] }) {
  const [series, parallel] = labels;
  return (
    <>
      {/* One string, one break, all dark. */}
      <path d="M24 52 L296 52" stroke="currentColor" strokeWidth={2} opacity={0.35} fill="none" />
      {[70, 122, 174, 226].map((x, index) => (
        <circle
          key={x}
          cx={x}
          cy={52}
          r={9}
          fill={index === 1 ? "none" : "currentColor"}
          opacity={index === 1 ? 1 : 0.2}
          stroke={index === 1 ? BAD : "none"}
          strokeWidth={2}
        />
      ))}
      <path d="M116 46 L128 58 M128 46 L116 58" stroke={BAD} strokeWidth={2} />

      {/* Separate legs. One break, the rest carry on. */}
      <path d="M24 140 L296 140" stroke="currentColor" strokeWidth={2} opacity={0.35} fill="none" />
      {[70, 122, 174, 226].map((x, index) => (
        <g key={x}>
          <path d={`M${x} 140 L${x} 118`} stroke="currentColor" strokeWidth={2} opacity={0.35} />
          <circle
            cx={x}
            cy={110}
            r={9}
            fill={index === 1 ? "none" : ACCENT}
            opacity={index === 1 ? 1 : 0.85}
            stroke={index === 1 ? BAD : "none"}
            strokeWidth={2}
          />
        </g>
      ))}
      <path d="M116 104 L128 116 M128 104 L116 116" stroke={BAD} strokeWidth={2} />

      <Caption x={160} y={84} width={30}>{series ?? ""}</Caption>
      <Caption x={160} y={172} width={30}>{parallel ?? ""}</Caption>
    </>
  );
}

function LoadVsRating({ labels }: { labels: string[] }) {
  const [drawing, rating, safe] = labels;
  return (
    <>
      {/*
        The bar has to end past the rating line, or the picture says the circuit
        is drawing exactly what it is allowed and there is nothing to explain.
        The first version ended flush with it and read as a full battery.
      */}
      <rect x={24} y={80} width={272} height={34} rx={6} fill={SURFACE} stroke={LINE} />
      <rect x={24} y={80} width={248} height={34} rx={6} fill={BAD} opacity={0.75} />

      {/* Where it is safe to sit all day: eighty per cent of the rating. */}
      <path d="M204 68 L204 150" stroke={GOOD} strokeWidth={2} strokeDasharray="4 3" />
      {/* Where the breaker gives up. Drawn last, so the bar cannot bury it. */}
      <path d="M246 52 L246 126" stroke="currentColor" strokeWidth={2.5} />

      {/* Centred on the bar's midline, so a label that wraps grows both ways
          inside it rather than hanging off the bottom edge. */}
      <Caption x={124} y={97} width={20} size={11} anchorY="middle" fill="var(--color-on-brand)">
        {drawing ?? ""}
      </Caption>
      {/* Each threshold's words sit at its own line, on opposite sides of the
          bar, so neither label has to be traced back to a stray tick. */}
      <Caption x={246} y={44} width={17} anchorY="bottom">{rating ?? ""}</Caption>
      <Caption x={204} y={168} width={16} fill={GOOD}>{safe ?? ""}</Caption>
    </>
  );
}

function ThreeWire({ labels }: { labels: string[] }) {
  const [hot, neutral, ground] = labels;
  const rows: [string, string, string][] = [
    [hot ?? "", BAD, "M96 60 L206 60"],
    [neutral ?? "", "currentColor", "M96 100 L206 100"],
    [ground ?? "", GOOD, "M96 140 L206 140"],
  ];

  return (
    <>
      <rect x={206} y={34} width={62} height={132} rx={8} fill={SURFACE} stroke={LINE} />
      <rect x={222} y={52} width={7} height={20} rx={2} fill={BAD} />
      <rect x={245} y={52} width={7} height={20} rx={2} fill="currentColor" opacity={0.5} />
      <circle cx={237} cy={140} r={7} fill="none" stroke={GOOD} strokeWidth={2} />

      {rows.map(([label, colour, path], index) => (
        <g key={index}>
          <path d={path} stroke={colour} strokeWidth={2.5} fill="none" opacity={colour === "currentColor" ? 0.5 : 1} />
          <Caption
            x={90}
            y={index * 40 + 64}
            anchor="end"
            width={16}
            fill={colour === "currentColor" ? MUTED : colour}
          >
            {label}
          </Caption>
        </g>
      ))}
    </>
  );
}

const DRAWINGS: Record<DiagramKey, (props: { labels: string[] }) => React.ReactNode> = {
  "panel-trip": PanelTrip,
  "circuit-path": CircuitPath,
  "ground-fault": GroundFault,
  "series-parallel": SeriesParallel,
  "load-vs-rating": LoadVsRating,
  "three-wire": ThreeWire,
};

export function JournalDiagram({
  diagram,
  labels,
  caption,
}: {
  diagram: string;
  labels: unknown;
  /** The one line under it, which is also the accessible description. */
  caption?: string;
}) {
  const spec = diagramSpec(diagram);
  if (!spec) return null;

  const Drawing = DRAWINGS[spec.key];
  const resolved = diagramLabels(spec.key, labels);
  const described = caption?.trim() || spec.shows;

  return (
    <figure className="my-6">
      {/*
        The scroll container is the responsive answer, not a smaller viewBox.
        A drawing squeezed into 320px has 7px labels nobody can read; one that
        keeps its proportions and scrolls stays legible, and the page body
        itself never scrolls sideways.
      */}
      <div className="overflow-x-auto rounded-panel border border-line bg-surface p-3">
        <svg
          viewBox="0 0 320 200"
          role="img"
          aria-labelledby={`${spec.key}-title ${spec.key}-desc`}
          className="mx-auto block h-auto w-full min-w-[280px] max-w-[520px] text-ink"
        >
          <title id={`${spec.key}-title`}>{spec.shows.split(".")[0]}</title>
          <desc id={`${spec.key}-desc`}>{`${described} Labelled: ${resolved.join("; ")}.`}</desc>
          <Drawing labels={resolved} />
        </svg>
      </div>

      {caption ? (
        <figcaption className="mt-2 text-center text-xs leading-5 text-ink-muted">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
