import { test, expect } from "@playwright/test";
import {
  expectLiveResult,
  gotoDecision,
  loadExample,
  runAnalysis,
} from "./helpers";

/**
 * An edited scenario must never fall back to stale numbers. Once an input
 * changes, the previous result is withdrawn and replaced by a neutral
 * "inputs changed" note until the visitor re-analyzes; re-analyzing restores
 * a current result labelled live. Model numbers themselves are covered by
 * API parity and the golden tests.
 */

test("editing after a result hides the stale output until re-analyzed", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toBeVisible();

  // Change an input: the previous result must not read as current.
  const requiredCapacity = page.getByLabel("Required capacity (MW)", {
    exact: true,
  });
  await requiredCapacity.fill("480");
  await expect(
    page.getByText(/Inputs changed since the last analysis/i),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toHaveCount(0);
  await expect(page.locator(".results")).toHaveCount(0);
  await expect(page.locator(".results-context")).toHaveCount(0);

  // Re-analyze: a current result comes back, labelled live, with the edited
  // input preserved.
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);
  await expect(
    page.getByRole("heading", { level: 2, name: /^The decision$/ }),
  ).toBeVisible();
  await expect(requiredCapacity).toHaveValue("480");
});
