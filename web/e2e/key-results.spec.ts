import { test, expect } from "@playwright/test";
import baselineFile from "./fixtures/baseline_n3.json" with { type: "json" };
import extendedFile from "./fixtures/extended_n6.json" with { type: "json" };
import largerFile from "./fixtures/larger_n10.json" with { type: "json" };
import {
  headlineRows,
  type HeadlineResultsProps,
} from "../src/components/HeadlineResults";
import { allocationHeading } from "../src/lib/explanation";
import { classifyResult, type ResultClassification } from "../src/lib/resultCase";
import type { ShowcaseExport } from "../src/types/showcase";

/**
 * Targeted gate — the public Key Results. Pure-logic assertions over
 * `headlineRows()` (the row model behind `HeadlineResults`) and
 * `allocationHeading`. No browser, no live API, and no model quantity is
 * computed here: every displayed value is a formatted engine field. Run with
 * `--config e2e/logic.playwright.config.ts`.
 *
 * The evaluation-method line (exact enumeration vs Monte Carlo) is no longer
 * part of the primary decision result; the distinction is documented in the
 * Technical Documentation instead, and is covered by that page's spec.
 */

const realShowcase = (file: unknown): ShowcaseExport =>
  (file as { showcase: unknown }).showcase as ShowcaseExport;

const BASELINE = realShowcase(baselineFile);
const EXTENDED = realShowcase(extendedFile);
const LARGER = realShowcase(largerFile);

/** The four public numeric-row labels, in render order. */
const PUBLIC_LABELS = [
  "Chance of meeting the target date",
  "Expected shortfall at the target date",
  "Expected delay burden",
  "Relative development cost",
] as const;

/** Notation that must never appear on the primary result surface. */
const BANNED_NOTATION = ["P(meet", "E[L]", "Objective J", "J =", "Σ c"];

const rowText = (props: HeadlineResultsProps): string =>
  headlineRows(props)
    .flatMap((r) => [r.term, r.value, r.def])
    .join("   ");

/* ------------------------------------------------------------------ */
/* Mode-dependent allocation heading                                 */
/* ------------------------------------------------------------------ */

test("allocation heading is mode-dependent and never mislabels comparison/forced/cost-only", () => {
  const at = (base: ResultClassification["base"]) =>
    allocationHeading({ base } as ResultClassification);

  expect(at("A")).toBe("Recommended allocation");
  expect(at("C")).toBe("Recommended allocation");
  expect(at("B")).toBe("Required allocation");
  expect(at("D")).toBe("Lowest-cost allocation (delay consequence set to 0)");
  expect(at("F")).toBe("Best of the compared strategies");

  // Comparison mode must never be called recommended or optimal.
  expect(at("F")).not.toMatch(/recommended|optimal/i);
  // Forced / cost-only must never be called recommended.
  expect(at("B")).not.toMatch(/recommended/i);
  expect(at("D")).not.toMatch(/recommended/i);
});

test("real comparison exports classify as F and take the comparison heading", () => {
  expect(classifyResult(EXTENDED).base).toBe("F");
  expect(classifyResult(LARGER).base).toBe("F");
  expect(allocationHeading(classifyResult(EXTENDED))).toBe(
    "Best of the compared strategies",
  );
  // The forced-case heading is exactly the intended wording.
  expect(allocationHeading({ base: "B" } as ResultClassification)).toBe(
    "Required allocation",
  );
  // The delay-consequence-zero heading is unchanged.
  expect(allocationHeading({ base: "D" } as ResultClassification)).toBe(
    "Lowest-cost allocation (delay consequence set to 0)",
  );
});

/* ------------------------------------------------------------------ */
/* headlineRows — four public rows, correct units, no old notation    */
/* ------------------------------------------------------------------ */

test("headlineRows yields exactly the four public labels and no old notation", () => {
  const rows = headlineRows({
    developmentCost: 500,
    pMeet: 0.42,
    expectedShortfall: 123.4,
    expectedDelayBurden: 4425,
    targetMonth: 36,
  });

  expect(rows.map((r) => r.term)).toEqual([...PUBLIC_LABELS]);

  const text = rowText({
    developmentCost: 500,
    pMeet: 0.42,
    expectedShortfall: 123.4,
    expectedDelayBurden: 4425,
    targetMonth: 36,
  });
  for (const token of BANNED_NOTATION) expect(text).not.toContain(token);
  expect(text).not.toMatch(/objective\s*j/i);
  expect(text).not.toMatch(/\bλ\b|lambda/i);
  expect(text).not.toContain("λ·");
});

test("probability renders as a percent, shortfall in MW, burden in MW-months, cost non-currency", () => {
  const rows = headlineRows({
    developmentCost: 500,
    pMeet: 0.216,
    expectedShortfall: 484.4,
    expectedDelayBurden: 4425,
    targetMonth: 36,
  });
  const byTerm = Object.fromEntries(rows.map((r) => [r.term, r.value]));

  expect(byTerm["Chance of meeting the target date"]).toBe("21.6%");
  expect(byTerm["Expected shortfall at the target date"]).toBe("484 MW");
  expect(byTerm["Expected delay burden"]).toBe("4,425.0 MW-months");
  expect(byTerm["Relative development cost"]).toBe("500.00 rel. units");
  expect(rowText({
    developmentCost: 500,
    pMeet: 0.216,
    expectedShortfall: 484.4,
    expectedDelayBurden: 4425,
    targetMonth: 36,
  })).not.toContain("$");
});

/* ------------------------------------------------------------------ */
/* Full Key Results in every structural case — no threshold           */
/* ------------------------------------------------------------------ */

test("chance and expected shortfall render for an optimized result", () => {
  const ev = BASELINE.optimizer!.evaluated;
  const rows = headlineRows({
    developmentCost: ev.development_cost,
    pMeet: ev.p_meet,
    expectedShortfall: ev.expected_shortfall_mw,
    expectedDelayBurden: ev.expected_delay_burden_mw_months,
    targetMonth: BASELINE.scenario.system.target_month,
  });
  const byTerm = Object.fromEntries(rows.map((r) => [r.term, r.value]));
  expect(byTerm["Chance of meeting the target date"]).toBe("0.0%");
  expect(byTerm["Expected shortfall at the target date"]).toBe("400 MW");
});

test("chance and expected shortfall render unconditionally at p_meet = 0 and for forced portfolios", () => {
  // Zero-chance overlay: baseline_n3 evaluated p_meet is exactly 0.
  expect(BASELINE.optimizer!.evaluated.p_meet).toBe(0);
  const zeroChance = headlineRows({
    developmentCost: 500,
    pMeet: 0,
    expectedShortfall: 400,
    expectedDelayBurden: 4425,
    targetMonth: 36,
  });
  expect(zeroChance.map((r) => r.term)).toEqual([...PUBLIC_LABELS]);
  const zByTerm = Object.fromEntries(zeroChance.map((r) => [r.term, r.value]));
  expect(zByTerm["Chance of meeting the target date"]).toBe("0.0%");
  expect(zByTerm["Expected shortfall at the target date"]).toBe("400 MW");

  // A forced (case B) portfolio renders the same four rows — no hiding.
  const forced = headlineRows({
    developmentCost: 600,
    pMeet: 0.3,
    expectedShortfall: 210,
    expectedDelayBurden: 900,
    targetMonth: 30,
  });
  expect(forced.map((r) => r.term)).toEqual([...PUBLIC_LABELS]);
  const fByTerm = Object.fromEntries(forced.map((r) => [r.term, r.value]));
  expect(fByTerm["Chance of meeting the target date"]).toBe("30.0%");
  expect(fByTerm["Expected shortfall at the target date"]).toBe("210 MW");
});

test("tiny non-zero probabilities are shown as <0.1%, distinct from exact-zero 0.0%", () => {
  const mk = (pMeet: number) =>
    headlineRows({
      developmentCost: 500,
      pMeet,
      expectedShortfall: 399,
      expectedDelayBurden: 4000,
      targetMonth: 36,
    });

  const small = mk(0.0004);
  expect(small.map((r) => r.term)).toEqual([...PUBLIC_LABELS]);
  // A positive value below the public display resolution keeps its sign,
  // it is not rounded down into the structural zero-chance state.
  expect(small[0].value).toBe("<0.1%");

  // Exact zero (case E) stays visibly distinct.
  expect(mk(0)[0].value).toBe("0.0%");
});

/* ------------------------------------------------------------------ */
/* Comparison mode draws Key Results from the engine-selected best     */
/* ------------------------------------------------------------------ */

test("comparison-mode Key Results come from classification.bestStrategy (engine-selected, not a browser sort)", () => {
  const c = classifyResult(EXTENDED);
  expect(c.base).toBe("F");
  const best = c.bestStrategy;
  expect(best).not.toBeNull();
  // The best strategy is the one on the switching-boundary segment for λ.
  expect(c.bestStrategyKey).toBe("diversified");

  for (const v of [
    best!.development_cost,
    best!.p_meet,
    best!.expected_shortfall_mw,
    best!.expected_delay_burden_mw_months,
  ]) {
    expect(Number.isFinite(v)).toBe(true);
  }

  const rows = headlineRows({
    developmentCost: best!.development_cost,
    pMeet: best!.p_meet,
    expectedShortfall: best!.expected_shortfall_mw,
    expectedDelayBurden: best!.expected_delay_burden_mw_months,
    targetMonth: EXTENDED.scenario.system.target_month,
  });
  expect(rows.map((r) => r.term)).toEqual([...PUBLIC_LABELS]);
  // diversified shortfall 359.63 → 360 MW, shown with MW units.
  expect(rows[1].value).toBe("360 MW");
  const text = rows.flatMap((r) => [r.term, r.value, r.def]).join(" ");
  for (const token of BANNED_NOTATION) expect(text).not.toContain(token);
});
