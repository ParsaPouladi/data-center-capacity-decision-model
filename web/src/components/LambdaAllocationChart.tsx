import { useId, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { siteColor } from "../lib/siteColor";
import {
  formatMw,
  formatMwMonths,
  formatNumber,
  formatProbability,
  formatRelativeCost,
} from "../lib/format";
import type { LambdaEnvelope, SiteAllocation } from "../types/showcase";

/**
 * How the cost-minimizing allocation changes as the consequence assigned to
 * delayed capacity (lambda) moves across the located decision regimes, for one
 * precomputed example portfolio.
 *
 * Every quantity drawn is authoritative:
 *   - regime allocations are `lambda_envelope.vertices[i].allocation` (exact MW);
 *   - regime boundaries are `lambda_envelope.breakpoints[i].lam_estimate`,
 *     each an ESTIMATE within `breakpoints[i].tolerance` -- shown as a band,
 *     never as an exact arithmetic value;
 *   - whether the solve that established a regime's allocation could certify
 *     uniqueness is `vertices[i].is_unique_within_tolerance`, threaded through
 *     to the regime readout together with `vertices[i].lam`, the lambda that
 *     solve was verified at. The flag belongs to that lambda,
 *     not to the regime: a vertex first discovered by a crossing probe was
 *     solved exactly at a located boundary, where a tie with the neighbouring
 *     allocation exists by construction and says nothing about the regime's
 *     interior. The readout says which lambda it is speaking about rather than
 *     generalizing the flag across the regime;
 *   - the terminal regime holds for every larger lambda
 *     (`x_hi_matches_terminal_vertex`).
 *
 * The component performs no model arithmetic: it does not reconstruct the
 * lambda-envelope, locate boundaries, interpolate an allocation between
 * vertices, or evaluate J. The lambda cursor is navigation over the already
 * -located regimes -- it snaps the readout to the exact authoritative vertex
 * allocation of whichever regime contains the cursor, never an interpolated
 * one, and it never implies a live recomputation.
 *
 * The raw feasibility-status string is not rendered; it was never
 * publicly legible.
 */

interface Regime {
  index: number;
  allocation: SiteAllocation;
  devCost: number;
  expectedDelayBurden: number;
  pMeet: number;
  /** `vertices[i].is_unique_within_tolerance`, verbatim from the engine. */
  isUniqueWithinTolerance: boolean;
  /** `vertices[i].lam` — the λ this regime's allocation was verified at. */
  verifiedAtLam: number | null;
  /** Whether that verification λ coincides with a located boundary. */
  verifiedAtBoundary: boolean;
  lamStart: number;
  lamEnd: number;
  startTol: number;
  endTol: number;
  isTerminal: boolean;
}

function allocRow(siteIds: string[], allocation: SiteAllocation, lam: number) {
  const row: Record<string, number> = { lam };
  for (const id of siteIds) row[id] = allocation[id] ?? 0;
  return row;
}

function allocText(siteIds: string[], allocation: SiteAllocation): string {
  return siteIds.map((id) => `${id} ${formatMw(allocation[id] ?? 0)}`).join(" · ");
}

/** Two allocations agree to within ordinary MW display precision. */
function sameAllocation(
  a: SiteAllocation,
  b: SiteAllocation,
  siteIds: string[],
): boolean {
  return siteIds.every(
    (id) => Math.abs((a[id] ?? 0) - (b[id] ?? 0)) <= 0.5,
  );
}

/**
 * Whether `vertices[i]` really is the allocation on regime `i`.
 *
 * This figure maps the i-th vertex onto the i-th regime by index. That mapping
 * is an assumption about the ORDER of the vertex list, and the list is not
 * ordered by regime: it is ordered by when each vertex was first discovered by
 * the boundary search, which for some portfolios finds a later regime before an
 * earlier one. Committed examples exist where the two orders differ, so drawing
 * without checking would attribute one regime's allocation to another and the
 * page would present a wrong figure with no sign that anything was wrong.
 *
 * The breakpoints carry the answer independently: each names the allocation on
 * its left and on its right. Requiring every vertex to match the neighbouring
 * boundaries' own record of it verifies the mapping instead of trusting it, and
 * a mismatch falls through to the existing "unexpected structure" message,
 * which leaves the authoritative vertex and boundary tables in place.
 */
function verticesAreInRegimeOrder(
  verts: LambdaEnvelope["vertices"],
  bps: LambdaEnvelope["breakpoints"],
  siteIds: string[],
): boolean {
  return verts.every((v, i) => {
    const leftOk =
      i === 0 ||
      sameAllocation(v.allocation, bps[i - 1].right_vertex_allocation, siteIds);
    const rightOk =
      i >= bps.length ||
      sameAllocation(v.allocation, bps[i].left_vertex_allocation, siteIds);
    return leftOk && rightOk;
  });
}

export function LambdaAllocationChart({
  envelope,
  siteIds,
}: {
  envelope: LambdaEnvelope;
  siteIds: string[];
}) {
  const sliderId = useId();
  const bps = envelope.breakpoints;
  const verts = envelope.vertices;
  const structureOk =
    verts.length === bps.length + 1 &&
    verts.length > 0 &&
    verticesAreInRegimeOrder(verts, bps, siteIds);

  const lMin = envelope.l_min;
  const xMax =
    envelope.lambda_anchor > envelope.terminal_breakpoint_lambda
      ? envelope.lambda_anchor
      : envelope.terminal_breakpoint_lambda * 1.2 || 1;

  const [cursorLam, setCursorLam] = useState(() =>
    Number((xMax / 2).toFixed(6)),
  );

  if (!structureOk) {
    return (
      <p className="fine-print" role="status">
        The precomputed λ envelope for this example has an unexpected structure
        ({verts.length} vertices, {bps.length} boundaries), so the regime
        composition figure is omitted. The vertex and boundary tables carry the
        authoritative values.
      </p>
    );
  }

  const regimes: Regime[] = verts.map((v, i) => {
    const sr = v.strategy_result;
    const verifiedAtLam =
      typeof v.lam === "number" && Number.isFinite(v.lam) ? v.lam : null;
    return {
      index: i,
      allocation: v.allocation,
      devCost: sr.development_cost,
      expectedDelayBurden: sr.expected_delay_burden_mw_months,
      pMeet: sr.p_meet,
      isUniqueWithinTolerance: v.is_unique_within_tolerance,
      verifiedAtLam,
      verifiedAtBoundary:
        verifiedAtLam !== null &&
        bps.some((b) => Math.abs(verifiedAtLam - b.lam_estimate) <= b.tolerance),
      lamStart: i === 0 ? lMin : bps[i - 1].lam_estimate,
      lamEnd: i < bps.length ? bps[i].lam_estimate : xMax,
      startTol: i === 0 ? 0 : bps[i - 1].tolerance,
      endTol: i < bps.length ? bps[i].tolerance : 0,
      isTerminal: i === verts.length - 1,
    };
  });

  const rows = regimes.map((r) => allocRow(siteIds, r.allocation, r.lamStart));
  rows.push(
    allocRow(siteIds, regimes[regimes.length - 1].allocation, xMax),
  );

  const totalMw = siteIds.reduce(
    (sum, id) => sum + (regimes[0].allocation[id] ?? 0),
    0,
  );
  const yMax = Math.ceil(Math.max(totalMw, 1) * 1.08);

  const activeRegime =
    regimes.find((r) => cursorLam >= r.lamStart && cursorLam < r.lamEnd) ??
    regimes[regimes.length - 1];
  const leftBp = activeRegime.index > 0 ? bps[activeRegime.index - 1] : null;
  const rightBp =
    activeRegime.index < bps.length ? bps[activeRegime.index] : null;
  const nearBp = bps.find(
    (b) => Math.abs(cursorLam - b.lam_estimate) <= b.tolerance,
  );

  const sliderStep = Number((xMax / 400).toPrecision(2)) || 0.0001;

  const regimeDescription = regimes
    .map(
      (r) =>
        `Regime ${r.index + 1}${r.isTerminal ? " (terminal)" : ""}: ` +
        `${r.isTerminal ? `lambda at or above ${formatNumber(r.lamStart, 4)}` : `lambda from ${formatNumber(r.lamStart, 4)} to ${formatNumber(r.lamEnd, 4)}`}, ` +
        `allocation ${allocText(siteIds, r.allocation)}, ` +
        `verified at lambda ${r.verifiedAtLam === null ? "not reported" : formatNumber(r.verifiedAtLam, 4)}` +
        `${r.verifiedAtBoundary ? ", which is a located boundary" : ""}, ` +
        `where the solve reports it as ${r.isUniqueWithinTolerance ? "uniquely optimal within tolerance" : "one representative of an effectively tied set"}`,
    )
    .join("; ");
  const bpDescription = bps
    .map(
      (b, i) =>
        `boundary ${i + 1} near lambda ${formatNumber(b.lam_estimate, 4)} ` +
        `within plus or minus ${formatNumber(b.tolerance, 4)}`,
    )
    .join("; ");

  return (
    <div className="lambda-panel">
      <figure
        className="chart-figure"
        role="img"
        aria-label={
          `Stacked area chart. Horizontal axis: lambda, the consequence per ` +
          `MW-month of unmet capacity, from 0 to ${formatNumber(xMax, 4)}. ` +
          `Vertical axis: optimal allocated capacity in megawatts, stacked by ` +
          `site. The composition is piecewise constant, stepping at each ` +
          `located decision boundary. ${regimeDescription}. Located ` +
          `boundaries: ${bpDescription}. Boundary positions are numerical ` +
          `estimates within the stated tolerance, not exact values. Exact ` +
          `figures are in the vertex and breakpoint tables below.`
        }
      >
        <div className="chart-figure__plot">
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart
              data={rows}
              margin={{ top: 34, right: 28, bottom: 32, left: 12 }}
            >
              <CartesianGrid
                stroke="var(--chart-gridline)"
                strokeDasharray="2 4"
              />
              <XAxis
                type="number"
                dataKey="lam"
                domain={[0, xMax]}
                tick={{ fill: "var(--chart-label)", fontSize: 12 }}
                stroke="var(--chart-axis)"
                tickFormatter={(v: number) => formatNumber(v, 3)}
                label={{
                  value: "λ  (consequence per MW-month unmet)",
                  position: "insideBottom",
                  offset: -16,
                  fill: "var(--text-secondary)",
                  fontSize: 12,
                }}
              />
              <YAxis
                type="number"
                domain={[0, yMax]}
                tick={{ fill: "var(--chart-label)", fontSize: 12 }}
                stroke="var(--chart-axis)"
                width={72}
                tickFormatter={(v: number) => formatNumber(v, 0)}
                label={{
                  value: "Optimal allocation (MW)",
                  angle: -90,
                  position: "insideLeft",
                  fill: "var(--text-secondary)",
                  fontSize: 12,
                }}
              />
              <Tooltip
                formatter={(value, name) => [
                  formatMw(Number(value)),
                  `Site ${String(name)}`,
                ]}
                labelFormatter={(label) => `λ ${formatNumber(Number(label), 4)}`}
                contentStyle={{
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border-hairline)",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              {regimes.map((r) => (
                <ReferenceArea
                  key={`regime-${r.index}`}
                  x1={r.lamStart}
                  x2={r.lamEnd}
                  fill="var(--accent)"
                  fillOpacity={r.index % 2 === 0 ? 0.04 : 0}
                  stroke="none"
                  label={{
                    value: `R${r.index + 1}${r.isTerminal ? " · terminal" : ""}`,
                    position: "insideTopLeft",
                    fill: "var(--text-muted)",
                    fontSize: 10,
                  }}
                />
              ))}
              {bps.map((b, i) => (
                <ReferenceArea
                  key={`bptol-${i}`}
                  x1={Math.max(0, b.lam_estimate - b.tolerance)}
                  x2={b.lam_estimate + b.tolerance}
                  fill="var(--warn-border)"
                  fillOpacity={0.18}
                  stroke="none"
                />
              ))}
              {bps.map((b, i) => (
                <ReferenceLine
                  key={`bp-${i}`}
                  x={b.lam_estimate}
                  stroke="var(--text-secondary)"
                  strokeDasharray="4 3"
                  label={{
                    // F01: at narrow widths, a boundary sitting near a regime's
                    // left edge put this annotation in the same top-of-plot
                    // band as that regime's "R#" label (both were
                    // "insideTop..."). Placing it in the chart's own top
                    // margin -- above the plot box the regime labels live
                    // inside -- keeps the two label families in vertically
                    // distinct bands at every width, regardless of how close
                    // a boundary falls to a regime edge.
                    value: `≈ ${formatNumber(b.lam_estimate, 3)}`,
                    position: "top",
                    fill: "var(--text-secondary)",
                    fontSize: 10,
                  }}
                />
              ))}
              {siteIds.map((id) => (
                <Area
                  key={id}
                  type="stepAfter"
                  dataKey={id}
                  name={id}
                  stackId="alloc"
                  stroke={siteColor(id) ?? "var(--border-strong)"}
                  fill={siteColor(id) ?? "var(--border-strong)"}
                  fillOpacity={0.55}
                  strokeWidth={1.5}
                  isAnimationActive={false}
                />
              ))}
              <ReferenceLine
                x={cursorLam}
                stroke="var(--accent)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <ul className="chart-key" aria-hidden="true">
          {siteIds.map((id) => (
            <li className="chart-key__item" key={id}>
              <span
                className="chart-key__swatch"
                style={{
                  background: siteColor(id) ?? "var(--border-strong)",
                }}
              />
              Site {id}
            </li>
          ))}
          {/* The one drawn element that is not a model result: the solid rule
              is where the slider below currently sits. Keyed explicitly so it
              is not read as another located boundary. */}
          <li className="chart-key__item">
            <span className="chart-key__rule chart-key__rule--cursor" />
            Slider position
          </li>
          <li className="chart-key__item">
            <span className="chart-key__rule chart-key__rule--boundary" />
            Located boundary
          </li>
        </ul>
        <figcaption className="fine-print">
          Piecewise-constant composition: within a regime the optimal
          allocation does not change. The solid vertical line is the current
          position of the λ slider below, not a model result. The shaded band
          at each dashed boundary is that boundary's numerical tolerance: the
          boundary is <em>located near</em> that λ, not at an exact value. The
          rightmost regime is terminal: its allocation holds for every larger
          λ.
        </figcaption>
      </figure>

      <div className="lambda-cursor">
        <label className="field__label" htmlFor={sliderId}>
          Explore λ across the precomputed regimes
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={xMax}
          step={sliderStep}
          value={cursorLam}
          onChange={(e) => setCursorLam(Number(e.target.value))}
          aria-valuetext={
            `lambda ${formatNumber(cursorLam, 4)}, regime ${activeRegime.index + 1}` +
            `${activeRegime.isTerminal ? " terminal" : ""}, allocation ` +
            `${allocText(siteIds, activeRegime.allocation)}`
          }
        />
        <div className="lambda-cursor__readout" role="status" aria-live="polite">
          <p>
            <strong>λ = {formatNumber(cursorLam, 4)}</strong> is in{" "}
            <strong>
              Regime {activeRegime.index + 1}
              {activeRegime.isTerminal ? " (terminal)" : ""}
            </strong>
            . Authoritative allocation for this regime:{" "}
            {allocText(siteIds, activeRegime.allocation)}.
          </p>
          <p className="lambda-cursor__uniqueness">
            {activeRegime.verifiedAtLam === null ? null : (
              <>
                This allocation was verified by a solve at λ ={" "}
                {formatNumber(activeRegime.verifiedAtLam, 4)}
                {activeRegime.verifiedAtBoundary
                  ? ", which is a located boundary of this envelope. "
                  : ". "}
              </>
            )}
            {activeRegime.isUniqueWithinTolerance
              ? "At that λ the allocation is uniquely optimal within the model's numerical tolerance."
              : "At that λ the allocation is one representative of an effectively tied set of optimal allocations within the model's numerical tolerance, not the only optimum."}
            {activeRegime.verifiedAtBoundary &&
            !activeRegime.isUniqueWithinTolerance
              ? " A tie at a located boundary is what defines that boundary: the allocations on either side of it have equal objectives there. It is not a claim that the tie holds across this regime."
              : ""}
          </p>
          <p className="fine-print" style={{ marginTop: "var(--space-2)" }}>
            Development cost {formatRelativeCost(activeRegime.devCost)} · expected
            delay burden {formatMwMonths(activeRegime.expectedDelayBurden)} ·
            P(meet T*) {formatProbability(activeRegime.pMeet)}.
          </p>
          <p className="fine-print">
            {leftBp
              ? `Lower boundary located near λ ≈ ${formatNumber(leftBp.lam_estimate, 4)} within ±${formatNumber(leftBp.tolerance, 4)}. `
              : "No lower boundary; this is the first regime. "}
            {rightBp
              ? `Upper boundary located near λ ≈ ${formatNumber(rightBp.lam_estimate, 4)} within ±${formatNumber(rightBp.tolerance, 4)}.`
              : "No upper boundary; the terminal regime holds for every larger λ."}
          </p>
          {nearBp ? (
            <p className="fine-print" style={{ color: "var(--warn-ink)" }}>
              The cursor is within a located boundary's numerical tolerance, so
              the regime assignment here is not exact: the boundary is an
              estimate near λ ≈ {formatNumber(nearBp.lam_estimate, 4)}.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
