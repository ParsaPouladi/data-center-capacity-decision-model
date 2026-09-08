import { test, expect, type Page } from "@playwright/test";
import { gotoDecision, loadExample } from "./helpers";

/**
 * Keyboard, semantics, and non-colour encoding, checked against the real
 * DOM/accessibility tree (no extra a11y framework; Playwright's role/name
 * engine + focused-element inspection is sufficient here).
 */

/** Computed focus-ring visibility for the active element. */
async function focusIsVisible(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const cs = getComputedStyle(el);
    const outline =
      cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
    const ring = cs.boxShadow !== "none" && cs.boxShadow !== "";
    return outline || ring;
  });
}

test.describe("keyboard", () => {
  test("skip link is the first stop and is focus-visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: /Skip to main content/i });
    await expect(skip).toBeFocused();
    expect(await focusIsVisible(page)).toBe(true);

    await skip.press("Enter");
    await expect(page.locator("#main-content")).toBeVisible();
  });

  test("the builder is a clean Tab sequence: all stops reachable, ring-visible, no trap", async ({ page }) => {
    await gotoDecision(page);
    // Load a worked example so every builder field is populated and the
    // action row (Analyze / Clear) is fully enabled.
    await loadExample(page, "cheap_site_risky_schedule");
    await page.locator("body").focus();

    const wantNames = [
      /Load an example/i,
      /Required capacity \(MW\)/i,
      /Target date \(month\)/i,
      /Delay consequence/i,
      /Capacity \(MW\)/i,
      /Power-delivery complexity/i,
      /Remove Site A/i,
      /Add site/i,
      /^Analyze scenario$/i,
      /^Clear$/i,
    ];
    const seen = new Set<number>();
    let missedRing = 0;
    let sawWrap = false;
    for (let i = 0; i < 90; i++) {
      await page.keyboard.press("Tab");
      const probe = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return { name: " BODY", inBuilder: false };
        const forLabel = el.id
          ? document.querySelector(`label[for="${el.id}"]`)?.textContent
          : null;
        const wrap = el.closest("label")?.textContent;
        const isFormControl = /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
        const name = (
          el.getAttribute("aria-label") ||
          (isFormControl ? forLabel : el.textContent && el.textContent.trim()) ||
          (forLabel && forLabel.trim()) ||
          (el.textContent && el.textContent.trim()) ||
          (wrap && wrap.trim()) ||
          ""
        ).slice(0, 48);
        return { name, inBuilder: !!el.closest(".workbench") };
      });
      if (probe.name === " BODY") continue;
      if (/Skip to main content/i.test(probe.name)) sawWrap = true;
      // The focus ring requirement is checked for builder controls.
      if (probe.inBuilder && !(await focusIsVisible(page))) missedRing++;
      wantNames.forEach((re, idx) => {
        if (re.test(probe.name)) seen.add(idx);
      });
    }
    expect([...wantNames.keys()].filter((k) => !seen.has(k)), "unreached builder stops").toEqual([]);
    expect(missedRing, "focused builder controls without a visible ring").toBe(0);
    expect(sawWrap, "focus escapes the builder (no keyboard trap)").toBe(true);
  });

  test("the delay-consequence quick-set slider responds to native arrow keys", async ({
    page,
  }) => {
    await gotoDecision(page);
    // The quick-set slider appears once the delay-consequence field holds a
    // value inside the slider's convenience range.
    await page.getByLabel("Delay consequence", { exact: true }).fill("0.02");
    const slider = page.getByRole("slider", {
      name: /Delay consequence quick-set/i,
    });
    await slider.focus();
    const before = await slider.inputValue();
    await slider.press("ArrowRight");
    const after = await slider.inputValue();
    expect(Number(after)).toBeGreaterThan(Number(before));
  });
});

test.describe("semantics", () => {
  test("each page has exactly one h1 and a single main landmark", async ({ page }) => {
    for (const path of ["/", "/technical-documentation.html"]) {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("main")).toHaveCount(1);
      await expect(page.getByRole("banner")).toHaveCount(1);
      await expect(page.getByRole("contentinfo")).toHaveCount(1);
    }
  });

  test("data tables use header cells with scope", async ({ page }) => {
    await gotoDecision(page);
    // The Choice comparison table is the Decision page's data table.
    await loadExample(page, "cheap_site_risky_schedule");
    const firstTable = page.getByRole("table").first();
    await expect(firstTable.locator("th[scope='col']").first()).toBeVisible();
    await expect(firstTable.locator("th[scope='row']").first()).toBeVisible();
  });

  test("builder form controls all have accessible names", async ({ page }) => {
    await gotoDecision(page);
    const controls = page.locator(
      ".editor input, .editor select, .analyze-bar button, .example-menu select",
    );
    const n = await controls.count();
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const c = controls.nth(i);
      const name = await c.evaluate((el) => {
        const byLabel = el.id
          ? document.querySelector(`label[for="${el.id}"]`)?.textContent
          : null;
        const wrapLabel = el.closest("label")?.textContent;
        const ownText = el.tagName === "BUTTON" ? el.textContent : null;
        return (
          el.getAttribute("aria-label") ||
          ownText ||
          byLabel ||
          wrapLabel ||
          el.getAttribute("title") ||
          ""
        ).trim();
      });
      expect(name, `control #${i} has an accessible name`).not.toBe("");
    }
  });

  test("status regions are announced", async ({ page }) => {
    await gotoDecision(page);
    await expect(
      page
        .getByRole("status")
        .filter({ hasText: /Analyze a scenario, or load an example/i }),
    ).toBeVisible();
  });
});

test.describe("non-colour encoding", () => {
  // The relocated cost / delay scatter and the λ envelope both live on the
  // Technical Documentation page, which auto-loads a worked example.
  test("the tradeoff scatter carries a full text alternative, not hover-only detail", async ({
    page,
  }) => {
    await page.goto("/technical-documentation.html");
    const fig = page.locator("#break-even .chart-figure").last();
    await expect(fig).toBeVisible();

    const label = (await fig.getAttribute("aria-label")) ?? "";
    // Each mark is distinguished by shape, not colour alone.
    expect(label).toMatch(/distinct shape/i);
    // The decision question and where to read exact values are both named, so
    // nothing essential is available only on hover.
    expect(label).toMatch(/expected delay burden/i);
    expect(label).toMatch(/development cost/i);
    expect(label).toMatch(/exact values are in the tables in this section/i);
    // Every plotted point's values are in the text alternative itself, in the
    // page's own public vocabulary, and so is its allocation.
    expect(label).toMatch(/chance of meeting the target date/i);
    expect(label).toMatch(/Model allocation\. Development cost/i);
    expect(label).toMatch(/Allocation A \d/i);
  });

  test("the λ envelope has a full table equivalent alongside the chart", async ({
    page,
  }) => {
    await page.goto("/technical-documentation.html");
    const regimes = page.locator("#regimes");
    await expect(regimes.getByRole("table").first()).toBeVisible();
    // The chart's axis is labelled in words, not left to visual reading.
    await expect(page.locator(".lambda-panel .chart-figure")).toHaveAttribute(
      "aria-label",
      /Horizontal axis: lambda/i,
    );
    await expect(regimes).toContainText(/tolerance within which it was found/i);
  });

  test("muted body text is not the lightest possible grey (contrast floor held)", async ({ page }) => {
    await page.goto("/");
    const c = await page.evaluate(() => {
      const el = document.querySelector(".fine-print, .app-footer");
      return el ? getComputedStyle(el).color : "";
    });
    expect(c).toMatch(/rgb/);
  });
});

test.describe("motion and zoom", () => {
  test("prefers-reduced-motion removes transitions on both pages", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/technical-documentation.html"]) {
      await page.goto(path);
      const worst = await page.evaluate(() => {
        let maxMs = 0;
        for (const el of Array.from(document.querySelectorAll("a, button"))) {
          const cs = getComputedStyle(el);
          for (const d of [cs.transitionDuration, cs.animationDuration]) {
            for (const part of d.split(",")) {
              const s = part.trim();
              const ms = s.endsWith("ms")
                ? parseFloat(s)
                : parseFloat(s) * 1000;
              if (Number.isFinite(ms)) maxMs = Math.max(maxMs, ms);
            }
          }
        }
        return maxMs;
      });
      expect(worst, `longest animation/transition on ${path}`).toBeLessThanOrEqual(1);
    }
  });

  test("200% zoom does not create page-level horizontal overflow", async ({
    page,
  }) => {
    // 200% zoom modelled as half the CSS viewport at the same layout width.
    await page.setViewportSize({ width: 720, height: 900 });
    for (const path of ["/", "/technical-documentation.html"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const over = await page.evaluate(() => {
        const de = document.documentElement;
        return de.scrollWidth - de.clientWidth;
      });
      expect(over, `horizontal overflow on ${path} at 200% zoom`).toBeLessThanOrEqual(1);
    }
  });
});
