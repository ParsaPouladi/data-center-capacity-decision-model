import { test, expect, type Page } from "@playwright/test";
import indexFile from "../public/data/index.json" with { type: "json" };
import { gotoDecision, loadExample, requiredCapacityField } from "./helpers";
import type { DataIndex } from "../src/types/showcase";

/**
 * Gate — the curated public example set.
 *
 * The "Load an example" menu carries exactly three examples, in order, and no
 * example is preloaded on a fresh page. The spec proves the menu contents and
 * each example's committed result renders; it re-derives no model quantity.
 */

const INDEX = indexFile as unknown as DataIndex;

const APPROVED = [
  { id: "balanced_portfolio", title: "Balanced portfolio" },
  { id: "capacity_constrained_portfolio", title: "Capacity-constrained portfolio" },
  { id: "cheap_site_risky_schedule", title: "Cheap site, risky schedule" },
];

/** The example <select>'s real option list, excluding the disabled placeholder. */
async function menuOptions(page: Page) {
  const select = page.getByLabel(/Load an example/i);
  return select.locator("option:not([disabled])").evaluateAll((els) =>
    els.map((el) => ({
      value: (el as HTMLOptionElement).value,
      label: (el.textContent ?? "").trim(),
    })),
  );
}

const allocRow = (page: Page, id: string) =>
  page.locator(".alloc-bars__row").filter({ hasText: `Site ${id}` });

/* ------------------------------------------------------------------ */
/* 1. Fresh load is blank                                              */
/* ------------------------------------------------------------------ */

test("a fresh page loads blank with no example preloaded", async ({ page }) => {
  await gotoDecision(page);

  await expect(page.locator(".results-empty")).toBeVisible();
  await expect(page.locator(".results-context")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: /^The decision$/ })).toHaveCount(0);
  // The select sits on its placeholder, not on an example.
  await expect(page.getByLabel(/Load an example/i)).toHaveValue("");
  await expect(requiredCapacityField(page)).toHaveValue("");
});

/* ------------------------------------------------------------------ */
/* 2. The menu is exactly the three approved examples, in order        */
/* ------------------------------------------------------------------ */

test("the example menu contains exactly the three approved examples in order", async ({
  page,
}) => {
  // The served index already carries only the three, in order.
  expect(INDEX.presets.map((p) => ({ id: p.id, title: p.title }))).toEqual(APPROVED);

  await gotoDecision(page);
  expect(await menuOptions(page)).toEqual(
    APPROVED.map((e) => ({ value: e.id, label: e.title })),
  );

  // No retired N = 6 / N = 10 curated option, and nothing titled with a site count.
  const labels = (await menuOptions(page)).map((o) => o.label);
  for (const label of labels) expect(label).not.toMatch(/\d+\s*sites?/i);
  expect(labels).not.toContain("Extended (6 sites)");
  expect(labels).not.toContain("Larger (10 sites)");
});

/* ------------------------------------------------------------------ */
/* 3. Balanced portfolio — the approved inputs and a mixed result      */
/* ------------------------------------------------------------------ */

test("Balanced portfolio loads the approved inputs and renders the mixed recommendation", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "balanced_portfolio");

  await expect(requiredCapacityField(page)).toHaveValue("300");
  await expect(page.getByLabel(/Target date \(month\)/i)).toHaveValue("30");
  await expect(page.getByLabel("Delay consequence", { exact: true })).toHaveValue(
    "0.05",
  );

  const keyResults = page.getByRole("region", { name: /^The decision$/ });
  await expect(
    keyResults.getByRole("heading", { name: /^Recommended allocation$/ }),
  ).toBeVisible();

  // A mixed allocation: 150 MW on A and on C, nothing on B.
  await expect(allocRow(page, "A")).toContainText("150 MW allocated");
  await expect(allocRow(page, "B")).toContainText("0 MW allocated");
  await expect(allocRow(page, "C")).toContainText("150 MW allocated");

  // The full result surface is present: the four numbers and the choice
  // table. Scoped to the numbers column, not the whole decision region --
  // the golden synthesis paragraph may also mention "chance of meeting the
  // target date" in its own tradeoff sentence.
  const numbers = keyResults.locator(".decision-grid__numbers");
  await expect(numbers.getByText(/Chance of meeting the target date/i)).toBeVisible();
  await expect(
    numbers.getByText(/Expected shortfall at the target date/i),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: /Choice comparison/i }),
  ).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* 4. Capacity-constrained portfolio — the forced case                 */
/* ------------------------------------------------------------------ */

test("Capacity-constrained portfolio renders the forced allocation and its explanation", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "capacity_constrained_portfolio");

  await expect(requiredCapacityField(page)).toHaveValue("600");

  const keyResults = page.getByRole("region", { name: /^The decision$/ });
  await expect(
    keyResults.getByRole("heading", { name: /^Required allocation$/ }),
  ).toBeVisible();

  for (const id of ["A", "B", "C"]) {
    await expect(allocRow(page, id)).toContainText("200 MW allocated");
    await expect(allocRow(page, id)).toContainText("0 MW unused");
  }

  // The forced-case explanation is in the golden "Why this decision"
  // synthesis; no choice comparison for a forced allocation.
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /Every candidate site is developed in full/i,
  );
  await expect(page.locator(".decision-synthesis__text")).toContainText(
    /no allocation to prefer over another/i,
  );
  await expect(
    page.getByRole("region", { name: /Choice comparison/i }),
  ).toHaveCount(0);
});

/* ------------------------------------------------------------------ */
/* 5. Cheap site, risky schedule — delay consequence 0.025, full result */
/* ------------------------------------------------------------------ */

test("Cheap site, risky schedule uses delay consequence 0.025 and renders a full optimized result", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  await expect(page.getByLabel("Delay consequence", { exact: true })).toHaveValue(
    "0.025",
  );

  const keyResults = page.getByRole("region", { name: /^The decision$/ });
  await expect(
    keyResults.getByRole("heading", { name: /^Recommended allocation$/ }),
  ).toBeVisible();
  // A genuine tradeoff mix, not the cost-only corner (which would be A only).
  await expect(allocRow(page, "A")).toContainText("250 MW allocated");
  await expect(allocRow(page, "B")).toContainText("250 MW allocated");

  // It carries the envelope, so decision sensitivity renders.
  await expect(
    keyResults.getByRole("heading", { name: /^Decision sensitivity$/ }),
  ).toBeVisible();
  // Scoped to the numbers column, not the whole decision region -- see the
  // "Balanced portfolio" test above for why.
  await expect(
    keyResults.locator(".decision-grid__numbers").getByText(/Chance of meeting the target date/i),
  ).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* 7. Technical Documentation still loads its worked example           */
/* ------------------------------------------------------------------ */

test("Technical Documentation loads its worked example after the rename", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  await expect(
    page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
  ).toBeVisible();

  // The worked-example figures read /data/cheap_site_risky_schedule.json.
  await expect(page.locator(".lambda-panel")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#regimes table")).toHaveCount(2);
  await expect(page.locator("#co-optimality table")).toBeVisible();
});
