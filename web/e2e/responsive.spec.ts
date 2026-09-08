import { test, expect } from "@playwright/test";
import { loadExample } from "./helpers";

/**
 * Responsive review of the finished two-page product at four viewports, plus
 * the screenshot artifacts used for the design critique. A wide analytical
 * table may scroll *inside its own* .table-scroll container; the page body
 * itself must never scroll horizontally.
 */

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

const PAGES = [
  { path: "/", slug: "decision" },
  { path: "/technical-documentation.html", slug: "technical-documentation" },
];

for (const vp of VIEWPORTS) {
  for (const pg of PAGES) {
    test(`${pg.slug} @ ${vp.name} (${vp.width}px): no page-level horizontal overflow`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(pg.path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      if (pg.path === "/") {
        // Bring up a full worked result so every section is exercised.
        await loadExample(page, "cheap_site_risky_schedule");
        await expect(
          page.getByRole("heading", { name: /Choice comparison/i }),
        ).toBeVisible();
      } else {
        // The Technical Documentation page auto-loads its worked example; wait
        // for a late section so the whole document is laid out.
        await expect(page.locator("#notation table").first()).toBeVisible();
      }

      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        const offenders: string[] = [];
        const vw = de.clientWidth;
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const r = el.getBoundingClientRect();
          if (el.closest(".table-scroll") && !el.classList.contains("table-scroll")) continue;
          if (r.right > vw + 1) {
            offenders.push(
              `${el.tagName}.${(el.className || "").toString().trim().split(/\s+/)[0]}`,
            );
          }
        }
        return { docScrollW: de.scrollWidth, clientW: vw, offenders: [...new Set(offenders)] };
      });

      expect(overflow.offenders, `overflowing elements on ${pg.slug} @ ${vp.name}`).toEqual([]);
      expect(overflow.docScrollW).toBeLessThanOrEqual(overflow.clientW + 1);
    });
  }
}

test("the scenario builder and primary nav stay usable at mobile width", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /^Analyze scenario$/ }),
  ).toBeVisible();
  await expect(page.getByLabel("Required capacity (MW)", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", {
      name: "Technical Documentation",
      exact: true,
    }),
  ).toBeVisible();
});

test("screenshot artifacts for design review", async ({ page }) => {
  const shot = (name: string) =>
    page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await shot("review-decision-desktop-builder");
  await loadExample(page, "cheap_site_risky_schedule");
  await expect(
    page.getByRole("heading", { name: /Choice comparison/i }),
  ).toBeVisible();
  await shot("review-decision-desktop");

  await page.goto("/technical-documentation.html");
  await expect(
    page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
  ).toBeVisible();
  await shot("review-technical-documentation-desktop");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("review-decision-mobile");

  await page.goto("/technical-documentation.html");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await shot("review-technical-documentation-mobile");
});
