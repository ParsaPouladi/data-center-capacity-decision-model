import {
  formatMw,
  formatMwMonths,
  formatProbability,
  formatRelativeCost,
} from "../lib/format";
import { allocationHeading } from "../lib/explanation";
import type { ResultClassification } from "../lib/resultCase";
import type { ShowcaseExport, StrategyResult } from "../types/showcase";

/**
 * V3 — the choice comparison: the three named benchmark strategies, plus the
 * allocation the model returned when there is one, on the same scenario.
 *
 * Every cell is a formatted authoritative `StrategyResult` field. The bars are
 * a visual encoding of those same numbers — chance on a fixed 0–100% scale,
 * relative development cost on one shared scale across the rows shown — and
 * each is accompanied by its exact value as text, so nothing is hover-only.
 *
 * There is no objective J, no concentration index, no feasibility-status
 * column, no ranking score, no Pareto or dominance claim, and no new
 * browser-computed decision metric. Which row is authoritative comes from the
 * existing structural `ResultClassification`: the optimizer's own row when it
 * ran, and in comparison mode the engine-selected `bestStrategy` (read off the
 * engine's switching boundaries) — never by sorting objective values here.
 *
 * Case B (`sum(K) == D` exactly) renders nothing: every strategy is the same
 * forced allocation, so a comparison would imply a choice that does not exist.
 */

/** Public wording for the engine's benchmark ids. */
const BENCHMARK_LABEL: Record<string, string> = {
  cost_concentration: "Cost first",
  speed_reliability: "Schedule first",
  diversified: "Spread across sites",
};

/** The label for the model-returned allocation row. */
const MODEL_ROW_LABEL = "Model allocation";

interface ChoiceRow {
  key: string;
  label: string;
  result: StrategyResult;
  /** The authoritative-result wording for this row, or null for an ordinary row. */
  badge: string | null;
}

export function choiceRows(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): ChoiceRow[] {
  const { optimizer } = showcase;
  const tied = classification.bestCoOptimalKeys.length > 1;
  const heading = allocationHeading(classification);

  const rows: ChoiceRow[] = [];
  if (optimizer) {
    rows.push({
      key: "optimized",
      label: MODEL_ROW_LABEL,
      result: optimizer.evaluated,
      badge: heading,
    });
  }
  for (const [key, result] of Object.entries(showcase.strategies)) {
    const marked =
      !optimizer && classification.bestCoOptimalKeys.includes(key);
    rows.push({
      key,
      label: BENCHMARK_LABEL[key] ?? key,
      result: result as StrategyResult,
      badge: marked ? (tied ? `${heading} (tied)` : heading) : null,
    });
  }
  return rows;
}

function Meter({
  fraction,
  value,
  variant,
}: {
  fraction: number;
  value: string;
  variant: "chance" | "cost";
}) {
  const width = Math.max(0, Math.min(1, fraction)) * 100;
  return (
    <div className="choice-meter">
      <div className="choice-meter__track">
        <div
          className={`choice-meter__fill choice-meter__fill--${variant}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <span className="choice-meter__value num">{value}</span>
    </div>
  );
}

export function ChoiceComparison({
  showcase,
  classification,
}: {
  showcase: ShowcaseExport;
  classification: ResultClassification;
}) {
  // Case B: every strategy is the same forced allocation. Nothing to compare.
  if (classification.base === "B") return null;

  const rows = choiceRows(showcase, classification);
  if (rows.length === 0) return null;

  // One shared cost scale across exactly the rows shown, so the bars are
  // comparable to each other and to nothing else.
  const maxCost = Math.max(...rows.map((r) => r.result.development_cost));

  return (
    <div className="choice-comparison">
      {/* Narrow viewports cannot fit all five columns, so the table scrolls.
          The cue names that explicitly (it is hidden once the table fits),
          and the scroll container is a labelled, focusable region so the
          columns off screen are reachable by keyboard as well as by touch. */}
      <p className="table-scroll-cue" aria-hidden="true">
        Scroll sideways for more columns
        <span className="table-scroll-cue__arrow">&#x2192;</span>
      </p>
      <div
        className="table-scroll"
        role="region"
        aria-label="Comparison table, scrollable"
        tabIndex={0}
      >
        <table className="data-table choice-table">
          <thead>
            <tr>
              <th scope="col">Allocation</th>
              <th scope="col">
                Chance of meeting the target date
                <span className="choice-table__unit">0–100%</span>
              </th>
              <th scope="col">
                Relative development cost
                <span className="choice-table__unit">
                  shared scale, rel. units
                </span>
              </th>
              <th scope="col" className="num">
                Expected shortfall
                <span className="choice-table__unit">MW</span>
              </th>
              <th scope="col" className="num">
                Expected delay burden
                <span className="choice-table__unit">MW-months</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={row.badge ? "choice-row choice-row--marked" : "choice-row"}
              >
                <th scope="row">
                  <span className="choice-row__label">{row.label}</span>
                  {row.badge ? (
                    <span className="choice-row__badge">{row.badge}</span>
                  ) : null}
                </th>
                <td>
                  <Meter
                    fraction={row.result.p_meet}
                    value={formatProbability(row.result.p_meet)}
                    variant="chance"
                  />
                </td>
                <td>
                  <Meter
                    fraction={
                      maxCost > 0 ? row.result.development_cost / maxCost : 0
                    }
                    value={formatRelativeCost(row.result.development_cost)}
                    variant="cost"
                  />
                </td>
                <td className="num">
                  {formatMw(row.result.expected_shortfall_mw)}
                </td>
                <td className="num">
                  {formatMwMonths(row.result.expected_delay_burden_mw_months)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
