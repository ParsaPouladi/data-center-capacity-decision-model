/**
 * Pure result classification.
 *
 * Classifies an already-computed engine result into exactly one base case
 * (A, B, C, D, or F) plus an additive zero-chance overlay (case E). Every
 * input is either an explicit field on the fetched `ShowcaseExport` or one of
 * the two authorized input-level structural checks: `sum(K) < D` is handled
 * upstream (a `system_insufficient` response has no result to classify), and
 * `sum(K) == D` is the forced-allocation check performed here.
 *
 * The forced check is an EXACT comparison. When the raw validated input
 * decimal strings are supplied (`RawCapacityInputs`), it is done on those
 * strings scaled to a common integer base with BigInt, so mathematically
 * equal decimals (0.1 + 0.2 == 0.3) are not split by binary floating point.
 * With no strings available it falls back to plain numeric equality on the
 * echoed scenario, which is exact for integer capacities. No epsilon, no
 * tolerance, no rounding.
 *
 * Nothing in this module derives a new model quantity, and there is no
 * probability threshold anywhere — case E fires only on the exact structural
 * state `p_meet === 0`. Low-slack / partial-forcing attribution is deferred
 * and is deliberately not inferred.
 */
import type {
  GlobalSwitchingBoundary,
  ShowcaseExport,
  StrategyResult,
} from "../types/showcase";

/**
 * Base result case. Precedence when the optimizer ran: B > D > C > A.
 * F is the disjoint comparison-mode case (`optimizer === null`).
 */
export type ResultCaseId = "A" | "B" | "C" | "D" | "F";

export interface ResultClassification {
  base: ResultCaseId;
  /** Case E overlay: `p_meet === 0` exactly. Additive — never replaces `base`. */
  zeroChance: boolean;
  /**
   * The `p_meet` the page shows for this result: the optimizer's evaluated
   * value, or (comparison mode) the engine-selected best strategy's value.
   * Read for display; classification only compares it to `0`.
   */
  pMeet: number;
  /** `sum(K_i) === D` exactly, from validated user inputs. */
  forced: boolean;
  /** Comparison mode only: the engine-selected best strategy id and result. */
  bestStrategyKey: string | null;
  bestStrategy: StrategyResult | null;
  /**
   * Comparison mode only: every strategy co-optimal on the current λ segment
   * (more than one entry ⇒ a genuine tie), taken straight from the engine's
   * `global_switching_boundaries` — never by sorting objectives in the browser.
   */
  bestCoOptimalKeys: string[];
}

const STRATEGY_KEYS = [
  "cost_concentration",
  "speed_reliability",
  "diversified",
] as const;

function isStrategyKey(k: string): k is (typeof STRATEGY_KEYS)[number] {
  return (STRATEGY_KEYS as readonly string[]).includes(k);
}

/**
 * The raw validated decimal input strings for the capacity structural check —
 * exactly as the builder holds them, before any `Number()` round-trip. Site
 * order is irrelevant; only the sum matters.
 */
export interface RawCapacityInputs {
  /** Required capacity D. */
  required: string;
  /** Each candidate site's developable capacity K_i. */
  sites: readonly string[];
}

interface DecimalParts {
  /** Signed integer value of the numeral at `scale` decimal places. */
  value: bigint;
  /** Count of fractional digits. */
  scale: number;
}

/**
 * Parse a plain decimal numeral ("600", "0.30", "50.25", " 100.5 ", "+7",
 * ".5", "5.") into an exact scaled integer. Returns `null` for anything that
 * is not a plain decimal (scientific notation, hex, empty, other text) so the
 * caller can fall back rather than compare inexactly.
 */
function parseDecimal(raw: string): DecimalParts | null {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw.trim());
  if (!m) return null;
  const sign = m[1];
  const intPart = m[2] ?? "";
  const fracPart = m[3] ?? "";
  if (intPart === "" && fracPart === "") return null; // "", ".", "+."
  const digits = `${intPart}${fracPart}` || "0";
  const magnitude = BigInt(digits);
  return {
    value: sign === "-" ? -magnitude : magnitude,
    scale: fracPart.length,
  };
}

/**
 * Exact `sum(addends) == total` on the raw decimal strings. Returns `null`
 * when any string is not a plain decimal numeral and the exact comparison
 * cannot be made.
 */
export function decimalSumEquals(
  addends: readonly string[],
  total: string,
): boolean | null {
  const totalParts = parseDecimal(total);
  if (totalParts === null) return null;
  const addendParts: DecimalParts[] = [];
  for (const a of addends) {
    const p = parseDecimal(a);
    if (p === null) return null;
    addendParts.push(p);
  }
  const scale = Math.max(
    totalParts.scale,
    ...addendParts.map((p) => p.scale),
  );
  const atScale = (p: DecimalParts) =>
    p.value * 10n ** BigInt(scale - p.scale);
  const lhs = addendParts.reduce((acc, p) => acc + atScale(p), 0n);
  return lhs === atScale(totalParts);
}

/**
 * `sum(K_i) == D` exactly. Prefers the raw validated decimal strings; falls
 * back to numeric equality on the echoed scenario (exact for integers) when
 * strings are absent or not plain decimals.
 */
function isForcedAllocation(
  showcase: ShowcaseExport,
  raw?: RawCapacityInputs,
): boolean {
  if (raw) {
    const exact = decimalSumEquals(raw.sites, raw.required);
    if (exact !== null) return exact;
  }
  const { scenario } = showcase;
  const requiredCapacity = scenario.system.required_capacity_mw;
  const capacitySum = scenario.sites.reduce((s, site) => s + site.capacity_mw, 0);
  return (
    Number.isFinite(capacitySum) &&
    Number.isFinite(requiredCapacity) &&
    capacitySum === requiredCapacity
  );
}

/**
 * The switching-boundary segment covering `lambda` — the last segment whose
 * `lambda_start` does not exceed it. Mirrors `regimeSentence()` in
 * `DecisionPage.tsx`.
 */
function segmentForLambda(
  boundaries: GlobalSwitchingBoundary[],
  lambda: number,
): GlobalSwitchingBoundary | null {
  if (boundaries.length === 0) return null;
  let current = boundaries[0];
  for (const b of boundaries) {
    if (b.lambda_start <= lambda) current = b;
  }
  return current;
}

export function classifyResult(
  showcase: ShowcaseExport,
  rawCapacities?: RawCapacityInputs,
): ResultClassification {
  const { optimizer, scenario } = showcase;
  // Only the exact structural state is recognized. sum(K) < D never reaches
  // here (handled upstream); anything between the two exact states is a
  // silence, not a claim.
  const forced = isForcedAllocation(showcase, rawCapacities);

  if (!optimizer) {
    const lambda = scenario.system.lambda_mw_month;
    const segment = segmentForLambda(
      showcase.decision_boundaries.global_switching_boundaries,
      lambda,
    );
    const coKeys = segment
      ? segment.co_optimal && segment.co_optimal.length > 0
        ? segment.co_optimal
        : [segment.strategy]
      : [];
    const bestKey = coKeys[0] ?? null;
    const bestStrategy =
      bestKey && isStrategyKey(bestKey) ? showcase.strategies[bestKey] : null;
    return {
      base: "F",
      zeroChance: bestStrategy ? bestStrategy.p_meet === 0 : false,
      pMeet: bestStrategy ? bestStrategy.p_meet : Number.NaN,
      forced,
      bestStrategyKey: bestKey,
      bestStrategy,
      bestCoOptimalKeys: coKeys,
    };
  }

  const pMeet = optimizer.evaluated.p_meet;
  let base: ResultCaseId;
  if (forced) base = "B";
  else if (optimizer.at_lambda === 0) base = "D";
  else if (!optimizer.result.is_unique_within_tolerance) base = "C";
  else base = "A";

  return {
    base,
    zeroChance: pMeet === 0,
    pMeet,
    forced,
    bestStrategyKey: null,
    bestStrategy: null,
    bestCoOptimalKeys: [],
  };
}
