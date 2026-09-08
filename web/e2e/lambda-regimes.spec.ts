import { test, expect, type Page } from "@playwright/test";
import {
  expectLiveResult,
  gotoDecision,
  loadExample,
  runAnalysis,
} from "./helpers";

/**
 * A delay consequence of 0 and a large positive one (0.19) both analyze
 * end-to-end from the redesigned workbench: a live optimized result with an
 * allocation and the public Key Results, and never a runtime-failure banner.
 * The capacity-feasibility classification fix lives in the backend; this guards
 * that the workbench flow still exercises it for a feasible large-value
 * scenario.
 */

async function setDelayConsequence(page: Page, value: string) {
  await page.getByLabel("Delay consequence", { exact: true }).fill(value);
}

for (const consequence of ["0", "0.19"]) {
  test(`delay consequence = ${consequence}: workbench analyze returns a live optimized result`, async ({
    page,
  }) => {
    await gotoDecision(page);
    await loadExample(page, "cheap_site_risky_schedule");
    await setDelayConsequence(page, consequence);

    const resp = page.waitForResponse(
      (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
      { timeout: 30_000 },
    );
    await runAnalysis(page);
    await resp;

    await expectLiveResult(page);
    const keyResults = page.getByRole("region", { name: /^The decision$/ });
    await expect(keyResults).toBeVisible();
    await expect(
      keyResults.getByText("Chance of meeting the target date", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/could not be completed|Not enough developable capacity/i),
    ).toHaveCount(0);
  });
}
