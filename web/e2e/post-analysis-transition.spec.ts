import { test, expect, type Page } from "@playwright/test";
import {
  buildComparisonPortfolio,
  expectLiveResult,
  gotoDecision,
  loadExample,
  runAnalysis,
} from "./helpers";

/**
 * Post-analysis discoverability. After a
 * SUCCESSFUL, USER-INITIATED "Analyze scenario" the app must carry the
 * visitor to the new result rather than leaving it below the fold:
 *
 *   1. the viewport moves to the beginning of the result narrative;
 *   2. programmatic focus lands on the result container ("The decision" is
 *      its first heading), so keyboard / screen-reader users are taken there
 *      too;
 *   3. a polite live region announces "Analysis complete. Results are now
 *      available."
 *
 * It must NOT happen for a validation / capacity-gap block, an API failure,
 * a mere example selection, an edit, or a non-user-initiated re-render.
 *
 * The result container is `.results`, carrying `tabIndex={-1}` and no focus
 * ring of its own.
 */

const COMPLETION = /Analysis complete\. Results are now available\./;

/** The polite completion announcement, if present in the DOM. */
const completionRegion = (page: Page) =>
  page.getByRole("status").filter({ hasText: COMPLETION });

/** Fill the three default rows into a valid, comfortably feasible 3-site
 * scenario, straight from a blank builder — no example involved. */
async function fillCustomThreeSiteScenario(page: Page): Promise<void> {
  await page.locator("#required-capacity").fill("300");
  await page.locator("#target-date").fill("30");
  await page.locator("#delay-consequence").fill("0.05");

  const rows: [string, string, string, string][] = [
    ["200", "1.00", "1", "1"],
    ["200", "1.10", "2", "2"],
    ["150", "1.20", "2", "3"],
  ];
  for (let i = 0; i < rows.length; i += 1) {
    const [cap, cost, complexity, uncertainty] = rows[i];
    await page.locator(`#site-${i}-capacity`).fill(cap);
    await page.locator(`#site-${i}-cost`).fill(cost);
    await page.locator(`#site-${i}-complexity`).selectOption(complexity);
    await page.locator(`#site-${i}-uncertainty`).selectOption(uncertainty);
  }
}

/** Assert the completed-analysis transition fired: focus on `.results`, the
 * region aligned to (or above) the top of the viewport, and the polite
 * announcement present. */
async function expectResultTransition(page: Page): Promise<void> {
  const results = page.locator(".results");
  await expect(results).toBeFocused();
  await expect(completionRegion(page)).toHaveCount(1);
  await expect
    .poll(
      () =>
        results.evaluate((el) => el.getBoundingClientRect().top).catch(() => 9999),
      { timeout: 5_000 },
    )
    .toBeLessThan(140);
}

test.describe("post-analysis transition — fires on a successful user run", () => {
  test("1. valid custom 3-site scenario", async ({ page }) => {
    await gotoDecision(page);
    await fillCustomThreeSiteScenario(page);

    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
      { timeout: 30_000 },
    );
    await runAnalysis(page);
    await resp;
    await expectLiveResult(page);

    await expectResultTransition(page);
    // Focus is on the container that opens with "The decision" — the result
    // is met in reading order, not at a lower card.
    await expect(
      page.locator(".results").getByRole("heading", { level: 2 }).first(),
    ).toHaveText("The decision");
  });

  test("2. edited worked example", async ({ page }) => {
    await gotoDecision(page);
    await loadExample(page, "cheap_site_risky_schedule");
    // Loading the example did not itself force the transition.
    await expect(page.locator(".results")).not.toBeFocused();
    await expect(completionRegion(page)).toHaveCount(0);

    await page.locator("#required-capacity").fill("610");
    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
      { timeout: 30_000 },
    );
    await runAnalysis(page);
    await resp;
    await expectLiveResult(page);

    await expectResultTransition(page);
  });

  test("3. 4+ site benchmark comparison", async ({ page }) => {
    await gotoDecision(page);
    await buildComparisonPortfolio(page);
    await expectResultTransition(page);
  });

  for (const width of [390, 768, 1440]) {
    test(`transition holds at ${width}px: focus + announcement, no page overflow, analyze bar intact`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await gotoDecision(page);
      await fillCustomThreeSiteScenario(page);

      const resp = page.waitForResponse(
        (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
        { timeout: 30_000 },
      );
      await runAnalysis(page);
      await resp;
      await expectLiveResult(page);

      await expect(page.locator(".results")).toBeFocused();
      await expect(completionRegion(page)).toHaveCount(1);

      // No page-level horizontal overflow introduced by the transition.
      const over = await page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth - de.clientWidth;
      });
      expect(over, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(1);

      // Analyze bar and its three controls are unchanged and still usable.
      const bar = page.locator(".analyze-bar");
      await expect(
        bar.getByRole("button", { name: /^Analyze scenario$/ }),
      ).toBeVisible();
      await expect(bar.getByLabel(/Load an example/i)).toBeVisible();
      await expect(bar.getByRole("button", { name: /^Clear$/ })).toBeVisible();
    });
  }

  test("7. prefers-reduced-motion: transition still occurs, without smooth scroll", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await gotoDecision(page);
    await fillCustomThreeSiteScenario(page);

    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
      { timeout: 30_000 },
    );
    await runAnalysis(page);
    await resp;
    await expectLiveResult(page);

    // Focus lands synchronously with the result; with reduced motion the
    // scroll is an immediate jump, so the region is already at the top the
    // first time we can measure it (no easing settle window).
    await expect(page.locator(".results")).toBeFocused();
    const top = await page
      .locator(".results")
      .evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeLessThan(140);
    await expect(completionRegion(page)).toHaveCount(1);
  });
});

test.describe("post-analysis transition — does NOT fire", () => {
  test("4. capacity-gap block: Analyze cannot run, no transition", async ({
    page,
  }) => {
    await gotoDecision(page);
    // One site, requirement far above its capacity: Σ K < D blocks Analyze.
    for (const id of ["C", "B"]) {
      await page
        .getByRole("group", { name: `Site ${id}` })
        .getByRole("button", { name: `Remove Site ${id}` })
        .click();
    }
    await page.locator("#required-capacity").fill("5000");
    await page.locator("#target-date").fill("30");
    await page.locator("#delay-consequence").fill("0.05");
    await page.locator("#site-0-capacity").fill("100");
    await page.locator("#site-0-cost").fill("1.00");
    await page.locator("#site-0-complexity").selectOption("1");
    await page.locator("#site-0-uncertainty").selectOption("1");

    await expect(page.locator(".analyze-blocker")).toBeVisible();
    await expect(
      page.locator(".analyze-bar").getByRole("button", { name: /^Analyze scenario$/ }),
    ).toBeDisabled();

    // No result to move to, and nothing announced.
    await expect(page.locator(".results")).toHaveCount(0);
    await expect(completionRegion(page)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.activeElement?.className ?? "",
      ),
    ).not.toContain("results");
  });

  test("5. API failure: no result transition", async ({ page }) => {
    await gotoDecision(page);
    await loadExample(page, "cheap_site_risky_schedule");
    await page.locator("#required-capacity").fill("455");

    await page.route("**/api/**", (route) => route.abort());
    await runAnalysis(page);

    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /Live analysis is temporarily unavailable/i }),
    ).toBeVisible({ timeout: 30_000 });

    await expect(page.locator(".results")).toHaveCount(0);
    await expect(completionRegion(page)).toHaveCount(0);
  });

  test("6. merely selecting a worked example does not force an auto-scroll", async ({
    page,
  }) => {
    await gotoDecision(page);
    const beforeY = await page.evaluate(() => window.scrollY);
    await loadExample(page, "cheap_site_risky_schedule");

    // The result rendered, but focus was not yanked into it and nothing
    // announced completion or scrolled the page.
    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toBeVisible();
    await expect(page.locator(".results")).not.toBeFocused();
    await expect(completionRegion(page)).toHaveCount(0);
    const afterY = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterY - beforeY)).toBeLessThan(80);
  });

  test("re-analyze from the stale note re-announces (repeat run, same text)", async ({
    page,
  }) => {
    await gotoDecision(page);
    await fillCustomThreeSiteScenario(page);
    let resp = page.waitForResponse(
      (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
      { timeout: 30_000 },
    );
    await runAnalysis(page);
    await resp;
    await expectResultTransition(page);

    // Edit → the announcement is withdrawn while the result is stale.
    await page.locator("#required-capacity").fill("305");
    await expect(completionRegion(page)).toHaveCount(0);

    // Re-analyze from the in-result "Re-analyze" control: the transition and
    // the announcement come back even though the text is identical.
    resp = page.waitForResponse(
      (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: /^Re-analyze$/ }).click();
    await resp;
    await expectResultTransition(page);
  });
});
