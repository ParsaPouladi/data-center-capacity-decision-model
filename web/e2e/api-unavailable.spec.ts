import { test, expect } from "@playwright/test";
import { gotoDecision, loadExample, runAnalysis } from "./helpers";

/**
 * Designed graceful degradation when the live analysis service is
 * unreachable. The API is simulated as down by aborting every `/api/**`
 * request at the network layer (a genuine fetch failure). High-priority
 * correctness: an edited scenario must never fall back to stale numbers, and
 * the committed examples must stay loadable and fully usable.
 */

test.describe("Live analysis unavailable", () => {
  test("analyze is disabled with a clear message; examples still load", async ({
    page,
  }) => {
    await page.route("**/api/**", (route) => route.abort());
    await gotoDecision(page);

    // Blank builder, service down: Analyze is disabled with the degradation
    // hint, and nothing has been analyzed.
    await expect(page.locator(".results-empty")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Analyze scenario$/ }),
    ).toBeDisabled();
    await expect(
      page.getByText(/Live analysis is temporarily unavailable/i),
    ).toBeVisible();

    // Committed examples do not touch /api and stay fully usable.
    await loadExample(page, "cheap_site_risky_schedule");
    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toBeVisible();
  });

  test("API drops after editing: edited state preserved, no stale result shown", async ({
    page,
  }) => {
    await gotoDecision(page);
    // Start from a fully populated, valid scenario.
    await loadExample(page, "cheap_site_risky_schedule");
    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toBeVisible();

    // Edit an input, then take the API away and re-analyze.
    await page.getByLabel("Required capacity (MW)", { exact: true }).fill("450");
    await page.route("**/api/**", (route) => route.abort());
    await runAnalysis(page);

    const errorRegion = page
      .getByRole("alert")
      .filter({ hasText: /Live analysis is temporarily unavailable/i });
    await expect(errorRegion).toBeVisible({ timeout: 30_000 });

    // Edited input preserved; no stale result sections presented as current.
    await expect(
      page.getByLabel("Required capacity (MW)", { exact: true }),
    ).toHaveValue("450");
    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toHaveCount(0);
    await expect(page.locator(".results")).toHaveCount(0);
  });
});
