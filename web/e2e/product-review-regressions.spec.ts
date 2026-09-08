import { expect, test, type Page } from "@playwright/test";
import { gotoDecision, loadExample, runAnalysis } from "./helpers";

/**
 * Product-review regressions.
 *
 * Covers concrete defects and commercial-positioning changes not already
 * exercised by the more targeted specs (`input-domain-feasibility.spec.ts`
 * owns the exact 7,000 / 5,778 / 1,222 MW capacity-gap case;
 * `technical-documentation.spec.ts` owns the unified notation table).
 * Nothing here re-checks model arithmetic.
 */

const ASK_STANDALONE_EMBEDDED =
  /Need a project-specific model for a larger or more complex decision\?/i;

/** Width in CSS px of the first element matching `selector`. */
async function widthOf(page: Page, selector: string): Promise<number> {
  const box = await page.locator(selector).first().boundingBox();
  expect(box, `no bounding box for "${selector}"`).not.toBeNull();
  return box!.width;
}

/** Fill `count` blank site rows (assumed already present via "Add site")
 * with a minimal valid configuration. */
async function fillSites(page: Page, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await page.fill(`#site-${i}-capacity`, "100");
    await page.fill(`#site-${i}-cost`, "1");
    await page.locator(`#site-${i}-complexity`).selectOption("1");
    await page.locator(`#site-${i}-uncertainty`).selectOption("1");
  }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
});

/* ------------------------------------------------------------------ */
/* Project-specific model offer: visible <=3, integrated >3, never both */
/* ------------------------------------------------------------------ */

test("the project-specific model offer is visible on a blank <=3-site builder, with no Analysis Mode notice", async ({
  page,
}) => {
  await gotoDecision(page);
  await expect(page.locator(".offer--standalone")).toBeVisible();
  await expect(page.locator(".offer--standalone .offer__ask")).toHaveText(
    ASK_STANDALONE_EMBEDDED,
  );
  await expect(page.locator(".mode-notice")).toHaveCount(0);
  await expect(page.locator(".offer--embedded")).toHaveCount(0);
});

test("a full 3-site custom scenario still shows the offer and never the Analysis Mode notice", async ({
  page,
}) => {
  await gotoDecision(page);
  // Σ Kᵢ = 300 MW across the three filled sites; kept below that.
  await page.fill("#required-capacity", "250");
  await page.fill("#target-date", "30");
  await page.fill("#delay-consequence", "0.05");
  await fillSites(page, 3);
  await expect(page.locator(".offer--standalone")).toBeVisible();
  await expect(page.locator(".mode-notice")).toHaveCount(0);

  await runAnalysis(page);
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toBeVisible({ timeout: 30_000 });
  // Full optimizer mode, not a comparison of benchmark strategies.
  await expect(page.locator(".decision-grid__allocation h3")).not.toHaveText(
    "Best of the compared strategies",
  );
  await expect(page.locator(".offer--standalone")).toBeVisible();
});

test("adding a fourth site switches to Analysis Mode with the offer embedded once, and the standalone offer disappears", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  await expect(page.locator(".offer--standalone")).toBeVisible();

  await page.getByRole("button", { name: /^Add site$/ }).click();
  await expect(page.locator(".mode-notice")).toBeVisible();
  await expect(page.locator(".offer--standalone")).toHaveCount(0);
  await expect(page.locator(".offer--embedded")).toHaveCount(1);
  await expect(
    page.locator(".mode-notice .offer--embedded .offer__ask"),
  ).toHaveText(ASK_STANDALONE_EMBEDDED);

  // Reading order inside the panel: the Analysis Mode explanation, then the
  // offer -- never the other way around.
  const order = await page.locator(".mode-notice").evaluate((el) => {
    const nodes = Array.from(
      el.querySelectorAll(".mode-notice__body, .offer--embedded"),
    );
    return nodes.map((n) => n.className);
  });
  expect(order[0]).toContain("mode-notice__body");
  expect(order[1]).toContain("offer--embedded");
});

test("a larger portfolio (10 sites) keeps Analysis Mode and the offer integrated, shown exactly once", async ({
  page,
}) => {
  await gotoDecision(page);
  const addSite = page.getByRole("button", { name: /^Add site$/ });
  for (let i = 0; i < 7; i += 1) await addSite.click();

  // Σ Kᵢ = 1,000 MW across the ten filled sites; kept strictly below that so
  // this is a genuine comparison, not the exact-equality forced case.
  await page.fill("#required-capacity", "900");
  await page.fill("#target-date", "30");
  await page.fill("#delay-consequence", "0.05");
  await fillSites(page, 10);

  await expect(page.locator(".mode-notice")).toBeVisible();
  await expect(page.locator(".offer--standalone")).toHaveCount(0);
  await expect(page.locator(".offer--embedded")).toHaveCount(1);

  await runAnalysis(page);
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toBeVisible({ timeout: 30_000 });
  // Still exactly one offer, and Analysis Mode's own comparison framing.
  await expect(page.locator(".offer--embedded")).toHaveCount(1);
  await expect(page.locator(".offer--standalone")).toHaveCount(0);
  await expect(page.locator(".decision-grid__allocation h3")).toHaveText(
    "Best of the compared strategies",
  );
});

/* ------------------------------------------------------------------ */
/* Marketing: broader than site count, one job per surface             */
/* ------------------------------------------------------------------ */

test("the four engagement surfaces carry distinct headlines, and the old narrow framing is gone", async ({
  page,
}) => {
  await gotoDecision(page);

  const heroAsk = await page.locator(".hero .cta__ask").innerText();
  const builderAsk = await page
    .locator(".offer--standalone .offer__ask")
    .innerText();
  const decisionCloseAsk = await page
    .locator(".app-footer .cta__ask")
    .innerText();

  // The builder offer leads with complexity, not site count: "more sites" is
  // at most one example inside its body copy, never the headline itself.
  expect(builderAsk).not.toMatch(/^larger portfolio$/i);
  expect(builderAsk).toMatch(/project-specific model/i);
  expect(builderAsk).toMatch(/larger or more complex decision/i);

  const builderBody = await page
    .locator(".offer--standalone .offer__body")
    .innerText();
  expect(builderBody).toMatch(/more sites/i);
  expect(builderBody).toMatch(/constraints|cost structures|uncertainty|parameterization/i);

  // The old narrow eyebrow/headline are gone from the Decision page.
  const decisionBody = await page.locator("body").innerText();
  expect(decisionBody).not.toMatch(/^Larger portfolio$/m);
  expect(decisionBody).not.toMatch(/Need optimized allocation across a larger portfolio/i);

  await page.goto("/technical-documentation.html");
  const docCloseAsk = await page.locator(".app-footer .cta__ask").innerText();
  const docBody = await page.locator("body").innerText();
  expect(docBody).not.toMatch(/^Larger portfolio$/m);
  expect(docBody).not.toMatch(/Need optimized allocation across a larger portfolio/i);

  const asks = [heroAsk, builderAsk, decisionCloseAsk, docCloseAsk];
  expect(new Set(asks).size, "all four headlines are distinct").toBe(4);
});

test("the Technical Documentation closing attribution reads the intended role phrase", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  const footer = page.locator(".app-footer .cta--closing");
  await expect(footer.locator(".cta__eyebrow")).toHaveText(
    "Model, application and technical documentation by",
  );
  await expect(footer.locator(".cta__author")).toContainText(
    "Parsa Pouladi, Ph.D.",
  );
  const footerText = await footer.innerText();
  expect(footerText).not.toMatch(/^Technical modeling by$/m);
});

/* ------------------------------------------------------------------ */
/* Desktop wrapping: "Why this decision", Analysis Mode, Choice comparison */
/* ------------------------------------------------------------------ */

test("at 1440px, Why this decision, Analysis Mode and Choice comparison use the section's width rather than a narrow prose cap", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  await expect(
    page.getByRole("heading", { name: /Choice comparison/i }),
  ).toBeVisible();

  // A ~86-88ch cap at this font size renders well under 900px; the section
  // itself spans over 1200px inside the 1440px-wide app canvas. Anything
  // clearly above that old cap proves the artificial ceiling is gone.
  const synthesisWidth = await widthOf(page, ".decision-synthesis");
  const sectionWidth = await widthOf(page, ".section--decision");
  expect(synthesisWidth).toBeGreaterThan(900);
  expect(synthesisWidth / sectionWidth).toBeGreaterThan(0.9);

  const choiceInsightWidth = await widthOf(
    page,
    'section[aria-labelledby="choice-heading"] .section-insight',
  );
  const choiceBasisWidth = await widthOf(
    page,
    'section[aria-labelledby="choice-heading"] .section-basis',
  );
  expect(choiceInsightWidth).toBeGreaterThan(900);
  expect(choiceBasisWidth).toBeGreaterThan(900);

  await page.getByRole("button", { name: /^Add site$/ }).click();
  const modeBodyWidth = await widthOf(page, ".mode-notice__body");
  expect(modeBodyWidth).toBeGreaterThan(900);
});

test("Why this decision reads as the executive conclusion: an accent heading and an accent ground, not a muted footnote", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  const heading = page.locator(".decision-synthesis__heading");
  await expect(heading).toHaveText("Why this decision");
  const [headingColor, bg] = await Promise.all([
    heading.evaluate((el) => getComputedStyle(el).color),
    page
      .locator(".decision-synthesis")
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ]);
  // Accent ink (#2e5c63 -> rgb(46, 92, 99)), not the muted ink every other
  // note heading uses.
  expect(headingColor).toBe("rgb(46, 92, 99)");
  // Accent-tint ground (#e3eded -> rgb(227, 237, 237)), not the neutral
  // sunken tint shared by every other note on the page.
  expect(bg).toBe("rgb(227, 237, 237)");
});

/* ------------------------------------------------------------------ */
/* Narrow / tablet widths: no overflow, offer and notice still connect */
/* ------------------------------------------------------------------ */

for (const width of [390, 768]) {
  test(`at ${width}px, the offer and Analysis Mode remain connected with no page overflow`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await gotoDecision(page);
    await expect(page.locator(".offer--standalone")).toBeVisible();

    await loadExample(page, "cheap_site_risky_schedule");
    await page.getByRole("button", { name: /^Add site$/ }).click();
    await expect(page.locator(".mode-notice .offer--embedded")).toBeVisible();

    const overflow = await page.evaluate(() => {
      const de = document.documentElement;
      return de.scrollWidth <= de.clientWidth + 1;
    });
    expect(overflow).toBe(true);
  });
}
