import { test, expect, type Page } from "@playwright/test";
import {
  expectLiveResult,
  gotoDecision,
  loadExample,
  runAnalysis,
} from "./helpers";

/**
 * Envelope identity across a λ-only edit.
 *
 * `build_envelope()` (src/trackc/experiments/envelope.py) ignores
 * `scenario.system.lambda_mw_month` — the envelope is defined ACROSS λ — so a
 * curated preset's validated, precomputed λ envelope stays applicable when the
 * loaded scenario differs from the preset ONLY in the Delay consequence. The
 * application carries that envelope forward on an envelope-identity match; it
 * never recomputes it live and never synthesizes new sensitivity data. Any
 * change to an envelope-defining input (a site capacity or cost, a site state,
 * the requirement, the target date, the horizon, site membership) breaks the
 * identity and the preset envelope is dropped.
 *
 * The decision page surfaces the retained envelope as the "Decision
 * sensitivity" sentence, which renders only when the result on screen carries
 * a `lambda_envelope` with a located breakpoint above the scenario's current
 * Delay consequence. "Balanced portfolio" ships breakpoints at ~0.008, ~0.008,
 * ~0.133 and ~0.267, so a breakpoint sits above λ = 0, above its own λ = 0.05,
 * and above λ = 0.1 alike.
 */

const PRESET = "balanced_portfolio" as const;

function sensitivitySentence(page: Page) {
  return page.locator(".sensitivity__sentence");
}

async function analyzeAndWait(page: Page) {
  const optimized = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await optimized;
  await expectLiveResult(page);
}

test("an unchanged preset keeps its precomputed envelope after Analyze", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, PRESET);
  await expect(sensitivitySentence(page)).toBeVisible();

  await analyzeAndWait(page);
  // Same portfolio, same envelope identity: the validated envelope is carried
  // verbatim onto the live result.
  await expect(sensitivitySentence(page)).toBeVisible();
});

test("a λ-only edit to 0 keeps the preset envelope available after Analyze", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, PRESET);

  await page.fill("#delay-consequence", "0");
  await analyzeAndWait(page);

  // Only the Delay consequence moved, so the envelope identity is unchanged
  // and the precomputed envelope still describes this portfolio.
  await expect(sensitivitySentence(page)).toBeVisible();
  await expect(sensitivitySentence(page)).toContainText(
    /up from the scenario’s 0,/,
  );
  // The example selector correctly records the edit without discarding it.
  await expect(page.locator(".example-menu__edited")).toContainText(
    /Edited from Balanced portfolio/i,
  );
});

test("a λ-only edit to another valid value keeps the preset envelope available after Analyze", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, PRESET);

  await page.fill("#delay-consequence", "0.1");
  await analyzeAndWait(page);

  await expect(sensitivitySentence(page)).toBeVisible();
  await expect(sensitivitySentence(page)).toContainText(
    /up from the scenario’s 0\.1,/,
  );
  await expect(page.locator(".example-menu__edited")).toContainText(
    /Edited from Balanced portfolio/i,
  );
});

test("changing an envelope-defining input drops the preset envelope", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, PRESET);
  await expect(sensitivitySentence(page)).toBeVisible();

  // A site capacity is an envelope-defining input: 300 -> 350 keeps the
  // portfolio feasible (requirement is 300 MW) but is a different portfolio,
  // so the preset's precomputed envelope no longer applies.
  await page.fill("#site-0-capacity", "350");
  await analyzeAndWait(page);

  await expect(sensitivitySentence(page)).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /^Decision sensitivity$/ }),
  ).toHaveCount(0);
});
