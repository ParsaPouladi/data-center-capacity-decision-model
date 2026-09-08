import { test, expect } from "@playwright/test";
import {
  expectLiveResult,
  gotoDecision,
  loadExample,
  runAnalysis,
} from "./helpers";

/**
 * Immediate portfolio feasibility feedback and authoritative input-domain
 * guardrails in the scenario builder.
 *
 * The builder is a presentation-layer pre-check only: it must never modify a
 * visitor's entered value, and the API remains the authoritative reject.
 * These cases prove the pre-check blocks a run the service is guaranteed to
 * reject, shows the domain fact neutrally, and re-enables cleanly on
 * recovery.
 */

test("total site capacity below the requirement shows a neutral notice with the exact gap and disables analyze; recovery re-enables it", async ({
  page,
}) => {
  await gotoDecision(page);
  // Start from a fully populated example: Σ Kᵢ = 1,050 MW across sites A/B/C.
  await loadExample(page, "cheap_site_risky_schedule");

  const requiredCapacity = page.getByLabel("Required capacity (MW)", {
    exact: true,
  });
  await requiredCapacity.fill("5000");

  const notice = page.locator(".editor__note.capacity-gap");
  await expect(notice).toBeVisible();
  await expect(notice.locator(".capacity-gap__chip-value")).toHaveText(
    "3,950 MW",
  );
  await expect(notice).toContainText(/1,050 MW/);
  await expect(notice).toContainText(/5,000 MW/);
  // Neutral notice, not the red input-error alert, and no claim about the
  // target date or schedule -- this is a capacity-feasibility fact only.
  await expect(
    page.getByText(/A few inputs still need attention/i),
  ).toHaveCount(0);
  await expect(notice).not.toContainText(/target date|deadline|schedule/i);

  // The action-local blocker beside Analyze restates the same figure, more
  // urgently, so a reader does not have to scroll back up to it.
  const blocker = page.locator(".analyze-blocker");
  await expect(blocker).toBeVisible();
  await expect(blocker).toContainText(/3,950 MW/);
  await expect(blocker).not.toContainText(/target date|deadline|schedule/i);

  const runBtn = page.getByRole("button", { name: /^Analyze scenario$/ });
  await expect(runBtn).toBeDisabled();
  await expect(runBtn).toHaveAttribute("aria-describedby", "analyze-hint");
  await expect(blocker).toHaveAttribute("id", "analyze-hint");

  // The entered value is preserved, never silently rewritten.
  await expect(requiredCapacity).toHaveValue("5000");

  // Recovery: bring the requirement back within total site capacity. Both
  // notices disappear together.
  await requiredCapacity.fill("500");
  await expect(notice).toHaveCount(0);
  await expect(blocker).toHaveCount(0);
  await expect(runBtn).toBeEnabled();

  // And a run now succeeds.
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);
});

/**
 * The exact worked case:
 * required 7,000 MW against 5,778 MW of total site capacity, a 1,222 MW gap.
 * Both diagnostic locations must show the identical figure, from the same
 * `validation.feasibility` source, and both repair paths (raising capacity,
 * lowering the requirement) must recover cleanly.
 */
test("7,000 MW required against 5,778 MW of site capacity: both locations show the same 1,222 MW gap, and both repair paths recover", async ({
  page,
}) => {
  await gotoDecision(page);

  await page.getByLabel("Required capacity (MW)", { exact: true }).fill("7000");
  await page.getByLabel("Target date (month)", { exact: true }).fill("30");
  await page.getByLabel("Delay consequence", { exact: true }).fill("0.05");

  const capacities = ["2000", "2000", "1778"];
  for (let i = 0; i < 3; i += 1) {
    await page.fill(`#site-${i}-capacity`, capacities[i]);
    await page.fill(`#site-${i}-cost`, "1");
    await page.locator(`#site-${i}-complexity`).selectOption("1");
    await page.locator(`#site-${i}-uncertainty`).selectOption("1");
  }

  const notice = page.locator(".editor__note.capacity-gap");
  const blocker = page.locator(".analyze-blocker");
  const runBtn = page.getByRole("button", { name: /^Analyze scenario$/ });

  await expect(notice.locator(".capacity-gap__chip-value")).toHaveText(
    "1,222 MW",
  );
  await expect(notice).toContainText(/5,778 MW/);
  await expect(notice).toContainText(/7,000 MW/);
  await expect(blocker).toContainText(/1,222 MW/);
  await expect(runBtn).toBeDisabled();

  // Repair path 1: raise total site capacity to exactly the requirement.
  await page.fill("#site-2-capacity", "3000");
  await expect(notice).toHaveCount(0);
  await expect(blocker).toHaveCount(0);
  await expect(runBtn).toBeEnabled();

  // Force the gap again, then repair it the other way: lower the
  // requirement to (or below) total site capacity instead.
  await page.fill("#site-2-capacity", "1778");
  await expect(notice.locator(".capacity-gap__chip-value")).toHaveText(
    "1,222 MW",
  );
  await expect(blocker).toContainText(/1,222 MW/);
  await page.getByLabel("Required capacity (MW)", { exact: true }).fill("5778");
  await expect(notice).toHaveCount(0);
  await expect(blocker).toHaveCount(0);
  await expect(runBtn).toBeEnabled();
});

test("builder input controls stay within the authoritative public domain", async ({
  page,
}) => {
  await gotoDecision(page);

  // Target date: bounded above by the fixed horizon (H − 1 = 71), and at least 1.
  const targetDate = page.getByLabel("Target date (month)", { exact: true });
  await expect(targetDate).toHaveAttribute("max", "71");
  await expect(targetDate).toHaveAttribute("min", "1");

  // Delay consequence: non-negative lower bound, and NO authoritative upper
  // bound on the number field.
  const delayConsequence = page.getByLabel("Delay consequence", { exact: true });
  await expect(delayConsequence).toHaveAttribute("min", "0");
  await expect(delayConsequence).not.toHaveAttribute("max", /.+/);

  // Power-delivery complexity: a select whose real options are the four
  // mapped ordinal states (plus a disabled placeholder).
  const complexity = page
    .getByRole("group", { name: "Site A" })
    .getByLabel("Power-delivery complexity", { exact: true });
  await expect(complexity).toHaveJSProperty("tagName", "SELECT");
  const values = await complexity.locator("option").evaluateAll((os) =>
    os
      .map((o) => (o as HTMLOptionElement).value)
      .filter((v) => v !== ""),
  );
  expect(values.sort()).toEqual(["1", "2", "3", "4"]);

  // A negative value is rejected by the input-level check, not clamped.
  const requiredCapacity = page.getByLabel("Required capacity (MW)", {
    exact: true,
  });
  await requiredCapacity.fill("-10");
  await expect(
    page.getByText(/Enter a required capacity greater than 0 MW/i),
  ).toBeVisible();
  await expect(requiredCapacity).toHaveValue("-10");
  await expect(
    page.getByRole("button", { name: /^Analyze scenario$/ }),
  ).toBeDisabled();
});
