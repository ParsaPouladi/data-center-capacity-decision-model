import {
  formatMw,
  formatMwMonths,
  formatProbability,
  formatRelativeCost,
} from "../lib/format";

export interface HeadlineResultsProps {
  developmentCost: number;
  pMeet: number;
  expectedShortfall: number;
  expectedDelayBurden: number;
  targetMonth: number;
}

export interface HeadlineRow {
  term: string;
  value: string;
  def: string;
}

/**
 * The four public decision numbers for one allocation, as a pure
 * term/value/definition list. Every value is a formatted authoritative
 * StrategyResult field -- nothing is computed here, only formatted. Split
 * out from the component so the key-results gate can assert on the rows
 * without a browser (mirrors the pure helpers behind the explanation gate).
 *
 * The scalarized objective J and the delay-consequence weight λ are
 * deliberately absent from this public surface -- they belong in the
 * Technical Documentation, not the primary Decision result.
 */
export function headlineRows({
  pMeet,
  expectedShortfall,
  expectedDelayBurden,
  developmentCost,
  targetMonth,
}: HeadlineResultsProps): HeadlineRow[] {
  return [
    {
      term: "Chance of meeting the target date",
      value: formatProbability(pMeet),
      def:
        `How often this allocation delivers the full requirement by month ` +
        `${targetMonth}, across the site-delay combinations evaluated.`,
    },
    {
      term: "Expected shortfall at the target date",
      value: formatMw(expectedShortfall),
      def:
        "How much capacity is expected to still be missing on the target " +
        "date, averaged over delay outcomes.",
    },
    {
      term: "Expected delay burden",
      value: formatMwMonths(expectedDelayBurden),
      def:
        "Missing capacity added up over time after the target date. It " +
        "captures how much is missing and for how long.",
    },
    {
      term: "Relative development cost",
      value: formatRelativeCost(developmentCost),
      def:
        "Total build cost in relative units. An index for comparing " +
        "allocations, not a budget.",
    },
  ];
}

/**
 * Presents the four public rows as a quiet definition list -- typography,
 * tabular numerals, and thin rules rather than oversized KPI cards.
 */
export function HeadlineResults(props: HeadlineResultsProps) {
  return (
    <dl className="headline-results">
      {headlineRows(props).map((r) => (
        <div key={r.term} className="headline-results__row">
          <dt className="headline-results__term">{r.term}</dt>
          <dd className="headline-results__value num">{r.value}</dd>
          <dd className="headline-results__def">{r.def}</dd>
        </div>
      ))}
    </dl>
  );
}
