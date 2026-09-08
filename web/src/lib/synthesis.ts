/**
 * The deterministic decision-synthesis layer.
 *
 * The Decision page shows an allocation, four Key Results, a strategy
 * comparison, a delivery trajectory, and a site-level delivery strip, but
 * before this module nothing on the page said in one place what was
 * selected, why it wins under the model's own criterion, what it gains or
 * gives up against the alternatives, what schedule exposure remains, and
 * what would have to change before the decision changes. This module builds
 * that one synthesis, plus one short local-interpretation sentence for each
 * of the four major result sections, from nothing but:
 *
 *   - explicit `ShowcaseExport` result fields (already authoritative and
 *     already rendered elsewhere on the page);
 *   - the existing structural `ResultClassification` (`resultCase.ts`);
 *   - simple differences/sums of those same displayed fields;
 *   - an exact index lookup into an exported site power-availability
 *     profile at the scenario's own target month.
 *
 * Nothing here computes a new model quantity. In particular:
 *   - delivered capacity is never recomputed as `min(x_i, A_i)`;
 *   - site power profiles are never aggregated into a portfolio trajectory
 *     (the portfolio trajectory is read verbatim from the authoritative
 *     `StrategyResult.delivered_capacity_trajectory`);
 *   - the scalarized objective `J` is read, never recomputed -- it is
 *     already an authoritative field on every exported `StrategyResult`
 *     (`_PUBLIC_STRATEGY_FIELDS` in `scripts/export_showcase_data.py`), it is
 *     simply never rendered as a table column (see the model specification).
 *
 * Two layers, kept separate on purpose:
 *   3A. `extractSynthesisFacts()` -- typed facts, no public prose.
 *   3B. `computeSiteTimingFacts()` -- the one narrow, conservative timing
 *       read described above.
 *   3C. everything below "Prose rendering" -- fixed templates over those
 *       facts, nothing else.
 *
 * `classifyResult()` (`resultCase.ts`) remains the one authority on
 * structural classification; this module never re-derives it. `nSites`/
 * `mode` above are the reason bases A-D never need the large-portfolio
 * scaling: `classifyResult()` only ever returns `F` when
 * `showcase.optimizer` is `null`, which the exporter/live API only does
 * above the public application's live optimization limit
 * (`ScenarioWorkbench.tsx`'s `LIVE_OPTIMIZE_MAX_SITES`, currently 3) -- so
 * bases A/B/C/D are exactly the "optimized" (1-3 site) cases and F is
 * exactly the "compared" (4-12 site) case; the mode is simply
 * `showcase.optimizer ? "optimized" : "compared"`.
 *
 * GOLDEN-PARAGRAPH SLOT GUARANTEE: every slot function in the "golden
 * paragraph" section below returns
 * AT MOST ONE complete sentence, or `null`. There are at most six slots.
 * Because of that invariant, `whyThisDecisionSentences()` needs no final
 * `.slice()` or other semantic truncation -- a valid sensitivity or
 * mechanism slot can never be crowded out by a verbose earlier slot, since
 * no slot is ever more than one sentence to begin with. `explanation.ts`'s
 * `decisionLeadFor()` / `selectionCriterionFor()` remain the source of
 * truth for the STANDALONE decision-lead / selection-criterion text (still
 * exported and unit-tested there for any other caller), but the golden
 * paragraph does not call them directly: both render as two sentences for
 * several cases (an unfunded-site clause, a scenario-value clause), which
 * would break the one-sentence guarantee. Instead the golden paragraph's own
 * `selectedResultSentence()` / `criterionSentence()` express the identical
 * authoritative facts and identical wording, merged into one sentence with
 * a semicolon rather than a second full stop -- same meaning, shorter
 * punctuation, never re-derived from a different fact.
 */
import {
  coOptimalSpanLegend,
  joinList,
  STRATEGY_LABEL,
  type DecisionNoteLine,
} from "./explanation";
import {
  formatMw,
  formatProbability,
  formatRelativeCost,
  formatTrimmed,
} from "./format";
import type { ResultCaseId, ResultClassification } from "./resultCase";
import type {
  LambdaEnvelope,
  ShowcaseExport,
  SitePowerProfile,
  StrategyResult,
} from "../types/showcase";

/* ================================================================== */
/* 3A. Structured fact extraction -- no public prose below this point */
/* ================================================================== */

/** Whether an allocation choice was actually optimized, or the best of a
 * fixed benchmark comparison was reported instead. */
export type ResultMode = "optimized" | "compared";

export interface FundedSite {
  id: string;
  mw: number;
}

/** One benchmark strategy NOT identified as the authoritative result, kept
 * with its full result so a synthesis sentence can compare against it using
 * only already-authoritative fields. */
export interface AlternativeContrast {
  key: string;
  label: string;
  result: StrategyResult;
}

/** The next validated λ breakpoint above the scenario's own delay
 * consequence, and which sites the allocation moves between there. Mirrors
 * the shape `DecisionPage.tsx` previously computed locally; ported here so
 * the fact is computed once and shared by the sensitivity block and the
 * synthesis's own bounded "what would change this" sentence. */
export interface SensitivityFact {
  threshold: number;
  clause: string;
}

export type SiteTimingStatus = "no_power" | "full_power";

/** A conservative, exact-index read of one site's exported power
 * availability at the scenario's target month. Present
 * only when every modeled outcome for that site agrees exactly -- either
 * zero power or the site's full developable capacity -- at an index where
 * `times[k] === target_month` exactly. Never present for a site whose
 * outcomes disagree, or whose exported profile has no exact target-month
 * index. */
export interface SiteTimingFact {
  siteId: string;
  status: SiteTimingStatus;
}

export interface SynthesisFacts {
  mode: ResultMode;
  base: ResultCaseId;
  zeroChance: boolean;
  nSites: number;
  requiredCapacityMw: number;
  targetMonth: number;
  horizonMonth: number;
  lambdaMwMonth: number;
  method: "exact" | "monte_carlo";
  nRealizations: number | null;
  /** The optimizer's evaluated result, or (comparison mode) the
   * engine-selected best strategy -- the same authoritative result the rest
   * of the Decision page already reads. Null only when neither exists. */
  selected: StrategyResult | null;
  /** Sites with a positive allocation under `selected`, sorted by MW
   * descending. */
  funded: FundedSite[];
  /** Site ids with zero allocation under `selected`. */
  unfundedIds: string[];
  /** Comparison mode only: every strategy co-optimal on the engine's own
   * switching boundary at this λ (`ResultClassification.bestCoOptimalKeys`,
   * never re-derived here). */
  bestCoOptimalKeys: string[];
  /** The three named benchmark strategies other than `selected` (all three,
   * in optimized mode, since the optimizer's result is a distinct object
   * from the benchmarks; two of three in comparison mode). */
  alternatives: AlternativeContrast[];
  /** The alternative with the lowest `objective` -- the closest-competing
   * strategy not returned as the result, by the model's own criterion. Null
   * only when there are no alternatives to compare against. */
  runnerUp: AlternativeContrast | null;
  sensitivity: SensitivityFact | null;
  timing: SiteTimingFact[];
}

/**
 * `sensitivityMoveFor()`'s inner search: the first breakpoint strictly above
 * `current`, phrased as a move of capacity off the sites that lose share
 * onto the sites that gain it. Ported verbatim from the Decision page's
 * former `nextDelayConsequenceMove()` -- ownership moves here so the fact
 * is computed once and shared by the sensitivity
 * block's own rendering and this module's bounded sensitivity sentence.
 */
function nextDelayConsequenceMove(
  envelope: LambdaEnvelope,
  current: number,
  showcase: ShowcaseExport,
): SensitivityFact | null {
  const above = envelope.breakpoints
    .filter((b) => b.lam_estimate > current)
    .sort((a, b) => a.lam_estimate - b.lam_estimate);
  const bp = above[0];
  if (!bp) return null;

  const ids = showcase.scenario.sites.map((s) => s.id);
  const off: string[] = [];
  const onto: string[] = [];
  for (const id of ids) {
    const delta =
      (bp.right_vertex_allocation[id] ?? 0) -
      (bp.left_vertex_allocation[id] ?? 0);
    if (delta > 0.5) onto.push(id);
    else if (delta < -0.5) off.push(id);
  }

  const clause =
    off.length && onto.length
      ? `shifting capacity from ${joinList(off.map((id) => `Site ${id}`))} toward ${joinList(onto.map((id) => `Site ${id}`))}`
      : "shifting the allocation between sites";
  return { threshold: bp.lam_estimate, clause };
}

/**
 * The validated next delay-consequence breakpoint for this result, or
 * `null` when there is none to report. The envelope is a precomputed,
 * validated artifact of one curated example portfolio and is never
 * recomputed live (see the former `DecisionPage.tsx` docstring this
 * replaces): its presence on `showcase` is the whole gate. Never fires for a
 * forced allocation (case B), where the allocation cannot move at all.
 */
export function sensitivityMoveFor(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): SensitivityFact | null {
  const envelope = showcase.lambda_envelope;
  if (!envelope || classification.base === "B") return null;
  return nextDelayConsequenceMove(
    envelope,
    showcase.scenario.system.lambda_mw_month,
    showcase,
  );
}

/**
 * 3B. Conservative timing facts.
 *
 * For each exported site power profile, locate the index `k` where
 * `times[k] === target_month` EXACTLY. When found, and every modeled outcome
 * agrees exactly at that index -- all zero, or all equal to the site's own
 * full developable capacity -- record that as a `SiteTimingFact`. Any site
 * without an exact target-month index, or whose outcomes disagree there
 * (genuine timing uncertainty at that exact month), is silently omitted:
 * this is deliberately a narrow, conservative read, never an inference.
 *
 * This is a statement about exported POWER AVAILABILITY only. It is never
 * combined with the allocation to state a delivered-capacity claim -- that
 * combination is exactly what this module must never compute (the
 * `min(x_i, A_i)` prohibition).
 */
export function computeSiteTimingFacts(
  profiles: readonly SitePowerProfile[],
  targetMonth: number,
): SiteTimingFact[] {
  const facts: SiteTimingFact[] = [];
  for (const profile of profiles) {
    const k = profile.times.indexOf(targetMonth);
    if (k === -1) continue; // no exact target-month sample in this export
    const valuesAtTarget = profile.outcomes.map((o) => o.profile_mw[k]);
    if (valuesAtTarget.length === 0) continue;
    if (valuesAtTarget.every((v) => v === 0)) {
      facts.push({ siteId: profile.site_id, status: "no_power" });
    } else if (valuesAtTarget.every((v) => v === profile.capacity_mw)) {
      facts.push({ siteId: profile.site_id, status: "full_power" });
    }
    // Otherwise the outcomes disagree at this exact month -- a real timing
    // uncertainty, not a gap in the data -- so no fact is recorded.
  }
  return facts;
}

/** Every benchmark strategy other than the one identified by `selectedKey`
 * (or every strategy, when `selectedKey` is null -- the optimized-mode case,
 * where the optimizer's own result is a distinct object from the three
 * named benchmarks). */
function alternativesFor(
  showcase: ShowcaseExport,
  selectedKey: string | null,
): AlternativeContrast[] {
  return Object.entries(showcase.strategies)
    .filter(([key]) => key !== selectedKey)
    .map(([key, result]) => ({
      key,
      label: STRATEGY_LABEL[key] ?? key,
      result: result as StrategyResult,
    }));
}

/** The alternative with the lowest `objective` -- the model's own frozen
 * criterion (see the model specification), already an authoritative field on
 * every exported `StrategyResult`; never recomputed here. */
function runnerUpOf(
  alternatives: readonly AlternativeContrast[],
): AlternativeContrast | null {
  if (alternatives.length === 0) return null;
  return alternatives.reduce((best, a) =>
    a.result.objective < best.result.objective ? a : best,
  );
}

/**
 * Extract every typed fact the prose layer below is allowed to read. Pure:
 * no formatting, no sentences, no site-count-dependent narration decisions.
 */
export function extractSynthesisFacts(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): SynthesisFacts {
  const { optimizer, scenario, scenario_set } = showcase;
  const { system, sites } = scenario;

  const mode: ResultMode = optimizer ? "optimized" : "compared";
  const selected: StrategyResult | null = optimizer
    ? optimizer.evaluated
    : classification.bestStrategy;

  const funded: FundedSite[] = [];
  const unfundedIds: string[] = [];
  if (selected) {
    for (const site of sites) {
      const mw = selected.allocation[site.id] ?? 0;
      if (mw > 0) funded.push({ id: site.id, mw });
      else unfundedIds.push(site.id);
    }
    funded.sort((a, b) => b.mw - a.mw);
  }

  const selectedKey = optimizer ? null : classification.bestStrategyKey;
  const alternatives = alternativesFor(showcase, selectedKey);

  return {
    mode,
    base: classification.base,
    zeroChance: classification.zeroChance,
    nSites: sites.length,
    requiredCapacityMw: system.required_capacity_mw,
    targetMonth: system.target_month,
    horizonMonth: system.horizon_month,
    lambdaMwMonth: system.lambda_mw_month,
    method: scenario_set.method,
    nRealizations: scenario_set.n_realizations ?? null,
    selected,
    funded,
    unfundedIds,
    bestCoOptimalKeys: classification.bestCoOptimalKeys,
    alternatives,
    runnerUp: runnerUpOf(alternatives),
    sensitivity: sensitivityMoveFor(showcase, classification),
    timing: computeSiteTimingFacts(showcase.site_power_profiles, system.target_month),
  };
}

/* ================================================================== */
/* 3C. Prose rendering -- fixed templates over the facts above only    */
/* ================================================================== */

/**
 * Above this many funded (or unfunded) sites, name only the top few and
 * summarize the rest by a plain MW sum (a deliberate presentation
 * boundary):
 *
 *   - the summed MW comes ONLY from the authoritative `selected.allocation`
 *     values this module already reads for `facts.funded` -- no other
 *     source, and no per-site power-profile arithmetic;
 *   - it is presentation-only: it never feeds back into optimization,
 *     structural classification (`resultCase.ts` owns that, unchanged), a
 *     delivered-capacity figure, or any objective/criterion computation;
 *   - it never supports a causal claim about why those sites were or were
 *     not funded -- it is a total, not a reason.
 *
 * A 12-site synthesis must read about as long as a 3-site one.
 */
const MAX_NAMED_SITES = 3;

function describeFundedScaled(facts: SynthesisFacts): string {
  const all = facts.funded;
  if (all.length === 0) return "no site";
  if (all.length <= MAX_NAMED_SITES) {
    return joinList(all.map((s) => `Site ${s.id} ${formatMw(s.mw)}`));
  }
  const named = all.slice(0, MAX_NAMED_SITES);
  const rest = all.slice(MAX_NAMED_SITES);
  const restMw = rest.reduce((sum, s) => sum + s.mw, 0);
  const namedText = named.map((s) => `Site ${s.id} ${formatMw(s.mw)}`).join(", ");
  return (
    `${namedText}, and ${rest.length} other site${rest.length === 1 ? "" : "s"} ` +
    `carrying the remaining ${formatMw(restMw)}`
  );
}

function describeUnfundedScaled(facts: SynthesisFacts): string | null {
  const ids = facts.unfundedIds;
  if (ids.length === 0) return null;
  // "take(s) none" -- the same verb `decisionLeadFor()` uses -- so this
  // clause reads identically whether it is naming one site or summarizing
  // several (same meaning, one voice across every base).
  if (ids.length <= MAX_NAMED_SITES) {
    return `${joinList(ids.map((id) => `Site ${id}`))} take${ids.length === 1 ? "s" : ""} none`;
  }
  return `${ids.length} sites take none`;
}

/**
 * Slot 1 -- what was selected, in exactly one sentence for every base.
 *
 * Expresses the same authoritative fact and the same wording
 * `explanation.ts`'s `decisionLeadFor()` uses (that function remains the
 * source of truth for the STANDALONE decision-lead text, still exported and
 * unit-tested there), but merged into one sentence with a semicolon rather
 * than `decisionLeadFor()`'s second full stop for an unfunded site --
 * `decisionLeadFor()` is not called here because that would reintroduce the
 * two-sentence rendering the golden paragraph's slot guarantee forbids. The
 * large-portfolio scaling (`describeFundedScaled()`/`describeUnfundedScaled()`)
 * applies uniformly; it is a no-op for the <=3-site bases (A-D), which never
 * exceed `MAX_NAMED_SITES` sites to begin with.
 */
function selectedResultSentence(facts: SynthesisFacts): string | null {
  if (facts.funded.length === 0) return null;
  const where = describeFundedScaled(facts);
  const unfunded = describeUnfundedScaled(facts);
  const tail = unfunded ? `; ${unfunded}.` : ".";

  if (facts.base === "B") {
    return `Every candidate site is developed in full: ${where}${tail}`;
  }
  if (facts.mode === "compared") {
    const labels = facts.bestCoOptimalKeys.map((k) => STRATEGY_LABEL[k] ?? k);
    const which =
      labels.length > 1
        ? `${joinList(labels)} are tied as the best of the strategies compared`
        : labels.length === 1
          ? `${labels[0]} is the best of the strategies compared`
          : "The best of the strategies compared";
    return `${which}, and it puts capacity on ${where}${tail}`;
  }
  return `Capacity goes to ${where}${tail}`;
}

/**
 * Slot 2 -- the criterion, and why the result wins under it, in exactly one
 * sentence for every base.
 *
 * For bases A and C this expresses the same authoritative facts and the
 * same wording `explanation.ts`'s `selectionCriterionFor()` uses (also
 * still exported and unit-tested there for any other caller), merged into
 * one sentence with a semicolon in place of its second full stop -- same
 * reason `selectedResultSentence()` does not call `decisionLeadFor()`
 * directly. Bases B/D/F write their own single-sentence explanations, since
 * `selectionCriterionFor()` is deliberately null for those (nothing was
 * selected under a criterion in case B, and cases D/F already have their own
 * single-sentence framing below). Comparison-mode wording here is checked by
 * `assertNoComparisonModeBannedConstructions()` and must never imply a
 * global optimum, an optimized/optimal allocation, or an optimizer
 * recommendation.
 */
function criterionSentence(facts: SynthesisFacts): string | null {
  if (facts.base === "A" || facts.base === "C") {
    const consequence = formatTrimmed(facts.lambdaMwMonth, 4);
    const closing =
      facts.base === "C"
        ? "the allocation shown is one of those with the lowest combined cost and delay total"
        : "the allocation shown has the lowest combined cost and delay total";
    return (
      `Feasible allocations are compared on relative development cost plus ` +
      `the delay consequence applied to the expected delay burden; at this ` +
      `scenario's delay consequence of ${consequence}, ${closing}.`
    );
  }
  if (facts.base === "B") {
    return (
      "The required capacity forces every developable megawatt into use " +
      "here, so there is no allocation to prefer over another."
    );
  }
  if (facts.base === "D") {
    return (
      "The delay consequence is set to 0 in this scenario, so the " +
      "allocation minimizes development cost only and does not weigh the " +
      "schedule at all."
    );
  }
  // F -- comparison mode. Never claims a search over every feasible
  // allocation, a global optimum, or an optimizer preference.
  const tied = facts.bestCoOptimalKeys.length > 1;
  return (
    `The model compares three named strategies here and returns ` +
    `${
      tied
        ? "the tied lowest-combined-cost-and-delay result among them"
        : "the one with the lowest combined development cost and delay-" +
          "consequence-weighted expected delay burden among them"
    }, ` +
    "not a search over every feasible allocation."
  );
}

const OBJECTIVE_TIE_EPS = 1e-6;
const PROBABILITY_TIE_EPS = 1e-9;
const COST_TIE_EPS = 1e-6;

/**
 * Slot 3 / Choice-comparison local sentence -- the important gain or give-up
 * against the closest-competing alternative (`facts.runnerUp`), using only
 * already-authoritative fields and their simple differences. Never renders
 * for a forced allocation (case B, where every strategy reduces to the same
 * allocation and there is nothing to trade off), and never renders when the
 * runner-up is actually tied on the model's own criterion (that is a
 * co-optimal fact, already carried by `bestCoOptimalKeys`/case C, not a
 * tradeoff). Never calls the alternative "wrong" for leading on a visible
 * diagnostic -- it states the combined-criterion fact that keeps it from
 * being the result returned here.
 */
export function tradeoffSentence(facts: SynthesisFacts): string | null {
  if (facts.base === "B") return null;
  const { selected, runnerUp } = facts;
  if (!selected || !runnerUp) return null;
  if (
    Math.abs(runnerUp.result.objective - selected.objective) <= OBJECTIVE_TIE_EPS
  ) {
    return null; // co-optimal alternative -- no material tradeoff to state
  }

  const pMeetDelta = runnerUp.result.p_meet - selected.p_meet;
  const costDelta = selected.development_cost - runnerUp.result.development_cost;

  if (pMeetDelta > PROBABILITY_TIE_EPS) {
    return (
      `${runnerUp.label} reaches a higher chance of meeting the target ` +
      `date (${formatProbability(runnerUp.result.p_meet)} versus ` +
      `${formatProbability(selected.p_meet)} here), but it carries a ` +
      `higher combined cost-and-delay total, so it is not the result ` +
      `returned here.`
    );
  }
  if (costDelta < -COST_TIE_EPS) {
    return (
      `Against ${runnerUp.label}, the next-best strategy compared, this ` +
      `result costs ${formatRelativeCost(-costDelta)} less in relative ` +
      `development cost while not trailing it on the chance of meeting ` +
      `the target date.`
    );
  }
  return null;
}

/**
 * Slot 4 / Key-Results local sentence -- one target-date interpretation,
 * method-honest about exact versus Monte Carlo evaluation. Deliberately
 * reused as-is for both the Key Results section and the golden paragraph's
 * "remaining exposure" slot: this one overlap is allowed ("each major
 * result section must make sense
 * independently"), so this is one sentence with two homes rather than two
 * near-duplicate sentences maintained separately.
 *
 * Exact and Monte Carlo evaluation get genuinely different wording, not the
 * same sentence with a parenthetical appended: exact
 * enumeration covers the whole outcome space, so "every outcome" / "no
 * evaluated outcome" is a population statement. A Monte Carlo run only ever
 * observed a finite sample, so the sentence says exactly that -- "all N
 * sampled outcomes" / "none of the N sampled outcomes" -- and the
 * intermediate case is stated as a sampled ESTIMATE, never as an exact
 * fraction. Nothing here calls a sampled result exact, and "all N sampled
 * outcomes reached..." is never read as a population guarantee -- it is a
 * fact about the sample actually drawn.
 */
export function keyResultsSentence(facts: SynthesisFacts): string | null {
  if (!facts.selected) return null;
  const p = facts.selected.p_meet;
  const isMonteCarlo = facts.method === "monte_carlo" && !!facts.nRealizations;
  const n = facts.nRealizations;
  const shortfall = formatMw(facts.selected.expected_shortfall_mw);

  if (p === 1) {
    return isMonteCarlo
      ? `All ${n} sampled outcomes reached the full requirement by month ` +
          `${facts.targetMonth}; the sampled estimate carries no expected ` +
          `target-date shortfall.`
      : `Across the modeled outcomes, the full requirement is met by month ` +
          `${facts.targetMonth} in every outcome, with no expected ` +
          `target-date shortfall.`;
  }
  if (p === 0) {
    return isMonteCarlo
      ? `None of the ${n} sampled outcomes reached the full requirement by ` +
          `month ${facts.targetMonth}; the expected shortfall shows the ` +
          `average capacity still missing on that date.`
      : `No modeled outcome reaches the full requirement by month ` +
          `${facts.targetMonth}; the expected shortfall shows the average ` +
          `capacity still missing on that date.`;
  }
  return isMonteCarlo
    ? `The sampled estimate of meeting the target date is ` +
        `${formatProbability(p)}, based on ${n} sampled outcomes, with an ` +
        `average ${shortfall} shortfall on that date.`
    : `The result reaches the full requirement by month ${facts.targetMonth} ` +
        `in ${formatProbability(p)} of modeled outcomes, with an average ` +
        `${shortfall} shortfall on that date.`;
}

/** The unfunded site (if any) with no power at the target month, else the
 * top funded site (if any) with full power there -- the one mechanism fact,
 * when one is available, most relevant to why the decision looks the way it
 * does. Null when no site's outcomes agree exactly at the target month. */
function pickMechanismTimingFact(facts: SynthesisFacts): SiteTimingFact | null {
  const unfundedNoPower = facts.timing.find(
    (t) => t.status === "no_power" && facts.unfundedIds.includes(t.siteId),
  );
  if (unfundedNoPower) return unfundedNoPower;
  const fundedFullPower = facts.timing.find(
    (t) => t.status === "full_power" && facts.funded.some((f) => f.id === t.siteId),
  );
  return fundedFullPower ?? null;
}

/**
 * Slot 5 -- the one conservative mechanism fact, only when one is supported
 * by an exact target-month sample. States exported power
 * availability only, never delivered capacity. Shared verbatim with
 * `siteDeliveryMeaning()`'s local sentence below -- one fact, two homes,
 * same reuse discipline `keyResultsSentence()` already documents for the
 * exposure slot.
 */
export function mechanismFactSentence(facts: SynthesisFacts): string | null {
  const fact = pickMechanismTimingFact(facts);
  if (!fact) return null;
  return fact.status === "no_power"
    ? `Site ${fact.siteId} has no power available at month ${facts.targetMonth} in any modeled outcome.`
    : `Site ${fact.siteId} has its full site capacity available at month ${facts.targetMonth} in every modeled outcome.`;
}

/** Slot 6 -- what would change the decision, only with a validated λ
 * envelope. */
export function sensitivitySentence(facts: SynthesisFacts): string | null {
  if (!facts.sensitivity) return null;
  return (
    `Above a delay consequence of ${formatTrimmed(facts.sensitivity.threshold, 3)}, ` +
    `the allocation would change, ${facts.sensitivity.clause}.`
  );
}

/**
 * Every slot the golden paragraph can render, in priority order. Exported
 * so a test can assert structurally over "the six slot functions" without
 * hard-coding their names, and so this is the one place the slot list is
 * defined (`whyThisDecisionSentences()` below and any bounded-length test
 * both read it from here).
 */
export const GOLDEN_PARAGRAPH_SLOTS: readonly ((facts: SynthesisFacts) => string | null)[] =
  [
    selectedResultSentence,
    criterionSentence,
    tradeoffSentence,
    keyResultsSentence,
    mechanismFactSentence,
    sensitivitySentence,
  ];

/**
 * The "Why this decision" golden paragraph: every slot in
 * `GOLDEN_PARAGRAPH_SLOTS`, in priority order, included only
 * when it returns a sentence. No slicing, truncation, or sentence-splitting
 * is applied here -- each slot function is independently guaranteed (and
 * tested, see `synthesis.spec.ts`) to return at most one complete
 * sentence, and there are at most six slots, so the result is bounded by
 * construction rather than by cutting rendered text. A verbose slot can
 * never crowd out a later one: every slot that has a fact to report gets
 * its sentence.
 */
export function whyThisDecisionSentences(facts: SynthesisFacts): string[] {
  return GOLDEN_PARAGRAPH_SLOTS.map((slot) => slot(facts)).filter(
    (s): s is string => !!s && s.trim().length > 0,
  );
}

/** Choice-comparison "what this means for your scenario" sentence: which row wins, plus the one distinguishing tradeoff. */
export function choiceComparisonMeaning(facts: SynthesisFacts): string | null {
  if (facts.base === "B" || !facts.selected) return null;
  const winnerLabel =
    facts.mode === "compared"
      ? STRATEGY_LABEL[facts.bestCoOptimalKeys[0] ?? ""] ??
        "The best of the strategies compared"
      : "The result shown above";
  const lead = `${winnerLabel} wins under the model's combined cost-and-delay criterion.`;
  const trade = tradeoffSentence(facts);
  return trade ? `${lead} ${trade}` : lead;
}

/**
 * Delivery-outlook "what this means for your scenario" sentence: a direct index read of the authoritative trajectory at the
 * target month, compared to the required capacity by inequality only --
 * never by subtraction, which would silently compute a different quantity
 * than the authoritative `expected_shortfall_mw` (the expectation of a
 * per-outcome maximum is not the same number as the required capacity minus
 * the expected trajectory value). No aggregation of site-level profiles.
 */
export function deliveryOutlookSentence(facts: SynthesisFacts): string | null {
  if (!facts.selected) return null;
  const idx = facts.selected.times.indexOf(facts.targetMonth);
  if (idx === -1) return null;
  const atTarget = facts.selected.delivered_capacity_trajectory[idx];
  const reaches = atTarget >= facts.requiredCapacityMw - 1e-6;
  return reaches
    ? `The plotted expected-capacity line reaches the full ${formatMw(facts.requiredCapacityMw)} requirement by month ${facts.targetMonth}.`
    : `Through month ${facts.targetMonth}, the plotted expected-capacity line remains below the full ${formatMw(facts.requiredCapacityMw)} requirement.`;
}

/** Site-delivery "what this means for your scenario" sentence: the one conservative timing fact, when supported. Identical to the
 * golden paragraph's own mechanism slot -- see `mechanismFactSentence()`. */
export function siteDeliveryMeaning(facts: SynthesisFacts): string | null {
  return mechanismFactSentence(facts);
}

/** Counts sentences in rendered prose for the bounded-length gate. Splits
 * on sentence-ending punctuation followed by whitespace-then-uppercase or by
 * end of string, so it is not fooled by the "rel. units" unit abbreviation
 * or by a decimal point inside a formatted number (never followed by
 * whitespace-then-uppercase, and never at the very end unless it is in fact
 * the sentence's own final character). */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed
    .split(/[.!?]+(?=\s+[A-Z]|\s*$)/)
    .filter((part) => part.trim().length > 0).length;
}

/** The complete decision synthesis for one result. */
export interface DecisionSynthesis {
  facts: SynthesisFacts;
  /** The "Why this decision" golden paragraph, already joined. */
  whyThisDecision: string;
  keyResultsInterpretation: string | null;
  choiceComparisonInterpretation: string | null;
  deliveryOutlookInterpretation: string | null;
  siteDeliveryInterpretation: string | null;
  /** Case C only: the bar-legend sentence `decisionNoteFor()` no longer
   * needs to carry on the page, since its "several allocations tie"
   * conclusion is now in `whyThisDecision` -- see `coOptimalSpanLegend()`. */
  coOptimalSpanLegend: DecisionNoteLine | null;
}

/** Build the complete synthesis for one classified result. The one function
 * `DecisionPage.tsx` calls. */
export function synthesizeDecision(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): DecisionSynthesis {
  const facts = extractSynthesisFacts(showcase, classification);
  const sentences = whyThisDecisionSentences(facts);
  return {
    facts,
    whyThisDecision: sentences.join(" "),
    keyResultsInterpretation: keyResultsSentence(facts),
    choiceComparisonInterpretation: choiceComparisonMeaning(facts),
    deliveryOutlookInterpretation: deliveryOutlookSentence(facts),
    siteDeliveryInterpretation: siteDeliveryMeaning(facts),
    coOptimalSpanLegend:
      classification.base === "C" ? coOptimalSpanLegend() : null,
  };
}

/* ================================================================== */
/* Mode-aware comparison-mode banned-construction gate */
/* ================================================================== */

/**
 * Optimization-claim language that is legitimate for a genuinely optimized
 * 1-3 site result but must never describe a 4-12 site COMPARISON-mode
 * result: comparison mode reports the best of three named benchmark
 * strategies, never a search over every feasible allocation. Kept separate
 * from `explanation.ts`'s global `BANNED_CONSTRUCTIONS` (unsupported
 * causal/solver-attribution language, banned in every mode) precisely
 * because these phrases are NOT globally unsafe -- `criterionSentence()`'s
 * own optimized-mode branches rely on the truthful "lowest combined cost and
 * delay total" wording (the same wording `explanation.ts`'s
 * `selectionCriterionFor()` uses), and nothing here forbids that for bases
 * A/C.
 */
export const COMPARISON_MODE_BANNED_CONSTRUCTIONS: readonly string[] = [
  "global optimum",
  "globally optimal",
  "optimal allocation",
  "optimized allocation",
  "the optimal",
  "best possible allocation",
];

/**
 * Word-pattern bans, checked in addition to the literal phrases above.
 * Patterns rather than a fixed phrase list because the offending word can
 * take several grammatical forms ("recommends"/"recommended"/
 * "recommendation", "optimal"/"optimally") that a plain substring list would
 * miss one at a time (raised in independent review).
 */
const COMPARISON_MODE_WORD_PATTERNS: readonly RegExp[] = [
  /\boptimal(?:ly)?\b/i,
  /\boptimized\b/i,
  /\boptimizer(?:'s)? recommend(?:s|ed|ation)?\b/i,
];

/** Every comparison-mode-prohibited construction present in `text`. */
export function findComparisonModeBannedConstructions(text: string): string[] {
  const lower = text.toLowerCase();
  const phraseHits = COMPARISON_MODE_BANNED_CONSTRUCTIONS.filter((p) =>
    lower.includes(p.toLowerCase()),
  );
  const wordHits = COMPARISON_MODE_WORD_PATTERNS.filter((re) => re.test(text)).map(
    (re) => re.source,
  );
  return [...phraseHits, ...wordHits];
}

/** Throws if any comparison-mode text implies a global optimum, an
 * optimized/optimal allocation, or an optimizer recommendation. Intended for
 * text actually rendered while `mode === "compared"` -- optimized-mode text
 * (bases A/C, 1-3 sites) is permitted to use this vocabulary truthfully and
 * must never be checked against this gate. */
export function assertNoComparisonModeBannedConstructions(
  texts: readonly string[],
): void {
  const hits = texts.flatMap((t) =>
    findComparisonModeBannedConstructions(t).map((f) => `"${f}" in: ${t}`),
  );
  if (hits.length > 0) {
    throw new Error(
      `Comparison-mode text implies unsupported optimization language:\n${hits.join("\n")}`,
    );
  }
}
