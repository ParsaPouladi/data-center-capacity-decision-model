import { test, expect } from "@playwright/test";
import { buildComparisonPortfolio, gotoDecision } from "./helpers";

/**
 * A custom portfolio above the live-optimization site count is a first-class
 * Strategy comparison result, reached through the real `/compare` path. The
 * browser never launches an `/optimize` request for it, and none of the
 * former site-count / policy framing appears on the public page.
 */

test("a portfolio above the optimizer site count routes through /compare, never /optimize", async ({
  page,
}) => {
  const optimizeRequests: string[] = [];
  const compareRequests: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/p1/optimize")) optimizeRequests.push(r.url());
    if (r.url().includes("/api/p1/compare")) compareRequests.push(r.url());
  });

  await gotoDecision(page);
  // Builds a seven-site scenario in the builder and analyzes it.
  await buildComparisonPortfolio(page);

  // Strategy comparison is a first-class result.
  const results = page.locator(".results");
  await expect(results).toContainText(/Best of the compared strategies/i);
  await expect(
    page.getByRole("region", { name: /Choice comparison/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /^The decision$/ }).getByText(
      /Chance of meeting the target date/i,
    ),
  ).toBeVisible();

  // The comparison path was used; the optimizer was never called from the UI.
  expect(compareRequests.length).toBeGreaterThan(0);
  expect(optimizeRequests).toHaveLength(0);

  // No former site-count / policy / guardrail framing on the public page.
  const text = await results.innerText();
  expect(text).not.toMatch(/No single optimized allocation/i);
  expect(text).not.toMatch(/site limit/i);
  expect(text).not.toMatch(/site-count/i);
  expect(text).not.toMatch(/guardrail/i);
  expect(text).not.toMatch(/not a limit of the model/i);
  expect(text).not.toMatch(/deployment/i);
});
