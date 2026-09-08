# Limitations

The model is a **stylized decision-support tool**. It organizes an
allocation decision under limited information; it does not forecast
project outcomes. This document states the boundaries directly. See also
[`assumptions.md`](assumptions.md) and
[`model-specification.md`](model-specification.md).

---

## Data and calibration

- **Synthetic inputs.** All inputs, configurations, and worked examples are
  synthetic and stylized (`assumptions.md` §1). The repository contains no
  facility-, utility-, or project-specific data and makes no such claim.
- **No empirical calibration.** The state-to-parameter mappings are
  generalized reference values, not probabilities or schedules fitted to
  observed interconnection or delivery histories. Results are conditional
  on those values.
- **Verification, not validation.** The implementation has been checked
  against hand-calculable cases, model invariants, and limiting cases. It
  has **not** been validated against realized project outcomes; that is a
  separate exercise a project implementation performs with its own
  evidence.

## Uncertainty structure

- **Timing uncertainty only.** Uncertainty enters through a finite
  distribution over whole-month delivery delays. Cost, capacity, and the
  requirement are treated as known.
- **Discrete states and delays.** Site conditions are four ordinal states
  per axis; delays are short finite lists of whole months. The model does
  not use continuous distributions or a continuous condition scale.
- **Independent site delays.** The reference model draws site delays
  independently; it represents no shared or correlated delay driver.
  Diversification-related results are conditional on this and can overstate
  the benefit of spreading capacity relative to a portfolio with common
  delay causes (`assumptions.md` §5).

## Decision scope

- **Objective.** The objective is `J = C_dev + lambda * E[L]`. Deadline
  probability (`P_meet`) and expected shortfall (`E[S]`) are reported
  diagnostics, not additional objective terms, and there is no service-level
  constraint on either.
- **Cost model.** Development cost is linear and expressed in relative,
  normalized units — no fixed costs, economies of scale, financing, or
  currency.
- **Power delivery only.** The model covers power availability and capacity
  allocation. Facility construction, equipment procurement, and
  commissioning readiness are not modeled, nor is any interaction between
  power availability and facility readiness.
- **No grid physics.** Load flow, system adequacy, and utility energization
  statistics are outside the model; site conditions enter only through the
  two published state mappings.

## Optimization and evaluation

- **Optimizer coverage.** Exact allocation optimization is performed for
  **1–3 candidate sites**. For **4–12 sites** the application compares the
  defined benchmark strategies (Cost first, Spread across sites, Schedule
  first) and reports the best among them; it does **not** claim a global
  optimum in that range.
- **Monte Carlo is evaluation, not optimization.** Where the joint delay
  space is too large to enumerate, a given allocation is evaluated by
  seeded Monte Carlo. Allocation optimization always runs on an exact
  scenario set; the model does not optimize over a sampled objective.
- **Numerical results.** Optimizer outputs are floating-point solutions
  reported with stated tolerances, not exact arithmetic. A result flagged
  as effectively tied is one representative of a co-optimal set; a result
  flagged unique-within-tolerance is not a mathematical uniqueness proof.
- **Per-coordinate ranges.** Where a tied result reports per-site capacity
  ranges, those are marginal (one coordinate at a time) and are not a box
  of jointly feasible allocations.

## Interpretation

- **Capacity gap.** `sum_i K_i < D` means the portfolio lacks enough
  developable capacity to meet the requirement. It does **not** mean
  target-date power delivery is infeasible for a portfolio that does have
  enough capacity — that is a question of deadline performance, not
  feasibility.
- **Forced allocation.** When `sum_i K_i = D`, every site is used in full
  because it is the only feasible allocation, not because the optimizer
  preferred it.
- **The delay consequence is set, not measured.** No value of `lambda` here
  is a recommendation; the `lambda`-sensitivity map, not the answer at one
  `lambda`, is the intended output.
- **Decision support, not a guarantee.** Outputs support structured
  analysis of an allocation decision. They are not forecasts, and not a
  guarantee of utility energization or project delivery.

## Appropriate use

The public version is designed for structured decision analysis under
limited information. Project-specific forecasting or engineering
application requires calibration and validation against project data,
along with the corresponding engineering, utility, commercial, and legal
diligence.
