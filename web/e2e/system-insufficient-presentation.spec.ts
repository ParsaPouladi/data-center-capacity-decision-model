import { test, expect } from "@playwright/test";
import { gotoDecision, loadExample, runAnalysis } from "./helpers";

/**
 * System-insufficient result presentation.
 *
 * The builder's Σ Kᵢ ≥ D pre-check normally stops this scenario before it is
 * sent, so a `system_insufficient` API envelope only reaches the frontend
 * via a direct/stale/future caller or a race. When it does, the UI must
 * show the neutral "Not enough developable capacity" domain outcome, never
 * "The analysis could not be completed", and must not fabricate a result or
 * leave stale sections presented as current.
 */

test("a system_insufficient response is shown as a domain outcome, not a runtime failure", async ({
  page,
}) => {
  await gotoDecision(page);
  // A fully valid, populated scenario so the builder pre-check passes and the
  // request is actually sent.
  await loadExample(page, "cheap_site_risky_schedule");
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toBeVisible();

  // Force the capacity-feasibility (Σ Kᵢ < D) envelope on the next optimize response.
  await page.route("**/api/p1/optimize", async (route) => {
    await route.fulfill({
      status: 422,
      contentType: "application/json",
      body: JSON.stringify({
        error: "system_insufficient",
        message:
          "Required capacity exceeds total developable portfolio capacity.",
        required_capacity_mw: 400,
        total_developable_capacity_mw: 300,
      }),
    });
  });

  // Edit an input so the loaded example is stale, then re-analyze.
  await page.getByLabel("Required capacity (MW)", { exact: true }).fill("400");
  await runAnalysis(page);

  // Neutral domain outcome, not a runtime-failure alert.
  await expect(
    page.getByText(/Not enough developable capacity\./i),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/could not be completed/i)).toHaveCount(0);

  // No fabricated result, and no stale result sections presented as current.
  await expect(page.locator(".results")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Choice comparison/i }),
  ).toHaveCount(0);

  // The edited input is preserved.
  await expect(
    page.getByLabel("Required capacity (MW)", { exact: true }),
  ).toHaveValue("400");
});
