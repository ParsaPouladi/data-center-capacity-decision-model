# Reproducibility

Every command below is run from the repository root and was executed against
this release. Counts and versions describe **v1.0.1**; they are not a
permanent contract, and later revisions may legitimately change the test
count.

## Determinism guarantees

- **Exact enumeration is deterministic.** It performs no sampling, so
  identical inputs always produce identical outputs.
- **Monte Carlo is seeded.** The RNG seed comes from configuration
  (`configs/model_defaults.yaml`, `random_seed: 12345`) or the request;
  identical inputs and seed reproduce the identical sample and identical
  numbers.
- **The curated examples use the real implementation.** Every value in
  `web/public/data/*.json` comes from a `trackc` engine call routed through
  `trackc_app.service`.
- **The committed showcase exports reproduce byte-for-byte** (see below).

Bitwise reproducibility across arbitrary platforms, compilers, and BLAS
builds is not claimed. The determinism above is within a fixed environment.

## Validated environment (this release)

| Tool | Version used |
|---|---|
| Python interpreter | 3.14.4 (`pyproject.toml` requires `>= 3.11`) |
| pip | 26.2.1 |
| ruff | 0.16.6 |
| numpy / scipy | 2.5.3 / 1.18.1 |
| pydantic / pyyaml | 2.13.5 / 6.0.3 |
| fastapi / uvicorn | 0.141.1 / 0.52.4 |
| Node.js | 22.22.1 |
| npm | 9.2.0 |
| Playwright | 1.62.1 (Chromium) |
| Vite / TypeScript | 8.x / 7.x (see `web/package.json`) |

## Python: environment and validation

```bash
python -m venv .venv
. .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -e ".[dev,app]"
```

`[dev]` adds pytest, ruff, and httpx; `[app]` adds fastapi and uvicorn for
the live API. `pip install -e .` alone builds the engine with only
numpy / scipy / pydantic / pyyaml.

```bash
pytest
```

Expected: **354 passed** (plus two upstream `DeprecationWarning`s from
Starlette's test client). Runtime is a few minutes; the convergence and
scalability suites dominate it.

```bash
ruff check .
```

Expected: `All checks passed!`

## Showcase data: byte-for-byte reproduction

```bash
python scripts/export_showcase_data.py            # writes web/public/data/
git status --porcelain web/public/data            # expect: no output
```

`git status` reporting no change is the check: the script regenerates
`balanced_portfolio.json`, `capacity_constrained_portfolio.json`,
`cheap_site_risky_schedule.json`, `mappings.json`, and `index.json`
identically to what is committed. Each example is a three-site scenario
evaluated by exact enumeration of the 27-outcome joint delay space, so there
is no sampling and no seed.

The v1.0.1 maintenance release changes only frontend fetch resilience; these
committed showcase / model-output artifacts are byte-identical to v1.0.0.

## Frontend: type-check, build, end-to-end

```bash
cd web
npm ci
npm run typecheck            # tsc --noEmit
npm run typecheck:e2e        # tsc --noEmit -p e2e/tsconfig.json
npm run build                # tsc --noEmit && vite build
npx playwright install chromium
npx playwright test
```

Expected: type-checks and build succeed (the "chunks larger than 500 kB"
line from Vite is informational, not an error). Playwright: **256 passed**,
Chromium only.

## Release manifest

`MANIFEST.sha256` lists a SHA-256 for every tracked release file except
`.git/` and the manifest itself, with stable, sorted, repository-relative
paths. To verify a checkout:

```bash
sha256sum -c MANIFEST.sha256
```

Expected: every line reports `OK`. Regenerate it (after any intentional
content change) with:

```bash
git ls-files -z | grep -zv '^MANIFEST.sha256$' | LC_ALL=C sort -z \
  | xargs -0 sha256sum > MANIFEST.sha256
```

`LC_ALL=C` fixes the sort to byte order, so the manifest is identical on
any machine.
