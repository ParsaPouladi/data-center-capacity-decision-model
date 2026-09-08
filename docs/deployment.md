# Deployment

This document describes how the public application is intended to be
deployed. It is informational; the repository runs and is fully testable
locally with no hosting account (see
[`reproducibility.md`](reproducibility.md)).

## Architecture

The application is a static frontend plus a small stateless API. There is
no database, no persistent disk, and no user data.

```
                capacity.parsapouladi.com
                          |
        +-----------------+------------------+
        |                                    |
  static frontend                       live API
  (Vite / React build)                  (FastAPI + Uvicorn)
  Cloudflare Pages                      Render
        |                                    |
  serves the Decision page,            /api/p1/evaluate
  Technical Documentation, and         /api/p1/compare
  the committed example JSON           /api/p1/optimize
  under /data                          /api/p1/profiles
                                       /api/p1/config, /api/version, /healthz
```

- **Frontend** — the `web/` project built with `vite build`, deployed as
  static files to Cloudflare Pages. It reads the committed example exports
  from `/data/*.json` directly and calls the live API for interactive
  scenarios.
- **API** — `trackc_app.api:app`, an ASGI app served by Uvicorn on Render.
  It is a thin HTTP boundary over the engine: it validates requests with
  the engine's own schemas, applies the public-application policies below,
  calls one service function, and serializes the result. It computes no
  model quantity itself.
- **Repository** — this repository
  (`data-center-capacity-decision-model`) is the source for both tiers.

The Render blueprint (`render.yaml`) provisions a single small web service
with one worker, bounded concurrency, `autoDeploy: false`, and a
`/healthz` health check. A production deployment would use an always-on
paid plan.

## Configuration

All configuration is through environment variables. None is a secret;
every value is a public hostname or a mode string. Templates are in
[`.env.example`](../.env.example) (API) and
[`web/.env.example`](../web/.env.example) (frontend).

### API (`src/trackc_app`)

| Variable | Purpose | Notes |
|---|---|---|
| `TRACKC_APP_ENV` | Deployment posture. `development` (default) keeps the interactive docs; `staging` and `production` disable them. An unrecognized value is treated as `production` (fail safe). | |
| `TRACKC_APP_CORS_ORIGINS` | Comma-separated exact browser origins allowed to call the API. No wildcard. Empty means no CORS middleware is installed (same-origin local dev via the Vite proxy). In production, set to the deployed frontend origin. | |
| `TRACKC_APP_TRUSTED_HOSTS` | Comma-separated allowed `Host` header values for the directly exposed service. Empty means the check is not installed. A leading dot (`.onrender.com`) matches any subdomain. | |
| `TRACKC_APP_COMMIT` | Optional build/release commit id for `/api/version`. Render provides `RENDER_GIT_COMMIT` automatically, so this is only needed on hosts that do not. Never set a fabricated value. | |

When `TRACKC_APP_ENV` is `staging` or `production`, the app is constructed
with `docs_url`, `redoc_url`, and `openapi_url` set to `None`, so
`/docs`, `/redoc`, and `/openapi.json` return 404. `/healthz` and
`/api/version` remain available.

### Frontend (`web/`)

| Variable | Purpose | Notes |
|---|---|---|
| `VITE_API_BASE_URL` | Bare origin of the live API, read at build time. A blank or non-`http(s)` value is ignored and the app falls back to same-origin `/api` (which the Vite dev/preview proxy forwards to a local API). | |
| `VITE_PUBLIC_REPO_URL` | The public source repository URL. The **only** place this is configured; it drives both the "GitHub" navigation item and the "Source and citation" row in the Technical Documentation. Leave unset for any build whose visitors could not open the repository — unset renders neither surface, so a build never ships a dead or private link. | |
| `VITE_BUILD_COMMIT` | Optional explicit build-identity override. Cloudflare Pages supplies `CF_PAGES_COMMIT_SHA` automatically, written into each HTML entry as `<meta name="app-build-commit">`. | |

## Public-application policies

These are deployment policies of the shared public service, enforced in the
application layer. They change no model behavior; the engine is `N`-general
and horizon-general.

| Policy | Value |
|---|---|
| Maximum sites accepted | 12 (requests above it are refused with a structured 409) |
| Live allocation optimization | `N <= 3`; larger portfolios are still evaluated and compared |
| Analysis horizon (public app) | 72 months, fixed and not user-editable |
| Live `lambda`-envelope | never computed on a request; the full envelope is a precomputed static artifact |
| Request body size | capped (structured 413 above the limit) |

## Security posture (public-safe summary)

- No secrets, no database, no persistent storage, no authentication, no
  user accounts.
- CORS is an exact origin allow-list, never a wildcard; credentials are not
  used.
- Optional `Host`-header allow-listing for the directly exposed service.
- A request-body size limit enforced on bytes actually received.
- Interactive API schema surfaces disabled outside development.
- Static responses carry `X-Content-Type-Options`, `X-Frame-Options:
  DENY`, a `Referrer-Policy`, a `Permissions-Policy`, and cross-origin
  policy headers (`Cross-Origin-Opener-Policy`,
  `Cross-Origin-Resource-Policy`; see `web/public/_headers`).

Operational hardening beyond this (rate limiting, WAF, a full
Content-Security-Policy naming the exact API origin) is applied at the
hosting platform at deployment time.
