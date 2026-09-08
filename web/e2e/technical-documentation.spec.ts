import { test, expect, type Page } from "@playwright/test";
import mappingsFile from "../public/data/mappings.json" with { type: "json" };
import exampleFile from "../public/data/cheap_site_risky_schedule.json" with { type: "json" };
import type { MappingsBundle, ShowcaseExport } from "../src/types/showcase";

/**
 * Gate — Technical Documentation as one professional technical
 * publication.
 *
 * The spec proves structural, terminological and accessibility properties.
 * It re-derives no model quantity: where it compares a rendered number, it
 * compares against the committed export the page itself reads.
 */

const MAPPINGS = mappingsFile as unknown as MappingsBundle;
const EXAMPLE = (exampleFile as { showcase: unknown }).showcase as ShowcaseExport;

/** The twenty top-level sections, in order. */
const SECTION_TITLES = [
  "1. Why data-center capacity allocation under power uncertainty matters",
  "2. The decision framework",
  "3. The causal mechanism",
  "4. Inputs and state mappings",
  "5. Phased power delivery",
  "6. Timing uncertainty",
  "7. Scenario construction",
  "8. Delivered usable capacity",
  "9. Deadline performance",
  "10. Development cost",
  "11. Delay consequence",
  "12. The objective",
  "13. Benchmark strategies",
  "14. Allocation optimization",
  "15. Co-optimal and effectively tied results",
  "16. How the answer changes with the delay consequence",
  "17. Exact evaluation and Monte Carlo",
  "18. Reproducibility",
  "19. Complete notation and public labels",
  "20. Assumptions and application boundary",
];

/**
 * Vocabulary that must never reach rendered public text.
 */
const PRIVATE_VOCABULARY = [
  /Problem 1/,
  /guardrail/i,
  /deployment/i,
  /executor/i,
  /LP solve/i,
  /recursion depth/i,
  /unresolved bracket/i,
  /generated_by/,
  /mapping_version/,
  /trackc/i,
  /model_spec/i,
  /configs\//,
  /baseline/i,
  /engine version/i,
  /peak memory/i,
  /wall.clock/i,
  /intentionally omits/i,
  /deferred presentation/i,
  /HHI/,
  /Herfindahl/i,
  /feasibility status/i,
  /system_insufficient/i,
];

async function gotoDocs(page: Page): Promise<void> {
  await page.goto("/technical-documentation.html");
  await expect(
    page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
  ).toBeVisible();
  // The worked-example sections read a committed export; wait for one of its
  // rendered figures before asserting on data-driven content.
  await expect(page.locator(".lambda-panel")).toBeVisible({ timeout: 30_000 });
}

/** Page-level horizontal overflow, ignoring content inside a scroll container. */
async function pageOverflow(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const vw = de.clientWidth;
    const offenders: string[] = [];
    const scrollers = ".table-scroll, .chart-figure__plot, .mechanism-diagram, .equation__display";
    for (const el of Array.from(document.querySelectorAll("*"))) {
      const holder = el.closest(scrollers);
      if (holder && el !== holder) continue;
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
/* 1-2. Document architecture and contents navigation                  */
/* ------------------------------------------------------------------ */

test("the twenty top-level sections exist in the approved order", async ({
  page,
}) => {
  await gotoDocs(page);

  const headings = (
    await page.locator(".doc-section > .section-heading").allInnerTexts()
  ).map((s) => s.trim());
  expect(headings).toEqual(SECTION_TITLES);

  // The masthead is deliberately simple: title and authorship, nothing
  // process-oriented. The document itself opens on the Introduction.
  await expect(page.locator(".hero__lede")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 2, name: /^1\. Why data-center/ }),
  ).toBeVisible();
});

test("every contents link resolves to its section anchor", async ({ page }) => {
  await gotoDocs(page);

  const toc = page.locator(".doc-toc");
  await expect(toc).toBeVisible();

  const links = toc.locator("a");
  await expect(links).toHaveCount(SECTION_TITLES.length);

  const hrefs = await links.evaluateAll((els) =>
    els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""),
  );
  for (const href of hrefs) {
    expect(href.startsWith("#")).toBe(true);
    const target = page.locator(`section${href}`);
    await expect(target).toHaveCount(1);
    await expect(target).toHaveClass(/doc-section/);
  }
});

/* ------------------------------------------------------------------ */
/* 2b. Introduction: industry evidence and framing */
/* ------------------------------------------------------------------ */

test("the introduction cites the LBNL and IEA sources with official links and the exact figures used", async ({
  page,
}) => {
  await gotoDocs(page);
  const intro = page.locator("#introduction");
  const text = await intro.innerText();

  // Every quantitative fact actually rendered is present, and only those.
  expect(text).toMatch(/11\.8%/);
  expect(text).toMatch(/9\.5.{1,2}15\.3%/);
  expect(text).toMatch(/around 20%/i);
  expect(text).toMatch(/945 TWh/);
  expect(text).toMatch(/four to eight years/i);

  // Source-precision micro-fix: the IEA's own wording is "wait times" for
  // "transformers and cables", not "lead times" for "transformers and other
  // critical grid components".
  expect(text).toMatch(
    /wait times for critical grid components such as transformers and cables have doubled/i,
  );
  expect(text).not.toMatch(/lead times for transformers/i);

  const lbnlHref = "https://eta-publications.lbl.gov/publications/united-states-data-center-energy-2025";
  const ieaHref = "https://www.iea.org/reports/energy-and-ai";
  const lbnlLinks = intro.locator(`a[href="${lbnlHref}"]`);
  const ieaLinks = intro.locator(`a[href="${ieaHref}"]`);
  expect(await lbnlLinks.count()).toBeGreaterThanOrEqual(2); // inline + source list
  expect(await ieaLinks.count()).toBeGreaterThanOrEqual(2);

  for (const link of await intro.locator("a[target]").all()) {
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }

  // A compact source list closes the section, naming both sources.
  const sources = intro.locator(".doc-sources li");
  await expect(sources).toHaveCount(2);
  await expect(sources.nth(0)).toContainText(/Smith et al\. \(2026\)/);
  await expect(sources.nth(0)).toContainText(/Lawrence Berkeley National Laboratory/);
  await expect(sources.nth(1)).toContainText(/International Energy Agency \(2025\)/);
});

test("the introduction states data-center framing, the intended users, and that references are context not calibration", async ({
  page,
}) => {
  await gotoDocs(page);
  const text = await page.locator("#introduction").innerText();

  // Data-center / electrical-capacity framing is explicit.
  expect(text).toMatch(/data-center electrical-capacity planning/i);

  // Intended professional users, named in prose rather than a bullet list.
  expect(text).toMatch(/data-center developers/i);
  expect(text).toMatch(/capacity planners/i);
  expect(text).toMatch(/site-selection teams/i);

  // Broader applicability is stated as secondary, not as genericization.
  expect(text).toMatch(/broader applicability is secondary/i);
  expect(text).not.toMatch(/generic\s+(decision|optimization)\s+framework/i);

  // References motivate the decision problem; they do not validate the
  // model's own parameterization -- stated once, precisely.
  expect(text).toMatch(/does not validate this model.s specific parameterization/i);
  expect(text).toMatch(/not derived from these industry reports/i);
});

test("the introduction's limited-information paragraph mirrors the ordinal-identifier rule without repeating the inputs section verbatim", async ({
  page,
}) => {
  await gotoDocs(page);
  const introText = await page.locator("#introduction").innerText();
  const inputsText = await page.locator("#inputs").innerText();

  expect(introText).toMatch(/limited qualitative or ordinal knowledge/i);
  expect(introText).toMatch(/condition state/i);
  expect(introText).toMatch(/probability distribution over delay/i);
  expect(introText).toMatch(/state 4 does not mean twice state 2/i);

  // The two sections carry the same rule without being the same paragraph.
  expect(inputsText).toMatch(/state 4 does not mean twice state 2/i);
  expect(introText).not.toEqual(inputsText);
});

/* ------------------------------------------------------------------ */
/* 3-4. Mechanism diagram and the translation layer                    */
/* ------------------------------------------------------------------ */

test("the mechanism diagram names the uncertain delivery step and marks provided inputs", async ({
  page,
}) => {
  await gotoDocs(page);

  const mechanism = page.locator("#mechanism");
  const diagram = mechanism.locator(".mechanism-diagram");
  await expect(diagram).toBeVisible();

  // The node that carries the uncertainty, in the diagram's own accessible
  // description and in the section prose.
  await expect(diagram).toContainText(/Physical timing and uncertainty/i);
  await expect(mechanism).toContainText("Physical timing and uncertainty");

  // The two quantities the reader provides are distinguished from computed
  // ones, and the distinction is stated in words as well as drawn. The
  // optimized allocation is NOT among them — it is the model's decision
  // variable, named as searched over rather than set.
  await expect(diagram).toContainText(/provided by you rather than computed/i);
  await expect(diagram).toContainText(
    /decision variable the model searches over/i,
  );
  expect(
    await diagram.locator(".mechanism-diagram__wide .mech-input-rect").count(),
  ).toBe(2);

  // The wide layout carries the provided-input cards on a labelled rail, and
  // the computed chain is one rule with a numbered station per step. The
  // chain ends at the allocation decision — five stations, no artificial
  // stage after it.
  await expect(diagram.locator(".mechanism-diagram__wide .mech-rail")).toHaveCount(1);
  await expect(
    diagram.locator(".mechanism-diagram__wide .mech-rail-label"),
  ).toHaveText("PROVIDED BY YOU");
  await expect(
    diagram.locator(".mechanism-diagram__wide .mech-station"),
  ).toHaveCount(5);
  await expect(diagram).toContainText(/Allocation decision/i);

  // The rail states which layer is provided, so no second legend restates it.
  await expect(diagram.locator(".mech-legend")).toHaveCount(0);
});

test("the qualitative-to-physical translation is explained explicitly", async ({
  page,
}) => {
  await gotoDocs(page);
  const inputs = page.locator("#inputs");

  const chain = inputs.locator(".translation-chain li");
  expect(await chain.allInnerTexts()).toEqual([
    "Limited qualitative or ordinal project knowledge",
    "State classification",
    "Explicit physical timing parameters and uncertainty distributions",
    "Quantitative evaluation",
  ]);

  await expect(inputs).toContainText(
    "State 4 does not mean twice state 2",
  );
  await expect(inputs).toContainText(/identifiers, not quantities/i);

  // Both complete mapping tables are published, with every state row and the
  // physical values each state resolves to.
  const burdenRows = inputs.locator("table").first().locator("tbody tr");
  await expect(burdenRows).toHaveCount(
    Object.keys(MAPPINGS.burden.states).length,
  );
  for (const [id, def] of Object.entries(MAPPINGS.burden.states)) {
    const row = inputs.locator("table").first().locator("tbody tr", {
      has: page.locator(`th:text-is("${id}")`),
    });
    await expect(row).toContainText(def.label);
    await expect(row).toContainText(String(def.tau1_bar));
    await expect(row).toContainText(String(def.tau2_bar));
  }

  const uncertaintyRows = inputs.locator("table").nth(1).locator("tbody tr");
  await expect(uncertaintyRows).toHaveCount(
    Object.keys(MAPPINGS.uncertainty.states).length,
  );
  const uncertaintyText = await inputs.locator("table").nth(1).innerText();
  for (const def of Object.values(MAPPINGS.uncertainty.states)) {
    expect(uncertaintyText).toContain(def.label);
    expect(uncertaintyText).toContain(
      def.delay_months.map((d) => String(d)).join(" / "),
    );
  }
});

/* ------------------------------------------------------------------ */
/* 5-6. Equations: accessible fallback, and never monospace            */
/* ------------------------------------------------------------------ */

test("every display equation carries its lead sentence and accessible text fallback", async ({
  page,
}) => {
  await gotoDocs(page);

  const equations = page.locator(".equation");
  const count = await equations.count();
  expect(count).toBeGreaterThanOrEqual(10);

  for (let i = 0; i < count; i += 1) {
    const eq = equations.nth(i);

    // 1. plain-language sentence, placed before the expression
    const lead = (await eq.locator(".equation__lead").innerText()).trim();
    expect(lead.length, `equation ${i} lead sentence`).toBeGreaterThan(20);

    // 2. the visible MathML expression
    const math = eq.locator("math");
    await expect(math).toHaveCount(1);

    // 3. an adjacent visually-hidden reading -- the announced version
    const reading = await eq.locator(".equation__reading").textContent();
    expect((reading ?? "").trim().length, `equation ${i} reading`).toBeGreaterThan(
      20,
    );

    // 4. a concise text representation on the element itself, with the MathML
    //    marked presentational so the two do not double-announce
    await expect(math).toHaveAttribute("alttext", /\S/);
    await expect(math).toHaveAttribute("aria-hidden", "true");
  }
});

test("no equation is rendered as monospace code", async ({ page }) => {
  await gotoDocs(page);

  // The old Method page set equations in <code>. Nothing on this page does.
  await expect(page.locator(".doc-main code")).toHaveCount(0);
  await expect(page.locator(".doc-main pre")).toHaveCount(0);

  const monospaced = await page.evaluate(() => {
    const offenders: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll(".equation math, .equation__lead, .var"),
    )) {
      const family = getComputedStyle(el).fontFamily.toLowerCase();
      if (family.includes("mono") || family.includes("courier")) {
        offenders.push(`${el.tagName}: ${family}`);
      }
    }
    return offenders;
  });
  expect(monospaced).toEqual([]);
});

test("display mathematics is set in the self-hosted math font", async ({
  page,
}) => {
  await gotoDocs(page);

  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    const math = document.querySelector(".equation math") as HTMLElement;
    return {
      family: getComputedStyle(math).fontFamily,
      // The MATH table is what stretches fences and positions scripts; a
      // fallback without one silently degrades every equation on the page.
      stix: document.fonts.check('1rem "STIX Two Math"'),
    };
  });
  expect(loaded.family).toMatch(/STIX Two Math/);
  expect(loaded.stix).toBe(true);
});

test("every piecewise definition keeps its rows and one brace that spans them", async ({
  page,
}) => {
  await gotoDocs(page);
  await page.evaluate(() => document.fonts.ready);

  // The available-power definition: three cases, in model order, behind one
  // stretchy fence. The row structure is the semantics and is asserted here;
  // the brace is checked for actually spanning the block, which the previous
  // font-size approximation did not.
  const cases = page.locator("#phased-delivery .equation math mtable").first();
  await expect(cases.locator("mtr")).toHaveCount(3);
  await expect(cases.locator("mtr").nth(0)).toContainText("if");
  await expect(cases.locator("mtr").nth(2)).toContainText("if");

  const spans = await page.evaluate(() => {
    const out: { rows: number; brace: number; table: number }[] = [];
    for (const row of Array.from(
      document.querySelectorAll('.equation math mo[fence="true"]'),
    )) {
      const table = row.parentElement?.querySelector("mtable");
      if (!table) continue;
      out.push({
        rows: table.querySelectorAll("mtr").length,
        brace: Math.round(row.getBoundingClientRect().height),
        table: Math.round(table.getBoundingClientRect().height),
      });
    }
    return out;
  });
  expect(spans.length).toBeGreaterThan(0);
  for (const s of spans) {
    expect(s.brace, `brace across ${s.rows} rows`).toBeGreaterThanOrEqual(
      s.table * 0.95,
    );
  }
});

test("no fence stretches beyond the group it encloses", async ({ page }) => {
  await gotoDocs(page);
  await page.evaluate(() => document.fonts.ready);

  // A stretchy fence grows to the tallest sibling in its row, so an argument
  // list left at the top level of an equation prints two letters inside huge
  // parentheses. Every group is in its own <mrow>; the only fences allowed to
  // grow are the piecewise braces and the objective's outer bracket.
  const oversized = await page.evaluate(() => {
    const out: string[] = [];
    for (const mo of Array.from(document.querySelectorAll(".equation math mo"))) {
      const glyph = (mo.textContent ?? "").trim();
      if (!"([{)]}".includes(glyph) || glyph === "") continue;
      const h = mo.getBoundingClientRect().height;
      const enclosesBlock =
        mo.parentElement?.querySelector("mtable") !== null ||
        mo.parentElement?.querySelector("munder, munderover") !== null;
      if (h > 34 && !enclosesBlock) {
        out.push(`${glyph} ${Math.round(h)}px`);
      }
    }
    return out;
  });
  expect(oversized).toEqual([]);
});

/* ------------------------------------------------------------------ */
/* 6b. Equation-local "where:" definitions                            */
/* ------------------------------------------------------------------ */

test("every displayed equation carries exactly one non-empty local where: key", async ({
  page,
}) => {
  await gotoDocs(page);

  const equations = page.locator(".equation");
  const count = await equations.count();
  expect(count).toBeGreaterThanOrEqual(20);

  for (let i = 0; i < count; i += 1) {
    const eq = equations.nth(i);
    const where = eq.locator(".equation__where");
    await expect(where, `equation ${i} where: block`).toHaveCount(1);

    const rows = where.locator("dl > div, dl > dt");
    expect(
      await rows.count(),
      `equation ${i} where: key is non-empty`,
    ).toBeGreaterThan(0);

    // Every symbol cell and every meaning cell actually carries text.
    const symbols = await where.locator("dt").allInnerTexts();
    const meanings = await where.locator("dd").allInnerTexts();
    expect(symbols.length, `equation ${i} symbol count`).toBeGreaterThan(0);
    expect(symbols.length).toBe(meanings.length);
    for (const s of symbols) expect(s.trim().length).toBeGreaterThan(0);
    for (const m of meanings) expect(m.trim().length).toBeGreaterThan(0);
  }
});

/**
 * Local `where:` completeness is judged per equation,
 * independent of whether an earlier equation already defined the same
 * symbol. The available-power equation's site index `i` was the one
 * confirmed miss; this pins it so it cannot regress.
 */
test("the available-power equation's where: key explicitly defines site index i", async ({
  page,
}) => {
  await gotoDocs(page);

  const where = page.locator("#phased-delivery .equation").nth(1).locator(".equation__where");
  const symbols = await where.locator("dt").allInnerTexts();
  expect(symbols.some((s) => s.trim() === "i")).toBe(true);

  const text = await where.innerText();
  expect(text).toMatch(/index of a candidate site/i);
});

test("the joint-scenario probability equation's where: key defines p_s, p_i^(s), i, N and s", async ({
  page,
}) => {
  await gotoDocs(page);

  const where = page.locator("#scenarios .equation").first().locator(".equation__where");
  const symbols = await where.locator("dt").allInnerTexts();
  expect(symbols.some((s) => s.trim() === "i")).toBe(true);
  expect(symbols.some((s) => s.trim() === "s")).toBe(true);

  const text = await where.innerText();
  expect(text).toMatch(/the number of candidate sites/i);
  expect(text).toMatch(/probability of site i.s own delay outcome in scenario s/i);
  expect(text).toMatch(/the joint probability of scenario s/i);
});

test("the Mₛ equation's where: key defines Mₛ, Y(T*, s), T*, s and D", async ({
  page,
}) => {
  await gotoDocs(page);

  const where = page.locator("#p-meet .equation").first().locator(".equation__where");
  const text = await where.innerText();
  expect(text).toMatch(/meets the requirement by the target month/i);
  expect(text).toMatch(/delivered usable capacity at the target month/i);
  expect(text).toMatch(/target month by which the required capacity is needed/i);
  expect(text).toMatch(/one delay outcome at every site at once/i);
  expect(text).toMatch(/required usable capacity, MW/i);
});

test("the objective equation's where: key defines J, C_dev, lambda and E[L]", async ({
  page,
}) => {
  await gotoDocs(page);

  const where = page.locator("#objective .equation").first().locator(".equation__where");
  const text = await where.innerText();
  expect(text).toMatch(/objective the optimization minimizes/i);
  expect(text).toMatch(/development cost, in relative units/i);
  expect(text).toMatch(/economic weight assigned to one MW-month of unmet capacity/i);
  expect(text).toMatch(/expected delay burden across scenarios/i);
});

test("the break-even equation's where: key disambiguates strategies A and B from Bᵢ and Site A/B", async ({
  page,
}) => {
  await gotoDocs(page);

  const where = page.locator("#break-even .equation").first().locator(".equation__where");
  const text = await where.innerText();
  expect(text).toMatch(/two candidate strategies being compared here/i);
  expect(text).toMatch(/not the power-delivery complexity state/i);
  expect(text).toMatch(/not the .Site A. \/ .Site B. labels/i);
  expect(text).toMatch(/development cost of strategy A and of strategy B/i);
  expect(text).toMatch(/expected delay burden of strategy A and of strategy B/i);
});

/* ------------------------------------------------------------------ */
/* 7. Complete notation and public labels                              */
/* ------------------------------------------------------------------ */

/**
 * The former two tables here -- "Complete
 * model notation" and "Public-label correspondence" -- repeated most of the
 * same concepts. They are now one unified reference table under the same
 * `#notation` section id, with every public label alongside its canonical
 * term and symbol in a single row rather than a second table.
 */
test("the unified notation table maps every public label to its canonical term, in one table", async ({
  page,
}) => {
  await gotoDocs(page);
  const tables = page.locator("#notation table");
  await expect(tables).toHaveCount(1);
  const table = tables.first();
  await expect(table).toBeVisible();
  const text = (await table.innerText()).toLowerCase();

  const REQUIRED: [string, string][] = [
    ["power-delivery complexity", "power-delivery burden"],
    ["schedule uncertainty", "schedule-timing uncertainty"],
    ["delay consequence", "delay-value parameter"],
    ["relative development cost", "development cost"],
    ["chance of meeting the target date", "probability of meeting the target"],
    ["expected shortfall at the target date", "deadline shortfall"],
    ["expected delay burden", "expected delay burden"],
    ["required capacity", "required capacity"],
    ["target date", "target month"],
    ["cost first", "cost concentration"],
    ["schedule first", "speed / reliability"],
    ["spread across sites", "diversified"],
    ["delivery stage, first stage, full service", "tranche"],
  ];
  for (const [publicLabel, canonical] of REQUIRED) {
    expect(text, `public label "${publicLabel}"`).toContain(publicLabel);
    expect(text, `canonical term "${canonical}"`).toContain(canonical);
  }

  // Each public label occurs in exactly one row's public-label column --
  // scoped to that column specifically, since several distinct rows'
  // canonical terms legitimately share a substring (e.g. "Break-even delay
  // consequence" and "Scenario delay consequence" both contain "delay
  // consequence", the public label for a different row entirely).
  const rowCount = await table.locator("tbody tr").count();
  const publicLabelCells: string[] = [];
  for (let i = 0; i < rowCount; i += 1) {
    const cell = await table
      .locator("tbody tr")
      .nth(i)
      .locator("td")
      .first()
      .innerText();
    publicLabelCells.push(cell.trim().toLowerCase());
  }
  for (const [publicLabel] of REQUIRED) {
    const hits = publicLabelCells.filter((l) => l === publicLabel).length;
    expect(hits, `"${publicLabel}" appears in exactly one row`).toBe(1);
  }

  // The concentration index is not part of the public translation table.
  expect(text).not.toMatch(/hhi|herfindahl/i);
});

test("the unified notation table covers every major model layer with no duplicate symbol, and lists benchmarks without one", async ({
  page,
}) => {
  await gotoDocs(page);
  const table = page.locator("#notation table").first();
  await expect(table).toBeVisible();

  const headerText = await table.locator("thead").innerText();
  expect(headerText).toMatch(/Symbol/i);
  expect(headerText).toMatch(/Public label/i);
  expect(headerText).toMatch(/Canonical name/i);
  expect(headerText).toMatch(/Unit \/ type/i);
  expect(headerText).toMatch(/Definition/i);

  const rowHeaders = await table.locator("tbody th").allInnerTexts();
  // Every row with an actual mathematical symbol renders a distinct one;
  // benchmark strategy rows share the "None" placeholder by design
  // rule 4; no em dash anywhere in public presentation, per
  // public-hygiene.spec.ts), so only the non-placeholder symbols are
  // checked for uniqueness.
  const symbolCells = rowHeaders.filter((h) => h.trim() !== "None");
  expect(new Set(symbolCells).size).toBe(symbolCells.length);

  // Benchmark strategy rows carry no symbol, by design.
  const benchmarkRows = rowHeaders.filter((h) => h.trim() === "None");
  expect(benchmarkRows.length).toBeGreaterThanOrEqual(3);

  const text = await table.innerText();
  // Representative symbols from every major model layer.
  const REPRESENTATIVE = [
    "MW", // units are stated, not omitted
    "Ordinal state identifier", // B and U are identifiers, not quantities
    "Objective",
    "Break-even delay consequence",
    "Site delivered capacity",
    "Joint scenario probability",
    "Available power",
    "Benchmark strategy", // unit/type for the three benchmark rows
  ];
  for (const term of REPRESENTATIVE) {
    expect(text, `notation table contains "${term}"`).toContain(term);
  }
});

/* ------------------------------------------------------------------ */
/* 8. Forced-allocation structure                                      */
/* ------------------------------------------------------------------ */

test("the forced-allocation structure is explained exactly", async ({ page }) => {
  await gotoDocs(page);
  const optimization = page.locator("#optimization");
  const text = await optimization.innerText();

  expect(text).toMatch(
    /total capacity of all candidate sites is exactly equal to the required capacity/i,
  );
  expect(text).toMatch(/every site is fully used|use every site in full/i);
  expect(text).toMatch(/no allocation choice left to make/i);
  expect(text).toMatch(/only two structural conditions/i);

  // No invented slack or "must carry at least" diagnostic.
  expect(text).not.toMatch(/must carry at least/i);
  expect(text).not.toMatch(/slack of/i);
});

/* ------------------------------------------------------------------ */
/* 9. Independence discussion lives in section 20, in full             */
/* ------------------------------------------------------------------ */

test("the assumptions section keeps every material assumption, concisely", async ({
  page,
}) => {
  await gotoDocs(page);
  const scope = page.locator("#scope-assumptions");
  const text = await scope.innerText();

  // Independence: stated, with its direction of effect and what a
  // project-specific application should do about it. One paragraph, not a
  // catalogue of hypothetical common causes.
  expect(text).toMatch(/delays are independent in the public reference model/i);
  expect(text).toMatch(/increase the apparent diversification benefit/i);
  expect(text).toMatch(/common or correlated delay drivers/i);
  expect(text).toMatch(/should represent those dependencies/i);
  expect(text).toMatch(/does not quantify the direction or size/i);
  expect(text).not.toMatch(/common supplier|permitting authority|regional event/i);
  // The narrower wording drops the "upper bound" / "necessarily smaller" claims.
  expect(text).not.toMatch(/upper bound/i);
  expect(text).not.toMatch(/mechanically favored/i);

  // Mapping provenance, units, coverage and the application boundary all
  // survive the compression.
  expect(text).toMatch(/generalized reference values/i);
  expect(text).toMatch(/relative values, not currency/i);
  expect(text).toMatch(/value the user sets/i);
  expect(text).toMatch(/commissioning readiness are not\s+modeled|not modeled/i);
  expect(text).toMatch(/grid physics, load flow/i);
  expect(text).toMatch(/structured allocation analysis under limited information/i);
  expect(text).toMatch(/engineering, utility, commercial,\s+and legal diligence|legal diligence/i);

  // No development-status or warning-box framing survives.
  expect(text).not.toMatch(/has not been run/i);
  expect(text).not.toMatch(/deferred/i);
  await expect(scope.locator(".callout--warn")).toHaveCount(0);

  // The independence assumption is discussed here and not on the first screen.
  const scopeSection = await page.locator("#scope").innerText();
  expect(scopeSection).not.toMatch(/independen/i);
});

test("the application boundary is declarative, in the same register as the decision framework", async ({
  page,
}) => {
  await gotoDocs(page);
  const text = await page.locator("#scope-assumptions").innerText();

  // Calibration described as the work a project implementation does, in the
  // same voice as the decision framework and the mappings-and-calibration
  // note above it.
  expect(text).toMatch(
    /project implementations calibrate the reference mappings, cost structure, and assumptions/i,
  );
  expect(text).toMatch(
    /available engineering evidence and the decision context/i,
  );
  expect(text).toContain(
    "The model organizes that decision; it does not supply the evidence for it.",
  );

  // No gating register: nothing is described as needing to qualify before it
  // counts as real work, and no demo / prototype contrast is drawn.
  expect(text).not.toMatch(/requires calibration/i);
  expect(text).not.toMatch(/project-specific engineered predictions/i);
  expect(text).not.toMatch(/\bdemo\b|\bprototype\b|real[- ]world|\btoy\b/i);
});

/* ------------------------------------------------------------------ */
/* 10-11. The λ envelope, co-optimality, and both boundary families    */
/* ------------------------------------------------------------------ */

test("the regime readout attributes uniqueness to the λ its solve was verified at", async ({
  page,
}) => {
  await gotoDocs(page);

  const envelope = EXAMPLE.lambda_envelope;
  expect(envelope, "the documentation example carries a λ envelope").not.toBeNull();
  const vertices = envelope!.vertices;
  const breakpoints = envelope!.breakpoints;
  expect(vertices.some((v) => v.is_unique_within_tolerance)).toBe(true);
  expect(vertices.some((v) => !v.is_unique_within_tolerance)).toBe(true);

  // The verification λ is what makes the uniqueness flag readable, so the
  // public export must carry it for every vertex.
  for (const v of vertices) expect(typeof v.lam).toBe("number");

  const readout = page.locator(".lambda-cursor__readout");
  const uniqueness = readout.locator(".lambda-cursor__uniqueness");
  const slider = page.locator(".lambda-cursor input[type=range]");

  // Regime 1 is verified inside its own interior, and is unique there.
  expect(vertices[0].is_unique_within_tolerance).toBe(true);
  await slider.focus();
  await slider.press("Home");
  await expect(uniqueness).toContainText(/verified by a solve at λ =/i);
  await expect(uniqueness).toContainText(
    /At that λ the allocation is uniquely optimal within the model's numerical tolerance/i,
  );

  // The terminal regime's allocation is verified exactly AT the final located
  // boundary in this example, so the tie it reports is the boundary's tie. The
  // readout must say so rather than presenting the terminal regime as tied.
  const terminal = vertices[vertices.length - 1];
  expect(terminal.is_unique_within_tolerance).toBe(false);
  const lastBp = breakpoints[breakpoints.length - 1];
  expect(
    Math.abs((terminal.lam as number) - lastBp.lam_estimate),
    "the terminal vertex is verified at the final located boundary",
  ).toBeLessThanOrEqual(lastBp.tolerance);

  await slider.press("End");
  await expect(uniqueness).toContainText(/which is a located boundary/i);
  await expect(uniqueness).toContainText(
    /At that λ the allocation is one representative of an effectively tied set/i,
  );
  await expect(uniqueness).toContainText(
    /not a claim that the tie holds across this regime/i,
  );

  // Breakpoint tolerance honesty is preserved: each boundary is located
  // numerically and reported with the tolerance it was found within...
  const regimes = page.locator("#regimes");
  await expect(regimes).toContainText(/tolerance within which it was found/i);
  await expect(regimes).toContainText(
    /reports it with\s+the tolerance within which it was found rather than as an exact\s+threshold/i,
  );
  // ...but that is no longer overstated as a mathematical necessity: a
  // crossing between two already-known allocations can be written directly.
  await expect(regimes).toContainText(
    /the delay\s+consequence at which two of them are indifferent can be written\s+directly/i,
  );

  // The regime table names the λ each row's uniqueness flag belongs to.
  await expect(regimes.locator("table").first()).toContainText(/Verified at/i);
  await expect(regimes).toContainText(
    /uniqueness column describes the solve at the delay consequence\s+beside it, not the whole regime/i,
  );

  // The λ axis is labelled as λ, not as a month axis.
  await expect(page.locator(".lambda-panel .chart-figure")).toHaveAttribute(
    "aria-label",
    /Horizontal axis: lambda/i,
  );
});

/**
 * The regime figure maps the i-th vertex onto the i-th
 * regime by index, but the vertex list is ordered by DISCOVERY, not by regime:
 * the boundary search can find a later regime before an earlier one. The
 * documentation example happens to come out in regime order, and this asserts
 * that rather than assuming it, so a future change of worked example cannot
 * silently draw one regime's allocation against another's λ range.
 */
test("the worked example's vertices really are in regime order, as the figure assumes", async ({
  page,
}) => {
  await gotoDocs(page);
  await expect(page.locator(".lambda-panel")).toBeVisible({ timeout: 30_000 });

  const envelope = EXAMPLE.lambda_envelope!;
  const { vertices, breakpoints } = envelope;
  expect(vertices).toHaveLength(breakpoints.length + 1);

  const siteIds = EXAMPLE.scenario.sites.map((site) => site.id);
  const same = (a: Record<string, number>, b: Record<string, number>) =>
    siteIds.every((id) => Math.abs((a[id] ?? 0) - (b[id] ?? 0)) <= 0.5);

  vertices.forEach((v, i) => {
    if (i > 0) {
      expect(
        same(v.allocation, breakpoints[i - 1].right_vertex_allocation),
        `vertex ${i} matches the allocation its lower boundary records on the right`,
      ).toBe(true);
    }
    if (i < breakpoints.length) {
      expect(
        same(v.allocation, breakpoints[i].left_vertex_allocation),
        `vertex ${i} matches the allocation its upper boundary records on the left`,
      ).toBe(true);
    }
  });

  // The order holding is what lets the figure render at all; when it does not,
  // the component falls through to its structural notice instead of drawing.
  await expect(page.locator(".lambda-panel .chart-figure")).toBeVisible();
  await expect(page.locator("#regimes")).not.toContainText(
    /unexpected structure/i,
  );

  // λ is strictly increasing across the regimes the figure lays out.
  const lams = vertices.map((v) => v.lam as number);
  for (let i = 1; i < lams.length; i += 1) {
    expect(lams[i], `vertex ${i} verification λ`).toBeGreaterThan(lams[i - 1]);
  }
});

test("the prominent solid rule is keyed as the slider position, not as a located boundary", async ({
  page,
}) => {
  await gotoDocs(page);
  await expect(page.locator(".lambda-panel")).toBeVisible({ timeout: 30_000 });

  // Both drawn rules are named, so the solid one is not read as a result.
  const key = page.locator(".lambda-panel .chart-key");
  await expect(key).toContainText(/Slider position/i);
  await expect(key).toContainText(/Located boundary/i);

  const caption = page.locator(".lambda-panel figcaption");
  await expect(caption).toContainText(
    /solid vertical line is the current position of the λ slider below, not a model result/i,
  );
  // The boundary treatment and its tolerance band are untouched.
  await expect(caption).toContainText(/shaded band at each dashed boundary/i);
  await expect(caption).toContainText(/located near/i);
  await expect(caption).toContainText(/rightmost\s+regime is terminal/i);
});

/**
 * F01 regression. At narrow widths a boundary annotation ("≈ 0.011") and a
 * regime label ("R1", "R2", ...) could land in the same top-of-plot band and
 * overlap. The fix keeps regime labels inside their areas and moves the
 * boundary-value family into the chart's own top margin, above the plot box
 * the regime labels sit inside -- so the two label families occupy visually
 * distinct bands at every width. This checks the drawn bounding boxes, not
 * fixed pixel positions, so it does not pin the layout in place.
 */
test("regime labels and boundary annotations never overlap, at 390px, 768px and desktop (F01)", async ({
  page,
}) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await gotoDocs(page);
    await expect(page.locator(".lambda-panel .chart-figure")).toBeVisible();

    const result = await page.evaluate(() => {
      const svg = document.querySelector(
        ".lambda-panel .chart-figure__plot svg",
      );
      if (!svg) return null;
      const texts = Array.from(svg.querySelectorAll("text"));
      const regimeLabels = texts.filter((t) =>
        /^R\d+/.test((t.textContent ?? "").trim()),
      );
      const boundaryLabels = texts.filter((t) =>
        (t.textContent ?? "").includes("≈"),
      );
      if (regimeLabels.length === 0 || boundaryLabels.length === 0) {
        return null;
      }
      const overlaps = (a: DOMRect, b: DOMRect) =>
        a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      let anyOverlap = false;
      for (const r of regimeLabels) {
        for (const b of boundaryLabels) {
          if (overlaps(r.getBoundingClientRect(), b.getBoundingClientRect())) {
            anyOverlap = true;
          }
        }
      }
      return {
        anyOverlap,
        regimeCount: regimeLabels.length,
        boundaryCount: boundaryLabels.length,
      };
    });

    expect(result, `regime/boundary labels present at ${width}px`).not.toBeNull();
    expect(result?.regimeCount ?? 0).toBeGreaterThan(0);
    expect(result?.boundaryCount ?? 0).toBeGreaterThan(0);
    expect(result?.anyOverlap, `label overlap at ${width}px`).toBe(false);
  }
});

test("co-optimal coordinate ranges are presented as marginal, not as a feasible box", async ({
  page,
}) => {
  await gotoDocs(page);
  const section = page.locator("#co-optimality");
  const text = await section.innerText();

  expect(text).toMatch(/effectively tied/i);
  expect(text).toMatch(/one representative/i);
  expect(text).toMatch(/marginal ranges, one coordinate at a time/i);
  expect(text).toMatch(/must not be read as a box of jointly feasible allocations/i);
  // The exact tolerance is stated once, here.
  expect(text).toMatch(/× 10/);
});

test("both boundary families are shown adjacently and explicitly distinguished", async ({
  page,
}) => {
  await gotoDocs(page);

  // Family 1: the optimizer envelope's located boundaries.
  const regimes = page.locator("#regimes");
  await expect(regimes).toBeVisible();
  const boundaryRows = regimes.locator("table").nth(1).locator("tbody tr");
  await expect(boundaryRows).toHaveCount(EXAMPLE.lambda_envelope!.breakpoints.length);

  // Family 2: benchmark break-even and switching values.
  const breakEven = page.locator("#break-even");
  await expect(breakEven).toBeVisible();
  const pairwiseRows = breakEven.locator("table").first().locator("tbody tr");
  await expect(pairwiseRows).toHaveCount(
    EXAMPLE.decision_boundaries.pairwise_break_even_lambda.length,
  );
  await expect(breakEven).toContainText("Cost first");
  await expect(breakEven).toContainText("Schedule first");
  await expect(breakEven).toContainText("Spread across sites");

  // The bridge: the two answer different questions and are not expected to
  // coincide.
  const bridge = page.locator("#boundary-families");
  const bridgeText = await bridge.innerText();
  expect(bridgeText).toMatch(/which of the\s+three fixed strategies is best/i);
  expect(bridgeText).toMatch(
    /where does the best\s+allocation over the full feasible set change/i,
  );
  expect(bridgeText).toMatch(/not expected to coincide/i);

  // The benchmark family is never presented as exhausting the feasible set.
  await expect(page.locator("#benchmarks")).toContainText(
    /reference points, not the set of allocations/i,
  );
});

/* ------------------------------------------------------------------ */
/* 12. The relocated scatter                                           */
/* ------------------------------------------------------------------ */

test("the relocated tradeoff scatter renders no concentration index or feasibility string", async ({
  page,
}) => {
  await gotoDocs(page);

  const scatter = page.locator("#break-even .chart-figure").last();
  await expect(scatter).toBeVisible();

  const label = (await scatter.getAttribute("aria-label")) ?? "";
  expect(label).toMatch(/expected delay burden/i);
  expect(label).not.toMatch(/HHI|Herfindahl/i);
  expect(label).not.toMatch(/feasib/i);
  // The accessible reading carries every mark's values, so the readout is
  // never the only route to them.
  expect(label).toMatch(/Model allocation\. Development cost/i);

  const text = await scatter.innerText();
  expect(text).not.toMatch(/HHI|Herfindahl/i);
  expect(text).not.toMatch(/feasib/i);
  // Implementation-defence copy is not interpretation guidance; it is gone.
  expect(text).not.toMatch(/frontier|dominance ordering|iso-objective/i);
});

test("tradeoff scatter marks are inspectable by pointer and by keyboard", async ({
  page,
}) => {
  await gotoDocs(page);

  const scatter = page.locator("#break-even .chart-figure").last();
  await scatter.scrollIntoViewIfNeeded();

  // The interaction is announced rather than left to be discovered.
  await expect(scatter.locator("figcaption")).toContainText(
    /hover or focus a mark/i,
  );

  // Shape coding is legible without colour: one key entry per mark.
  const marks = scatter.locator(".chart-figure__plot .scatter-mark");
  await expect(marks).toHaveCount(await scatter.locator(".scatter-key__item").count());

  // Hover opens the readout.
  await expect(scatter.locator(".scatter-readout")).toHaveCount(0);
  await marks.first().hover();
  await expect(scatter.locator(".scatter-readout")).toBeVisible();

  // So does keyboard focus, on its own.
  await page.mouse.move(0, 0);
  await expect(scatter.locator(".scatter-readout")).toHaveCount(0);
  await marks.last().focus();
  const readout = scatter.locator(".scatter-readout");
  await expect(readout).toBeVisible();
  await expect(readout).toContainText(/Development cost/);
  await expect(readout).toContainText(/Expected delay burden/);
  await expect(readout).toContainText(/Chance of meeting the date/);
});

/**
 * A readout is placed by measuring the plot and the
 * readout and clamping into the plot box, so it stays inside the figure for a
 * mark at ANY edge. The previous placement chose between two fixed percentage
 * offsets, which handled a mark near the right edge and let a mark near the
 * left or top edge push the readout out of the card.
 *
 * Every mark is exercised rather than the one that happened to fail, because a
 * bounds bug is a property of the edges, not of one data point.
 */
test("the tradeoff readout stays inside the plot for every mark, by pointer and by focus", async ({
  page,
}) => {
  await gotoDocs(page);

  const scatter = page.locator("#break-even .chart-figure").last();
  await scatter.scrollIntoViewIfNeeded();
  const plot = scatter.locator(".chart-figure__plot");
  const readout = scatter.locator(".scatter-readout");
  const marks = plot.locator(".scatter-mark");

  const count = await marks.count();
  expect(count).toBeGreaterThan(1);

  const plotBox = await plot.boundingBox();
  expect(plotBox).not.toBeNull();

  // Exercise the extremes explicitly as well as every mark: the leftmost and
  // topmost marks are the cases the old placement got wrong.
  const centres: { i: number; x: number; y: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const box = await marks.nth(i).boundingBox();
    expect(box).not.toBeNull();
    centres.push({
      i,
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    });
  }
  const order = [
    ...centres,
    [...centres].sort((a, b) => a.x - b.x)[0], // leftmost
    [...centres].sort((a, b) => b.x - a.x)[0], // rightmost
    [...centres].sort((a, b) => a.y - b.y)[0], // topmost
    [...centres].sort((a, b) => b.y - a.y)[0], // bottommost
  ];

  for (const mark of order) {
    await marks.nth(mark.i).hover();
    await expect(readout).toBeVisible();
    const box = await readout.boundingBox();
    expect(box, `mark ${mark.i} readout has a box`).not.toBeNull();

    // One pixel of slack for sub-pixel layout rounding only.
    expect(box!.x, `mark ${mark.i} readout left edge`).toBeGreaterThanOrEqual(
      plotBox!.x - 1,
    );
    expect(box!.y, `mark ${mark.i} readout top edge`).toBeGreaterThanOrEqual(
      plotBox!.y - 1,
    );
    expect(
      box!.x + box!.width,
      `mark ${mark.i} readout right edge`,
    ).toBeLessThanOrEqual(plotBox!.x + plotBox!.width + 1);
    expect(
      box!.y + box!.height,
      `mark ${mark.i} readout bottom edge`,
    ).toBeLessThanOrEqual(plotBox!.y + plotBox!.height + 1);

    // Dismissal still works, so nothing sticks open from mark to mark.
    await page.mouse.move(0, 0);
    await expect(readout).toHaveCount(0);
  }

  // Keyboard focus opens and blurs the same readout, within the same bounds.
  await marks.first().focus();
  await expect(readout).toBeVisible();
  const focusBox = await readout.boundingBox();
  expect(focusBox!.x).toBeGreaterThanOrEqual(plotBox!.x - 1);
  expect(focusBox!.x + focusBox!.width).toBeLessThanOrEqual(
    plotBox!.x + plotBox!.width + 1,
  );
  await marks.first().blur();
  await expect(readout).toHaveCount(0);
});

test("the tradeoff readout stays inside the plot on a narrow viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await gotoDocs(page);

  const scatter = page.locator("#break-even .chart-figure").last();
  await scatter.scrollIntoViewIfNeeded();
  const plot = scatter.locator(".chart-figure__plot");
  const readout = scatter.locator(".scatter-readout");
  const marks = plot.locator(".scatter-mark");

  const plotBox = await plot.boundingBox();
  const count = await marks.count();
  for (let i = 0; i < count; i += 1) {
    await marks.nth(i).focus();
    await expect(readout).toBeVisible();
    const box = await readout.boundingBox();
    expect(box!.x, `mark ${i} left edge`).toBeGreaterThanOrEqual(plotBox!.x - 1);
    expect(
      box!.x + box!.width,
      `mark ${i} right edge`,
    ).toBeLessThanOrEqual(plotBox!.x + plotBox!.width + 1);
    await marks.nth(i).blur();
  }

  // And the page itself never scrolls sideways because of it.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

/* ------------------------------------------------------------------ */
/* 13-15. Evaluation, reproducibility, scope and numerical authority   */
/* ------------------------------------------------------------------ */

test("exact vs Monte Carlo and reproducibility are stated as modeling facts only", async ({
  page,
}) => {
  await gotoDocs(page);

  const methods = await page.locator("#exact-monte-carlo").innerText();
  expect(methods).toMatch(/Exact enumeration/);
  expect(methods).toMatch(/Monte Carlo/);
  expect(methods).toMatch(
    /allocation optimization in this release runs on an exact scenario\s+set/i,
  );
  // A7: sampling error is disclosed, and no interval is invented to quantify it.
  expect(methods).toMatch(/carries sampling error/i);
  expect(methods).toMatch(
    /does not report a separate standard error or confidence interval/i,
  );
  expect(methods).not.toMatch(/responsive|interactive|hosting|public service|cap\b/i);

  const repro = await page.locator("#reproducibility").innerText();
  expect(repro).toMatch(
    /Identical inputs and an identical seed reproduce identical Monte Carlo\s+results/i,
  );
  expect(repro).toMatch(/Exact enumeration is deterministic/i);
  expect(repro).toMatch(/hand-verifiable cases, model invariants/i);
  // Verification is claimed; empirical validation explicitly is not.
  expect(repro).toMatch(/not validation against realized project outcomes/i);
  expect(repro).not.toMatch(/branch|test count|freeze|agent|reviewer|stage \w/i);

  // Numerical authority is stated as: model outputs come from the engine, AI
  // does not touch them, and the browser only formats and arranges them.
  expect(repro).toMatch(
    /All quantitative outputs come from the mathematical engine/i,
  );
  expect(repro).toMatch(/AI does not generate or alter them/i);
  expect(repro).toMatch(/does not recompute, smooth, or infer a quantitative result/i);
  expect(repro).not.toMatch(/no figure on any page is derived in the\s+browser/i);
});

test("the decision framework opens on capability and states the application boundary positively", async ({
  page,
}) => {
  await gotoDocs(page);
  const scope = await page.locator("#scope").innerText();

  // Capability first: what the framework does, in its own section heading
  // and its own list. No "what it does not do" catalogue opens the section.
  expect(scope).toMatch(/^2\. The decision framework/);
  expect(scope).toMatch(/What it does/);
  expect(scope).not.toMatch(/What the model does not do/i);
  expect(scope).toMatch(/Translates ordinal site conditions/i);
  expect(scope).toMatch(/Optimizes the allocation under the stated objective/i);

  // The application boundary is stated positively, as calibration work a
  // project-specific application does, not as an apology.
  expect(scope).toContain(
    "The framework uses explicit reference mappings as its default parameterization.",
  );
  expect(scope).toMatch(
    /calibrate those mappings to the available engineering evidence and decision context/i,
  );
  expect(scope).not.toMatch(/\bsynthetic\b|\bstylized\b|\billustrative\b/i);

  expect(scope).toContain(
    "All numerical results are produced by the auditable mathematical engine; AI does not generate or alter the quantitative outputs.",
  );

  // The overview stays truthful for exact enumeration and Monte Carlo alike:
  // it evaluates "across the modeled delay outcomes", not the full space.
  expect(scope).toMatch(/across\s+the modeled delay outcomes/i);
  expect(scope).not.toMatch(/full space of modeled delay outcomes/i);

  // The scope statement is prose, not a warning badge.
  await expect(page.locator("#scope .callout--warn")).toHaveCount(0);
  await expect(page.locator(".synthetic-badge")).toHaveCount(0);
});

test("no private or excluded vocabulary appears in the rendered page", async ({
  page,
}) => {
  await gotoDocs(page);
  const text = await page.locator("main").innerText();
  for (const re of PRIVATE_VOCABULARY) {
    expect(text, `private vocabulary ${re}`).not.toMatch(re);
  }
});

/* ------------------------------------------------------------------ */
/* 16. Responsive                                                      */
/* ------------------------------------------------------------------ */

test("640 px viewport: the document has no page-level horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 640, height: 900 });
  await gotoDocs(page);

  await expect(page.locator("#notation table").first()).toBeVisible();

  const overflow = await pageOverflow(page);
  expect(overflow.offenders, "overflowing elements at 640 px").toEqual([]);
  expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);
});

/**
 * The equation-local "where:" blocks are exercised at three widths,
 * alongside the deep-link/contents behavior
 * they must not disturb.
 */
test("390px, 768px and desktop: equation where: blocks add no overflow, and deep links still work", async ({
  page,
}) => {
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await gotoDocs(page);

    const overflow = await pageOverflow(page);
    expect(overflow.offenders, `overflowing elements at ${width}px`).toEqual([]);
    expect(overflow.scrollW).toBeLessThanOrEqual(overflow.clientW + 1);

    // The where: key stays inside the equation display's own column at every
    // width -- no row escapes further right than the equation itself.
    const eqBox = await page.locator(".equation").first().boundingBox();
    const whereBox = await page
      .locator(".equation")
      .first()
      .locator(".equation__where")
      .boundingBox();
    expect(eqBox).not.toBeNull();
    expect(whereBox).not.toBeNull();
    expect(whereBox!.x + whereBox!.width).toBeLessThanOrEqual(
      eqBox!.x + eqBox!.width + 1,
    );

    // A deep link into a section past the new Introduction still resolves.
    await page.goto("/technical-documentation.html#objective");
    await expect(page.locator("#objective")).toBeInViewport();
  }
});

/* ------------------------------------------------------------------ */
/* 17. Old Method / Limits URLs                                        */
/* ------------------------------------------------------------------ */

test("the retired Method and Limits URLs redirect to Technical Documentation", async ({
  page,
}) => {
  for (const oldUrl of ["/method.html", "/limits.html"]) {
    await page.goto(oldUrl);
    await page.waitForURL(/\/technical-documentation\.html/, { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
    ).toBeVisible();
  }
});
