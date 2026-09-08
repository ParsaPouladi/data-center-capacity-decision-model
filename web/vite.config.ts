import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// `process` is available at config-evaluation time (Node) without pulling in
// @types/node; the dev-dependency set stays minimal (see the entry() note).
declare const process: { env: Record<string, string | undefined> };

// Build/release identity. Cloudflare Pages provides CF_PAGES_COMMIT_SHA for
// every deployment; VITE_BUILD_COMMIT is an explicit override for other
// build hosts. When present it is written into each HTML entry as
//   <meta name="app-build-commit" content="<sha>">
// so a deployed smoke test can confirm Tier 1 and Tier 2 came from the same
// commit. It is metadata only -- nothing renders it in the UI.
const buildCommit = (
  process.env.CF_PAGES_COMMIT_SHA ??
  process.env.VITE_BUILD_COMMIT ??
  ""
).trim();

const buildCommitMeta = (): Plugin => ({
  name: "trackc-build-commit-meta",
  transformIndexHtml(html) {
    if (!buildCommit) return html;
    const safe = buildCommit.replace(/[^A-Za-z0-9._-]/g, "").slice(0, 40);
    return html.replace(
      "</head>",
      `  <meta name="app-build-commit" content="${safe}" />\n  </head>`,
    );
  },
});

// Resolve an entry HTML path without depending on @types/node (the
// dev-dependency set is kept minimal). The pathname is percent-encoded (this repo's path contains spaces), so decode
// it back to a literal filesystem path before handing it to Rollup.
const entry = (name: string) =>
  decodeURIComponent(new URL(`./${name}`, import.meta.url).pathname);

// Static multi-page mode: three HTML entries, no client-side router.
//
// The frontend calls the live API at `/api/*`. In dev and `vite preview`
// that is proxied to the local FastAPI service (`uvicorn trackc_app.api:app`,
// default port 8000). In a production build `VITE_API_BASE_URL` points the
// client at the real API origin
// instead (see web/src/data/api.ts); the API then grants CORS only to the
// exact deployed frontend origin(s) via TRACKC_APP_CORS_ORIGINS.
const apiProxy = { "/api": { target: "http://localhost:8000", changeOrigin: true } };

export default defineConfig({
  plugins: [react(), buildCommitMeta()],
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  build: {
    rollupOptions: {
      input: {
        decision: entry("index.html"),
        technicalDocumentation: entry("technical-documentation.html"),
        // Compatibility: the former Method and Limits URLs are static
        // redirect documents into Technical Documentation. They carry no page
        // content and no application script -- no routing framework is added.
        methodRedirect: entry("method.html"),
        limitsRedirect: entry("limits.html"),
      },
    },
  },
});
