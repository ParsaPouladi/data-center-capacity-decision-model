# Data Center Capacity Decision Model

Data center capacity allocation under limited information and uncertain power
delivery.

**Live application:** <https://capacity.parsapouladi.com>
· **Technical Documentation:** <https://capacity.parsapouladi.com/technical-documentation.html>

---

## The decision problem

A data-center developer needs a fixed amount of usable electrical capacity in
place by a target month, and can develop that capacity across several
candidate sites. The sites differ in how much capacity each can carry, in
relative development cost per MW, in how much grid-connection work the power
delivery requires, and in how predictable that delivery timing is. Power
often arrives in stages rather than all at once, and the schedule can slip.

The question is not which single site is fastest or cheapest. It is **how
much capacity to place at each site, given the stated consequence of being
late.** A cheaper site can expose the portfolio to more delay; a faster or
more diversified allocation can cost more. The model makes that tradeoff
explicit and shows where the answer changes.

Industry context for why the underlying capacity/grid-delivery decision is
material is in [References](#references); it is not a calibration of this
model.

## What the model does

- Translates two ordinal site conditions — power-delivery complexity and
  schedule uncertainty — into explicit physical timing parameters and a
  finite probability distribution over delivery delay, through **published
  mappings** that can be inspected and changed.
- Builds each site's phased power-availability profile across the modeled
  delay outcomes, and from a candidate allocation computes delivered usable
  capacity over time.
- Reports, for that allocation: the chance of meeting the target date, the
  expected shortfall at that date, and the expected **delay burden** (unmet
  capacity accumulated from the target month through the analysis horizon,
  in MW-months).
- Optimizes the allocation under a single stated objective for portfolios of
  **1–3 sites**, compares interpretable benchmark strategies for **4–12
  sites**, and maps how the answer moves as the consequence assigned to
  delay changes.

## Analysis boundaries — what the results mean, and what they do not

A reviewer should be able to see quickly what the model proves and what it
does not.

1. **The objective is** `J = C_dev + λ·E[L]` — development cost plus the
   delay consequence times the expected delay burden. Deadline probability
   and expected shortfall are **diagnostics of the resulting allocation, not
   additional objective terms**, and there is no service-level constraint on
   either.
2. **1–3 candidate sites:** the allocation is optimized exactly, as a linear
   program with a global optimum (subject to reported numerical tolerances).
3. **4–12 candidate sites:** the application evaluates the defined benchmark
   strategies — **Cost first**, **Spread across sites**, **Schedule first** —
   and reports the best among those compared strategies. It does **not**
   claim a global optimum for the 4–12-site case.
4. **Monte Carlo evaluation is not Monte Carlo optimization.** Where the
   joint delay space is too large to enumerate, a given allocation is
   evaluated by seeded sampling; allocation optimization always runs on an
   exact scenario set.
5. **A forced allocation is not a solver preference.** When total developable
   capacity exactly equals the requirement, every site is used in full
   because that is the only feasible allocation.
6. **Co-optimal allocations do not imply a unique optimizer preference.**
   Where the objective ties, the reported allocation is one representative of
   a co-optimal set, flagged as such, with per-site marginal ranges that are
   *not* a box of jointly feasible allocations.
7. **Ordinal states are identifiers, not arithmetic risk scores.** State 4 is
   not "twice" state 2. Each state resolves through an explicit published
   mapping to physical parameters, and the engine operates only on those.
8. **`Σ Kᵢ < D` means the portfolio lacks enough developable capacity** to
   meet the requirement. It does **not** mean target-date power delivery is
   infeasible for a portfolio that does have enough capacity — that is a
   question of deadline performance, not feasibility.
9. **Inputs and worked examples are synthetic and stylized.** The repository
   claims no proprietary facility or project data, and the baseline mappings
   are generalized reference values, not empirically calibrated
   probabilities.

## How the model works

The model is built for an early, limited-information decision context. It
does not pretend detailed site data exist when they do not; instead it
carries limited knowledge through an explicit chain:

```
limited site information
  → ordinal state classification (power-delivery complexity, schedule uncertainty)
  → explicit state-to-physical-parameter mappings   (published, inspectable, replaceable)
  → phased power-delivery profiles + finite delay distributions
  → delivered usable capacity over the modeled delay scenarios
  → deadline metrics + expected delay burden
  → allocation optimization (1–3 sites) / benchmark comparison (4–12 sites)
  → cost / delay decision metrics and λ-sensitivity
```

Available power at a site is a step function of time — none, then a fraction
`α` (0.50 in this version) of the site's capacity at the first stage, then
its full capacity at full service — with both stage dates shifted later by a
realized delay drawn from the site's distribution. Delivered capacity at a
site is `min(allocated, available)`. The optimizer minimizes `J` over the
feasible set `{0 ≤ xᵢ ≤ Kᵢ, Σ xᵢ ≥ D}`; because `J` is convex
piecewise-linear, the problem is written as an exact linear program and
solved with HiGHS. Full definitions, including exact-vs-Monte-Carlo
switching, co-optimality semantics, and the λ-envelope, are in
[`docs/model-specification.md`](docs/model-specification.md).

## Worked examples

Three curated example portfolios ship as committed exports under
[`web/public/data/`](web/public/data/) and drive the live application. Each
is a three-site scenario evaluated by exact enumeration of the 27-outcome
joint delay space (no sampling, no seed), and each reproduces byte-for-byte
from the engine (see [Validation and reproducibility](#validation-and-reproducibility)).

| Example | Setup | Optimized allocation (at its λ) | Reads as |
|---|---|---|---|
| **Balanced portfolio** | `D = 300` MW by month 30; sites 300/300/150 MW at cost 1.00/1.20/1.10 | `A 150, B 0, C 150` (λ = 0.05) | An ordinary tradeoff: the cheapest site is power-risky, so the allocation splits toward faster delivery. Five λ-regimes. |
| **Capacity-constrained portfolio** | `D = 600` MW; three 200-MW sites (`Σ Kᵢ = D`) | `A 200, B 200, C 200` (forced) | No allocation choice exists; every site is used in full because it is the only feasible allocation. The delivery outlook is still reported. |
| **Cheap site, risky schedule** | `D = 500` MW by month 36; a large cheap high-uncertainty site vs. two smaller faster ones | `A 250, B 250, C 0` (λ = 0.025) | Inside the second decision regime: partial reliance on the cheap site, hedged. Regime boundaries near λ ≈ 0.011, 0.037, 0.074. |

## Repository architecture

```
src/trackc/            Quantitative engine (the sole numerical authority).
  model/                 schemas · state mappings · power profiles ·
                         scenario engine · evaluator · optimizer · comparator
  experiments/           λ-envelope construction and synthetic portfolio builders
                         (compose the frozen primitives; add no new metric)
src/trackc_app/        Non-canonical application layer over the engine:
  service.py             assembles engine results + provenance metadata
  api.py                 thin FastAPI HTTP boundary; computes no model quantity
configs/               State-mapping tables (baseline + ±10% variants),
                       model defaults, the baseline scenario fixture
scripts/               export_showcase_data.py — rebuilds web/public/data
tests/                 unit · invariants · convergence · golden-parity · API
web/                   Vite/React frontend: Decision page + Technical
                       Documentation; web/public/data holds the committed exports
docs/                  This specification set
```

The engine never imports the application layer or the web tier. `src/trackc/`
depends only on `numpy`, `scipy`, `pydantic`, and `pyyaml`.

## Run locally

Python 3.11+ and Node 20+ (validated on Python 3.14.4, Node 22.22.1).

```bash
# Engine + API
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev,app]"
pytest                     # Python test suite
ruff check .               # lint

# Live API (optional)
uvicorn trackc_app.api:app --reload         # needs the [app] extra

# Frontend
cd web
npm ci
npm run typecheck && npm run build
npx playwright install chromium && npx playwright test
npm run dev                 # http://localhost:5173, proxies /api to :8000
```

Full commands, expected output, and the exact validated tool versions are in
[`docs/reproducibility.md`](docs/reproducibility.md).

## Validation and reproducibility

The point of the tests is *what* is checked, not the count:

- **Unit tests** against hand-calculated values on the baseline fixture.
- **Mathematical invariants** — monotonicity of available power, probability
  normalization, `E[S], E[L] ≥ 0`, `P_meet ∈ [0,1]`, `J = C_dev` at `λ = 0`.
- **Exact-vs-Monte-Carlo convergence** — sampled estimates approach the exact
  values, with spread shrinking on the order of `1/√M`.
- **Golden-result parity** — the committed public exports and the API's
  structured responses equal a direct engine call on the same inputs.
- **Optimizer semantics** — LP objective and re-evaluated objective agree
  within a justified tolerance; the optimum beats or ties every benchmark;
  co-optimality and forced-allocation cases are asserted explicitly.
- **API contract tests** — deployment guardrails, structured errors, and the
  rule that no internal reference is forwarded to a client.
- **Frontend** — accessibility, responsive behavior, and end-to-end product
  workflows.

Exact enumeration is deterministic. Monte Carlo uses an explicit RNG seed
from configuration. The committed showcase data
([`web/public/data/`](web/public/data/)) is reproduced byte-for-byte by
`python scripts/export_showcase_data.py`.

## Technical documentation

- [`docs/model-specification.md`](docs/model-specification.md) — the full
  mathematical specification.
- [`docs/assumptions.md`](docs/assumptions.md) — assumptions, separated from
  identities, each with its consequence for reading a result.
- [`docs/limitations.md`](docs/limitations.md) — where the model does not
  apply.
- [`docs/reproducibility.md`](docs/reproducibility.md) — every command and
  the validated environment.
- [`docs/deployment.md`](docs/deployment.md) — intended hosting architecture
  and configuration.
- [`docs/PROVENANCE.md`](docs/PROVENANCE.md) — why the public history is
  curated.
- The rendered [Technical
  Documentation](https://capacity.parsapouladi.com/technical-documentation.html)
  presents the same model with worked numbers and typeset equations.

## Limitations

In brief (full list in [`docs/limitations.md`](docs/limitations.md)):
synthetic, stylized inputs with no claim of empirical site-specific
calibration; uncertainty enters only through delivery timing; site delays are
modeled as independent, with no shared or correlated driver in the baseline;
the public optimizer covers 1–3 sites and 4–12 sites use benchmark-strategy
comparison; numerical results carry stated tolerances; results are
decision-support outputs, not guarantees of utility energization or project
delivery.

## Development approach

Problem formulation, model architecture, product direction, acceptance
criteria, and technical validation were led by Parsa Pouladi. Claude Code
was used as an AI-assisted software-development environment for
implementation, testing, and iterative product development. All quantitative
results at runtime are produced by the implemented mathematical and
stochastic engine; no generative-AI or LLM call produces or alters a model
result at runtime.

## Project-specific modeling

The public model is intentionally stylized. A real infrastructure decision
may require project-specific parameterization, additional constraints, richer
cost structures, correlated uncertainty, additional data interfaces, or
organization-specific decision rules.

For project-specific quantitative modeling, uncertainty analysis, and
optimization:

**Parsa Pouladi, Ph.D.** — <ParsaPouladi@outlook.com> ·
[ORCID 0009-0006-2257-391X](https://orcid.org/0009-0006-2257-391X)

## Citation

Citation metadata is in [`CITATION.cff`](CITATION.cff). GitHub renders it as
a "Cite this repository" panel; most reference managers can import the file
directly. Cite the software as:

> Pouladi, P. *Data Center Capacity Decision Model* (Version 1.0.0)
> [Computer software]. <https://github.com/ParsaPouladi/data-center-capacity-decision-model>

## References

Context for why the capacity and grid-delivery decision is material. These
sources are **not** used to calibrate or validate this model.

1. Smith et al. (2026). *United States Data Center Energy Usage Report: 2025
   Update.* Lawrence Berkeley National Laboratory.
   <https://eta-publications.lbl.gov/publications/united-states-data-center-energy-2025>
2. International Energy Agency (2025). *Energy and AI.*
   <https://www.iea.org/reports/energy-and-ai>

## License

[Apache License 2.0](LICENSE). Bundled third-party font assets retain their
own licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
