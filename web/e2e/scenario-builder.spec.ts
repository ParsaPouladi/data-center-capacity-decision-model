import { test, expect, type Page } from "@playwright/test";
import { gotoDecision, loadExample } from "./helpers";

/**
 * Targeted gate — the scenario builder.
 *
 * Covers six checks: blank first load, blank narrow load, load-an-example,
 * Clear, the Σ K < D feasibility pre-check, and copy hygiene. All
 * assertions are client-side (no live Analyze call), so the gate does not
 * depend on the engine API being reachable.
 */

const builder = (page: Page) => page.locator(".workbench");
const siteGroup = (page: Page, id: string) =>
  page.getByRole("group", { name: `Site ${id}` });
const analyzeButton = (page: Page) =>
  page.locator(".analyze-bar").getByRole("button", { name: /^Analyze scenario$/ });

test.describe("Scenario builder", () => {
  test("A. fresh desktop load is blank, no result, Analyze disabled", async ({
    page,
  }) => {
    await gotoDecision(page);

    for (const label of [
      "Required capacity (MW)",
      "Target date (month)",
      "Delay consequence",
    ]) {
      const field = page.getByLabel(label, { exact: true });
      await expect(field).toHaveValue("");
      await expect(field).toHaveAttribute("placeholder", "Enter value");
    }

    for (const id of ["A", "B", "C"]) {
      const group = siteGroup(page, id);
      await expect(group.getByLabel("Site", { exact: true })).toHaveValue(id);
      await expect(group.getByLabel("Capacity (MW)", { exact: true })).toHaveValue(
        "",
      );
      await expect(
        group.getByLabel("Relative cost per MW", { exact: true }),
      ).toHaveValue("");
      // A blank state select shows its placeholder, not a silent default.
      await expect(
        group.getByLabel("Power-delivery complexity", { exact: true }),
      ).toHaveValue("");
      await expect(
        group.getByLabel("Schedule uncertainty", { exact: true }),
      ).toHaveValue("");
    }

    await expect(
      page.getByText(
        "Analyze a scenario, or load an example, to see a recommendation.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /Decision summary/i }),
    ).toHaveCount(0);

    await expect(analyzeButton(page)).toBeDisabled();
    await expect(
      page.getByText("Enter the requirement and at least one site to analyze."),
    ).toBeVisible();

    // No input-error list on an untouched worksheet.
    await expect(page.getByText(/still need attention/i)).toHaveCount(0);
  });

  test("B. narrow load: no horizontal overflow, state meaning visible without hover", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 600, height: 900 });
    await gotoDecision(page);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    const group = siteGroup(page, "A");
    await group
      .getByLabel("Power-delivery complexity", { exact: true })
      .selectOption("1");
    await expect(
      group.getByText(
        "Limited additional infrastructure. Power from month 18, full month 24.",
      ),
    ).toBeVisible();

    await group
      .getByLabel("Schedule uncertainty", { exact: true })
      .selectOption("3");
    await expect(
      group.getByText(
        "Large timing uncertainty. Up to 18 months late in the worst modeled case.",
      ),
    ).toBeVisible();
  });

  test("C. loading an example fills every field and shows a result", async ({
    page,
  }) => {
    await gotoDecision(page);
    await loadExample(page, "cheap_site_risky_schedule");

    await expect(page.getByLabel("Required capacity (MW)", { exact: true })).not.toHaveValue(
      "",
    );
    for (const id of ["A", "B", "C"]) {
      const group = siteGroup(page, id);
      await expect(
        group.getByLabel("Capacity (MW)", { exact: true }),
      ).not.toHaveValue("");
      await expect(
        group.getByLabel("Power-delivery complexity", { exact: true }),
      ).not.toHaveValue("");
    }

    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Analyze a scenario, or load an example, to see a recommendation.",
      ),
    ).toHaveCount(0);
  });

  test("D. Clear returns every value to blank and removes the result", async ({
    page,
  }) => {
    await gotoDecision(page);
    await loadExample(page, "cheap_site_risky_schedule");
    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toBeVisible();

    await page.locator(".analyze-bar").getByRole("button", { name: /^Clear$/ }).click();

    await expect(page.getByLabel("Required capacity (MW)", { exact: true })).toHaveValue(
      "",
    );
    const group = siteGroup(page, "A");
    await expect(group.getByLabel("Capacity (MW)", { exact: true })).toHaveValue("");
    await expect(
      group.getByLabel("Power-delivery complexity", { exact: true }),
    ).toHaveValue("");

    await expect(page.locator(".results-context")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: /^The decision$/ }),
    ).toHaveCount(0);
    await expect(
      page.getByText(
        "Analyze a scenario, or load an example, to see a recommendation.",
      ),
    ).toBeVisible();
  });

  test("E. Σ K < D blocks Analyze; raising capacity recovers", async ({ page }) => {
    await gotoDecision(page);

    // Reduce to a single site so only the feasibility gap can block Analyze.
    for (const id of ["C", "B"]) {
      await siteGroup(page, id)
        .getByRole("button", { name: `Remove Site ${id}` })
        .click();
    }

    await page.getByLabel("Required capacity (MW)", { exact: true }).fill("5000");
    await page.getByLabel("Target date (month)", { exact: true }).fill("30");
    await page.getByLabel("Delay consequence", { exact: true }).fill("0.05");

    const group = siteGroup(page, "A");
    await group.getByLabel("Capacity (MW)", { exact: true }).fill("100");
    await group.getByLabel("Relative cost per MW", { exact: true }).fill("1");
    await group.getByLabel("Power-delivery complexity", { exact: true }).selectOption("1");
    await group.getByLabel("Schedule uncertainty", { exact: true }).selectOption("1");

    await expect(
      page.locator(".editor__note").getByText(/capacity gap/i),
    ).toBeVisible();
    await expect(page.locator(".analyze-blocker")).toBeVisible();
    await expect(analyzeButton(page)).toBeDisabled();

    await group.getByLabel("Capacity (MW)", { exact: true }).fill("6000");
    await expect(page.locator(".editor__note")).toHaveCount(0);
    await expect(page.locator(".analyze-blocker")).toHaveCount(0);
    await expect(analyzeButton(page)).toBeEnabled();
  });

  test("F. builder copy hygiene", async ({ page }) => {
    await gotoDecision(page);
    // Populate the state meanings so their copy is in the DOM for the scan.
    for (const id of ["A", "B", "C"]) {
      const group = siteGroup(page, id);
      await group.getByLabel("Power-delivery complexity", { exact: true }).selectOption("2");
      await group.getByLabel("Schedule uncertainty", { exact: true }).selectOption("2");
    }

    const text = (await builder(page).innerText()).toLowerCase();
    expect(text).not.toContain("willing to pay");
    expect(text).not.toContain("worth accepting");
    expect(text).not.toContain("power-delivery burden");
    expect(text).not.toContain("reset to starter");
    expect(text).not.toMatch(/[$€£]/);
    // λ must not be presented as an empirical market price.
    expect(text).toContain("not a market price");
  });
});
