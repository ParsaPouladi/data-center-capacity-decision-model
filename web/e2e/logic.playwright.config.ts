import { defineConfig } from "@playwright/test";

/**
 * Lightweight config for pure-logic specs that import application modules
 * directly and assert on their return values — no browser, no Vite preview
 * server, no live API. Used by the result-explanation, key-results and
 * decision-synthesis targeted gates.
 *
 * Run: `npx playwright test --config e2e/logic.playwright.config.ts`
 *
 * The main `playwright.config.ts` still picks these specs up on a full run;
 * they simply do not need its `webServer` entries.
 */
export default defineConfig({
  testDir: ".",
  testMatch: /(?:result-explanation|key-results|synthesis)\.spec\.ts$/,
  fullyParallel: true,
  reporter: "list",
  projects: [{ name: "logic" }],
});
