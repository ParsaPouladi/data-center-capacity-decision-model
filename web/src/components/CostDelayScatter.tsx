import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatMw,
  formatMwMonths,
  formatNumber,
  formatProbability,
  formatRelativeCost,
} from "../lib/format";
import type { SiteAllocation } from "../types/showcase";

/**
 * Candidate allocations plotted as relative development cost against expected
 * delay burden. Every coordinate is a value the engine already exported for
 * the scenario (`strategies.*` and, when present, `optimizer.evaluated`);
 * this component only maps those authoritative pairs to chart coordinates and
 * draws one mark per allocation. It computes nothing.
 *
 * Presentation. The marks are drawn here rather than by the chart library's
 * defaults, for three reasons the previous version failed on: they were small
 * enough to read as plot noise, the model allocation was not visibly the
 * focal point, and nothing indicated that a mark could be inspected at all.
 * Each mark is now a deliberate target with a generous hit area, the model
 * allocation carries a halo the benchmarks do not, and shape coding is
 * retained so no distinction depends on colour.
 *
 * Inspection is keyboard-reachable: every mark is focusable and opens the
 * same readout on focus as on hover. Nothing is available only that way —
 * the marks carry the full reading as an accessible label, and the tables in
 * this section remain the authoritative exact values.
 *
 * This figure lives in Technical Documentation rather than the Decision
 * page, and drops the concentration index and the raw feasibility string
 * from its readout. Both remain in the export, unused here.
 */

export interface TradeoffPoint {
  key: string;
  label: string;
  /** 'triangle' | 'diamond' | 'square' | 'circle' -- shape-coded, not colour-only. */
  shape: "triangle" | "diamond" | "square" | "circle";
  el: number;
  cost: number;
  objective: number;
  pMeet: number;
  allocation: SiteAllocation;
  isOptimized: boolean;
}

interface ActiveMark {
  point: TradeoffPoint;
  cx: number;
  cy: number;
}

/** Plot height, in px. Also the reference for readout placement. */
const PLOT_HEIGHT = 340;

/** Clearance kept between the readout and the plot's own edges, in px. */
const READOUT_EDGE_PAD = 8;

/** Vertical clearance between the readout and the mark it describes, in px. */
const READOUT_MARK_GAP = 16;

/** Where the readout is drawn, in plot coordinates. */
interface ReadoutPlacement {
  x: number;
  y: number;
}

/**
 * Resolve the readout's position from the measured geometry of the plot, the
 * readout and the active mark.
 *
 * Preference order, then clamping. Vertically the readout sits above the mark
 * and drops below it when there is not room above; horizontally it is centred
 * on the mark. Both axes are then clamped into the plot box, which is what
 * actually keeps a readout inside the figure — the previous version chose
 * between two fixed percentage offsets, which handled a mark near the right
 * edge and silently let a mark near the LEFT edge push the readout out of the
 * card, because a percentage offset knows nothing about where the plot ends.
 * Clamping is bounds-aware and therefore correct for every mark, including the
 * corners, at every plot width.
 */
function resolveReadoutPlacement(
  mark: ActiveMark,
  plotWidth: number,
  plotHeight: number,
  readoutWidth: number,
  readoutHeight: number,
): ReadoutPlacement {
  const pad = READOUT_EDGE_PAD;

  let y = mark.cy - readoutHeight - READOUT_MARK_GAP;
  if (y < pad) y = mark.cy + READOUT_MARK_GAP;

  const x = mark.cx - readoutWidth / 2;

  // `Math.max(pad, …)` keeps the upper bound above the lower one when the
  // readout is wider or taller than the box it is being fitted into, so the
  // clamp degrades to "flush against the top-left inset" rather than
  // inverting and throwing the readout out of the plot entirely.
  const maxX = Math.max(pad, plotWidth - readoutWidth - pad);
  const maxY = Math.max(pad, plotHeight - readoutHeight - pad);

  return {
    x: Math.min(Math.max(x, pad), maxX),
    y: Math.min(Math.max(y, pad), maxY),
  };
}

function allocationText(allocation: SiteAllocation): string {
  return Object.entries(allocation)
    .map(([id, mw]) => `${id} ${formatMw(mw)}`)
    .join(" · ");
}

/** The spoken reading of one mark, and the content of its readout. */
function describePoint(p: TradeoffPoint): string {
  return (
    `${p.label}. Development cost ${formatNumber(p.cost)} relative units. ` +
    `Expected delay burden ${formatNumber(p.el, 1)} MW-months. ` +
    `Chance of meeting the target date ${formatProbability(p.pMeet)}. ` +
    `Allocation ${allocationText(p.allocation)}.`
  );
}

/* ------------------------------------------------------------------ */
/* Marks                                                               */
/* ------------------------------------------------------------------ */

/** Outline geometry for one mark, centred on the plotted coordinate. */
function markPath(shape: TradeoffPoint["shape"], cx: number, cy: number, r: number) {
  switch (shape) {
    case "circle":
      return <circle cx={cx} cy={cy} r={r} />;
    case "square": {
      const h = r * 0.88;
      return <rect x={cx - h} y={cy - h} width={h * 2} height={h * 2} />;
    }
    case "diamond":
      return (
        <polygon
          points={`${cx},${cy - r * 1.12} ${cx + r * 1.12},${cy} ${cx},${cy + r * 1.12} ${cx - r * 1.12},${cy}`}
        />
      );
    case "triangle":
      return (
        <polygon
          points={`${cx},${cy - r * 1.1} ${cx + r},${cy + r * 0.78} ${cx - r},${cy + r * 0.78}`}
        />
      );
  }
}

/**
 * One mark. Deliberately free of any state that changes while the figure is
 * being inspected: the chart subtree is memoised so that opening a readout
 * does not re-render it, because the chart library replaces these DOM nodes
 * on every render — which silently destroys the node that received
 * `mouseover` or `focus`, so the matching `mouseleave` and `blur` never
 * arrive and the readout sticks open. The active state is therefore carried
 * by CSS `:hover` and `:focus`, not by a prop.
 */
function Mark({
  point,
  cx,
  cy,
  onActivate,
  onDismiss,
}: {
  point: TradeoffPoint;
  cx: number;
  cy: number;
  onActivate: (m: ActiveMark) => void;
  onDismiss: () => void;
}) {
  const r = point.isOptimized ? 11 : 9.5;
  const activate = () => onActivate({ point, cx, cy });
  return (
    <g
      className={
        "scatter-mark" + (point.isOptimized ? " scatter-mark--model" : "")
      }
      tabIndex={0}
      role="img"
      aria-label={describePoint(point)}
      onMouseEnter={activate}
      onMouseLeave={onDismiss}
      onFocus={activate}
      onBlur={onDismiss}
      // A transient overlay opened by focus has to be closable without
      // leaving the element that opened it. Focus stays on the mark, so the
      // reading is still available on the mark's own accessible name and no
      // focus is trapped or moved.
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
    >
      {/* A pointer- and focus-sized target, invisible, so a 7px mark does not
          have to be hit exactly. */}
      <circle className="scatter-mark__hit" cx={cx} cy={cy} r={18} />
      {point.isOptimized ? (
        <circle className="scatter-mark__halo" cx={cx} cy={cy} r={r + 6} />
      ) : null}
      <g className="scatter-mark__glyph">{markPath(point.shape, cx, cy, r)}</g>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* Readout                                                             */
/* ------------------------------------------------------------------ */

function MarkReadout({ point }: { point: TradeoffPoint }) {
  return (
    <div className="scatter-readout__body">
      <p className="scatter-readout__title">{point.label}</p>
      <dl className="scatter-readout__grid">
        <dt>Development cost</dt>
        <dd>{formatRelativeCost(point.cost)}</dd>
        <dt>Expected delay burden</dt>
        <dd>{formatMwMonths(point.el)}</dd>
        <dt>Chance of meeting the date</dt>
        <dd>{formatProbability(point.pMeet)}</dd>
      </dl>
      <p className="scatter-readout__allocation">
        {allocationText(point.allocation)}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Figure                                                              */
/* ------------------------------------------------------------------ */

export function CostDelayScatter({
  points,
  method,
  nRealizations,
}: {
  points: TradeoffPoint[];
  method: string;
  nRealizations: number;
}) {
  const [active, setActive] = useState<ActiveMark | null>(null);
  const [placement, setPlacement] = useState<ReadoutPlacement | null>(null);
  const plotRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLDivElement>(null);

  const describe = points.map(describePoint).join(" ");

  // Placement is resolved from measured geometry, after the readout is in the
  // DOM but before the browser paints it, so it is never seen at an unresolved
  // position. It is measured rather than estimated because the readout's size
  // depends on its content — the site list and the label both vary — and a
  // guess at that size is what a fixed offset amounts to.
  useLayoutEffect(() => {
    const plot = plotRef.current;
    const readout = readoutRef.current;
    if (!active || !plot || !readout) {
      setPlacement(null);
      return;
    }
    setPlacement(
      resolveReadoutPlacement(
        active,
        plot.clientWidth,
        plot.clientHeight || PLOT_HEIGHT,
        readout.offsetWidth,
        readout.offsetHeight,
      ),
    );
  }, [active]);

  // Memoised on the data alone. Opening a readout must not re-render the
  // chart: the library rebuilds every mark's DOM node when it does, which
  // discards the node the pointer or the keyboard is currently on, and the
  // `mouseleave` / `blur` that should close the readout is then never
  // delivered. See the note on `Mark`.
  const chart = useMemo(() => {
    const costs = points.map((p) => p.cost);
    const els = points.map((p) => p.el);
    const costMin = Math.min(...costs);
    const costMax = Math.max(...costs);
    const costPad = Math.max((costMax - costMin) * 0.15, 5);
    const elMax = Math.max(...els);
    const elPad = Math.max(elMax * 0.06, 50);
    return (
      <ResponsiveContainer width="100%" height={PLOT_HEIGHT}>
        <ScatterChart margin={{ top: 16, right: 32, bottom: 32, left: 12 }}>
          <CartesianGrid stroke="var(--chart-gridline)" strokeDasharray="2 4" />
          <XAxis
            type="number"
            dataKey="el"
            name="Expected delay burden"
            domain={[0, Math.ceil(elMax + elPad)]}
            tick={{ fill: "var(--chart-label)", fontSize: 12 }}
            stroke="var(--chart-axis)"
            tickFormatter={(v: number) => formatNumber(v, 0)}
            label={{
              value: "Expected delay burden (MW-months)",
              position: "insideBottom",
              offset: -16,
              fill: "var(--text-secondary)",
              fontSize: 12,
            }}
          />
          <YAxis
            type="number"
            dataKey="cost"
            name="Development cost"
            domain={[Math.floor(costMin - costPad), Math.ceil(costMax + costPad)]}
            tick={{ fill: "var(--chart-label)", fontSize: 12 }}
            stroke="var(--chart-axis)"
            width={72}
            tickFormatter={(v: number) => formatNumber(v, 0)}
            label={{
              value: "Development cost (relative units)",
              angle: -90,
              position: "insideLeft",
              fill: "var(--text-secondary)",
              fontSize: 12,
              // Anchored at its own midpoint, so the rotated label centres on
              // the axis instead of running off the top of the plot.
              style: { textAnchor: "middle" },
            }}
          />
          {points.map((p) => (
            <Scatter
              key={p.key}
              name={p.label}
              data={[p]}
              isAnimationActive={false}
              shape={(props: { cx?: number; cy?: number }) => (
                <Mark
                  point={p}
                  cx={props.cx ?? 0}
                  cy={props.cy ?? 0}
                  onActivate={setActive}
                  onDismiss={() => setActive(null)}
                />
              )}
            />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    );
  }, [points]);

  return (
    <figure
      className="chart-figure"
      role="img"
      aria-label={
        `Scatter plot. Horizontal axis: expected delay burden in MW-months. ` +
        `Vertical axis: development cost in relative units. One mark per ` +
        `candidate allocation, each a distinct shape. ${describe} ` +
        `Lower is cheaper and further left is less expected delay burden. ` +
        `Exact values are in the tables in this section.`
      }
    >
      <div className="chart-figure__plot" ref={plotRef}>
        {chart}

        {active ? (
          <div
            ref={readoutRef}
            className="scatter-readout"
            style={{
              transform: `translate(${placement?.x ?? 0}px, ${placement?.y ?? 0}px)`,
              // Hidden, not unmounted, for the one frame it is being measured
              // in: `visibility` keeps it in layout, which is what makes the
              // measurement possible at all.
              visibility: placement ? "visible" : "hidden",
            }}
            aria-hidden="true"
          >
            <MarkReadout point={active.point} />
          </div>
        ) : null}
      </div>

      <ul className="scatter-key">
        {points.map((p) => (
          <li className="scatter-key__item" key={p.key}>
            <svg
              className="scatter-key__glyph"
              viewBox="0 0 22 22"
              width="22"
              height="22"
              aria-hidden="true"
            >
              <g
                className={
                  "scatter-mark" + (p.isOptimized ? " scatter-mark--model" : "")
                }
              >
                <g className="scatter-mark__glyph">{markPath(p.shape, 11, 11, 8)}</g>
              </g>
            </svg>
            {p.label}
          </li>
        ))}
      </ul>

      <figcaption className="fine-print">
        Each mark is one candidate allocation the engine evaluated on this
        scenario, placed by its development cost and its expected delay burden.
        Lower is cheaper; further left is less expected delay burden. The
        filled mark is the model allocation.{" "}
        <strong className="scatter-hint">
          Hover or focus a mark for its allocation details.
        </strong>{" "}
        {method}, {formatNumber(nRealizations, 0)} realizations.
      </figcaption>
    </figure>
  );
}
