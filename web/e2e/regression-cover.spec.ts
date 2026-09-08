import { expect, test, type Page } from "@playwright/test";
import { expectResult, gotoDecision, loadExample, runAnalysis } from "./helpers";

/**
 * Regression cover for a set of presentation-layer defects. Each block
 * below reproduces a behaviour that was observed and asserts the corrected
 * behaviour, so a later change that reintroduces one of them fails here
 * rather than in front of a reader.
 *
 * Nothing here re-checks model arithmetic: these are integrity, identity and
 * interaction assertions over the presentation layer. The engine's numbers
 * remain owned by the API-parity and golden tests.
 */

const DECISION_HEADING = 'h2:text-is("The decision")';

/** A completed three-site scenario typed into the builder, not loaded. */
async function fillCustomScenario(page: Page): Promise<void> {
  await page.fill("#required-capacity", "400");
  await page.fill("#target-date", "30");
  await page.fill("#delay-consequence", "0.05");
  const capacity = ["300", "300", "150"];
  const cost = ["1", "1.2", "1.1"];
  const complexity = ["3", "1", "2"];
  for (let i = 0; i < 3; i += 1) {
    await page.fill(`#site-${i}-capacity`, capacity[i]);
    await page.fill(`#site-${i}-cost`, cost[i]);
    await page.locator(`#site-${i}-complexity`).selectOption(complexity[i]);
    await page.locator(`#site-${i}-uncertainty`).selectOption("1");
  }
}

/* ------------------------------------------------------------------ */
/* Result-to-scenario integrity                                       */
/* ------------------------------------------------------------------ */

test.describe("a result is never shown beside inputs it does not describe", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDecision(page);
  });

  test("an edit that leaves the draft incomplete does not bring the old result back", async ({
    page,
  }) => {
    await loadExample(page, "balanced_portfolio");
    await expect(page.locator(DECISION_HEADING)).toBeVisible();

    // An edit that keeps the draft valid: the result goes stale, as before.
    await page.fill("#target-date", "36");
    await expect(page.locator(DECISION_HEADING)).toHaveCount(0);
    await expect(page.locator(".results-note")).toContainText(
      /Inputs changed since the last analysis/i,
    );

    // The regression: emptying a required field left no valid scenario to
    // compare against, staleness evaluated false, and the previous result
    // reappeared as though it belonged to these inputs.
    await page.fill("#required-capacity", "");
    await expect(page.locator(DECISION_HEADING)).toHaveCount(0);
    await expect(page.locator(".results-note")).toContainText(
      /Inputs changed since the last analysis/i,
    );
  });

  test("clearing a site capacity hides the loaded example's result", async ({
    page,
  }) => {
    await loadExample(page, "balanced_portfolio");
    await page.fill("#site-0-capacity", "");
    await expect(page.locator(DECISION_HEADING)).toHaveCount(0);
    await expect(page.locator(".results-note")).toContainText(
      /Inputs changed since the last analysis/i,
    );
  });
});

/* ------------------------------------------------------------------ */
/* Scenario and result survive documentation navigation               */
/* ------------------------------------------------------------------ */

test("the scenario and its result survive a trip to Technical Documentation", async ({
  page,
}) => {
  await gotoDecision(page);
  await fillCustomScenario(page);
  await runAnalysis(page);
  await expectResult(page);
  const allocationBefore = await page.locator(".alloc-bars").innerText();

  await page
    .locator('a[href^="/technical-documentation.html"]')
    .first()
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
  ).toBeVisible();

  await page.goBack();
  await expect(page.locator(DECISION_HEADING)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("#required-capacity")).toHaveValue("400");
  await expect(page.locator("#site-2-capacity")).toHaveValue("150");
  expect(await page.locator(".alloc-bars").innerText()).toBe(allocationBefore);
  // The restored result is current, not stale, and no transient state was
  // restored as though it were a result.
  await expect(page.locator(".results-note")).toHaveCount(0);
});

test("Clear removes the saved scenario for this tab", async ({ page }) => {
  await gotoDecision(page);
  await loadExample(page, "balanced_portfolio");
  await page.getByRole("button", { name: /^Clear$/ }).click();
  await page.reload();
  await expect(page.locator("#required-capacity")).toHaveValue("");
  await expect(page.locator(".results-empty")).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Delay consequence: the numeric field is authoritative              */
/* ------------------------------------------------------------------ */

test.describe("the quick-set slider never overrides the entered delay consequence", () => {
  const slider = (page: Page) => page.locator(".field__lambda-slider");
  const outOfRangeNote = (page: Page) => page.locator(".field__hint--lambda");

  test.beforeEach(async ({ page }) => {
    await gotoDecision(page);
  });

  test("no slider exists before a finite value does", async ({ page }) => {
    await expect(slider(page)).toHaveCount(0);
    await expect(outOfRangeNote(page)).toHaveCount(0);
  });

  test("values inside the quick-set range get a slider that tracks them", async ({
    page,
  }) => {
    for (const value of ["0", "0.05", "0.25"]) {
      await page.fill("#delay-consequence", value);
      await expect(slider(page)).toHaveCount(1);
      await expect(slider(page)).toHaveValue(value);
      await expect(outOfRangeNote(page)).toHaveCount(0);
    }
  });

  test("values above the quick-set range keep their value and lose the slider", async ({
    page,
  }) => {
    for (const value of ["0.5", "5"]) {
      await page.fill("#delay-consequence", value);
      await expect(slider(page)).toHaveCount(0);
      await expect(outOfRangeNote(page)).toContainText(
        /used exactly as typed/i,
      );
      await expect(page.locator("#delay-consequence")).toHaveValue(value);
    }
  });

  test("keyboard interaction cannot rewrite a value above the quick-set range", async ({
    page,
  }) => {
    await page.fill("#delay-consequence", "5");
    await page.locator("#delay-consequence").focus();
    // Tab forward past the numeric field and work the keyboard: with no
    // slider rendered there is nothing pinned at the convenience maximum to
    // nudge, which is what used to write 0.245 over a valid 5.
    await page.keyboard.press("Tab");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#delay-consequence")).toHaveValue("5");
  });

  test("a slider inside the range still adjusts the value", async ({ page }) => {
    await page.fill("#delay-consequence", "0.1");
    await slider(page).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#delay-consequence")).toHaveValue("0.105");
  });
});

/* ------------------------------------------------------------------ */
/* Example identity after an edit                                     */
/* ------------------------------------------------------------------ */

test("an edited example stops claiming to be that example", async ({ page }) => {
  await gotoDecision(page);
  await loadExample(page, "balanced_portfolio");
  await expect(page.locator("#example-select")).toHaveValue(
    "balanced_portfolio",
  );

  await page.fill("#target-date", "36");
  await expect(page.locator("#example-select")).toHaveValue("");
  // Provenance is kept as a statement of where the scenario came from, not as
  // a selector still naming an untouched example.
  await expect(page.locator(".example-menu__edited")).toContainText(
    /Edited from Balanced portfolio/i,
  );
});

test("re-running an unchanged example keeps its validated sensitivity", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "balanced_portfolio");
  const sensitivity = page.locator(".sensitivity__sentence");
  await expect(sensitivity).toBeVisible();
  const before = await sensitivity.innerText();

  await runAnalysis(page);
  await expectResult(page);
  // The λ envelope is a validated artifact of exactly this scenario, so an
  // ordinary re-run of exactly this scenario must not silently lose it.
  await expect(sensitivity).toBeVisible();
  expect(await sensitivity.innerText()).toBe(before);
});

/* ------------------------------------------------------------------ */
/* Four or more sites: an analysis-mode transition                    */
/* ------------------------------------------------------------------ */

test("adding a fourth site announces the comparison mode immediately", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  const notice = page.locator(".mode-notice");
  await expect(notice).toHaveCount(0);

  await page.getByRole("button", { name: /^Add site$/ }).click();
  // Before Analyze is pressed, not after.
  await expect(notice).toBeVisible();
  await expect(notice).toContainText(/Benchmark strategy comparison/i);
  await expect(notice).toContainText(/Cost first/);
  await expect(notice).toContainText(/Spread across sites/);
  await expect(notice).toContainText(/Schedule first/);
  await expect(notice).toContainText(/Parsa Pouladi, Ph\.D\./);
  // A mode change and an offer, never an apology or a claimed model limit.
  await expect(notice).not.toContainText(/sorry|unfortunately|cannot handle/i);
  await expect(notice).not.toContainText(/not supported|limitation/i);

  await page.fill("#site-3-capacity", "100");
  await page.fill("#site-3-cost", "1.10");
  await page.locator("#site-3-complexity").selectOption("2");
  await page.locator("#site-3-uncertainty").selectOption("2");

  const analyze = page
    .locator(".analyze-bar")
    .getByRole("button", { name: /^Analyze scenario$/ });
  await expect(analyze).toBeEnabled();
  await analyze.click();
  await expectResult(page);

  // The result is labelled for what it is: the best of a fixed benchmark set,
  // never a global optimum and never an optimized allocation.
  const heading = page.locator(".decision-grid__allocation h3");
  await expect(heading).toHaveText("Best of the compared strategies");
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /best of the strategies compared/i,
  );
  await expect(page.locator(".results")).not.toContainText(/global optimum/i);
});

test("the mode notice links to the benchmark strategy definitions", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  await page.getByRole("button", { name: /^Add site$/ }).click();
  await page.locator('.mode-notice a[href*="#benchmarks"]').click();
  await expect(page).toHaveURL(/technical-documentation\.html#benchmarks$/);
  const offset = await page.evaluate(() => {
    const el = document.getElementById("benchmarks");
    return el ? Math.abs(el.getBoundingClientRect().top) : Number.NaN;
  });
  expect(offset).toBeLessThan(60);
});

/* ------------------------------------------------------------------ */
/* Cross-page deep links                                              */
/* ------------------------------------------------------------------ */

test("cross-page documentation hashes land on their section", async ({
  page,
}) => {
  for (const id of ["objective", "regimes", "break-even", "benchmarks"]) {
    await page.goto(`/technical-documentation.html#${id}`);
    await expect(page.locator(`#${id}`)).toBeVisible();
    await expect
      .poll(
        async () =>
          page.evaluate((target) => {
            const el = document.getElementById(target);
            return el ? Math.abs(el.getBoundingClientRect().top) : Number.NaN;
          }, id),
        { timeout: 10_000 },
      )
      .toBeLessThan(60);
  }
});

/* ------------------------------------------------------------------ */
/* Chart interaction and narrow viewports                             */
/* ------------------------------------------------------------------ */

test("Escape closes a focus-opened chart readout without moving focus", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  const mark = page.locator('.scatter-mark[tabindex="0"]').first();
  await expect(mark).toBeAttached({ timeout: 15_000 });
  await mark.scrollIntoViewIfNeeded();
  await mark.focus();
  await expect(page.locator(".scatter-readout")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".scatter-readout")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      document.activeElement?.classList.contains("scatter-mark"),
    ),
  ).toBe(true);
});

test("the delivery figure's two markers do not overprint at narrow widths", async ({
  page,
}) => {
  for (const width of [360, 390, 500, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoDecision(page);
    await loadExample(page, "balanced_portfolio");
    const result = await page.evaluate(() => {
      const figure = document.querySelector("figure.chart-figure");
      if (!figure) return null;
      const labels = Array.from(figure.querySelectorAll("text")).filter((t) =>
        /Required|Target/.test(t.textContent ?? ""),
      );
      if (labels.length !== 2) return null;
      const [a, b] = labels.map((t) => t.getBoundingClientRect());
      return {
        overlap:
          a.left < b.right &&
          b.left < a.right &&
          a.top < b.bottom &&
          b.top < a.bottom,
        pageScrolls:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    });
    expect(result, `markers present at ${width}px`).not.toBeNull();
    expect(result?.overlap, `marker overlap at ${width}px`).toBe(false);
    expect(result?.pageScrolls, `page scrolls at ${width}px`).toBe(false);
  }
});

test("an open chart readout does not make the figure scroll sideways", async ({
  page,
}) => {
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/technical-documentation.html");
    const marks = page.locator('.scatter-mark[tabindex="0"]');
    // The figure is built from an asynchronously fetched example export.
    await expect(marks.first()).toBeAttached({ timeout: 15_000 });
    const count = await marks.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await marks.nth(i).scrollIntoViewIfNeeded();
      await marks.nth(i).focus();
      const overflow = await page.evaluate(() => {
        const readout = document.querySelector(".scatter-readout");
        const plot = readout?.closest(".chart-figure__plot");
        if (!plot) return null;
        return {
          plot: plot.scrollWidth > plot.clientWidth,
          page:
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth,
        };
      });
      expect(overflow?.plot, `figure scrolls at ${width}px, mark ${i}`).toBe(
        false,
      );
      expect(overflow?.page, `page scrolls at ${width}px, mark ${i}`).toBe(
        false,
      );
    }
  }
});

/* ------------------------------------------------------------------ */
/* Authorship and navigation                                          */
/* ------------------------------------------------------------------ */

test("the author's name is a visible element wherever authorship appears", async ({
  page,
}) => {
  const weightOf = (locator: ReturnType<Page["locator"]>) =>
    locator.evaluate((el) => {
      const style = window.getComputedStyle(el);
      return {
        size: parseFloat(style.fontSize),
        weight: Number(style.fontWeight),
      };
    });

  await gotoDecision(page);
  const heroName = page.locator(".hero__byline strong");
  await expect(heroName).toHaveText("Parsa Pouladi, Ph.D.");
  const hero = await weightOf(heroName);
  expect(hero.weight).toBeGreaterThanOrEqual(700);
  expect(hero.size).toBeGreaterThanOrEqual(18);

  const closingAuthor = page.locator(".cta--closing .cta__author");
  await expect(closingAuthor).toHaveText("Parsa Pouladi, Ph.D.");
  const closing = await weightOf(closingAuthor);
  expect(closing.weight).toBeGreaterThanOrEqual(700);
  expect(closing.size).toBeGreaterThanOrEqual(16);

  await page.goto("/technical-documentation.html");
  const docName = page.locator(".hero__byline-name");
  await expect(docName).toHaveText("Parsa Pouladi, Ph.D.");
  const doc = await weightOf(docName);
  expect(doc.weight).toBeGreaterThanOrEqual(700);
  expect(doc.size).toBeGreaterThanOrEqual(20);
  // Still subordinate to the page title.
  const title = await weightOf(page.locator("h1.hero__title"));
  expect(doc.size).toBeLessThan(title.size);
});

test("no GitHub navigation item is shipped without a public repository URL", async ({
  page,
}) => {
  // The build under test has VITE_PUBLIC_REPO_URL unset, which is the safe
  // default: an unauthenticated visitor is never handed a link they cannot
  // open. Setting that one variable is the whole change when the curated
  // public repository exists.
  await gotoDecision(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav.getByRole("link", { name: "Decision" })).toBeVisible();
  await expect(
    nav.getByRole("link", { name: "Technical Documentation" }),
  ).toBeVisible();
  await expect(nav.getByRole("link", { name: "GitHub" })).toHaveCount(0);
  await expect(nav.locator('a[href="#"]')).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* Comprehension: the conclusion comes first                          */
/* ------------------------------------------------------------------ */

test("the decision states its conclusion before the metrics, in the golden synthesis", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "balanced_portfolio");

  const order = await page.evaluate(() => {
    const section = document.querySelector(".section--decision");
    if (!section) return null;
    const index = (selector: string) => {
      const el = section.querySelector(selector);
      if (!el) return -1;
      return Array.prototype.indexOf.call(
        section.querySelectorAll("*"),
        el,
      );
    };
    return {
      synthesis: index(".decision-synthesis"),
      numbers: index(".decision-grid__numbers"),
    };
  });
  expect(order).not.toBeNull();
  expect(order!.synthesis).toBeGreaterThanOrEqual(0);
  expect(order!.synthesis).toBeLessThan(order!.numbers);
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /Capacity goes to/,
  );
});

test("the comparison explains the criterion in words, with no objective column", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "balanced_portfolio");
  // Scoped to Choice comparison: Delivery outlook and Site delivery each
  // carry their own (different) ".section-basis" technical-basis line too.
  const comparison = page.getByRole("region", { name: /Choice comparison/i });
  await expect(comparison.locator(".section-basis")).toContainText(
    /neither is a term in that criterion/i,
  );
  const headers = await page
    .locator(".choice-table thead th")
    .allInnerTexts();
  expect(headers).toHaveLength(5);
  for (const header of headers) {
    expect(header).not.toMatch(/objective|\bJ\b|combined/i);
  }
});

test("a structurally forced allocation is explained before its metrics", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "capacity_constrained_portfolio");
  // The example set's forced case: D equals the portfolio's total capacity.
  const synthesis = page.locator(".decision-synthesis");
  await expect(synthesis).toBeVisible();
  const order = await page.evaluate(() => {
    const section = document.querySelector(".section--decision");
    if (!section) return null;
    const all = Array.prototype.slice.call(section.querySelectorAll("*"));
    const at = (selector: string) => {
      const el = section.querySelector(selector);
      return el ? all.indexOf(el) : -1;
    };
    return {
      synthesis: at(".decision-synthesis"),
      numbers: at(".decision-grid__numbers"),
    };
  });
  // The golden synthesis now precedes the headline metrics rather than
  // sitting underneath them.
  if (order && order.synthesis >= 0 && order.numbers >= 0) {
    expect(order.synthesis).toBeLessThan(order.numbers);
  }
});
