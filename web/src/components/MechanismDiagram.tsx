/**
 * The causal-mechanism diagram for the Technical Documentation.
 *
 * Composition. The computed chain is drawn as a numbered sequence of
 * stations on a single rule, not as a row of boxes: five outlined rectangles
 * with arrows between them is the generic process graphic, and it read as
 * one however carefully the geometry was regularised. A rule with numbered
 * stations says the same thing — five steps, in this order, each feeding the
 * next — with one continuous line instead of nine separate marks, and it
 * leaves the labels room to be read at full size instead of squeezed inside
 * a box.
 *
 * The two quantities you provide are a separate layer, not a variant node
 * style: a tinted rail above the chain, labelled once, with each input
 * dropping into the exact station the mathematics says it enters — the
 * ordinal site conditions resolve into physical timing and uncertainty, the
 * delay consequence prices the delay burden inside the objective. The
 * candidate allocation the model searches over is the decision variable, not
 * a quantity you set and not a computed result; it is named in the caption
 * rather than drawn, so the figure keeps one clean two-way distinction —
 * provided vs computed — instead of three. Because the rail is labelled and
 * everything off it is on the computed rule, the figure needs no legend, and
 * carries none. Inputs are marked by BOTH a dashed rule and a tint, never
 * colour alone, so the distinction survives greyscale and colour-vision
 * differences.
 *
 * It is a functional technical diagram, not illustration: flat fills and
 * hairlines in the token palette, no gradients, no shadows, no depth.
 * Nothing is revealed on hover. Two purpose-built layouts — a horizontal
 * rule and a vertical timeline — are swapped by CSS media query, so no
 * resize logic is needed; the narrow one is composed for its own shape
 * rather than being the wide one turned on its side. Both SVGs are
 * decorative-equivalent to the adjacent visually-hidden summary.
 *
 * Geometry is derived from a single set of constants per layout, so station
 * spacing, label baselines and connector lengths are uniform by
 * construction. The chain asserts only the model's own structure; no causal
 * claim beyond it is drawn.
 */

interface ChainNode {
  label: string;
  /** Index of the chain node this user-set input feeds, or undefined for chain nodes. */
  feeds?: number;
}

/** The computed chain, in model order. */
const CHAIN: ChainNode[] = [
  { label: "Physical timing and uncertainty" },
  { label: "Usable capacity over time" },
  { label: "Deadline consequences" },
  { label: "Cost and delay tradeoff" },
  { label: "Allocation decision" },
];

/** The two quantities you provide, and where each enters the chain. */
const INPUTS: Required<Pick<ChainNode, "label" | "feeds">>[] = [
  { label: "Site conditions", feeds: 0 },
  { label: "Delay consequence", feeds: 3 },
];

const INPUT_LAYER_LABEL = "PROVIDED BY YOU";

/**
 * The text summary screen readers announce in place of the two decorative
 * SVGs. Built from the same node lists the diagram draws, so the two cannot
 * drift apart.
 */
const SUMMARY =
  "Diagram of the model mechanism. The model computes five steps in order: " +
  CHAIN.map((n) => n.label).join("; ") +
  ". Each step feeds the next. Two quantities are provided by you rather than " +
  "computed by the model, and each enters the chain at one point: " +
  INPUTS.map((n) => `${n.label}, which enters at ${CHAIN[n.feeds].label}`).join(
    "; ",
  ) +
  ". The capacity allocation is the decision variable the model searches " +
  "over: each candidate allocation is run through the chain, and the model " +
  "returns the one it selects as the allocation decision. Physical timing " +
  "and uncertainty carries each site's nominal delivery schedule together " +
  "with a distribution of possible delays, which is where uncertainty " +
  "enters the chain. Nothing beyond this structure is claimed.";

export function MechanismDiagram() {
  return (
    <div className="mechanism-diagram">
      <p className="visually-hidden">{SUMMARY}</p>
      <WideDiagram />
      <NarrowDiagram />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shared text metrics                                                 */
/* ------------------------------------------------------------------ */

/**
 * Two-line wrapping for a station label. A two-word label is broken only
 * when keeping it on one line would make it wider than its column; short
 * ones stay whole rather than being split for the sake of symmetry.
 */
function labelLines(label: string): string[] {
  const words = label.split(" ");
  if (words.length === 1) return [label];
  if (words.length === 2) {
    return label.length > 17 ? words : [label];
  }
  if (words.length === 3) return [words[0], words.slice(1).join(" ")];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}

/* ------------------------------------------------------------------ */
/* Wide: an input rail above one numbered rule                         */
/* ------------------------------------------------------------------ */

const W = {
  /** One station column. Wide enough for the longest label at full size. */
  colW: 184,
  inputW: 150,
  inputH: 44,
  /** Baseline of the rail's layer label, below the band's top edge. */
  railLabelDrop: 17,
  /** Top of the input cards, below the band's top edge — clears the label. */
  railPadTop: 27,
  railPadBottom: 12,
  /** Clear vertical run between the input rail and the chain rule. */
  drop: 50,
  dotR: 11,
  /** First label baseline below the rule. */
  labelDrop: 34,
  labelLine: 18,
  labelSize: 13.5,
};

function WideDiagram() {
  const width = CHAIN.length * W.colW;
  const railH = W.railPadTop + W.inputH + W.railPadBottom;
  const ruleY = railH + W.drop;
  const height = ruleY + W.labelDrop + W.labelLine + 8;
  const stationX = (i: number) => W.colW / 2 + i * W.colW;
  const first = stationX(0);
  const last = stationX(CHAIN.length - 1);

  return (
    <svg
      className="mechanism-diagram__wide"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
    >
      <ArrowDefs id="mech-wide" />

      {/* The input layer. One band, labelled once, so every mark off it is
          read as computed without a second legend saying so. The band runs
          from the first station to just past the last provided input, rather
          than the full width. The layer label is centred over that band so it
          governs both provided-input cards equally rather than sitting against
          the first one. */}
      {(() => {
        const lastFeed = Math.max(...INPUTS.map((n) => n.feeds));
        const railW = stationX(lastFeed) + W.inputW / 2 + 20;
        return (
          <>
            <rect
              x={0}
              y={0}
              width={railW}
              height={railH}
              rx={4}
              className="mech-rail"
            />
            <text
              x={railW / 2}
              y={17}
              textAnchor="middle"
              fontSize="12"
              className="mech-rail-label"
            >
              {INPUT_LAYER_LABEL}
            </text>
          </>
        );
      })()}

      {INPUTS.map((input) => {
        const cx = stationX(input.feeds);
        return (
          <g key={input.label}>
            <rect
              x={cx - W.inputW / 2}
              y={W.railPadTop}
              width={W.inputW}
              height={W.inputH}
              rx={3}
              className="mech-input-rect"
            />
            <text
              x={cx}
              y={W.railPadTop + W.inputH / 2 + 4}
              textAnchor="middle"
              fontSize="13"
              className="mech-input-text"
            >
              {input.label}
            </text>
            <line
              x1={cx}
              y1={railH + 10}
              x2={cx}
              y2={ruleY - W.dotR - 10}
              className="mech-connector"
              markerEnd="url(#mech-wide-head-input)"
            />
          </g>
        );
      })}

      {/* The computed chain: one rule, one station per step. Direction is
          carried by the step numbers and the ringed terminal station — the
          chain ends at the allocation decision, so the rule ends there too,
          with no arrowhead pointing past it. */}
      <line
        x1={first}
        y1={ruleY}
        x2={last}
        y2={ruleY}
        className="mech-rule"
      />

      {CHAIN.map((node, i) => {
        const cx = stationX(i);
        const isLast = i === CHAIN.length - 1;
        const lines = labelLines(node.label);
        return (
          <g key={node.label}>
            {isLast ? (
              <circle cx={cx} cy={ruleY} r={W.dotR + 4} className="mech-station-ring" />
            ) : null}
            <circle cx={cx} cy={ruleY} r={W.dotR} className="mech-station" />
            <text
              x={cx}
              y={ruleY + 4}
              textAnchor="middle"
              fontSize="12"
              className="mech-station-number"
            >
              {i + 1}
            </text>
            <text
              x={cx}
              y={ruleY + W.labelDrop}
              textAnchor="middle"
              fontSize={W.labelSize}
              className={
                isLast ? "mech-label mech-label--terminal" : "mech-label"
              }
            >
              {lines.map((line, k) => (
                <tspan key={k} x={cx} dy={k === 0 ? 0 : W.labelLine}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Narrow: a vertical timeline, inputs entering above their station    */
/* ------------------------------------------------------------------ */

const N = {
  width: 320,
  spineX: 20,
  dotR: 11,
  labelX: 46,
  labelSize: 14,
  labelLine: 19,
  /** Vertical run between one station's label block and the next station. */
  gap: 26,
  cardH: 50,
  cardX: 46,
  /** Vertical run from an input card down into the station it feeds. */
  cardDrop: 26,
};

interface NarrowRow {
  kind: "input" | "station";
  label: string;
  /** Station number, 1-based; inputs carry none. */
  step?: number;
  top: number;
  /** Centre of the station dot. */
  dotY?: number;
  lines: string[];
}

/**
 * The stacked reading order: each station, preceded by any input it takes,
 * with every y position resolved once so the spine and the connectors are
 * drawn from the same numbers the labels are.
 */
function narrowRows(): { rows: NarrowRow[]; height: number } {
  const rows: NarrowRow[] = [];
  let y = 0;
  CHAIN.forEach((node, i) => {
    for (const input of INPUTS) {
      if (input.feeds !== i) continue;
      rows.push({ kind: "input", label: input.label, top: y, lines: [input.label] });
      y += N.cardH + N.cardDrop;
    }
    const lines = labelLines(node.label);
    rows.push({
      kind: "station",
      label: node.label,
      step: i + 1,
      top: y,
      dotY: y + 12,
      lines,
    });
    y += 12 + lines.length * N.labelLine + N.gap;
  });
  return { rows, height: y - N.gap + 6 };
}

function NarrowDiagram() {
  const { rows, height } = narrowRows();
  const stations = rows.filter((r) => r.kind === "station");
  const firstDot = stations[0].dotY as number;
  const lastDot = stations[stations.length - 1].dotY as number;

  return (
    <svg
      className="mechanism-diagram__narrow"
      viewBox={`0 0 ${N.width} ${height}`}
      width={N.width}
      height={height}
      aria-hidden="true"
    >
      <ArrowDefs id="mech-narrow" />

      <line
        x1={N.spineX}
        y1={firstDot}
        x2={N.spineX}
        y2={lastDot}
        className="mech-rule"
      />

      {rows.map((row, i) => {
        if (row.kind === "input") {
          const connectorX = N.cardX + 18;
          return (
            <g key={`${row.label}-${i}`}>
              <rect
                x={N.cardX}
                y={row.top}
                width={N.width - N.cardX - 6}
                height={N.cardH}
                rx={3}
                className="mech-input-rect"
              />
              {/* The layer label rides on the card itself: at this width a
                  separate rail would cost a row of vertical space to say
                  what two words inside the card already say. */}
              <text
                x={N.cardX + 12}
                y={row.top + 18}
                fontSize="10.5"
                className="mech-rail-label"
              >
                {INPUT_LAYER_LABEL}
              </text>
              <text
                x={N.cardX + 12}
                y={row.top + 37}
                fontSize="13.5"
                className="mech-input-text"
              >
                {row.label}
              </text>
              <line
                x1={connectorX}
                y1={row.top + N.cardH + 4}
                x2={connectorX}
                y2={row.top + N.cardH + N.cardDrop - 2}
                className="mech-connector"
                markerEnd="url(#mech-narrow-head-input)"
              />
            </g>
          );
        }

        const isLast = row.step === CHAIN.length;
        const dotY = row.dotY as number;
        return (
          <g key={`${row.label}-${i}`}>
            {isLast ? (
              <circle
                cx={N.spineX}
                cy={dotY}
                r={N.dotR + 4}
                className="mech-station-ring"
              />
            ) : null}
            <circle cx={N.spineX} cy={dotY} r={N.dotR} className="mech-station" />
            <text
              x={N.spineX}
              y={dotY + 4}
              textAnchor="middle"
              fontSize="12"
              className="mech-station-number"
            >
              {row.step}
            </text>
            <text
              x={N.labelX}
              y={dotY + 5}
              fontSize={N.labelSize}
              className={
                isLast ? "mech-label mech-label--terminal" : "mech-label"
              }
            >
              {row.lines.map((line, k) => (
                <tspan key={k} x={N.labelX} dy={k === 0 ? 0 : N.labelLine}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ArrowDefs({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={`${id}-head-input`}
        viewBox="0 0 10 10"
        refX="8"
        refY="5"
        markerWidth="6"
        markerHeight="6"
        orient="auto-start-reverse"
      >
        <path
          d="M0,0 L10,5 L0,10 z"
          className="mech-arrowhead mech-arrowhead--input"
        />
      </marker>
    </defs>
  );
}
