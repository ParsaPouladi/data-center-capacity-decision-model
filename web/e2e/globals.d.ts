// Minimal ambient shims so the e2e sources type-check without pulling in
// @types/node (the repo deliberately keeps it out — see web/vite.config.ts).
// Playwright's own loader provides the real implementations at runtime.
interface ImportMeta {
  readonly dirname: string;
}
declare const process: { env: Record<string, string | undefined> };
