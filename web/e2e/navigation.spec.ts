import { test, expect } from "@playwright/test";

/**
 * Navigation across the two static HTML entries (Decision and Technical
 * Documentation; no client-side router, see web/vite.config.ts) plus the
 * compatibility redirects from the former Method and Limits URLs.
 */

const PAGES = [
  {
    path: "/",
    nav: "Decision",
    h1: /Data center capacity allocation under limited information and uncertain power delivery/i,
    title: /Data Center Capacity Decision Model/,
  },
  {
    path: "/technical-documentation.html",
    nav: "Technical Documentation",
    h1: /Technical Documentation/i,
    title: /Technical Documentation/,
  },
];

test("primary nav walks Decision and Technical Documentation with correct active state", async ({
  page,
}) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "Primary" });

  for (const target of ["Technical Documentation", "Decision"]) {
    await nav.getByRole("link", { name: target, exact: true }).click();
    const active = nav.getByRole("link", { name: target, exact: true });
    await expect(active).toHaveAttribute("aria-current", "page");
    // Exactly one link is current at a time.
    await expect(nav.locator('a[aria-current="page"]')).toHaveCount(1);
  }
});

for (const p of PAGES) {
  test(`${p.nav}: direct load, refresh, no missing assets`, async ({ page }) => {
    const failed: string[] = [];
    page.on("requestfailed", (r) => {
      if (!/favicon/.test(r.url())) failed.push(`${r.method()} ${r.url()}`);
    });
    const bad: string[] = [];
    page.on("response", (r) => {
      if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`);
    });

    await page.goto(p.path);
    await expect(page).toHaveTitle(p.title);
    await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: p.h1 })).toBeVisible();

    expect(failed, `failed requests on ${p.path}`).toEqual([]);
    expect(bad, `>=400 responses on ${p.path}`).toEqual([]);
  });
}

// The Method and Limits pages were absorbed into Technical Documentation; the
// old URLs are compatibility redirect documents (web/method.html,
// web/limits.html), not standalone pages.
for (const legacy of ["/method.html", "/limits.html"]) {
  test(`${legacy} redirects to Technical Documentation`, async ({ page }) => {
    await page.goto(legacy);
    await expect(page).toHaveURL(/\/technical-documentation\.html/);
    await expect(
      page.getByRole("heading", { level: 1, name: /Technical Documentation/i }),
    ).toBeVisible();
    // The former standalone page headings are gone.
    await expect(page.getByRole("heading", { level: 1, name: /^Method$/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: /^Limits$/ })).toHaveCount(0);
  });
}

test("Technical Documentation exposes an on-page table of contents", async ({
  page,
}) => {
  await page.goto("/technical-documentation.html");
  const toc = page.getByRole("navigation", { name: /Contents/i });
  await expect(toc).toBeVisible();
});
