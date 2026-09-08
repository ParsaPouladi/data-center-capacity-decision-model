import { test, expect, type Page } from "@playwright/test";
import exampleFile from "../public/data/cheap_site_risky_schedule.json" with { type: "json" };
import {
  buildComparisonPortfolio,
  expectLiveResult,
  gotoDecision,
  loadExample,
  requiredCapacityField,
  runAnalysis,
} from "./helpers";
import type { ShowcaseExport } from "../src/types/showcase";

/**
 * The Decision page assembled as one decision story. The spec proves
 * structural / presentation properties only; it re-derives no model quantity.
 *
 * For a valid result the story runs
 *   decision → tradeoff → outcome → physical mechanism:
 *
 *   The decision  (allocation + the four numbers + any structural note +
 *                  decision sensitivity where the export supports it)
 *   → Choice comparison
 *   → Delivery outlook
 *   → Site delivery
 *
 * A successful result has no status callout above it, and an ordinary
 * optimized result has no explanatory prose repeating the allocation. The
 * evaluation-method line (exact enumeration vs Monte Carlo) is documented in
 * the Technical Documentation, not on the primary result.
 *
 * Comparison mode is a first-class result, not a warning. No developer
 * vocabulary (seed number, engine / mapping versions, raw λ, "deployment",
 * "not run", "not computed", "not shown") is rendered, and the site-delay
 * independence assumption is not on this page.
 */

const EXAMPLE = (exampleFile as { showcase: unknown }).showcase as ShowcaseExport;

/** The ordered <h2> section headings inside the rendered result. */
async function resultHeadings(page: Page): Promise<string[]> {
  const raw = await page.locator(".results .section-heading").allInnerTexts();
  return raw.map((s) => s.trim());
}

/** Page-level horizontal overflow, ignoring content inside a .table-scroll. */
async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.closest(".table-scroll") && !el.classList.contains("table-scroll")) {
        continue;
      }
      if (el.getBoundingClientRect().right > vw + 1) {
        offenders.push(
          `${el.tagName}.${(el.className || "").toString().trim().split(/\s+/)[0]}`,
        );
      }
    }
    return { scrollW: de.scrollWidth, clientW: vw, offenders: [...new Set(offenders)] };
  });
}

/* Concepts that must never be rendered on the assembled Decision page. */
const DEV_VOCABULARY = [
  /not computed/i,
  /not shown/i,
  /not run/i,
  /deployment/i,
  /LP solve/i,
  /co-optimality tolerance/i,
  /engine version/i,
  /mapping version/i,
  /generated_by/i,
  /random seed/i,
  /seed \d/i,
  /provenance/i,
  /independen/i, // the site-delay independence assumption belongs to Technical Documentation
  /λ/,
];

/* ------------------------------------------------------------------ */
/* Blank first load                                                    */
/* ------------------------------------------------------------------ */

test("a blank first load shows the builder and no result", async ({ page }) => {
  await gotoDecision(page);

  await expect(page.locator(".results-empty")).toBeVisible();
  await expect(page.locator(".results-context")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^The decision$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^Key results$/ }),
  ).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* Optimizer-mode journey                                              */
/* ------------------------------------------------------------------ */

test("an optimizer-mode result reads decision, then tradeoff, then outcome, then mechanism", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  // A loaded example is named by a restrained context label, not by a
  // callout explaining what a precomputed run is. No developer detail.
  const context = page.locator(".results-context");
  await expect(context).toHaveText("Example: Cheap site, risky schedule");
  await expect(context).not.toContainText(/seed|precomputed|engine/i);

  // "Cheap site, risky schedule" carries a lambda_envelope with a breakpoint
  // above its delay consequence, so decision sensitivity renders with the
  // primary decision summary.
  expect(EXAMPLE.lambda_envelope).not.toBeNull();
  expect(EXAMPLE.optimizer).not.toBeNull();

  expect(await resultHeadings(page)).toEqual([
    "The decision",
    "Choice comparison",
    "Delivery outlook",
    "Site delivery",
  ]);

  // The mode-dependent allocation sub-heading and all four public numbers
  // are inside the decision section.
  const decision = page.getByRole("region", { name: /^The decision$/ });
  await expect(
    decision.getByRole("heading", { name: /^Recommended allocation$/ }),
  ).toBeVisible();
  // Scoped to the Key Results block: the same words also appear, correctly,
  // in the sentence defining the criterion the allocation was selected on.
  const keyResults = decision.locator(".decision-grid__numbers");
  for (const label of [
    /Chance of meeting the target date/i,
    /Expected shortfall at the target date/i,
    /Expected delay burden/i,
    /Relative development cost/i,
  ]) {
    await expect(keyResults.getByText(label)).toBeVisible();
  }

  // An ordinary optimized result carries no prose restating the allocation,
  // and no evaluation-method line.
  await expect(page.locator(".decision-note")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /What this result means/i }),
  ).toHaveCount(0);
  const results = await page.locator(".results").innerText();
  expect(results).not.toMatch(/combinations of site delays/i);
  expect(results).not.toMatch(/Monte Carlo|sampled combinations/i);
});

/* ------------------------------------------------------------------ */
/* What "Recommended allocation" means                                 */
/* ------------------------------------------------------------------ */

test("an optimized result defines the criterion it was selected on, in the golden synthesis", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  const decision = page.getByRole("region", { name: /^The decision$/ });
  const synthesis = decision.locator(".decision-synthesis__text");
  await expect(synthesis).toBeVisible();
  await expect(synthesis).toContainText(
    /relative development cost plus the delay consequence applied to the expected delay burden/i,
  );
  // The scenario's own value, not a fixed one.
  await expect(synthesis).toContainText(/delay consequence of 0\.025/);
  // Public vocabulary only: the canonical notation stays in the documentation.
  await expect(synthesis).not.toContainText("λ");
  await expect(synthesis).not.toContainText("E[L]");
  await expect(synthesis).not.toContainText("J");

  // The criterion's own documentation link now lives with the Choice
  // comparison's technical basis, once, rather than repeated beside the
  // synthesis paragraph.
  const comparison = page.getByRole("region", { name: /Choice comparison/i });
  await expect(
    comparison.getByRole("link", { name: /How this criterion is defined/i }),
  ).toHaveAttribute("href", "/technical-documentation.html#objective");
});

test("the criterion is stated for a live custom optimized run too", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  await requiredCapacityField(page).fill("610");
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);

  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /delay consequence applied to the expected delay burden/i,
  );
});

/* ------------------------------------------------------------------ */
/* The close of the story: pointer to the mathematics                 */
/* ------------------------------------------------------------------ */

test("every valid result ends with a quiet pointer to Technical Documentation", async ({
  page,
}) => {
  await gotoDecision(page);
  // Absent before there is a result to point from.
  await expect(page.locator(".method-note")).toHaveCount(0);

  await loadExample(page, "cheap_site_risky_schedule");
  const note = page.locator(".method-note");
  await expect(note).toBeVisible();
  await expect(note).toContainText(
    /equations, assumptions, state mappings, optimization method, and sensitivity methodology/i,
  );
  await expect(
    note.getByRole("link", { name: /^Technical Documentation$/ }),
  ).toHaveAttribute("href", "/technical-documentation.html");

  // It closes the story: nothing in the results region follows it.
  const isLast = await page.evaluate(() => {
    const results = document.querySelector(".results");
    return results?.lastElementChild?.classList.contains("method-note");
  });
  expect(isLast).toBe(true);

  // It is a pointer, not a third engagement surface.
  await expect(note.locator(".cta__link")).toHaveCount(0);
  await expect(note).not.toContainText(/contact|discuss a project/i);

  // Present for a live custom run, where the example-only sensitivity link
  // does not exist.
  await requiredCapacityField(page).fill("610");
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);
  await expect(
    page.getByRole("heading", { name: /^Decision sensitivity$/ }),
  ).toHaveCount(0);
  await expect(page.locator(".method-note")).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Worked-example pointers into Technical Documentation                */
/* ------------------------------------------------------------------ */

/**
 * The two most important figures — the
 * regime map and the cost / delay tradeoff — are built from a committed
 * example portfolio and its precomputed λ envelope, which this page does not
 * compute for a live scenario. They therefore stay in Technical Documentation
 * and are reached from here by a quiet pointer, which must say in its own link
 * text that it leads to a worked example.
 */
test("the decision story points at both worked-example figures, without claiming they are this scenario", async ({
  page,
}) => {
  await gotoDecision(page);
  // Nothing to point from before there is a result.
  await expect(page.locator(".worked-example-note")).toHaveCount(0);

  await loadExample(page, "cheap_site_risky_schedule");
  const notes = page.locator(".worked-example-note");
  await expect(notes).toHaveCount(2);

  // 1. Beside the decision: how the allocation moves with the delay
  //    consequence, linked straight to "Regimes and boundaries".
  const regimeLink = page.getByRole("link", {
    name: /See a worked example of how the allocation changes as the delay consequence moves/i,
  });
  await expect(regimeLink).toHaveAttribute(
    "href",
    "/technical-documentation.html#regimes",
  );

  // 2. Beside the comparison: the cost / delay tradeoff figure.
  const tradeoffLink = page.getByRole("link", {
    name: /See a worked example of the development-cost versus expected-delay-burden tradeoff/i,
  });
  await expect(tradeoffLink).toHaveAttribute(
    "href",
    "/technical-documentation.html#break-even",
  );

  // Each says plainly that it is not the scenario on screen.
  for (const note of await notes.all()) {
    await expect(note).toContainText(/worked example/i);
    await expect(note).toContainText(/not this scenario/i);
    // A pointer, not a third engagement surface.
    await expect(note.locator("button")).toHaveCount(0);
    await expect(note.locator(".cta__link")).toHaveCount(0);
  }

  // The story order is unchanged: the regime pointer sits in the decision
  // section, the tradeoff pointer in the comparison section.
  await expect(
    page.locator(".section--decision .worked-example-note"),
  ).toHaveCount(1);
  await expect(
    page
      .getByRole("region", { name: /Choice comparison/i })
      .locator(".worked-example-note"),
  ).toHaveCount(1);

  // No live sensitivity is computed, and no "unavailable" message replaces it.
  await expect(page.locator(".results")).not.toContainText(
    /unavailable|not computed|cannot be shown/i,
  );
});

test("both worked-example anchors resolve to real documentation subsections", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html#regimes");
  await expect(page.locator("#regimes")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#regimes")).toContainText(/Regimes and boundaries/i);

  await page.goto("/technical-documentation.html#break-even");
  await expect(page.locator("#break-even")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#break-even .chart-figure")).not.toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* Conditional delay-consequence sentence                             */
/* ------------------------------------------------------------------ */

test("decision sensitivity sits with the primary decision, and never appears for a live custom run", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  // It answers "what would have to change?", inside the decision section
  // rather than as a distant mathematical aside.
  const decision = page.getByRole("region", { name: /^The decision$/ });
  const sensitivity = decision.locator(".sensitivity");
  await expect(
    sensitivity.getByRole("heading", { name: /^Decision sensitivity$/ }),
  ).toBeVisible();
  // The two substantive findings — the breakpoint value and the direction of
  // the capacity move — carried in one sentence and given the emphasis.
  const sentence = sensitivity.locator(".sensitivity__sentence");
  await expect(sentence).toContainText(/Above 0\.037 delay consequence/);
  await expect(sentence).toContainText(/up from the scenario.s 0\.025/);
  await expect(sentence).toContainText(
    /the allocation changes, shifting capacity from Site A toward Site B\./,
  );
  await expect(sensitivity.locator(".sensitivity__threshold")).toHaveText("0.037");
  await expect(sensitivity.locator(".sensitivity__shift")).toContainText(
    "from Site A toward Site B",
  );
  // Exactly one documentation pointer sits with the sensitivity finding, and
  // it says in its own link text that the figure it opens is a worked example
  // rather than this scenario. A second, differently-worded link here promised
  // something scenario-specific and landed on the same fixed example.
  const pointer = sensitivity.locator(".worked-example-note");
  await expect(pointer).toHaveCount(1);
  await expect(pointer.getByRole("link")).toHaveAttribute(
    "href",
    "/technical-documentation.html#regimes",
  );
  await expect(pointer).toContainText(/worked example/i);
  await expect(
    sensitivity.getByRole("link", { name: /Explore sensitivity/i }),
  ).toHaveCount(0);
  await expect(sensitivity).not.toContainText("λ");

  // Re-analyze the same portfolio live: the envelope is a precomputed
  // artifact, so the sentence must not appear for a custom run.
  await requiredCapacityField(page).fill("610");
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);
  await expect(
    page.getByRole("heading", { name: /^Decision sensitivity$/ }),
  ).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* Comparison mode is first-class                                      */
/* ------------------------------------------------------------------ */

test("comparison mode is a first-class result with no deployment or unavailable warning", async ({
  page,
}) => {
  await gotoDecision(page);
  // No curated example is above the live-optimization site limit; build one
  // in the builder so the analysis routes to the strategy-comparison path.
  await buildComparisonPortfolio(page);

  // The compact journey, with no conditional delay sentence (a live custom
  // run carries no precomputed lambda_envelope).
  expect(await resultHeadings(page)).toEqual([
    "The decision",
    "Choice comparison",
    "Delivery outlook",
    "Site delivery",
  ]);

  const results = page.locator(".results");
  await expect(results).toContainText(/Best of the compared strategies/i);
  // Comparison mode is a structural case, explained in the golden synthesis.
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /compares three named strategies/i,
  );
  // ... and is never dressed up as optimization over feasible allocations.
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /not a search over every feasible allocation/i,
  );
  await expect(page.locator(".selection-criterion")).toHaveCount(0);

  // None of the old guardrail / deployment framing survives.
  const text = await results.innerText();
  expect(text).not.toMatch(/No single optimized allocation/i);
  expect(text).not.toMatch(/deployment limit/i);
  expect(text).not.toMatch(/not a limit of the model/i);
  expect(text).not.toMatch(/\brecommend/i);
  expect(text).not.toMatch(/\boptimal\b/i);
  for (const re of DEV_VOCABULARY) expect(text).not.toMatch(re);

  // Key results are still populated, from the engine-selected best strategy.
  const decision = page.getByRole("region", { name: /^The decision$/ });
  await expect(
    decision.getByText(/Chance of meeting the target date/i),
  ).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Forced allocation                                                   */
/* ------------------------------------------------------------------ */

test("the exact forced case keeps Required allocation, drops the delay sentence, and suppresses V3", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  const sumK = EXAMPLE.scenario.sites.reduce((a, s) => a + s.capacity_mw, 0);
  expect(sumK).toBe(1050);
  await requiredCapacityField(page).fill(String(sumK));
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);

  await expect(
    page.getByRole("heading", { name: /^Required allocation$/ }),
  ).toBeVisible();
  expect(await resultHeadings(page)).toEqual([
    "The decision",
    "Delivery outlook",
    "Site delivery",
  ]);
  // No empty placeholder for the section that does not apply.
  await expect(
    page.getByRole("region", { name: /Choice comparison/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^Decision sensitivity$/ }),
  ).toHaveCount(0);
  // The structural fact survives, in the golden synthesis: there is no
  // allocation choice to make.
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /forces every developable megawatt into use/i,
  );
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /no allocation to prefer over another/i,
  );
  // Nothing was selected, so nothing describes a selection criterion here.
  await expect(page.locator(".selection-criterion")).toHaveCount(0);
  await expect(page.locator(".results")).not.toContainText(
    /Feasible allocations are compared/i,
  );
});

/**
 * Spacing defect: the structural explanation above "Required
 * allocation" had no bottom margin, so it sat visually flush against the
 * subsection beneath it. This does not pin an exact pixel value -- only that
 * a deliberate gap exists, so a future edit cannot silently drop it again.
 * The explanation moved from the old structural note into the golden
 * synthesis block; the gap requirement moves with it.
 */
test("the golden synthesis keeps a deliberate gap above the section it precedes", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  const sumK = EXAMPLE.scenario.sites.reduce((a, s) => a + s.capacity_mw, 0);
  await requiredCapacityField(page).fill(String(sumK));
  await runAnalysis(page);
  await expectLiveResult(page);

  const synthesis = page.locator(".decision-synthesis");
  await expect(synthesis).toBeVisible();
  const marginBottom = await synthesis.evaluate(
    (el) => parseFloat(getComputedStyle(el).marginBottom),
  );
  expect(marginBottom).toBeGreaterThan(0);
});

/* ------------------------------------------------------------------ */
/* The old technical-report stack is gone                              */
/* ------------------------------------------------------------------ */

test("the Explore layer and the obsolete Decision-page sections are absent", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  for (const name of [
    /Explore the decision/i,
    /Decision summary/i,
    /Portfolio and site conditions/i,
    /Cost-minimizing optimizer/i,
    /λ sensitivity/i,
    /Break-even λ and regime switching/i,
    /Evaluate a specific allocation/i,
    /Provenance and reproducibility/i,
    /How inputs become a decision/i,
    /What this result means/i,
    /If delay mattered more/i,
  ]) {
    await expect(page.getByRole("heading", { name })).toHaveCount(0);
  }

  // No developer vocabulary anywhere in the rendered result, and no
  // independence-assumption copy.
  const text = await page.locator(".results").innerText();
  for (const re of DEV_VOCABULARY) expect(text).not.toMatch(re);
});

/* ------------------------------------------------------------------ */
/* Responsive                                                          */
/* ------------------------------------------------------------------ */

test("640 px viewport: the assembled result has no page-level horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  await expect(
    page.getByRole("region", { name: /^The decision$/ }),
  ).toBeVisible();

  const overflow = await pageOverflow(page);
  expect(overflow.offenders, "overflowing elements at 640 px").toEqual([]);
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
});
