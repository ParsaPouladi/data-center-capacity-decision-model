import { defineConfig, devices } from "@playwright/test";

/**
 * Real-browser / E2E / accessibility validation for the public
 * application.
 *
 * Scope: the two application tiers running locally —
 *   Tier 1  the Vite `preview` server over the production build (port 4173);
 *   Tier 2  the FastAPI live API via uvicorn (port 8000), reached through the
 *           Vite `/api` proxy (web/vite.config.ts).
 * Chromium only; Firefox/WebKit are not installed for this stage.
 *
 * Run by Playwright's own loader (esbuild transpile), not the `tsc` app
 * gate — the repo keeps `@types/node` out of the dev-dependency set
 * (see web/vite.config.ts), so this file avoids `node:*` imports and reads
 * its one path anchor from `import.meta.dirname` (Node ≥ 20.11).
 */
const WEB_DIR = import.meta.dirname;
const REPO_ROOT = `${WEB_DIR}/..`;
const VENV_PYTHON = `${REPO_ROOT}/.venv/bin/python`;
const isCI = !!process.env.CI;

const FRONTEND_URL = "http://127.0.0.1:4173";
const API_HEALTH_URL = "http://127.0.0.1:8000/api/version";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  reporter: isCI ? [["list"], ["html", { open: "never" }]] : "list",
  outputDir: "./test-results",

  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    viewport: { width: 1440, height: 900 },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: [
    {
      // Tier 2 — live API. Needs the `.[app]` extra in .venv
      // (fastapi + uvicorn).
      command: `"${VENV_PYTHON}" -m uvicorn trackc_app.api:app --port 8000 --host 127.0.0.1`,
      cwd: REPO_ROOT,
      url: API_HEALTH_URL,
      timeout: 60_000,
      reuseExistingServer: !isCI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      // Tier 1 — production build served by Vite preview.
      command: "npm run build && npm run preview -- --port 4173 --strictPort --host 127.0.0.1",
      cwd: WEB_DIR,
      url: FRONTEND_URL,
      timeout: 120_000,
      reuseExistingServer: !isCI,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
