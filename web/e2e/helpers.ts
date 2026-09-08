import { expect, type Page } from "@playwright/test";

/**
 * Shared helpers for the E2E specs. Deliberately small — these wrap only the
 * multi-step navigation the flows share, using semantic (role / accessible
 * name) locators. No model arithmetic is re-checked here; API parity +
 * golden tests own the numerical contract.
 *
 * The Decision page opens on a workbench-first flow — a blank scenario in an
 * explicit "not analyzed" state. Results appear only after "Analyze scenario"
 * or after "Load an example".
 *
 * A successful result no longer announces itself with a status callout: it
 * transitions straight into "The decision". A loaded example carries only a
 * quiet context label, so that label is what distinguishes an example result
 * from a live one.
 */

export type ExampleId =
  | "balanced_portfolio"
  | "capacity_constrained_portfolio"
  | "cheap_site_risky_schedule";

/**
 * Build a portfolio above the live-optimization site limit directly in the
 * builder, so "Analyze scenario" routes to the strategy-comparison path
 * (`/compare`, no optimizer). Starts from the three-site "Cheap site,
 * risky schedule" example and adds four more sites, then analyzes.
 */
export async function buildComparisonPortfolio(page: Page): Promise<void> {
  await loadExample(page, "cheap_site_risky_schedule");
  const addSite = page.getByRole("button", { name: /^Add site$/ });
  for (let i = 0; i < 4; i += 1) await addSite.click();
  // The example fills rows 0..2 (A, B, C); fill the four new rows 3..6.
  for (let i = 3; i <= 6; i += 1) {
    await page.locator(`#site-${i}-capacity`).fill("100");
    await page.locator(`#site-${i}-cost`).fill("1.10");
    await page.locator(`#site-${i}-complexity`).selectOption({ label: "Moderate" });
    await page.locator(`#site-${i}-uncertainty`).selectOption({ label: "Moderate" });
  }
  await runAnalysis(page);
  await expectLiveResult(page);
}

/** The result has rendered (either a live run or a loaded example). */
export async function expectResult(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toBeVisible({ timeout: 30_000 });
}

/** The result has rendered and came from a live engine run, not an example. */
export async function expectLiveResult(page: Page): Promise<void> {
  await expectResult(page);
  await expect(page.locator(".results-context")).toHaveCount(0);
}

/** Load the Decision page and wait for the scenario builder to be ready. */
export async function gotoDecision(page: Page): Promise<void> {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: /Data center capacity allocation under limited information and uncertain power delivery/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Build a scenario/i }),
  ).toBeVisible();
}

/** The editor is always present now; kept for call-site compatibility. */
export async function startEditing(page: Page): Promise<void> {
  await expect(
    page.getByRole("heading", { name: /Build a scenario/i }),
  ).toBeVisible();
}

/** Load one of the precomputed examples via the "Load an example" menu. */
export async function loadExample(page: Page, id: ExampleId): Promise<void> {
  await page.getByLabel(/Load an example/i).selectOption(id);
  await expectResult(page);
  await expect(page.locator(".results-context")).toContainText(/^Example: /);
}

/** The system "Required capacity (MW)" number field in the editor. */
export function requiredCapacityField(page: Page) {
  return page.getByLabel(/Required capacity \(MW\)/i);
}

/** Click the primary "Analyze scenario" CTA in the analyze bar. */
export async function runAnalysis(page: Page): Promise<void> {
  await page
    .locator(".analyze-bar")
    .getByRole("button", { name: /^Analyze scenario$/ })
    .click();
}
