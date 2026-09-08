import { test, expect, type Page } from "@playwright/test";
import exampleFile from "../public/data/cheap_site_risky_schedule.json" with { type: "json" };
import {
  formatMw,
  formatMwMonths,
  formatProbability,
  formatRelativeCost,
} from "../src/lib/format";
import type { ShowcaseExport } from "../src/types/showcase";
import {
  buildComparisonPortfolio,
  expectLiveResult,
  gotoDecision,
  loadExample,
  requiredCapacityField,
  runAnalysis,
} from "./helpers";

/**
 * Gate — the three decision visuals in a real browser.
 *
 * V1  Delivery outlook          (one authoritative allocation, no selector)
 * V2  Site delivery             (allocation + delivery timing per site)
 * V3  Choice comparison         (benchmarks + model allocation, no J / HHI)
 *
 * The spec proves presentation properties only — that the intended treatment
 * is on the page, that its important values are readable as text without
 * hovering, that the mode-dependent wording is never upgraded to
 * "recommended", that the forced case suppresses V3, and that the V3 cells
 * carry the authoritative engine fields verbatim. It re-derives no model
 * quantity: expected cell strings are formatted straight from the committed
 * export fixture.
 */

const showcaseOf = (file: unknown): ShowcaseExport =>
  (file as { showcase: unknown }).showcase as ShowcaseExport;

const EXAMPLE = showcaseOf(exampleFile);

const v1 = (page: Page) => page.getByRole("region", { name: /Delivery outlook/i });
const v2 = (page: Page) =>
  page.getByRole("region", { name: /^Site delivery$/ });
const v3 = (page: Page) =>
  page.getByRole("region", { name: /Choice comparison/i });

/** Page-level horizontal overflow, ignoring content inside a .table-scroll. */
async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.querySelectorAll("*"))) {
      if (el.closest(".table-scroll") && !el.classList.contains("table-scroll")) {
        continue;
      }
      if (el.getBoundingClientRect().right > vw + 1) {
        offenders.push(
          `${el.tagName}.${(el.className || "").toString().trim().split(/\s+/)[0]}`,
        );
      }
    }
    return { scrollW: de.scrollWidth, clientW: vw, offenders: [...new Set(offenders)] };
  });
}

/* ------------------------------------------------------------------ */
/* Presence — exactly the three intended treatments                    */
/* ------------------------------------------------------------------ */

test("the three decision visuals are present and the superseded treatments are gone", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  await expect(v1(page)).toBeVisible();
  await expect(v2(page)).toBeVisible();
  await expect(v3(page)).toBeVisible();

  // The replaced Decision-page treatments: the seven-column benchmark table
  // and the cost-versus-delay scatter.
  await expect(
    page.getByRole("heading", { name: /^Strategy comparison$/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Cost versus expected delay burden/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Per-site phased power delivery/i }),
  ).toHaveCount(0);

  // The engine-internal quantities V3 must not reintroduce.
  const table = v3(page).locator("table");
  await expect(table).toBeVisible();
  const headers = (await table.locator("thead").innerText()).toLowerCase();
  expect(headers).not.toMatch(/objective|hhi|feasibility|score|rank/);
});

/* ------------------------------------------------------------------ */
/* V1 — no allocation selector                                         */
/* ------------------------------------------------------------------ */

test("V1 shows one authoritative allocation and has no allocation-selector tabs", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  const outlook = v1(page);
  await expect(outlook.locator(".preset-tabs")).toHaveCount(0);
  await expect(outlook.locator("[aria-pressed]")).toHaveCount(0);
  await expect(outlook.getByRole("button")).toHaveCount(0);
  // Exactly one plotted series.
  await expect(outlook.locator(".chart-figure__series-note")).toHaveCount(1);
});

/* ------------------------------------------------------------------ */
/* Captions                                                            */
/* ------------------------------------------------------------------ */

test("the two figures carry a concise caption, and the comparison carries no defensive one", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  // V1 says what the trajectory is and where the uncertainty went. The
  // merges this into the section's own "how to read this" caption rather
  // than stacking it in a separate figure caption underneath.
  await expect(v1(page).locator(".section-subheading")).toContainText(
    /expected capacity across the modeled delay outcomes/i,
  );
  await expect(v1(page).locator(".section-subheading")).toContainText(
    /not a guaranteed schedule/i,
  );
  // V2 says once, and only once, how the site profiles roll up into V1.
  await expect(v2(page).locator(".section-subheading")).toContainText(
    /combine to produce the portfolio capacity trajectory above/i,
  );
  await expect(v2(page).locator(".section-subheading")).toContainText(
    /Each site delivers power in two stages/i,
  );
  for (const region of [v1(page), v2(page)]) {
    await expect(region.locator(".section-subheading")).toBeVisible();
  }

  // The comparison is decision evidence; methodological defense of it
  // belongs in the Technical Documentation, not under the table.
  const comparison = await v3(page).innerText();
  expect(comparison).not.toMatch(/No ranking or score is computed here/i);
  expect(comparison).not.toMatch(/objective|score/i);
});

/* ------------------------------------------------------------------ */
/* Nothing essential is hover-only                                     */
/* ------------------------------------------------------------------ */

test("the key figure values are readable as text without hovering", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  const { required_capacity_mw: D, target_month: T } =
    EXAMPLE.scenario.system;

  // V1: the required-capacity rule and target-date marker are named in text.
  const readout = v1(page).locator(".chart-figure__readout");
  await expect(readout).toBeVisible();
  await expect(readout).toContainText(formatMw(D));
  await expect(readout).toContainText(`Target month ${T}`);

  // Recharts always mounts its tooltip container; with no pointer on the
  // plot it must be empty, so nothing essential can be living inside it.
  await expect(v1(page).locator(".recharts-tooltip-wrapper")).toHaveText("");

  // V2: every site's exact MW values and every delay outcome are text.
  const strip = v2(page);
  const rows = strip.locator(".site-strip__row");
  // One row per site, in the engine's own profile order.
  await expect(rows).toHaveCount(EXAMPLE.site_power_profiles.length);
  for (const [i, profile] of EXAMPLE.site_power_profiles.entries()) {
    const site = EXAMPLE.scenario.sites.find((x) => x.id === profile.site_id)!;
    const row = rows.nth(i);
    await expect(row).toContainText(`Site ${site.id}`);
    const values = row.locator(".site-strip__values");
    await expect(values).toContainText(`K = ${formatMw(site.capacity_mw)}`);
    await expect(values).toContainText("allocated");
    await expect(values).toContainText("unused");
  }
  const profile = EXAMPLE.site_power_profiles[0];
  const firstRow = rows.first();
  for (const outcome of profile.outcomes) {
    await expect(firstRow.locator(".site-strip__outcomes")).toContainText(
      formatProbability(outcome.probability),
    );
    await expect(firstRow.locator(".site-strip__outcomes")).toContainText(
      `full power month ${outcome.tau2}`,
    );
  }
  // Shared month axis and the target-date marker are labelled in text.
  await expect(strip.locator(".site-strip__axis-legend")).toContainText(
    `Target month ${T}`,
  );
  await expect(strip.locator(".site-strip__axis-legend")).toContainText("Month");

  // V3: every meter states its exact value beside the bar.
  const meters = v3(page).locator(".choice-meter__value");
  expect(await meters.count()).toBeGreaterThan(0);
  for (const text of await meters.allInnerTexts()) {
    expect(text.trim()).not.toBe("");
  }
});

/* ------------------------------------------------------------------ */
/* V3 — authoritative values, optimizer mode                           */
/* ------------------------------------------------------------------ */

test("V3 rows carry the authoritative engine fields and the model row is marked", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  const expected: [string, { p_meet: number; development_cost: number; expected_shortfall_mw: number; expected_delay_burden_mw_months: number }][] =
    [
      ["Model allocation", EXAMPLE.optimizer!.evaluated],
      ["Cost first", EXAMPLE.strategies.cost_concentration],
      ["Schedule first", EXAMPLE.strategies.speed_reliability],
      ["Spread across sites", EXAMPLE.strategies.diversified],
    ];

  for (const [label, r] of expected) {
    const row = v3(page)
      .locator("tbody tr")
      .filter({ has: page.locator(".choice-row__label", { hasText: label }) });
    await expect(row).toHaveCount(1);
    const text = await row.innerText();
    expect(text, `${label} chance`).toContain(formatProbability(r.p_meet));
    expect(text, `${label} cost`).toContain(
      formatRelativeCost(r.development_cost),
    );
    expect(text, `${label} shortfall`).toContain(
      formatMw(r.expected_shortfall_mw),
    );
    expect(text, `${label} burden`).toContain(
      formatMwMonths(r.expected_delay_burden_mw_months),
    );
  }

  // Exactly one row is marked authoritative, and it is the model's own.
  const marked = v3(page).locator("tbody tr.choice-row--marked");
  await expect(marked).toHaveCount(1);
  await expect(marked.locator(".choice-row__label")).toHaveText(
    "Model allocation",
  );
  // "Cheap site, risky schedule" runs at a non-zero delay consequence inside a
  // genuine tradeoff regime, so the marked row is the recommended allocation.
  expect(EXAMPLE.optimizer!.at_lambda).toBe(0.025);
  await expect(marked.locator(".choice-row__badge")).toContainText(
    /Recommended allocation/i,
  );
});

/* ------------------------------------------------------------------ */
/* V3 — comparison mode wording                                        */
/* ------------------------------------------------------------------ */

test("comparison mode marks the best compared strategy and never says recommended or optimal", async ({
  page,
}) => {
  await gotoDecision(page);
  // No curated example is above the live-optimization site limit; build a
  // seven-site portfolio in the builder so the analysis routes to the
  // strategy-comparison path (no optimizer row).
  await buildComparisonPortfolio(page);

  const marked = v3(page).locator("tbody tr.choice-row--marked");
  await expect(marked).toHaveCount(1);
  await expect(marked.locator(".choice-row__badge")).toContainText(
    "Best of the compared strategies",
  );

  // No model-allocation row exists; the lead names only the benchmark
  // strategies and carries no site-count / deployment rationale.
  await expect(
    v3(page).locator(".choice-row__label", { hasText: "Model allocation" }),
  ).toHaveCount(0);
  const lead = v3(page).locator(".section-subheading");
  await expect(lead).toContainText(/each row is a candidate allocation strategy/i);
  await expect(lead).not.toContainText(/site limit|live-optimization|deployment/i);

  // Nowhere in the comparison is the result upgraded to a recommendation.
  const regionText = await v3(page).innerText();
  expect(regionText).not.toMatch(/recommend/i);
  expect(regionText).not.toMatch(/optimal/i);

  // V2 falls back to the most-likely outcome plus a min/max range above six
  // sites, and still states the range as text.
  await expect(v2(page).locator(".site-strip__row")).toHaveCount(7);
  await expect(v2(page).locator(".site-strip__row").first()).toContainText(
    /Most likely: .*full power lands between month \d+ and month \d+/is,
  );
});

/* ------------------------------------------------------------------ */
/* Forced case (sum(K) == D exactly) suppresses V3                     */
/* ------------------------------------------------------------------ */

test("the exact forced case suppresses V3 while V1 and V2 remain", async ({
  page,
}) => {
  await gotoDecision(page);
  // Start from a worked portfolio, then ask for exactly its total developable
  // capacity: Σ Kᵢ = 500 + 300 + 250 = 1050 MW. That is case B — every
  // strategy is the same forced allocation.
  await loadExample(page, "cheap_site_risky_schedule");
  const sumK = EXAMPLE.scenario.sites.reduce((a, s) => a + s.capacity_mw, 0);
  expect(sumK).toBe(1050);

  await requiredCapacityField(page).fill(String(sumK));
  const resp = page.waitForResponse(
    (r) => r.url().includes("/api/p1/optimize") && r.status() === 200,
    { timeout: 30_000 },
  );
  await runAnalysis(page);
  await resp;
  await expectLiveResult(page);
  await expect(
    page.getByRole("heading", { name: /^Required allocation$/ }),
  ).toBeVisible();

  await expect(v3(page)).toHaveCount(0);
  await expect(v1(page)).toBeVisible();
  await expect(v2(page)).toBeVisible();
});

/* ------------------------------------------------------------------ */
/* Responsive                                                          */
/* ------------------------------------------------------------------ */

test("390 px viewport: the comparison's off-screen columns are discoverable and reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  // The table is intentionally wider than the viewport here; say so.
  const cue = v3(page).locator(".table-scroll-cue");
  await expect(cue).toBeVisible();
  await expect(cue).toContainText(/scroll sideways/i);

  // Every column is reachable: the scroll container is a labelled, focusable
  // region, and scrolling it brings the last column fully into view.
  const scroller = v3(page).getByRole("region", { name: /scrollable/i });
  await expect(scroller).toHaveAttribute("tabindex", "0");
  const reachable = await scroller.evaluate((el) => {
    el.scrollLeft = el.scrollWidth;
    const last = el.querySelector("thead th:last-child") as HTMLElement;
    return (
      last.getBoundingClientRect().right <=
      el.getBoundingClientRect().right + 1
    );
  });
  expect(reachable).toBe(true);
  await expect(v3(page)).toContainText(/Expected delay burden/i);

  // The table scrolls; the page does not.
  const overflow = await pageOverflow(page);
  expect(overflow.offenders, "overflowing elements at 390 px").toEqual([]);
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
});

test("the scroll cue is not shown at desktop, where the comparison fits", async ({
  page,
}) => {
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");
  await expect(v3(page).locator(".table-scroll-cue")).toBeHidden();
});

test("640 px viewport: the visuals stay readable with no page-level overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await gotoDecision(page);
  await loadExample(page, "cheap_site_risky_schedule");

  await expect(v1(page)).toBeVisible();
  await expect(v2(page)).toBeVisible();
  await expect(v3(page)).toBeVisible();

  // Axis titles, captions and labels survive the narrow layout.
  await expect(v1(page).locator(".chart-figure__readout")).toBeVisible();
  await expect(v2(page).locator(".site-strip__axis-legend")).toContainText(
    "Month",
  );
  await expect(v3(page).locator(".section-subheading")).toBeVisible();

  const overflow = await pageOverflow(page);
  expect(overflow.offenders, "overflowing elements at 640 px").toEqual([]);
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
});
