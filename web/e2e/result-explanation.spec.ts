import { test, expect } from "@playwright/test";
import baselineFile from "./fixtures/baseline_n3.json" with { type: "json" };
import extendedFile from "./fixtures/extended_n6.json" with { type: "json" };
import largerFile from "./fixtures/larger_n10.json" with { type: "json" };
import {
  classifyResult,
  decimalSumEquals,
  type RawCapacityInputs,
  type ResultClassification,
} from "../src/lib/resultCase";
import {
  BANNED_CONSTRUCTIONS,
  allocationHeading,
  assertNoBannedConstructions,
  decisionLeadFor,
  decisionNoteFor,
  decisionNoteText,
  findBannedConstructions,
  OBJECTIVE_VERSUS_DIAGNOSTICS,
  selectionCriterionFor,
} from "../src/lib/explanation";
import type { ShowcaseExport } from "../src/types/showcase";

/**
 * Targeted gate — result classification and the conditional structural note.
 * Pure-logic assertions over `classifyResult()` and `decisionNoteFor()`; no
 * browser, no live API. Run with `--config e2e/logic.playwright.config.ts`.
 *
 * The note is conditional: an ordinary optimized result (case A with a
 * non-zero chance of meeting the date) returns null, because restating the
 * allocation the bars already show adds no decision information. Only the
 * structural cases produce copy.
 *
 * Real committed exports cover cases D, E, and F (`baseline_n3` is the
 * λ = 0 non-forced optimized run; `extended_n6` / `larger_n10` are the
 * N > 3 comparison runs). Cases A, B, and C are exercised with minimal
 * synthetic `ShowcaseExport` objects — the two stress scenarios
 * (the two continuity stress scenarios) and a co-optimal optimizer result. These are
 * classification inputs, not new engine fixtures: no model quantity is
 * computed here.
 */

const realShowcase = (file: unknown): ShowcaseExport =>
  (file as { showcase: unknown }).showcase as ShowcaseExport;

const BASELINE = realShowcase(baselineFile);
const EXTENDED = realShowcase(extendedFile);
const LARGER = realShowcase(largerFile);

/* ------------------------------------------------------------------ */
/* Synthetic ShowcaseExport builder — only the fields the classifier  */
/* and the explanation reader actually touch.                         */
/* ------------------------------------------------------------------ */

interface FakeOpts {
  D: number;
  target?: number;
  atLambda: number;
  capacities: Record<string, number>;
  allocation: Record<string, number>;
  isUnique?: boolean;
  pMeet: number;
}

function fakeOptimized(o: FakeOpts): ShowcaseExport {
  const siteIds = Object.keys(o.capacities);
  const showcase = {
    scenario: {
      system: {
        required_capacity_mw: o.D,
        target_month: o.target ?? 30,
        horizon_month: 72,
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
    strategies: {},
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
      // Real exports carry the allocation on `evaluated` as well; the
      // Decision page reads the authoritative allocation from there.
      evaluated: {
        p_meet: o.pMeet,
        expected_shortfall_mw: 0,
        allocation: o.allocation,
      },
    },
  };
  return showcase as unknown as ShowcaseExport;
}

/**
 * The note's lines as the plain sentences a reader reads. `decisionNoteFor`
 * returns each line as segments so the decisive conclusion can be emphasized
 * on the page; every assertion below is about the sentence, not the split, so
 * segmentation must never change one of these outcomes.
 */
const lines = (sc: ShowcaseExport, c: ResultClassification): string[] =>
  (decisionNoteFor(sc, c) ?? []).map(decisionNoteText);

const joined = (c: ResultClassification, sc: ShowcaseExport) =>
  lines(sc, c).join(" ");

/* ------------------------------------------------------------------ */
/* Case A — genuine tradeoff (controlled scenario)                    */
/* ------------------------------------------------------------------ */

test("case A: an ordinary optimized result produces no note at all", () => {
  const sc = fakeOptimized({
    D: 300,
    target: 30,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0.64,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("A");
  expect(c.zeroChance).toBe(false);
  expect(allocationHeading(c)).toBe("Recommended allocation");

  // The allocation bars and the four Key Results already carry this result.
  // Prose repeating the placement would add no decision context.
  expect(decisionNoteFor(sc, c)).toBeNull();
});

test("case A with no chance of meeting the date still gets the zero-chance line", () => {
  const sc = fakeOptimized({
    D: 300,
    target: 30,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("A");
  expect(decisionNoteFor(sc, c)).not.toBeNull();
  const note = lines(sc, c);
  expect(note).toHaveLength(1);
  expect(note[0]).toContain(
    "No modeled delivery outcome reaches the full requirement by month 30",
  );
});

/* ------------------------------------------------------------------ */
/* Case B — feasibility-forced (forced scenario)                      */
/* ------------------------------------------------------------------ */

test("case B: forced — full-allocation wording, no optimizer/benchmark/regime clause", () => {
  const sc = fakeOptimized({
    D: 600,
    target: 30,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("B");
  expect(c.forced).toBe(true);

  expect(allocationHeading(c)).toBe("Required allocation");

  const text = joined(c, sc);
  expect(text).toContain(
    "all developable capacity is required to reach the 600 MW requirement",
  );
  expect(text).toContain("no allocation choice in this scenario");
  // p_meet < 1 → the grounded delivery-timing clause, saying only what
  // p_meet establishes (some outcomes miss) — no expected-value claim that
  // capacity arrives late.
  expect(text).toContain(
    "some modeled delay outcomes miss the full requirement at the target date",
  );
  expect(text).not.toMatch(/expected to (become available|arrive)/i);

  // Suppressed: optimizer preference, benchmark naming, λ / regime language,
  // and any implication that the delay consequence changes the allocation.
  expect(text).not.toMatch(/λ|lambda/i);
  expect(text).not.toMatch(/delay consequence/i);
  expect(text).not.toMatch(/regime|benchmark|co-?optimal/i);
  expect(text).not.toMatch(/cost first|schedule first|spread across/i);
  expect(text).not.toMatch(/minimiz|cost-minimizing|lowest cost/i);
  expect(findBannedConstructions(text)).toEqual([]);
});

test("case B: precedence over D — delay consequence 0 leaves case and allocation unchanged", () => {
  const base = {
    D: 600,
    target: 30,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
  };
  const atHalf = classifyResult(fakeOptimized({ ...base, atLambda: 0.5 }));
  const atZero = classifyResult(fakeOptimized({ ...base, atLambda: 0 }));

  expect(atHalf.base).toBe("B");
  expect(atZero.base).toBe("B"); // B > D
  expect(allocationHeading(atZero)).toBe("Required allocation"); // not the cost-only heading
  expect(allocationHeading(atZero)).not.toContain("delay consequence set to 0");

  const scZero = fakeOptimized({ ...base, atLambda: 0 });
  const text = joined(atZero, scZero);
  expect(text).not.toMatch(/minimizes development cost only/);
  expect(text).toContain("no allocation choice in this scenario");
});

test("case B: no late-delivery clause when the run meets the date with certainty", () => {
  const sc = fakeOptimized({
    D: 600,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 1,
  });
  const c = classifyResult(sc);
  const note = lines(sc, c);
  expect(note).toHaveLength(1);
  expect(note[0]).not.toContain("Delivery timing");
});

/* ------------------------------------------------------------------ */
/* Case B — exact decimal forced check                               */
/* ------------------------------------------------------------------ */

test("decimalSumEquals: exact decimal-string comparison, no floating-point split", () => {
  expect(decimalSumEquals(["200", "200", "200"], "600")).toBe(true);
  expect(decimalSumEquals(["0.1", "0.2"], "0.3")).toBe(true); // 0.1 + 0.2 !== 0.3 in float
  expect(decimalSumEquals(["50.25", "50.25"], "100.5")).toBe(true);
  expect(decimalSumEquals(["50.25", "50.24"], "100.5")).toBe(false);
  expect(decimalSumEquals(["200.00", " 400 "], "600")).toBe(true);
  expect(decimalSumEquals([".5", "0.50"], "1")).toBe(true);
  // Not a plain decimal numeral → undecidable, caller falls back.
  expect(decimalSumEquals(["1e3"], "1000")).toBeNull();
  expect(decimalSumEquals(["600"], "6e2")).toBeNull();
});

test("case B: mathematically equal decimal inputs are classified forced", () => {
  const forcedFrom = (D: string, ks: string[]) => {
    const nums = ks.map(Number);
    const ids = ks.map((_, i) => String.fromCharCode(65 + i));
    const sc = fakeOptimized({
      D: Number(D),
      atLambda: 0.5,
      capacities: Object.fromEntries(ids.map((id, i) => [id, nums[i]])),
      allocation: Object.fromEntries(ids.map((id, i) => [id, nums[i]])),
      pMeet: 0.3,
    });
    const raw: RawCapacityInputs = { required: D, sites: ks };
    return classifyResult(sc, raw);
  };

  expect(forcedFrom("600", ["200", "200", "200"]).base).toBe("B");
  expect(forcedFrom("0.3", ["0.1", "0.2"]).base).toBe("B");
  expect(forcedFrom("100.5", ["50.25", "50.25"]).base).toBe("B");

  const notForced = forcedFrom("100.5", ["50.25", "50.24"]);
  expect(notForced.forced).toBe(false);
  expect(notForced.base).not.toBe("B");
});

test("case B: numeric fallback still classifies integer forced portfolios", () => {
  // No raw strings supplied → exact numeric equality (exact for integers).
  const sc = fakeOptimized({
    D: 600,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
  });
  expect(classifyResult(sc).forced).toBe(true);
  expect(classifyResult(sc).base).toBe("B");
  // Raw strings that are not plain decimals also fall back to numeric.
  expect(
    classifyResult(sc, { required: "6e2", sites: ["200", "200", "200"] }).base,
  ).toBe("B");
});

test("case B: a decimal portfolio that only looks forced in float is a silence, not a false B", () => {
  // sum in float is 0.30000000000000004; D is 0.3. Exact string check → forced.
  // If the check regressed to numeric === it would MISS this (not falsely B).
  const c = classifyResult(
    fakeOptimized({
      D: 0.3,
      atLambda: 0.5,
      capacities: { A: 0.1, B: 0.2 },
      allocation: { A: 0.1, B: 0.2 },
      pMeet: 0.3,
    }),
    { required: "0.3", sites: ["0.1", "0.2"] },
  );
  expect(c.forced).toBe(true);
  expect(c.base).toBe("B");
});

/* ------------------------------------------------------------------ */
/* Case C — co-optimal                                                */
/* ------------------------------------------------------------------ */

test("case C: co-optimal — tied wording, no numerical tolerance shown", () => {
  const sc = fakeOptimized({
    D: 400,
    atLambda: 0.03,
    capacities: { A: 300, B: 300 },
    allocation: { A: 300, B: 100 },
    isUnique: false,
    pMeet: 0.8,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("C");

  const text = joined(c, sc);
  expect(text).toContain("Several allocations perform identically here");
  expect(text).toContain("marked span on each bar");
  expect(text).toContain("not a box of jointly feasible allocations");
  // No co-optimality tolerance number on the Decision page.
  expect(text).not.toMatch(/tolerance/i);
  expect(text).not.toMatch(/0\.\d{5,}/);
  expect(text).not.toMatch(/1e-|e-0?\d/i);
  expect(findBannedConstructions(text)).toEqual([]);
});

test("classification precedence: B > D > C > A", () => {
  const caps = { A: 300, B: 300 };
  // forced + λ0 + non-unique → B
  expect(
    classifyResult(
      fakeOptimized({
        D: 600,
        atLambda: 0,
        capacities: caps,
        allocation: { A: 300, B: 300 },
        isUnique: false,
        pMeet: 0.5,
      }),
    ).base,
  ).toBe("B");
  // not forced + λ0 + non-unique → D (D > C)
  expect(
    classifyResult(
      fakeOptimized({
        D: 400,
        atLambda: 0,
        capacities: caps,
        allocation: { A: 300, B: 100 },
        isUnique: false,
        pMeet: 0.5,
      }),
    ).base,
  ).toBe("D");
  // not forced + λ>0 + non-unique → C
  expect(
    classifyResult(
      fakeOptimized({
        D: 400,
        atLambda: 0.02,
        capacities: caps,
        allocation: { A: 300, B: 100 },
        isUnique: false,
        pMeet: 0.5,
      }),
    ).base,
  ).toBe("C");
  // not forced + λ>0 + unique → A
  expect(
    classifyResult(
      fakeOptimized({
        D: 400,
        atLambda: 0.02,
        capacities: caps,
        allocation: { A: 300, B: 100 },
        isUnique: true,
        pMeet: 0.5,
      }),
    ).base,
  ).toBe("A");
});

/* ------------------------------------------------------------------ */
/* Case D — delay consequence zero (real baseline_n3 export)          */
/* ------------------------------------------------------------------ */

test("case D: cost-only — heading is not 'Recommended', explanation names the setting", () => {
  const c = classifyResult(BASELINE);
  expect(c.base).toBe("D");
  expect(BASELINE.optimizer?.at_lambda).toBe(0);

  expect(allocationHeading(c)).toBe(
    "Lowest-cost allocation (delay consequence set to 0)",
  );
  expect(allocationHeading(c)).not.toMatch(/recommended/i);

  const text = joined(c, BASELINE);
  expect(text).toContain(
    "The delay consequence is set to 0, so this run minimizes development cost only",
  );
  expect(text).not.toMatch(/recommended/i);
  expect(findBannedConstructions(text)).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Case E — zero chance overlay (structural, no threshold)            */
/* ------------------------------------------------------------------ */

test("case E: overlay fires only on exact p_meet == 0 and never replaces the base case", () => {
  const c = classifyResult(BASELINE);
  expect(c.zeroChance).toBe(true);
  expect(c.base).toBe("D"); // overlay is additive

  const note = lines(BASELINE, c);
  expect(note[note.length - 1]).toContain(
    "No modeled delivery outcome reaches the full requirement by month 36",
  );
  expect(note.length).toBeGreaterThan(1); // base sentence(s) kept
});

test("case E: no probability threshold — only exact zero is a zero-chance state", () => {
  const mk = (pMeet: number) =>
    classifyResult(
      fakeOptimized({
        D: 400,
        atLambda: 0.02,
        capacities: { A: 300, B: 300 },
        allocation: { A: 300, B: 100 },
        pMeet,
      }),
    ).zeroChance;
  expect(mk(0)).toBe(true);
  expect(mk(0.0001)).toBe(false);
  expect(mk(0.4)).toBe(false);
  expect(mk(0.49)).toBe(false);
  expect(mk(1)).toBe(false);
});

/* ------------------------------------------------------------------ */
/* Case F — comparison mode (real N > 3 exports)                      */
/* ------------------------------------------------------------------ */

test("case F: extended_n6 — comparison framing, engine-selected best, no 'Recommended'/'Optimal'", () => {
  const c = classifyResult(EXTENDED);
  expect(c.base).toBe("F");
  expect(c.bestStrategyKey).toBe("diversified"); // from global_switching_boundaries at λ

  const text = joined(c, EXTENDED);
  expect(text).toContain("With 6 candidate sites");
  expect(text).toContain("compares three named strategies");
  expect(text).toContain(
    "Spread across sites has the lowest combined cost and delay total",
  );
  expect(text).not.toMatch(/recommended allocation|optimal allocation/i);
  expect(text).not.toMatch(/\brecommended\b/i);
  expect(findBannedConstructions(text)).toEqual([]);
});

test("case F: larger_n10 — best strategy comes from the switching boundary, not a browser sort", () => {
  const c = classifyResult(LARGER);
  expect(c.base).toBe("F");
  expect(c.bestStrategyKey).toBe("speed_reliability");

  const text = joined(c, LARGER);
  expect(text).toContain("With 10 candidate sites");
  expect(text).toContain(
    "Schedule first has the lowest combined cost and delay total",
  );
  expect(findBannedConstructions(text)).toEqual([]);
});

test("case F: co-optimal segment names the whole tied set", () => {
  const sc = {
    ...EXTENDED,
    scenario: {
      ...EXTENDED.scenario,
      system: { ...EXTENDED.scenario.system, lambda_mw_month: 0 },
    },
    decision_boundaries: {
      ...EXTENDED.decision_boundaries,
      global_switching_boundaries: [
        {
          lambda_start: 0,
          strategy: "cost_concentration",
          co_optimal: ["cost_concentration", "diversified"],
        },
      ],
    },
  } as ShowcaseExport;
  const c = classifyResult(sc);
  expect(c.bestCoOptimalKeys).toEqual(["cost_concentration", "diversified"]);
  const text = joined(c, sc);
  expect(text).toContain("Cost first and Spread across sites are tied");
  expect(findBannedConstructions(text)).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* Banned-construction assertion                                      */
/* ------------------------------------------------------------------ */

test("no generated structural note contains a banned construction", () => {
  const cases: Array<[ShowcaseExport, ResultClassification]> = [];
  const push = (sc: ShowcaseExport) => cases.push([sc, classifyResult(sc)]);

  push(
    fakeOptimized({
      D: 300,
      atLambda: 0.05,
      capacities: { A: 300, B: 300, C: 150 },
      allocation: { A: 150, B: 0, C: 150 },
      pMeet: 0.64,
    }),
  );
  push(
    fakeOptimized({
      D: 600,
      atLambda: 0.5,
      capacities: { A: 200, B: 200, C: 200 },
      allocation: { A: 200, B: 200, C: 200 },
      pMeet: 0.3,
    }),
  );
  push(
    fakeOptimized({
      D: 600,
      atLambda: 0,
      capacities: { A: 200, B: 200, C: 200 },
      allocation: { A: 200, B: 200, C: 200 },
      pMeet: 0,
    }),
  );
  push(
    fakeOptimized({
      D: 400,
      atLambda: 0.03,
      capacities: { A: 300, B: 300 },
      allocation: { A: 300, B: 100 },
      isUnique: false,
      pMeet: 0.8,
    }),
  );
  push(BASELINE);
  push(EXTENDED);
  push(LARGER);

  for (const [sc, c] of cases) {
    const note = lines(sc, c);
    expect(() => assertNoBannedConstructions(note)).not.toThrow();
    for (const p of note) expect(findBannedConstructions(p)).toEqual([]);
  }
});

/* ------------------------------------------------------------------ */
/* The selection criterion — what "recommended" means                 */
/* ------------------------------------------------------------------ */

test("case A: the criterion is defined once, in public terms, at the scenario's own value", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0.025,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0.64,
  });
  const c = classifyResult(sc);
  const text = selectionCriterionFor(sc, c);
  expect(text).not.toBeNull();

  // The criterion, in the public vocabulary.
  expect(text!).toContain("relative development cost");
  expect(text!).toContain("delay consequence");
  expect(text!).toContain("expected delay burden");
  // The scenario's actual value, never a hard-coded one.
  expect(text!).toContain("delay consequence of 0.025");
  expect(text!).toContain("has the lowest combined cost and delay total");

  // Canonical notation stays on the Technical Documentation page.
  expect(text!).not.toMatch(/λ|lambda|E\[L\]|E\[S\]|\bJ\b|P\(meet/i);
  // A definition of the criterion, not an account of optimizer causality.
  expect(findBannedConstructions(text!)).toEqual([]);
  expect(text!).not.toMatch(/because|therefore|in order to/i);
});

test("the criterion sentence carries the scenario's own delay consequence", () => {
  const at = (lam: number) =>
    selectionCriterionFor(
      fakeOptimized({
        D: 300,
        atLambda: lam,
        capacities: { A: 300, B: 300 },
        allocation: { A: 150, B: 150 },
        pMeet: 0.5,
      }),
      classifyResult(
        fakeOptimized({
          D: 300,
          atLambda: lam,
          capacities: { A: 300, B: 300 },
          allocation: { A: 150, B: 150 },
          pMeet: 0.5,
        }),
      ),
    );
  expect(at(0.05)!).toContain("delay consequence of 0.05");
  expect(at(1.25)!).toContain("delay consequence of 1.25");
});

test("case C: the tied result states the criterion without claiming a unique lowest", () => {
  const sc = fakeOptimized({
    D: 400,
    atLambda: 0.03,
    capacities: { A: 300, B: 300 },
    allocation: { A: 300, B: 100 },
    isUnique: false,
    pMeet: 0.8,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("C");
  const text = selectionCriterionFor(sc, c);
  expect(text).not.toBeNull();
  expect(text!).toContain(
    "is one of those with the lowest combined cost and delay total",
  );
  expect(findBannedConstructions(text!)).toEqual([]);
});

test("case B: a structurally forced allocation is never given a selection criterion", () => {
  const sc = fakeOptimized({
    D: 600,
    atLambda: 0.5,
    capacities: { A: 200, B: 200, C: 200 },
    allocation: { A: 200, B: 200, C: 200 },
    pMeet: 0.3,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("B");
  // Nothing was selected, so nothing is described as having been selected.
  expect(selectionCriterionFor(sc, c)).toBeNull();
  expect(allocationHeading(c)).toBe("Required allocation");
});

test("case D: the cost-only run keeps its own interpretation, with no second criterion line", () => {
  const sc = fakeOptimized({
    D: 300,
    atLambda: 0,
    capacities: { A: 300, B: 300 },
    allocation: { A: 300, B: 0 },
    pMeet: 0.5,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("D");
  expect(selectionCriterionFor(sc, c)).toBeNull();
  expect(joined(c, sc)).toContain("minimizes development cost only");
});

test("case F: comparison mode is not described as optimization over feasible allocations", () => {
  for (const sc of [EXTENDED, LARGER]) {
    const c = classifyResult(sc);
    expect(c.base).toBe("F");
    expect(selectionCriterionFor(sc, c)).toBeNull();
    expect(joined(c, sc)).toContain(
      "rather than optimizing across every possible allocation",
    );
  }
});

test("the banned-construction checker actually catches the forbidden constructions", () => {
  for (const token of [
    "chose",
    "preferred",
    "favored",
    "decided",
    "judged",
    "recommends because",
    "which is why",
    "so the model placed",
    "because of this",
    "optimizer therefore",
    "must carry at least",
  ]) {
    expect(BANNED_CONSTRUCTIONS).toContain(token);
  }

  expect(
    findBannedConstructions(
      "The model chose Site A because of this, which is why the optimizer therefore favored it.",
    ).length,
  ).toBeGreaterThan(0);
  expect(
    findBannedConstructions("Site A must carry at least 100 MW of the requirement."),
  ).toContain("must carry at least");
  expect(() =>
    assertNoBannedConstructions(["The model preferred the cheaper site."]),
  ).toThrow(/banned construction/i);

  // Ordinary vocabulary is not tripped by the word-boundary matchers.
  expect(
    findBannedConstructions(
      "There is no choice about where the capacity goes, so every site is fully allocated.",
    ),
  ).toEqual([]);
});


/* ------------------------------------------------------------------ */
/* The plain-language conclusion, before criterion or method          */
/* ------------------------------------------------------------------ */

test("lead: an ordinary optimized result names the sites that receive capacity", () => {
  const sc = fakeOptimized({
    D: 300,
    target: 30,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 150, B: 0, C: 150 },
    pMeet: 0.64,
  });
  const c = classifyResult(sc);
  const lead = decisionLeadFor(sc, c);
  expect(lead).not.toBeNull();
  expect(lead).toContain("Site A 150 MW");
  expect(lead).toContain("Site C 150 MW");
  // A site with no allocation is stated as taking none, not omitted.
  expect(lead).toContain("Site B takes none");
  // The conclusion, not the criterion: the criterion sentence follows it.
  expect(lead).not.toMatch(/lowest combined/i);
  assertNoBannedConstructions([lead as string]);
});

test("lead: a forced allocation says so before any metric is read", () => {
  const sc = fakeOptimized({
    D: 750,
    target: 30,
    atLambda: 0.05,
    capacities: { A: 300, B: 300, C: 150 },
    allocation: { A: 300, B: 300, C: 150 },
    pMeet: 0.5,
  });
  const c = classifyResult(sc);
  expect(c.base).toBe("B");
  const lead = decisionLeadFor(sc, c);
  expect(lead).toContain("Every candidate site is developed in full");
  expect(lead).toContain("Site A 300 MW");
  assertNoBannedConstructions([lead as string]);
});

test("lead: comparison mode is named as the best of the strategies compared", () => {
  const c = classifyResult(EXTENDED);
  expect(c.base).toBe("F");
  const lead = decisionLeadFor(EXTENDED, c);
  expect(lead).not.toBeNull();
  expect(lead).toMatch(/best of the strategies compared/i);
  // Never "optimal", "optimized", or "global" for a comparison-mode result.
  expect(lead).not.toMatch(/\boptimi[sz]ed\b|\bglobal\b/i);
  assertNoBannedConstructions([lead as string]);
});

test("lead: no authoritative allocation yields no lead sentence", () => {
  const empty = {
    ...EXTENDED,
    optimizer: null,
    decision_boundaries: {
      pairwise_break_even_lambda: [],
      global_switching_boundaries: [],
      global_switching_has_cooptimal_segments: false,
    },
  } as unknown as ShowcaseExport;
  const c = classifyResult(empty);
  expect(decisionLeadFor(empty, c)).toBeNull();
});

test("the objective-versus-diagnostics explanation names both diagnostics and no J", () => {
  const text = OBJECTIVE_VERSUS_DIAGNOSTICS;
  expect(text).toMatch(/development cost/i);
  expect(text).toMatch(/delay consequence/i);
  expect(text).toMatch(/expected delay burden/i);
  expect(text).toMatch(/chance of meeting the target date/i);
  expect(text).toMatch(/expected shortfall/i);
  // Plain language, not a symbol: the combined objective is never printed as
  // a value or a column on the Decision page.
  expect(text).not.toMatch(/\bJ\b/);
  assertNoBannedConstructions([text]);
});
