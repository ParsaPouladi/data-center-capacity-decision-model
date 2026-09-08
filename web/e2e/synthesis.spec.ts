import { test, expect } from "@playwright/test";
import baselineFile from "./fixtures/baseline_n3.json" with { type: "json" };
import extendedFile from "./fixtures/extended_n6.json" with { type: "json" };
import largerFile from "./fixtures/larger_n10.json" with { type: "json" };
import cheapSiteFile from "../public/data/cheap_site_risky_schedule.json" with { type: "json" };
import { classifyResult, type ResultClassification } from "../src/lib/resultCase";
import { assertNoBannedConstructions } from "../src/lib/explanation";
import {
  assertNoComparisonModeBannedConstructions,
  choiceComparisonMeaning,
  computeSiteTimingFacts,
  countSentences,
  deliveryOutlookSentence,
  extractSynthesisFacts,
  findComparisonModeBannedConstructions,
  GOLDEN_PARAGRAPH_SLOTS,
  keyResultsSentence,
  siteDeliveryMeaning,
  synthesizeDecision,
  tradeoffSentence,
  whyThisDecisionSentences,
  type SynthesisFacts,
} from "../src/lib/synthesis";
import type {
  LambdaEnvelope,
  ShowcaseExport,
  SitePowerProfile,
  StrategyResult,
} from "../src/types/showcase";

/**
 * Targeted gate — the deterministic decision synthesis (`lib/synthesis.ts`).
 * Pure-logic assertions; no browser, no live API. Run with
 * `--config e2e/logic.playwright.config.ts`.
 *
 * Real committed exports cover the structural cases that occur in practice:
 * `baseline_n3` is the case-D (λ=0) / zero-chance run with an envelope;
 * `extended_n6` / `larger_n10` are the N>3 comparison-mode runs (exact and
 * Monte Carlo respectively); `cheap_site_risky_schedule.json` is the case-A
 * optimized run with a validated λ envelope. Cases B and C, the
 * High->Very High counterintuitive scenario, and the timing-fact edge cases
 * are exercised with minimal synthetic `ShowcaseExport` objects -- the same
 * convention `result-explanation.spec.ts` uses for the same reason: they
 * are classification/fact-extraction inputs, not new engine fixtures. No
 * model quantity is computed in this file or in the module under test.
 */

const realShowcase = (file: unknown): ShowcaseExport =>
  (file as { showcase: unknown }).showcase as ShowcaseExport;

const BASELINE = realShowcase(baselineFile); // case D, zero-chance, envelope
const EXTENDED = realShowcase(extendedFile); // case F, exact, no envelope, N=6
const LARGER = realShowcase(largerFile); // case F, Monte Carlo, zero-chance, N=10
const CHEAP_SITE = realShowcase(cheapSiteFile); // case A, envelope, N=3

/* ------------------------------------------------------------------ */
/* Synthetic ShowcaseExport builder -- optimized mode (bases A/B/C/D) */
/* ------------------------------------------------------------------ */

interface FakeOptimizedOpts {
  D: number;
  target?: number;
  horizon?: number;
  atLambda: number;
  capacities: Record<string, number>;
  allocation: Record<string, number>;
  isUnique?: boolean;
  pMeet: number;
  expectedShortfall?: number;
  developmentCost?: number;
  expectedDelayBurden?: number;
  objective?: number;
  method?: "exact" | "monte_carlo";
  nRealizations?: number;
  sitePowerProfiles?: SitePowerProfile[];
  strategies?: Record<string, StrategyResult>;
  lambdaEnvelope?: LambdaEnvelope;
}

function fakeStrategyResult(
  allocation: Record<string, number>,
  overrides: Partial<StrategyResult> = {},
): StrategyResult {
  return {
    allocation,
    development_cost: 0,
    p_meet: 0,
    expected_shortfall_mw: 0,
    expected_delay_burden_mw_months: 0,
    objective: 0,
    times: [],
    delivered_capacity_trajectory: [],
    ...overrides,
  };
}

function fakeOptimized(o: FakeOptimizedOpts): ShowcaseExport {
  const siteIds = Object.keys(o.capacities);
  const evaluated = fakeStrategyResult(o.allocation, {
    development_cost: o.developmentCost ?? 0,
    p_meet: o.pMeet,
    expected_shortfall_mw: o.expectedShortfall ?? 0,
    expected_delay_burden_mw_months: o.expectedDelayBurden ?? 0,
    objective: o.objective ?? 0,
    times: [0, o.target ?? 30],
    delivered_capacity_trajectory: [0, o.pMeet * o.D],
  });
  const showcase = {
    scenario: {
      system: {
        required_capacity_mw: o.D,
        target_month: o.target ?? 30,
        horizon_month: o.horizon ?? 72,
        lambda_mw_month: o.atLambda,
      },
      sites: siteIds.map((id) => ({
        id,
        capacity_mw: o.capacities[id],
        cost_per_mw: 1,
        burden_state: 1,
        uncertainty_state: 1,
      })),
    },
    scenario_set: {
      method: o.method ?? "exact",
      n_realizations: o.nRealizations ?? 27,
    },
    site_power_profiles: o.sitePowerProfiles ?? [],
    strategies: o.strategies ?? {
      cost_concentration: fakeStrategyResult(o.allocation, {
        objective: (o.objective ?? 0) + 10,
        p_meet: o.pMeet,
      }),
      speed_reliability: fakeStrategyResult(o.allocation, {
        objective: (o.objective ?? 0) + 20,
        p_meet: o.pMeet,
      }),
      diversified: fakeStrategyResult(o.allocation, {
        objective: (o.objective ?? 0) + 15,
        p_meet: o.pMeet,
      }),
    },
    decision_boundaries: {
      pairwise_break_even_lambda: [],
      global_switching_boundaries: [],
      global_switching_has_cooptimal_segments: false,
    },
    optimizer: {
      at_lambda: o.atLambda,
      result: {
        site_ids: siteIds,
        allocation: o.allocation,
        is_unique_within_tolerance: o.isUnique ?? true,
        coordinate_bounds: {},
        cooptimality_tolerance: 1e-8,
      },
      evaluated,
    },
    lambda_envelope: o.lambdaEnvelope ?? null,
  };
  return showcase as unknown as ShowcaseExport;
}

/* ------------------------------------------------------------------ */
/* Site power profile builder -- for the conservative timing facts    */
/* ------------------------------------------------------------------ */

function fakeProfile(
  siteId: string,
  capacityMw: number,
  times: number[],
  outcomeValuesAtEachTime: number[][],
): SitePowerProfile {
  return {
    site_id: siteId,
    capacity_mw: capacityMw,
    burden_state: 1,
    uncertainty_state: 1,
    tau1_bar: 18,
    tau2_bar: 24,
    alpha: 0.5,
    times,
    outcomes: outcomeValuesAtEachTime.map((profile_mw, i) => ({
      delay_months: i,
      probability: 1 / outcomeValuesAtEachTime.length,
      tau1: 18,
      tau2: 24,
      profile_mw,
    })),
  };
}

/* ================================================================== */
/* computeSiteTimingFacts -- 3B conservative timing facts              */
/* ================================================================== */

test("timing fact: every outcome exactly zero at the exact target-month index -> no_power", () => {
  const profile = fakeProfile(
    "A",
    500,
    [0, 12, 36],
    [
      [0, 0, 0],
      [0, 0, 0],
    ],
  );
  const facts = computeSiteTimingFacts([profile], 36);
  expect(facts).toEqual([{ siteId: "A", status: "no_power" }]);
});

test("timing fact: every outcome exactly full capacity at the exact target-month index -> full_power", () => {
  const profile = fakeProfile(
    "B",
    300,
    [0, 12, 36],
    [
      [0, 150, 300],
      [0, 0, 300],
    ],
  );
  const facts = computeSiteTimingFacts([profile], 36);
  expect(facts).toEqual([{ siteId: "B", status: "full_power" }]);
});

test("timing fact: outcomes disagree at the exact target month -> omitted, never invented", () => {
  const profile = fakeProfile(
    "C",
    300,
    [0, 12, 36],
    [
      [0, 150, 300],
      [0, 0, 0],
    ],
  );
  expect(computeSiteTimingFacts([profile], 36)).toEqual([]);
});

test("timing fact: no exact target-month sample in the export -> omitted", () => {
  const profile = fakeProfile(
    "D",
    300,
    [0, 12, 24], // no sample at month 36
    [
      [0, 150, 300],
      [0, 0, 300],
    ],
  );
  expect(computeSiteTimingFacts([profile], 36)).toEqual([]);
});

test("timing fact never states a delivered-capacity number: only 'no_power' / 'full_power' status", () => {
  const facts = computeSiteTimingFacts(
    [fakeProfile("A", 500, [36], [[0]])],
    36,
  );
  for (const f of facts) {
    expect(["no_power", "full_power"]).toContain(f.status);
  }
});

/* ================================================================== */
/* extractSynthesisFacts -- mode detection                             */
/* ================================================================== */

test("mode: bases A/B/C/D are optimized (optimizer present); F is compared (optimizer null)", () => {
  const a = classifyResult(CHEAP_SITE);
  expect(a.base).toBe("A");
  expect(extractSynthesisFacts(CHEAP_SITE, a).mode).toBe("optimized");

  const f = classifyResult(EXTENDED);
  expect(f.base).toBe("F");
  expect(extractSynthesisFacts(EXTENDED, f).mode).toBe("compared");
});

test("funded sites are sorted by MW descending; zero-MW sites are unfunded", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 50, B: 200, C: 0 },
    pMeet: 0.5,
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  expect(facts.funded).toEqual([
    { id: "B", mw: 200 },
    { id: "A", mw: 50 },
  ]);
  expect(facts.unfundedIds).toEqual(["C"]);
});

/* ================================================================== */
/* Bounded length -- every case, approximately <= 6 sentences          */
/* ================================================================== */

const boundedCases: Array<[string, ShowcaseExport]> = [
  ["baseline_n3 (D, zero-chance, envelope)", BASELINE],
  ["extended_n6 (F, exact, no envelope, N=6)", EXTENDED],
  ["larger_n10 (F, Monte Carlo, zero-chance, N=10)", LARGER],
  ["cheap_site_risky_schedule (A, envelope, N=3)", CHEAP_SITE],
];

for (const [label, sc] of boundedCases) {
  test(`bounded length: ${label} produces at most 6 sentences`, () => {
    const c = classifyResult(sc);
    const facts = extractSynthesisFacts(sc, c);
    const sentences = whyThisDecisionSentences(facts);
    expect(sentences.length).toBeLessThanOrEqual(6);
    const joined = sentences.join(" ");
    expect(countSentences(joined)).toBeLessThanOrEqual(6);
  });
}

test("countSentences is not fooled by 'rel. units' or a decimal point mid-sentence", () => {
  const text =
    "The selected allocation costs 12.50 rel. units less. It also reaches 40.0% here.";
  expect(countSentences(text)).toBe(2);
});

/* ================================================================== */
/* Case B -- forced allocation: no preference language                 */
/* ================================================================== */

test("case B: golden paragraph states the requirement forces full use, with no preference language", () => {
  const sc = fakeOptimized({
    D: 600,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
    objective: 100,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("B");
  const facts = extractSynthesisFacts(sc, c);
  const text = whyThisDecisionSentences(facts).join(" ");

  expect(text).toMatch(/forces every developable megawatt into use/i);
  expect(text).toMatch(/no allocation to prefer over another/i);
  expect(text).not.toMatch(/chose|preferred|favou?red|decided|judged/i);
  assertNoBannedConstructions([text]);
  // No tradeoff sentence: every strategy IS the same forced allocation.
  expect(tradeoffSentence(facts)).toBeNull();
});

/* ================================================================== */
/* Case D -- lambda = 0: cost-only, no schedule-aware claim             */
/* ================================================================== */

test("case D: golden paragraph explains cost-only behavior with no schedule-aware-selection claim", () => {
  const c = classifyResult(BASELINE);
  expect(c.base).toBe("D");
  const facts = extractSynthesisFacts(BASELINE, c);
  const text = whyThisDecisionSentences(facts).join(" ");

  expect(text).toMatch(/minimizes development cost only/i);
  expect(text).toMatch(/does not weigh the schedule at all/i);
  assertNoBannedConstructions([text]);
});

/* ================================================================== */
/* Case C -- co-optimal: never presented as unique                     */
/* ================================================================== */

test("case C: the golden paragraph never claims the shown allocation is uniquely best", () => {
  const sc = fakeOptimized({
    D: 400,
    atLambda: 0.03,
    capacities: { A: 300, B: 300 },
    allocation: { A: 300, B: 100 },
    isUnique: false,
    pMeet: 0.8,
    objective: 50,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("C");
  const facts = extractSynthesisFacts(sc, c);
  const text = whyThisDecisionSentences(facts).join(" ");

  expect(text).toMatch(/one of those with the lowest combined cost and delay total/i);
  expect(text).not.toMatch(/the lowest[^.]*\ballocation\b(?! shown is one)/i);
  assertNoBannedConstructions([text]);

  const synthesis = synthesizeDecision(sc, c);
  expect(synthesis.coOptimalSpanLegend).not.toBeNull();
  expect(synthesis.coOptimalSpanLegend![0].text).toContain("marked span on each bar");
  // Not repeated: the golden paragraph does not also restate the legend text.
  expect(synthesis.whyThisDecision).not.toContain("marked span on each bar");
});

/* ================================================================== */
/* Comparison mode -- no global-optimization language                  */
/* ================================================================== */

test("comparison mode (extended_n6, larger_n10): no optimal/optimized/global-optimum language", () => {
  for (const sc of [EXTENDED, LARGER]) {
    const c = classifyResult(sc);
    expect(c.base).toBe("F");
    const facts = extractSynthesisFacts(sc, c);
    const why = whyThisDecisionSentences(facts).join(" ");
    const meaning = choiceComparisonMeaning(facts) ?? "";
    assertNoComparisonModeBannedConstructions([why, meaning]);
    expect(why).toMatch(/not a search over every feasible allocation/i);
  }
});

test("optimized mode is allowed truthful optimization language (never banned there)", () => {
  const c = classifyResult(CHEAP_SITE);
  const facts = extractSynthesisFacts(CHEAP_SITE, c);
  const why = whyThisDecisionSentences(facts).join(" ");
  // The optimized-mode text may legitimately describe the recommended
  // allocation as the lowest combined result -- the comparison-mode gate is
  // never applied to it.
  expect(why).toMatch(/lowest combined cost and delay total/i);
  // findComparisonModeBannedConstructions is a plain detector, usable on any
  // string; optimized-mode wording here simply never trips it because it
  // never claims a search over "every feasible allocation" was compared.
  expect(findComparisonModeBannedConstructions("the recommended allocation")).toEqual(
    [],
  );
});

test("the comparison-mode gate actually catches prohibited optimization language", () => {
  for (const bad of [
    "this is the global optimum",
    "the optimized allocation shown here",
    "an optimal allocation",
    "the optimizer recommends this split",
    "the best possible allocation",
    // Grammatical variants a fixed phrase list alone would miss.
    "the optimizer recommended this split",
    "this site was allocated optimally",
  ]) {
    expect(findComparisonModeBannedConstructions(bad).length).toBeGreaterThan(0);
  }
  expect(() =>
    assertNoComparisonModeBannedConstructions(["an optimal allocation"]),
  ).toThrow(/optimization language/i);
});

/* ================================================================== */
/* Large-portfolio scaling (1 / 3 / 4 / 12 sites)                      */
/* ================================================================== */

function fakeComparison(
  capacities: Record<string, number>,
  allocation: Record<string, number>,
  bestKey = "diversified",
): ShowcaseExport {
  const siteIds = Object.keys(capacities);
  const D = Object.values(allocation).reduce((a, b) => a + b, 0);
  const strategies = {
    cost_concentration: fakeStrategyResult(allocation, {
      objective: 100,
      p_meet: 0.5,
    }),
    speed_reliability: fakeStrategyResult(allocation, {
      objective: 90,
      p_meet: 0.6,
    }),
    diversified: fakeStrategyResult(allocation, { objective: 80, p_meet: 0.7 }),
  };
  const showcase = {
    scenario: {
      system: {
        required_capacity_mw: D,
        target_month: 30,
        horizon_month: 72,
        lambda_mw_month: 0.05,
      },
      sites: siteIds.map((id) => ({
        id,
        capacity_mw: capacities[id],
        cost_per_mw: 1,
        burden_state: 1,
        uncertainty_state: 1,
      })),
    },
    scenario_set: { method: "exact", n_realizations: 729 },
    site_power_profiles: [],
    strategies,
    decision_boundaries: {
      pairwise_break_even_lambda: [],
      global_switching_boundaries: [
        { lambda_start: 0, strategy: bestKey, co_optimal: [bestKey] },
      ],
      global_switching_has_cooptimal_segments: false,
    },
    optimizer: null,
    lambda_envelope: null,
  };
  return showcase as unknown as ShowcaseExport;
}

test("N=12 comparison mode: names at most 3 funded sites and summarizes the remainder", () => {
  const capacities: Record<string, number> = {};
  const allocation: Record<string, number> = {};
  const ids = "ABCDEFGHIJKL".split("");
  for (const [i, id] of ids.entries()) {
    capacities[id] = 100;
    // 8 funded (descending MW so the top 3 are deterministic), 4 unfunded.
    allocation[id] = i < 8 ? 80 - i * 5 : 0;
  }
  const sc = fakeComparison(capacities, allocation);
  const c = classifyResult(sc);
  expect(c.base).toBe("F");
  const facts = extractSynthesisFacts(sc, c);
  expect(facts.funded).toHaveLength(8);
  expect(facts.unfundedIds).toHaveLength(4);

  const why = whyThisDecisionSentences(facts).join(" ");
  // Only the top 3 named individually.
  expect(why).toContain(`Site ${ids[0]}`);
  expect(why).toContain(`Site ${ids[1]}`);
  expect(why).toContain(`Site ${ids[2]}`);
  expect(why).not.toContain(`Site ${ids[3]}`);
  // The remaining 5 funded sites are summarized by count, not enumerated.
  expect(why).toMatch(/5 other sites carrying the remaining/i);
  // The 4 unfunded sites are summarized by count, not named (> 3).
  expect(why).toMatch(/4 sites take none/i);
  assertNoComparisonModeBannedConstructions([why]);
});

test("N=4 comparison mode with few funded/unfunded sites still names them directly", () => {
  const sc = fakeComparison(
    { A: 100, B: 100, C: 100, D: 100 },
    { A: 60, B: 40, C: 0, D: 0 },
  );
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const why = whyThisDecisionSentences(facts).join(" ");
  expect(why).toContain("Site A");
  expect(why).toContain("Site B");
  expect(why).toMatch(/Site C and Site D take none/i);
});

test("N=1 and N=3 optimized-mode prose reads about as long as a 12-site comparison prose", () => {
  const one = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300 },
    allocation: { A: 300 },
    pMeet: 0.9,
    objective: 50,
  });
  const c1 = classifyResult(one);
  const facts1 = extractSynthesisFacts(one, c1);
  const sentences1 = whyThisDecisionSentences(facts1);
  expect(sentences1.length).toBeLessThanOrEqual(6);

  const c3 = classifyResult(CHEAP_SITE);
  const facts3 = extractSynthesisFacts(CHEAP_SITE, c3);
  const sentences3 = whyThisDecisionSentences(facts3);
  expect(sentences3.length).toBeLessThanOrEqual(6);
});

/* ================================================================== */
/* Tradeoff sentence -- leading on a diagnostic is not "wrong"         */
/* ================================================================== */

test("an alternative leading on p_meet is named without calling the selected row wrong", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0.5,
    developmentCost: 100,
    objective: 200,
    strategies: {
      cost_concentration: fakeStrategyResult(
        { A: 150, B: 0, C: 150 },
        { objective: 250, p_meet: 0.5, development_cost: 100 },
      ),
      // This alternative leads on p_meet but loses under the objective.
      speed_reliability: fakeStrategyResult(
        { A: 0, B: 300, C: 0 },
        { objective: 260, p_meet: 0.9, development_cost: 300 },
      ),
      diversified: fakeStrategyResult(
        { A: 150, B: 150, C: 0 },
        { objective: 270, p_meet: 0.6, development_cost: 150 },
      ),
    },
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  expect(facts.runnerUp?.key).toBe("cost_concentration"); // lowest objective among alternatives

  // Force the runner-up to the p_meet-leading alternative for this assertion.
  const factsWithLeader: SynthesisFacts = {
    ...facts,
    runnerUp: facts.alternatives.find((a) => a.key === "speed_reliability")!,
  };
  const sentence = tradeoffSentence(factsWithLeader);
  expect(sentence).not.toBeNull();
  expect(sentence).toMatch(/higher chance of meeting the target date/i);
  expect(sentence).not.toMatch(/\bwrong\b/i);
  expect(sentence).toMatch(/is not the result returned here/i);
});

test("tradeoff sentence never renders for a forced allocation (case B)", () => {
  const sc = fakeOptimized({
    D: 600,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  expect(tradeoffSentence(facts)).toBeNull();
});

/* ================================================================== */
/* Key Results sentence -- exact vs Monte Carlo, and the three buckets */
/* ================================================================== */

test("keyResultsSentence: p_meet = 1, exact evaluation -- a population statement, 'every outcome'", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300 },
    allocation: { A: 300 },
    pMeet: 1,
    method: "exact",
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const sentence = keyResultsSentence(facts);
  expect(sentence).toMatch(/full requirement is met by month \d+ in every outcome/i);
  expect(sentence).not.toMatch(/sampled/i);
});

test("keyResultsSentence: p_meet = 1, Monte Carlo -- a sample statement, never called exact or a population guarantee", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300 },
    allocation: { A: 300 },
    pMeet: 1,
    method: "monte_carlo",
    nRealizations: 5000,
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const sentence = keyResultsSentence(facts);
  // States a fact about the 5000 outcomes actually sampled, not "every
  // outcome" (a population claim) and not "exact".
  expect(sentence).toMatch(/all 5000 sampled outcomes reached the full requirement/i);
  expect(sentence).not.toMatch(/\bexact\b/i);
  expect(sentence).not.toMatch(/every outcome/i);
});

test("keyResultsSentence: p_meet = 0, exact evaluation (zero-chance) -- 'no modeled outcome'", () => {
  const c = classifyResult(BASELINE);
  expect(c.zeroChance).toBe(true);
  const facts = extractSynthesisFacts(BASELINE, c);
  const sentence = keyResultsSentence(facts);
  expect(sentence).toMatch(/no modeled outcome/i);
  expect(sentence).toMatch(/reaches the full requirement by month 36/i);
  // Exact method -- no Monte Carlo sampling language.
  expect(sentence).not.toMatch(/sampled/i);
});

test("keyResultsSentence: p_meet = 0, Monte Carlo -- 'none of the N sampled outcomes'", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300 },
    allocation: { A: 0 },
    pMeet: 0,
    method: "monte_carlo",
    nRealizations: 8000,
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const sentence = keyResultsSentence(facts);
  expect(sentence).toMatch(/none of the 8000 sampled outcomes reached the full requirement/i);
  expect(sentence).not.toMatch(/\bexact\b/i);
});

test("keyResultsSentence: 0 < p_meet < 1, exact evaluation states the fraction and the average shortfall", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0.64,
    expectedShortfall: 45,
    method: "exact",
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const sentence = keyResultsSentence(facts);
  expect(sentence).toMatch(/64\.0% of modeled outcomes/i);
  expect(sentence).toMatch(/average 45 MW shortfall/i);
  expect(sentence).not.toMatch(/sampled|estimate/i);
});

test("keyResultsSentence: 0 < p_meet < 1, Monte Carlo states a SAMPLED ESTIMATE, not an exact fraction", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0.64,
    expectedShortfall: 45,
    method: "monte_carlo",
    nRealizations: 10000,
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const sentence = keyResultsSentence(facts);
  expect(sentence).toMatch(/sampled estimate of meeting the target date is 64\.0%/i);
  expect(sentence).toMatch(/based on 10000 sampled outcomes/i);
  expect(sentence).toMatch(/average 45 MW shortfall/i);
  expect(sentence).not.toMatch(/\bexact\b/i);
});

/* ================================================================== */
/* Sensitivity -- only with a validated envelope                       */
/* ================================================================== */

test("sensitivity FACT is present only with a validated lambda envelope (cheap_site_risky_schedule has one, extended_n6 does not)", () => {
  const withEnvelope = extractSynthesisFacts(CHEAP_SITE, classifyResult(CHEAP_SITE));
  expect(withEnvelope.sensitivity).not.toBeNull();
  expect(withEnvelope.sensitivity!.threshold).toBeCloseTo(0.037, 3);

  const withoutEnvelope = extractSynthesisFacts(EXTENDED, classifyResult(EXTENDED));
  expect(withoutEnvelope.sensitivity).toBeNull();
  expect(
    whyThisDecisionSentences(withoutEnvelope).join(
      " ",
    ),
  ).not.toMatch(/delay consequence/i);
});

test("sensitivity FACT (baseline cheap_site_risky_schedule) is NEVER crowded out of the golden paragraph by the lead/criterion slots", () => {
  // Regression: under the old slice(0,6) design this
  // scenario's own longer slots 1-4 (2 sentences apiece, before the
  // one-sentence-per-slot refactor) pushed the sensitivity slot out
  // entirely. With every slot now guaranteed to be at most one sentence,
  // a valid sensitivity fact is never dropped merely for arriving last.
  const c = classifyResult(CHEAP_SITE);
  const facts = extractSynthesisFacts(CHEAP_SITE, c);
  expect(facts.sensitivity).not.toBeNull();
  const sentences = whyThisDecisionSentences(facts);
  const why = sentences.join(" ");
  expect(why).toMatch(/Above a delay consequence of 0\.037/);
  expect(sentences.length).toBeLessThanOrEqual(6);
  expect(countSentences(why)).toBeLessThanOrEqual(6);
});

test("mechanism + sensitivity: a case with BOTH facts retains BOTH sentences, still <= 6 total", () => {
  const envelope: LambdaEnvelope = {
    l_min: 0,
    lambda_anchor: 0,
    terminal_breakpoint_lambda: 1,
    vertices: [],
    breakpoints: [
      {
        lam_estimate: 0.05,
        tolerance: 1e-6,
        co_optimal_at_breakpoint: false,
        left_vertex_allocation: { A: 300, B: 0 },
        right_vertex_allocation: { A: 0, B: 300 },
      },
    ],
  };
  // Site B is unfunded and has no power at the target month -- a genuine
  // mechanism fact -- while the envelope also carries a genuine breakpoint
  // above the scenario's own lambda. Both must survive together.
  const bProfile = fakeProfile("B", 300, [0, 30], [[0, 0]]);
  const sc = fakeOptimized({
    D: 300,
    target: 30,
    atLambda: 0.01,
    // K > D so this is an ordinary optimized result (case A), not forced
    // (case B, where `sensitivityMoveFor()` never fires by design).
    capacities: { A: 400, B: 300 },
    allocation: { A: 300, B: 0 },
    pMeet: 1,
    objective: 100,
    lambdaEnvelope: envelope,
    sitePowerProfiles: [bProfile],
    strategies: {
      cost_concentration: fakeStrategyResult(
        { A: 300, B: 0 },
        { objective: 100, p_meet: 1 },
      ),
      speed_reliability: fakeStrategyResult(
        { A: 300, B: 0 },
        { objective: 100, p_meet: 1 },
      ),
      diversified: fakeStrategyResult(
        { A: 300, B: 0 },
        { objective: 100, p_meet: 1 },
      ),
    },
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  expect(facts.sensitivity).not.toBeNull();
  expect(facts.timing).toEqual([{ siteId: "B", status: "no_power" }]);

  const sentences = whyThisDecisionSentences(facts);
  const why = sentences.join(" ");
  // Both facts present...
  expect(why).toMatch(/Site B has no power available at month 30/i);
  expect(why).toMatch(/Above a delay consequence of 0\.05/);
  expect(why).toMatch(/shifting capacity from Site A toward Site B/);
  // ...and the paragraph is still bounded.
  expect(sentences.length).toBeLessThanOrEqual(6);
  expect(countSentences(why)).toBeLessThanOrEqual(6);
});

test("no silent truncation: every applicable slot fires when all six have a fact to report", () => {
  // A deliberately maximal fixture: forced-out tradeoff, exposure, mechanism
  // and sensitivity all have a genuine fact, alongside the always-present
  // selected-result and criterion slots -- exactly six slots, none dropped.
  const envelope: LambdaEnvelope = {
    l_min: 0,
    lambda_anchor: 0,
    terminal_breakpoint_lambda: 1,
    vertices: [],
    breakpoints: [
      {
        lam_estimate: 0.03,
        tolerance: 1e-6,
        co_optimal_at_breakpoint: false,
        left_vertex_allocation: { A: 150, C: 150 },
        right_vertex_allocation: { A: 0, C: 300 },
      },
    ],
  };
  const cProfile = fakeProfile("C", 150, [0, 30], [[0, 0]]); // unfunded, no power
  const sc = fakeOptimized({
    D: 300,
    target: 30,
    atLambda: 0.02,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 150, C: 0 },
    pMeet: 0.64,
    expectedShortfall: 45,
    objective: 200,
    lambdaEnvelope: envelope,
    sitePowerProfiles: [cProfile],
    strategies: {
      // speed_reliability has the LOWEST objective among the alternatives
      // (210 < 250 < 270), so it is `facts.runnerUp` -- and it leads on
      // p_meet (0.9 > the selected result's 0.64) while still losing under
      // the combined criterion (its objective, 210, is still above the
      // selected result's 200).
      cost_concentration: fakeStrategyResult(
        { A: 300, B: 0, C: 0 },
        { objective: 250, p_meet: 0.5, development_cost: 100 },
      ),
      speed_reliability: fakeStrategyResult(
        { A: 0, B: 300, C: 0 },
        { objective: 210, p_meet: 0.9, development_cost: 300 },
      ),
      diversified: fakeStrategyResult(
        { A: 150, B: 150, C: 0 },
        { objective: 270, p_meet: 0.6, development_cost: 150 },
      ),
    },
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("A");
  const facts = extractSynthesisFacts(sc, c);
  expect(facts.sensitivity).not.toBeNull();
  expect(facts.timing.some((t) => t.siteId === "C" && t.status === "no_power")).toBe(
    true,
  );

  const sentences = whyThisDecisionSentences(facts);
  expect(sentences).toHaveLength(6); // all six slots fired
  const why = sentences.join(" ");
  expect(why).toMatch(/Capacity goes to Site A 150 MW and Site B 150 MW/i); // slot 1
  expect(why).toMatch(/lowest combined cost and delay total/i); // slot 2
  expect(why).toMatch(/higher chance of meeting the target date/i); // slot 3
  expect(why).toMatch(/64\.0% of modeled outcomes/i); // slot 4
  expect(why).toMatch(/Site C has no power available at month 30/i); // slot 5
  expect(why).toMatch(/Above a delay consequence of 0\.03/i); // slot 6
  expect(countSentences(why)).toBeLessThanOrEqual(6);
});

/* ================================================================== */
/* Delivery outlook + Site delivery local sentences                    */
/* ================================================================== */

test("deliveryOutlookSentence reads the authoritative trajectory at the target month only", () => {
  const c = classifyResult(BASELINE);
  const facts = extractSynthesisFacts(BASELINE, c);
  const sentence = deliveryOutlookSentence(facts);
  expect(sentence).toMatch(/remains below the full/i); // baseline is zero-chance
  // Never a derived per-site delivered-capacity number.
  expect(sentence).not.toMatch(/\bMW allocated\b/i);
});

test("siteDeliveryMeaning states power availability only, never delivered capacity or allocation", () => {
  const profile = fakeProfile("A", 500, [0, 36], [[0, 0], [0, 0]]);
  const sc = fakeOptimized({
    D: 500,
    target: 36,
    atLambda: 0.025,
    capacities: { A: 500, B: 300 },
    allocation: { A: 0, B: 300 },
    pMeet: 1,
    sitePowerProfiles: [profile],
  });
  const c = classifyResult(sc);
  const facts = extractSynthesisFacts(sc, c);
  const sentence = siteDeliveryMeaning(facts);
  expect(sentence).toMatch(/Site A has no power available at month 36/i);
  expect(sentence).not.toMatch(/deliver|allocat/i);
});

/* ================================================================== */
/* High -> Very High counterintuitive scenario                         */
/* ================================================================== */

/**
 * Locks the SCENARIO-LOCAL prose the live page is allowed to show for the
 * this case. The mechanism itself is verified
 * against the frozen engine in
 * `tests/golden/test_counterintuitive_condition_change.py`; this test only
 * checks that the frontend text derived from that result stays scenario-
 * local and never narrates cross-scenario causality.
 */
test("High -> Very High: the golden paragraph is scenario-local, with no cross-scenario causal claim", () => {
  const aProfile = fakeProfile("A", 500, [0, 36], [[0, 0], [0, 0]]); // no power at month 36
  const worsened = fakeOptimized({
    D: 500,
    target: 36,
    atLambda: 0.025,
    capacities: { A: 500, B: 300, C: 250 },
    allocation: { A: 0, B: 300, C: 200 },
    pMeet: 1,
    developmentCost: 605,
    expectedShortfall: 0,
    expectedDelayBurden: 0,
    objective: 605,
    sitePowerProfiles: [aProfile],
  });
  const c = classifyResult(worsened);
  expect(c.base).toBe("A");
  const facts = extractSynthesisFacts(worsened, c);

  // The edited scenario is not the committed preset, so it carries no
  // validated λ envelope -- no sensitivity move is fabricated, and none is
  // shown, even though this scenario happens to have breakpoints in
  // principle.
  expect(facts.sensitivity).toBeNull();

  const why = whyThisDecisionSentences(facts).join(" ");

  // Safe, scenario-local facts.
  expect(why).toMatch(/Site B 300 MW/);
  expect(why).toMatch(/Site C 200 MW/);
  expect(why).toMatch(/Site A takes none/i);
  expect(why).toMatch(/Site A has no power available at month 36/i);
  expect(why).not.toMatch(/the allocation would change/i); // no sensitivity slot rendered

  // Never a cross-scenario causal narrative (the explicit
  // forbidden constructions).
  for (const forbidden of [
    /worsening a? ?improved/i,
    /making a very high caused/i,
    /the optimizer abandoned/i,
    /because it became worse/i,
    /improved because/i,
    /rose from 40%/i,
  ]) {
    expect(why).not.toMatch(forbidden);
  }
  assertNoBannedConstructions([why]);
});

/* ================================================================== */
/* Every golden-paragraph slot is at most one public sentence          */
/* ================================================================== */

/**
 * Structural gate: no golden-paragraph slot function
 * may ever render more than one complete sentence, over every structural
 * case this file constructs. Asserted over `GOLDEN_PARAGRAPH_SLOTS`
 * (the exported, ordered slot-function list `whyThisDecisionSentences()`
 * itself reads) rather than by name, so this does not depend on which
 * private helper happens to implement a given slot.
 */
test("every golden-paragraph slot renders at most one public sentence, for every structural case", () => {
  const worsenedScenario = fakeOptimized({
    D: 500,
    target: 36,
    atLambda: 0.025,
    capacities: { A: 500, B: 300, C: 250 },
    allocation: { A: 0, B: 300, C: 200 },
    pMeet: 1,
    developmentCost: 605,
    sitePowerProfiles: [fakeProfile("A", 500, [0, 36], [[0, 0]])],
  });
  const forcedScenario = fakeOptimized({
    D: 600,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
  });
  const coOptimalScenario = fakeOptimized({
    D: 400,
    atLambda: 0.03,
    capacities: { A: 300, B: 300 },
    allocation: { A: 300, B: 100 },
    isUnique: false,
    pMeet: 0.8,
  });
  const cases: ShowcaseExport[] = [
    BASELINE,
    EXTENDED,
    LARGER,
    CHEAP_SITE,
    worsenedScenario,
    forcedScenario,
    coOptimalScenario,
  ];

  for (const sc of cases) {
    const c = classifyResult(sc);
    const facts = extractSynthesisFacts(sc, c);
    for (const slot of GOLDEN_PARAGRAPH_SLOTS) {
      const rendered = slot(facts);
      if (rendered === null) continue;
      expect(
        countSentences(rendered),
        `slot output exceeded one sentence: "${rendered}"`,
      ).toBeLessThanOrEqual(1);
    }
  }
});
