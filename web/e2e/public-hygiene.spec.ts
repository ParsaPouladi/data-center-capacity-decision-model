import { test, expect, type Page } from "@playwright/test";
import { gotoDecision, loadExample, type ExampleId } from "./helpers";

/**
 * Final public-hygiene gate. Inspects *rendered* public content (and the
 * public data actually served), not merely source text.
 *
 * The boundary being enforced:
 *   - No em dash anywhere in public presentation.
 *   - No "Problem 1" in public copy.
 *   - The Decision page carries no raw technical notation and no
 *     private / provenance / deployment vocabulary, and no unsupported
 *     optimizer-causality language.
 *   - The Technical Documentation page keeps its canonical notation and its
 *     scope / calibration disclosure, but still exposes no private
 *     provenance / deployment detail.
 *   - The public data files hold no provenance, version, seed, config-path,
 *     "baseline", or generator identifiers.
 */

const EM_DASH = "—";

/** Provenance / deployment / build vocabulary that must never be public. */
const PRIVATE_VOCAB: RegExp[] = [
  /Problem 1/i,
  /generated_by/i,
  /model_spec/i,
  /mapping_version/i,
  /trackc_version/i,
  /\bengine version\b/i,
  /\brandom seed\b/i,
  /seed \d/i,
  /\bguardrail\b/i,
  /\bLP-solve\b/i,
  /recursion depth/i,
  /\bHHI\b/i,
  /Herfindahl/i,
  /concentration index/i,
  /site-count cap/i,
  /live-optimization (?:site )?limit/i,
  /hosting|deployment architecture/i,
  /executor|concurrency/i,
  /\bPhase \d/i,
  /\breviewer\b|\bagent\b|handoff/i,
  /configs\//i,
];

/** Raw Decision-page technical notation kept off that surface. */
const DECISION_NOTATION: RegExp[] = [
  /P\(meet/,
  /E\[L\]/,
  /E\[S\]/,
  /Objective J/i,
  /\bJ ?=/,
  /λ/, // λ
  /Σ/, // Σ
  /\bHHI\b/,
];

/** Unsupported optimizer-causality language. */
const CAUSAL_LANGUAGE: RegExp[] = [
  /\bchose\b/i,
  /\bpreferred\b/i,
  /\bfavou?red\b/i,
  /\bdecided\b/i,
  /\bjudged\b/i,
  /recommends because/i,
];

async function mainText(page: Page): Promise<string> {
  return (await page.getByRole("main").innerText()).normalize("NFC");
}

/* ================================================================== */
/* Decision page                                                       */
/* ================================================================== */

test("Decision page: blank first load shows the builder and no result", async ({
  page,
}) => {
  await gotoDecision(page);
  await expect(page.locator(".results-empty")).toBeVisible();
  await expect(page.locator(".results")).toHaveCount(0);
  await expect(page.locator(".results-context")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2, name: /^The decision$/ })).toHaveCount(0);
});

test("Decision page: no em dash, no Problem 1, no raw notation, no private vocabulary (blank)", async ({
  page,
}) => {
  await gotoDecision(page);
  const text = await mainText(page);

  expect(text).not.toContain(EM_DASH);
  for (const re of PRIVATE_VOCAB) expect(text, `private vocab ${re}`).not.toMatch(re);
  for (const re of DECISION_NOTATION) expect(text, `notation ${re}`).not.toMatch(re);
});

for (const id of [
  "balanced_portfolio",
  "capacity_constrained_portfolio",
  "cheap_site_risky_schedule",
] as ExampleId[]) {
  test(`Decision page: worked result for "${id}" stays clean of em dash, notation, private vocab and causal language`, async ({
    page,
  }) => {
    await gotoDecision(page);
    await loadExample(page, id);
    await expect(page.getByRole("heading", { level: 2, name: /^The decision$/ })).toBeVisible();

    const text = await mainText(page);
    expect(text).not.toContain(EM_DASH);
    for (const re of PRIVATE_VOCAB) expect(text, `private vocab ${re}`).not.toMatch(re);
    for (const re of DECISION_NOTATION) expect(text, `notation ${re}`).not.toMatch(re);

    // The optimizer-causality ban applies to the whole rendered result,
    // including the conditional structural note where one is present.
    const results = await page.locator(".results").innerText();
    for (const re of CAUSAL_LANGUAGE) {
      expect(results, `causal language ${re}`).not.toMatch(re);
    }
  });
}

/* ================================================================== */
/* Technical Documentation page                                        */
/* ================================================================== */

test("Technical Documentation: no em dash and no Problem 1 in rendered content", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  await expect(page.locator("#notation table").first()).toBeVisible();
  const text = await mainText(page);

  expect(text).not.toContain(EM_DASH);
  expect(text).not.toMatch(/Problem 1/i);
});

test("Technical Documentation: no private provenance / deployment vocabulary", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  await expect(page.locator("#notation table").first()).toBeVisible();
  const text = await mainText(page);

  // λ, E[L] and the objective are legitimate canonical notation here, so the
  // Decision-page notation ban does not apply. The provenance / deployment
  // ban still does.
  const bannedHere = PRIVATE_VOCAB.filter(
    (re) => !/engine version/i.test(re.source),
  );
  for (const re of bannedHere) {
    expect(text, `private vocab ${re}`).not.toMatch(re);
  }
  // No build / environment identifiers.
  expect(text).not.toMatch(/version \d/i);
  expect(text).not.toMatch(/\bv\d+\.\d+\.\d+/i);
  expect(text).not.toMatch(/executor|uvicorn|FastAPI|chromium/i);
});

test("Technical Documentation: canonical notation and scope disclosure remain present", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");

  // Canonical notation is still defined and displayed.
  await expect(page.locator("#notation table").first()).toBeVisible();
  const notation = await page.locator("#notation").innerText();
  expect(notation).toMatch(/λ|E\[L\]|E\[S\]|P/); // λ / E[L] / E[S] / P_meet
  await expect(page.locator("#objective math").first()).toBeVisible();

  // The assumptions section is present, with the independence assumption
  // and the professional calibration / application-boundary statement.
  await expect(
    page.getByRole("heading", { name: /Assumptions and application boundary/i }),
  ).toBeVisible();
  const scope = await page.locator("#scope-assumptions").innerText();
  expect(scope).toMatch(/delays are independent in the public reference model/i);
  expect(scope).toMatch(/generalized reference values/i);
  expect(scope).toMatch(
    /project implementations calibrate the reference mappings, cost structure, and assumptions/i,
  );
  expect(scope).toMatch(/structured allocation analysis under limited information/i);

  // The numerical-authority statement survives, on this page only.
  await expect(
    page.getByText(
      /AI does not generate or alter the quantitative outputs/i,
    ).first(),
  ).toBeVisible();
});

/* ================================================================== */
/* Public data                                                         */
/* ================================================================== */

test("public data files hold no provenance, version, seed, config path, baseline or generator identifiers", async ({
  request,
}) => {
  const index = await (await request.get("/data/index.json")).json();
  const files: string[] = [
    "index.json",
    "mappings.json",
    ...index.presets.map((p: { file: string }) => p.file),
  ];

  const bannedInData: RegExp[] = [
    /Problem 1/i,
    /baseline/i,
    /generated_by/i,
    /generator/i,
    /model_spec/i,
    /configs\//i,
    /mapping_version/i,
    /trackc_version/i,
    /"[^"]*version[^"]*"\s*:/i,
    /random_seed/i,
    /"seed"\s*:/i,
    /"source"\s*:/i,
    /\bHHI\b/,
    /feasibility_status/i,
    new RegExp(EM_DASH),
  ];

  for (const file of files) {
    const res = await request.get(`/data/${file}`);
    expect(res.ok(), `GET /data/${file}`).toBeTruthy();
    const raw = await res.text();
    for (const re of bannedInData) {
      expect(raw, `${file} contains ${re}`).not.toMatch(re);
    }
  }
});
