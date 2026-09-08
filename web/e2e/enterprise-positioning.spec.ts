import { test, expect, type Page } from "@playwright/test";
import { gotoDecision, loadExample } from "./helpers";

/**
 * Enterprise positioning gate.
 *
 * The product has to present as serious infrastructure decision-support work
 * before a reader has run anything: capability first, application boundary
 * second, authorship visible, and a professional way to make contact at both
 * ends of the page. It also has to stop underselling itself: the defensive
 * "synthetic / stylized / illustrative model" framing and the closing scope
 * disclaimer are gone from prominent copy, and the honest mapping-provenance
 * statement lives once, in the Technical Documentation, where an expert
 * auditing the model will look for it.
 *
 * These assertions test the principle, not the sentence: they anchor on the
 * contact address, the authorship line, the three capability steps, and the
 * absence of the undersell vocabulary, rather than freezing wording.
 */

const CONTACT = "ParsaPouladi@outlook.com";
const MAILTO = `mailto:${CONTACT}`;

/**
 * Framing that undersells the work. None of it may appear in prominent copy
 * on either page. "Reference" and "calibration" wording replaces it where
 * mapping provenance genuinely has to be disclosed.
 */
const UNDERSELL: RegExp[] = [
  /Synthetic decision model/i,
  /\bsynthetic\b/i,
  /\bstylized\b/i,
  /\billustrative\b/i,
  /demonstration model/i,
  /\btoy\b/i,
  /research (?:model|prototype|exercise)/i,
  /reference exercise/i,
  /not a forecast/i,
  /does not predict/i,
  /what the model does not do/i,
  /not empirical/i,
  /not observed/i,
];

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).normalize("NFC");
}

/* ================================================================== */
/* First screen: capability, authorship, contact                       */
/* ================================================================== */

test("the first screen leads with capability and states the boundary positively", async ({
  page,
}) => {
  await gotoDecision(page);
  const hero = page.locator(".hero");

  // The business problem -- a data-center site decision under limited
  // information and uncertain power delivery -- leads, before the
  // instruction to build a portfolio that follows it in the same paragraph.
  const lede = hero.locator(".hero__lede");
  await expect(lede).toContainText(/data center site decision/i);
  await expect(lede).toContainText(/before every engineering detail is resolved/i);
  await expect(lede).toContainText(/phased power delivery/i);
  await expect(lede).toContainText(
    /how should a required amount of electrical capacity be split across candidate sites/i,
  );
  await expect(lede).toContainText(/build a portfolio below/i);

  // The concept statement: incomplete qualitative knowledge
  // becomes explicit physical parameters and distributions, not an arbitrary
  // score, and it is stated positively rather than as a limitation.
  const concept = hero.locator(".hero__concept");
  await expect(concept).toContainText(/not converted into arbitrary risk scores/i);
  await expect(concept).toContainText(
    /classified, mapped into explicit physical timing and probability distributions/i,
  );
  await expect(concept).toContainText(/evaluated through the quantitative model/i);

  // One evidence sentence, two clickable, independently-attributed sources.
  const evidence = hero.locator(".hero__evidence");
  await expect(evidence).toContainText(/11\.8%/);
  await expect(evidence).toContainText(/20%/);
  const lbnl = evidence.locator('a[href*="lbl.gov"]');
  const iea = evidence.locator('a[href*="iea.org"]');
  await expect(lbnl).toHaveCount(1);
  await expect(iea).toHaveCount(1);
  await expect(lbnl).toHaveAttribute("target", "_blank");
  await expect(lbnl).toHaveAttribute("rel", /noopener/);
  await expect(iea).toHaveAttribute("target", "_blank");
  await expect(iea).toHaveAttribute("rel", /noopener/);

  // Reading order: the business problem, then the concept statement, then
  // the evidence -- never a bare instruction to "build a portfolio" ahead of
  // the problem it exists to solve.
  const order = await hero.evaluate((el) => {
    const nodes = Array.from(
      el.querySelectorAll(".hero__lede, .hero__concept, .hero__evidence"),
    );
    return nodes.map((n) => n.className);
  });
  expect(order[0]).toContain("hero__lede");
  expect(order[1]).toContain("hero__concept");
  expect(order[2]).toContain("hero__evidence");
});

test("the distinctive capability is legible on the first screen as three steps", async ({
  page,
}) => {
  await gotoDecision(page);
  const steps = page.locator(".capability__step");
  await expect(steps).toHaveCount(3);

  // limited information -> explicit physical uncertainty -> auditable
  // quantitative decisions.
  await expect(steps.nth(0)).toContainText(/Built for limited information/i);
  await expect(steps.nth(0)).toContainText(/qualitative and ordinal site knowledge/i);

  await expect(steps.nth(1)).toContainText(/physical and explicit/i);
  await expect(steps.nth(1)).toContainText(/explicit mappings/i);
  await expect(steps.nth(1)).toContainText(/uncertainty distributions/i);
  // Ordinal states are identifiers, not arithmetic scores.
  await expect(steps.nth(1)).toContainText(/not arithmetic scores/i);

  await expect(steps.nth(2)).toContainText(/Auditable quantitative decisions/i);
  await expect(steps.nth(2)).toContainText(/mathematical engine/i);
  for (const capability of [
    /allocation/i,
    /deadline risk/i,
    /shortfall/i,
    /delay burden/i,
    /cost tradeoff/i,
    /thresholds at which the decision changes/i,
  ]) {
    await expect(steps.nth(2)).toContainText(capability);
  }
});

test("authorship is associated with the model at the top of the page, not only in the footer", async ({
  page,
}) => {
  await gotoDecision(page);

  const byline = page.locator(".hero__byline");
  await expect(byline).toContainText("Parsa Pouladi, Ph.D.");

  // Above the fold at a normal desktop viewport, and above the builder.
  const box = await byline.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeLessThan(600);

  const builder = await page
    .getByRole("heading", { name: /Build a scenario/i })
    .boundingBox();
  expect(box!.y).toBeLessThan(builder!.y);
});

test("a professional contact route exists near the introduction and at the bottom", async ({
  page,
}) => {
  await gotoDecision(page);

  // Top, builder (the project-specific model offer, visible on a
  // blank <=3-site page) and bottom.
  const links = page.locator(`a[href="${MAILTO}"]`);
  await expect(links).toHaveCount(3);

  // Top: inside the lead, framed by the client's problem rather than by
  // authorship, which the byline above it already carries. Its job is
  // discovery — "could Parsa build one of these for my problem?".
  const top = page.locator(".hero .cta");
  await expect(top).toBeVisible();
  await expect(top.locator(".cta__eyebrow")).toHaveText(
    /Project-specific decision modeling/i,
  );
  await expect(top.locator(".cta__ask")).toContainText(
    /similar infrastructure decision under uncertainty/i,
  );
  await expect(top).toContainText(/Custom quantitative decision models/i);
  await expect(top).not.toContainText(/work with the author/i);
  await expect(top.locator(`a[href="${MAILTO}"]`)).toContainText(CONTACT);

  // Middle: the builder's project-specific model offer. Its job is a
  // third, distinct one -- raised at the point a visitor is looking at the
  // portfolio they just built, not merely restating the hero's discovery
  // pitch or the footer's closing conversion.
  const middle = page.locator(".offer--standalone");
  await expect(middle).toBeVisible();
  await expect(middle.locator(".offer__ask")).toContainText(
    /project-specific model/i,
  );
  // The offer's contact link reads "Contact <name>" rather than repeating
  // the address, unlike the hero and footer panels; the mailto target is
  // what has to match.
  await expect(middle.locator(`a[href="${MAILTO}"]`)).toContainText(
    /Contact Parsa Pouladi/i,
  );

  // Bottom: the closing band is a contact opportunity, not a disclaimer, and
  // its job is conversion after the visitor has seen the work — a different
  // message from the top panel, not a restatement of it.
  const bottom = page.locator(".app-footer .cta");
  await expect(bottom).toBeVisible();
  await expect(bottom.locator(".cta__ask")).toContainText(
    /auditable decision model/i,
  );
  await expect(bottom.locator(`a[href="${MAILTO}"]`)).toContainText(CONTACT);

  // The two engagement surfaces belong to one system but do not carry the
  // same headline.
  const topAsk = (await top.locator(".cta__ask").innerText()).trim();
  const bottomAsk = (await bottom.locator(".cta__ask").innerText()).trim();
  expect(topAsk).not.toEqual(bottomAsk);

  const footer = await page.locator(".app-footer").innerText();
  expect(footer).toContain("Parsa Pouladi, Ph.D.");
  for (const re of UNDERSELL) {
    expect(footer, `footer undersell ${re}`).not.toMatch(re);
  }
  expect(footer).not.toMatch(/see the technical documentation page for the full/i);
});

test("the contact route survives onto the Technical Documentation page", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  await expect(
    page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
  ).toBeVisible();
  await expect(page.locator(`.app-footer a[href="${MAILTO}"]`)).toContainText(
    CONTACT,
  );
});

/* ================================================================== */
/* Undersell vocabulary                                                */
/* ================================================================== */

test("the Decision page carries no synthetic / stylized / demo framing", async ({
  page,
}) => {
  await gotoDecision(page);
  const blank = await bodyText(page);
  for (const re of UNDERSELL) {
    expect(blank, `blank page undersell ${re}`).not.toMatch(re);
  }

  await loadExample(page, "cheap_site_risky_schedule");
  const worked = await bodyText(page);
  for (const re of UNDERSELL) {
    expect(worked, `worked result undersell ${re}`).not.toMatch(re);
  }
});

test("mapping provenance is disclosed once, in reference-and-calibration terms", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  await expect(page.locator("#notation table").first()).toBeVisible();
  const text = (await page.locator("body").innerText()).normalize("NFC");

  // The honest disclosure survives, in the register an expert can act on:
  // explicit reference mappings as a baseline parameterization, calibrated
  // per project.
  expect(text).toMatch(/reference mappings as its default parameterization/i);
  expect(text).toMatch(/generalized reference values/i);
  expect(text).toMatch(/calibrate those mappings to the available engineering evidence/i);

  // It is not restated as an apology, and the old framing is gone.
  for (const re of UNDERSELL) {
    expect(text, `documentation undersell ${re}`).not.toMatch(re);
  }

  // Stated where it helps auditability, not repeated on every heading.
  const occurrences =
    text.match(/reference (?:mappings|values|parameterization)/gi) ?? [];
  expect(occurrences.length).toBeGreaterThanOrEqual(2);
  expect(occurrences.length).toBeLessThanOrEqual(5);
});
