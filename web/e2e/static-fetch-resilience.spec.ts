import { test, expect, type Page, type Route } from "@playwright/test";
import { gotoDecision } from "./helpers";

/**
 * Resilience of the committed same-origin static-JSON fetches (`/data/*.json`)
 * against a single transient failure — the maintenance-patch scope.
 *
 * `fetchStaticJson` retries once, ~600 ms later, when a `fetch()` is rejected
 * with no HTTP response or the edge returns 502/503/504; it never retries an
 * ordinary 4xx, and it makes at most two attempts. These specs drive that at
 * the network layer with `page.route`, counting the attempts Playwright sees.
 *
 * No model quantity is re-derived here — the assertions are about whether the
 * example renders, whether the recovery affordance appears, and how many
 * requests leave the browser.
 */

const EXAMPLE_ID = "cheap_site_risky_schedule";
const EXAMPLE_FILE = "**/data/cheap_site_risky_schedule.json";

const decisionHeading = (page: Page) =>
  page.getByRole("heading", { level: 2, name: /^The decision$/ });

const exampleErrorAlert = (page: Page) =>
  page
    .getByRole("alert")
    .filter({ hasText: /This example could not be loaded/i });

async function chooseExample(page: Page): Promise<void> {
  await page.getByLabel(/Load an example/i).selectOption(EXAMPLE_ID);
}

test.describe("Static-JSON fetch resilience", () => {
  test("A. one aborted example GET, then success: the example renders, no error", async ({
    page,
  }) => {
    await gotoDecision(page);

    let attempts = 0;
    await page.route(EXAMPLE_FILE, (route: Route) => {
      attempts += 1;
      return attempts === 1 ? route.abort() : route.continue();
    });

    await chooseExample(page);

    await expect(decisionHeading(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".results-context")).toContainText(/^Example: /);
    await expect(exampleErrorAlert(page)).toHaveCount(0);
    expect(attempts).toBe(2);
  });

  test("B. two aborted example GETs: professional failure copy and a usable Try again", async ({
    page,
  }) => {
    await gotoDecision(page);

    let attempts = 0;
    await page.route(EXAMPLE_FILE, (route: Route) => {
      attempts += 1;
      return route.abort();
    });

    await chooseExample(page);

    const alert = exampleErrorAlert(page);
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // No raw browser TypeError text as the explanation.
    await expect(alert).not.toContainText(/failed to fetch/i);
    await expect(alert).not.toContainText(/TypeError/);
    const tryAgain = alert.getByRole("button", { name: /^Try again$/ });
    await expect(tryAgain).toBeEnabled();
    // The failed load did not fall through to a rendered result.
    await expect(decisionHeading(page)).toHaveCount(0);
    // Exactly two attempts — the retry is single, not a loop.
    await page.waitForTimeout(1_500);
    expect(attempts).toBe(2);
  });

  test("C. Try again succeeds after a double failure and clears the error", async ({
    page,
  }) => {
    await gotoDecision(page);

    let attempts = 0;
    await page.route(EXAMPLE_FILE, (route: Route) => {
      attempts += 1;
      // Attempts 1 and 2 are the first load (both fail); attempt 3 is the
      // retry the visitor triggers, and it succeeds.
      return attempts <= 2 ? route.abort() : route.continue();
    });

    await chooseExample(page);
    const alert = exampleErrorAlert(page);
    await expect(alert).toBeVisible({ timeout: 20_000 });

    await alert.getByRole("button", { name: /^Try again$/ }).click();

    await expect(decisionHeading(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".results-context")).toContainText(/^Example: /);
    await expect(exampleErrorAlert(page)).toHaveCount(0);
    expect(attempts).toBe(3);
  });

  test("D. a 4xx example GET is surfaced at once and never retried", async ({
    page,
  }) => {
    await gotoDecision(page);

    let attempts = 0;
    await page.route(EXAMPLE_FILE, (route: Route) => {
      attempts += 1;
      return route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ error: "not found" }),
      });
    });

    await chooseExample(page);

    await expect(exampleErrorAlert(page)).toBeVisible({ timeout: 20_000 });
    // Give any (unwanted) retry well over the 600 ms window to fire.
    await page.waitForTimeout(1_500);
    expect(attempts).toBe(1);
  });

  test("E. normal example loading is unchanged when nothing fails", async ({
    page,
  }) => {
    await gotoDecision(page);

    let attempts = 0;
    await page.route(EXAMPLE_FILE, (route: Route) => {
      attempts += 1;
      return route.continue();
    });

    await chooseExample(page);

    await expect(decisionHeading(page)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".results-context")).toContainText(
      /^Example: Cheap site, risky schedule$/,
    );
    await expect(page.getByLabel(/Load an example/i)).toHaveValue(EXAMPLE_ID);
    expect(attempts).toBe(1);
  });

  test("F. useJson recovers a transient index.json failure, and a hard failure still degrades cleanly", async ({
    page,
  }) => {
    // One aborted attempt on the index the example menu is built from; the
    // retry succeeds and the menu populates as normal.
    let indexAttempts = 0;
    await page.route("**/data/index.json", (route: Route) => {
      indexAttempts += 1;
      return indexAttempts === 1 ? route.abort() : route.continue();
    });

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Build a scenario/i }),
    ).toBeVisible();
    await expect(
      page.getByLabel(/Load an example/i).locator("option:not([disabled])"),
    ).toHaveCount(3);
    expect(indexAttempts).toBe(2);

    // Both attempts fail: existing behaviour is preserved — the page still
    // renders, the menu is simply absent, and nothing throws.
    await page.unroute("**/data/index.json");
    let hardAttempts = 0;
    await page.route("**/data/index.json", (route: Route) => {
      hardAttempts += 1;
      return route.abort();
    });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Build a scenario/i }),
    ).toBeVisible();
    await expect(page.getByLabel(/Load an example/i)).toHaveCount(0);
    // The retry runs ~600 ms after the first abort; poll until it has.
    await expect.poll(() => hardAttempts).toBe(2);
    await page.waitForTimeout(1_000);
    expect(hardAttempts).toBe(2);
  });
});
