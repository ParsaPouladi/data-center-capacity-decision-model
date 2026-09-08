/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bare origin of the live Tier-2 API in staging/production
   * (e.g. "https://<service>.onrender.com"). Unset in local dev and
   * `vite preview`, where the same-origin `/api` path + Vite proxy is used. */
  readonly VITE_API_BASE_URL?: string;
  /** Commit the frontend bundle was built from. Cloudflare Pages provides
   * CF_PAGES_COMMIT_SHA automatically (exposed via envPrefix in
   * vite.config.ts); VITE_BUILD_COMMIT is an explicit override. */
  readonly CF_PAGES_COMMIT_SHA?: string;
  readonly VITE_BUILD_COMMIT?: string;
  /** Canonical URL of the PUBLIC source repository. Drives the "GitHub" item
   * in the top navigation and the "Source and citation" row in Technical
   * Documentation (web/src/components/AppShell.tsx). Unset for any build
   * whose visitors could not open the repository; both surfaces then render
   * nothing rather than a dead or private link. */
  readonly VITE_PUBLIC_REPO_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
