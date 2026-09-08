# Model specification

**Data Center Capacity Decision Model — version 1.0.0**

This document specifies the mathematics of the model: its inputs, the
mapping from ordinal site conditions to physical quantities, the
evaluation metrics, the objective, the optimization, and the boundaries
within which each result is defined. It is written so that a reader with a
background in operations research or quantitative modeling can reconstruct
the meaning of every reported number.

The companion documents are
[`assumptions.md`](assumptions.md) (what is assumed, and why),
[`limitations.md`](limitations.md) (where the model does not apply), and
[`reproducibility.md`](reproducibility.md) (how to reproduce every result).
The rendered [Technical Documentation](https://capacity.parsapouladi.com/technical-documentation.html)
presents the same model with worked examples and typeset equations.

Section numbers in this document are stable; source comments refer to it by
section title rather than by number.

---

## 1. Purpose and scope

A developer must have a fixed quantity of usable electrical capacity in
place by a target month, and can develop that capacity across several
candidate sites. The sites differ in how much capacity each can carry, in
relative development cost per MW, in how much power-delivery work the grid
connection requires, and in how predictable that delivery timing is. The
model answers one question: **given those differences and the stated
consequence of being late, how should the required capacity be split
across the sites?**

The model is designed for an early allocation or site-screening stage, at
which detailed project parameters are typically incomplete. Rather than
compressing limited qualitative knowledge into a single weighted risk
score, it carries that knowledge through an explicit chain:

```
limited qualitative / ordinal site knowledge
  -> condition-state classification
  -> explicit physical timing parameters + a finite delay distribution
  -> phased power-delivery profiles over modeled delay scenarios
  -> delivered usable capacity over time
  -> deadline and delay-burden metrics
  -> allocation optimization (1-3 sites) or benchmark comparison (4-12 sites)
  -> cost / delay decision metrics
```

The quantitative engine operates only on the physical parameters and
distributions the states resolve to. It is deterministic given its inputs
and a seed; no generative model or heuristic reasoning produces or alters a
quantitative output.

Out of scope for this version: facility construction, procurement and
commissioning readiness; grid physics, load flow, and utility energization
statistics; correlated or shared delay drivers across sites; fixed
site-opening costs, economies of scale, and financing effects; any
currency interpretation of cost.

---

## 2. Notation

| Symbol | Meaning | Unit / type |
|---|---|---|
| `i` | candidate-site index, `i = 1, ..., N` | index |
| `N` | number of candidate sites | count |
| `t` | month being evaluated, a whole-month point | months |
| `s` | index of one joint delay outcome across all sites (a scenario) | index |
| `K_i` | maximum developable capacity at site `i` | MW |
| `c_i` | relative development cost per MW at site `i` | relative units / MW |
| `B_i` | power-delivery complexity state of site `i` | ordinal identifier in {1,2,3,4} |
| `U_i` | schedule-uncertainty state of site `i` | ordinal identifier in {1,2,3,4} |
| `D` | required usable capacity | MW |
| `T*` | target month by which `D` is required | months |
| `H` | analysis horizon (final modeled month) | months |
| `lambda` | delay consequence: weight on one MW-month of unmet capacity | relative units / MW-month |
| `alpha` | tranche fraction: share of a site's capacity available at the first stage | unitless fraction |
| `tau1_bar_i`, `tau2_bar_i` | nominal first-stage and full-service months for site `i`, from `B_i` | months |
| `delta_i(s)` | realized delay for site `i` in scenario `s` | months |
| `tau1_i(s)`, `tau2_i(s)` | realized first-stage and full-service months for site `i` in scenario `s` | months |
| `A_i(t,s)` | available power at site `i`, month `t`, scenario `s` | MW |
| `p_i^(s)` | probability of site `i`'s own delay outcome in scenario `s` | [0, 1] |
| `p_s` | joint probability of scenario `s` | [0, 1] |
| `q_i` | number of delay outcomes listed for site `i` | count |
| `S_full` | number of distinct joint delay outcomes | count |
| `x_i` | capacity allocated to site `i` (the decision variable) | MW |
| `Y_i(t,s)` | delivered usable capacity at site `i`, month `t`, scenario `s` | MW |
| `Y(t,s)` | total delivered usable capacity, month `t`, scenario `s` | MW |
| `M_s` | target-date meet indicator for scenario `s` | {0, 1} |
| `P_meet` | probability of meeting the requirement by `T*` | [0, 1] |
| `S_s` | target-date shortfall in scenario `s` | MW |
| `E[S]` | expected target-date shortfall | MW |
| `Q(t,s)` | capacity still missing at month `t`, scenario `s` | MW |
| `L_s` | delay burden accumulated in scenario `s` | MW-months |
| `E[L]` | expected delay burden | MW-months |
| `C_dev` | total development cost | relative units |
| `C_delay,s` | priced consequence of delay in scenario `s` | relative units |
| `J` | objective: `C_dev + lambda * E[L]` | relative units |
| `lambda*` | break-even delay consequence between two strategies | relative units / MW-month |

`B_i` and `U_i` are **identifiers, not quantities**: no equation adds,
scales, weights, or averages them. State 4 is not "twice" state 2. Each is
a lookup key into a published table (Section 5); the engine operates only
on the physical values that table returns.

---

## 3. Site and system inputs

Each candidate site `i` carries four independently supplied inputs:

- `K_i > 0` — maximum developable capacity (MW);
- `c_i >= 0` — relative development cost per MW (normalized, not currency);
- `B_i in {1,2,3,4}` — power-delivery complexity state;
- `U_i in {1,2,3,4}` — schedule-uncertainty state.

Capacity, cost, complexity, and uncertainty are not derived from one
another. Building correlations among them into the inputs would manufacture
the tradeoff the model exists to study.

The system carries:

- `D > 0` — required usable capacity (MW);
- `T* > 0` — target month;
- `H > T*` — analysis horizon; `H` must extend past `T*` so that late
  delivery can be scored;
- `lambda >= 0` — delay consequence (Section 13).

Time is discrete: every stage date, delay outcome, target month, and
horizon is a whole number of months, and all sums over time are sums over
whole-month points one month apart.

---

## 4. Ordinal states are identifiers, not scores

`B_i` and `U_i` encode limited project knowledge. They are deliberately
coarse because a coarse judgment is usually what is available at the
decision stage. The model's role is to make the step from that judgment to
physical quantities explicit and auditable:

1. limited qualitative or ordinal project knowledge;
2. classification into a condition state;
3. explicit physical timing parameters and a delay distribution;
4. quantitative evaluation on those parameters only.

A different classification changes **which row** of a published table is
read, never the scale of any number. The state integers themselves never
enter arithmetic — including their raw ordering, or any function of that
ordering used as a ranking proxy.

---

## 5. State mappings

Two published tables convert the ordinal states into physical parameters.
Their values are **synthetic reference assumptions** for a stylized model,
not measured utility or facility statistics. A project implementation
recalibrates them against its own engineering evidence; the reference
values are the default parameterization and are versioned
(`mapping_version`).

### 5.1 Power-delivery complexity: `B_i -> (tau1_bar_i, tau2_bar_i)`

`B_i` fixes **when** power is nominally delivered: a nominal first-stage
month `tau1_bar_i` and a nominal full-service month `tau2_bar_i`, counted
from the start of the analysis horizon, with
`0 < tau1_bar_i < tau2_bar_i`.

Reference mapping (`configs/burden_states.yaml`, `mapping_version:
v1-baseline`):

| `B_i` | Label | First stage (month) | Full service (month) |
|---|---|---|---|
| 1 | Low | 18 | 24 |
| 2 | Moderate | 24 | 30 |
| 3 | High | 30 | 42 |
| 4 | Very high | 42 | 54 |

### 5.2 Schedule uncertainty: `U_i -> F_i`

`U_i` fixes **how far the nominal schedule may slip, and with what
probability**. It resolves to a finite distribution `F_i` over
whole-month delays. Delays are non-negative (delivery can run late but
never early), so a mapped stage date is a planned delivery date, not a
statistical mean.

Reference mapping (`configs/uncertainty_states.yaml`, `mapping_version:
v1-baseline`):

| `U_i` | Label | Delay outcomes (months) | Probabilities |
|---|---|---|---|
| 1 | Low | 0 / 3 / 6 | 0.80 / 0.15 / 0.05 |
| 2 | Moderate | 0 / 6 / 12 | 0.60 / 0.30 / 0.10 |
| 3 | High | 0 / 9 / 18 | 0.40 / 0.35 / 0.25 |
| 4 | Very high | 0 / 12 / 24 | 0.25 / 0.35 / 0.40 |

Each row's probabilities sum to 1 (to within a fixed `1e-9` tolerance,
checked at config load). The number of outcomes `q_i` is read per site
from its resolved distribution; every reference state has `q_i = 3`, which
is a property of this mapping, not a model law.

### 5.3 Sensitivity variants

Compressed (`x0.9` timing / delay spread) and stretched (`x1.1`) variants
of both tables are provided (`configs/*_compressed.yaml`,
`configs/*_stretched.yaml`). They exist to test whether located decision
boundaries and strategy rankings survive a plausible alternative
calibration; they are not claims that either variant is more accurate than
the baseline.

---

## 6. Phased power delivery and the availability function

Power arrives at a site in stages, not all at once. A realized delay
`delta_i(s)` drawn from `F_i` shifts **both** stage dates by the same
amount, preserving the internal structure of the delivery schedule:

```
tau1_i(s) = tau1_bar_i + delta_i(s)
tau2_i(s) = tau2_bar_i + delta_i(s)
```

Available power at a site is then a step function of time:

```
A_i(t,s) = 0                for t <  tau1_i(s)
A_i(t,s) = alpha * K_i      for tau1_i(s) <= t < tau2_i(s)
A_i(t,s) = K_i              for t >= tau2_i(s)
```

`alpha = 0.50` in this model version (`configs/model_defaults.yaml`,
constrained `0 < alpha < 1`), so available power steps from none, to half
of the site's capacity, to all of it. `A_i(t,s)` depends only on `K_i`,
`B_i`, `delta_i(s)`, and `alpha` — never on the allocation `x`. It is
data, computed once per (site, month, scenario).

---

## 7. Timing uncertainty

Each site's delay is a finite, site-specific distribution:

```
P(delta_i = d_ik) = p_ik    for k = 1, ..., q_i
sum_{k=1..q_i} p_ik = 1
```

Delays are drawn **independently across sites**. This is a modeling
assumption of the reference model, discussed in
[`assumptions.md`](assumptions.md); the engine models no shared or
correlated delay driver.

---

## 8. Scenario construction

A **scenario** `s` is one joint outcome: a realized delay at every site at
once. Because site delays are independent, its probability is the product
of the per-site outcome probabilities it is composed of:

```
p_s = prod_{i=1..N} p_i^(s)
```

The size of the complete joint space is:

```
S_full = prod_{i=1..N} q_i
```

That count decides how the scenario space is handled (Section 20). Every
metric below is defined identically as an expectation over the scenario
set, whether that set is the exact enumeration or a Monte Carlo sample.

---

## 9. Delivered usable capacity

The allocation `x = (x_1, ..., x_N)` is the decision. Delivered usable
capacity at a site is the smaller of the capacity allocated there and the
power that has actually become available there by that month in that
scenario:

```
Y_i(t,s) = min(x_i, A_i(t,s))
```

The minimum binds in both directions: allocating more to a site than its
power supports wastes the allocation; allocating less leaves that power
unused. Total delivered usable capacity is the sum across sites:

```
Y(t,s) = sum_{i=1..N} Y_i(t,s)
```

`Y(t,s)` is the principal system trajectory; every deadline and delay
metric is a reading taken from it.

---

## 10. Deadline performance

Deadline performance is measured three ways, because a deadline can be
missed in three different senses.

### 10.1 Chance of meeting the target date

```
M_s = 1  if Y(T*, s) >= D
M_s = 0  otherwise

P_meet = E[M_s] = sum_s p_s * M_s
```

`P_meet` answers a yes-or-no question and carries no information about
severity.

### 10.2 Shortfall at the target date

```
S_s   = max(0, D - Y(T*, s))
E[S]  = sum_s p_s * S_s
```

`S_s` is the unmet requirement at the target month itself, floored at zero;
capacity beyond the requirement is not counted as a credit. It carries no
information about the months that follow.

Comparisons that would flip an indicator or report a spurious shortfall
from floating-point summation roundoff are guarded by a fixed `1e-9` MW
tolerance: a delivered capacity that is mathematically exactly `D` is
treated as meeting `D`.

---

## 11. Delay burden

At any month from `T*` onward, the capacity still missing is:

```
Q(t,s) = max(0, D - Y(t,s))
```

The delay burden in one scenario accumulates that missing capacity month
by month, from the target month through the horizon, **inclusive of
both**:

```
L_s  = sum_{t = T* .. H} Q(t,s)
E[L] = sum_s p_s * L_s
```

`L_s` is measured in MW-months; it captures both how much capacity is
missing and for how long. The target month is the first month counted, so
a shortfall on the target date always contributes to the delay burden as
well. Capacity still missing after `H` adds no further burden: the horizon
is part of the question being asked. Some mapped delivery outcomes can
fall beyond `H`, in which case the capacity they would eventually bring is
outside the scored window.

Shortfall and delay burden answer different questions and can move in
opposite directions: two plans with an identical `S_s` have different
`L_s` if one recovers in a month and the other in two years.

---

## 12. Development cost

```
C_dev = sum_{i=1..N} c_i * x_i
```

Cost is linear in the allocation. The `c_i` are **relative, normalized
values, not currency**: a site at 1.15 costs 15% more per MW than a site
at 1.00, and that ratio is the entire content of the number. There is no
fixed site-opening cost, no economy of scale, and no financing effect in
this version. Reported totals carry relative units, never a currency
symbol, even where the numeric range overlaps the MW figures beside them.

---

## 13. Delay consequence

```
C_delay,s   = lambda * L_s
E[C_delay]  = lambda * E[L]
```

`lambda` converts one MW-month of unmet capacity into the units of
development cost, so the two can be weighed against each other. **It is a
value the user sets, not an empirical constant, a market price, or a figure
the model supplies.** Read it as a position: how much additional relative
development cost is worth accepting to remove one MW-month of expected
unmet capacity. At `lambda = 0`, delay carries no consequence and the
problem reduces to pure cost minimization. Because it is a position rather
than a measurement, the useful question is how far it must move before the
answer changes (Section 18).

`lambda >= 0` is required; it is enforced at the input schema and
re-checked in the optimizer, where non-negativity is what makes the
objective convex.

---

## 14. The objective

```
J = C_dev + lambda * E[L]
```

`J` is the mathematical tradeoff the optimization minimizes. Both terms are
relative, so `J` orders allocations under one stated `lambda` on one
portfolio and has no meaning as an absolute figure. It is not reported as a
score.

**Development cost and the expected delay burden are the only two
quantities the optimization acts on.** `P_meet` and `E[S]` are reported
because a decision-maker needs them, but they are diagnostics of the
resulting allocation, not objective terms: no term in `J` contains either,
and the model carries no constraint requiring `P_meet` to reach any
particular level. No additional risk penalty, variance term, or robustness
weighting is added; an additional term would have to express a decision
this objective cannot.

---

## 15. Feasibility and forced allocation

The feasible set is:

```
0 <= x_i <= K_i    for every site i
sum_i x_i >= D
```

Total allocation may exceed `D`: deliberate redundancy can be worth its
cost when `lambda` is high, so whether overcapacity helps is left as a
result rather than fixed as an assumption. The `>= D` constraint is
load-bearing, not redundant: without it, the unconstrained minimizer of
`J` can rationally leave `D` unmet whenever the marginal development cost
of more capacity exceeds the marginal `lambda`-weighted delay reduction it
buys.

Two structural conditions are exact, and only these two are recognized:

- **Capacity shortfall (`sum_i K_i < D`).** No allocation satisfies the
  capacity constraint; the feasible set is empty. This is a statement about
  the capacity constraint only. It does **not** say that target-date power
  delivery is infeasible — an allocation that satisfies the capacity
  constraint may still fail to deliver by `T*`, which is a question of
  deadline performance, not feasibility.
- **Forced allocation (`sum_i K_i = D`).** The only feasible allocation is
  `x_i = K_i` for every site. There is no allocation choice to make; the
  allocation is determined by the arithmetic of the portfolio, and
  presenting it as a recommendation would misstate what happened.

When `sum_i K_i > D`, the model makes no claim about how much room the
feasible set has or how much any site must carry.

---

## 16. Allocation optimization

The optimization seeks the allocation that minimizes `J` over the feasible
set:

```
min_x  [ sum_i c_i x_i + lambda * E[L](x) ]
s.t.   0 <= x_i <= K_i,   sum_i x_i >= D
```

### 16.1 Structure and method

`C_dev` is linear in `x`. `Y_i(t,s) = min(x_i, A_i(t,s))` is concave
piecewise-linear in `x_i`; `Q(t,s) = max(0, D - Y(t,s))` is therefore
convex piecewise-linear, and so are `L_s` and `E[L]`. For `lambda >= 0`,
`J` is a non-negative combination of a linear and a convex
piecewise-linear function, hence **convex piecewise-linear** in `x`.

Written over the exact scenario set with epigraph auxiliary variables
`y_{i,t,s}` for delivered site capacity and `z_{t,s}` for missing capacity,
the problem becomes a **linear program** over the feasible polytope:

```
min    sum_i c_i x_i  +  lambda * sum_s p_s * sum_{t in [T*, H]} z_{t,s}
s.t.   0 <= x_i <= K_i
       sum_i x_i >= D
       0 <= y_{i,t,s} <= A_i(t,s)          (A is constant data; a variable bound)
       y_{i,t,s} <= x_i
       z_{t,s} >= D - sum_i y_{i,t,s}
       z_{t,s} >= 0
```

The LP is solved numerically with HiGHS (via `scipy.optimize.linprog`).
Linear programming has no separate local minima, so a solved and verified
result is a **global minimum of the stated formulation**, subject to
reported numerical tolerances — not the best point of a local search, and
not the best of a sampled or gridded candidate set.

The auxiliary `y`/`z` variables carry no independent meaning and are never
reported. Every published quantity for the optimized allocation — from
`C_dev` to `P_meet`, `E[S]`, and `E[L]` — is produced by re-evaluating that
allocation through the same definitions in Sections 9–14. The LP objective
value and the evaluator's `J` at the returned `x*` are required to agree
within a bound composed of the evaluator's `1e-9` MW clamp (scaled by
`lambda` and the number of summed months) and an ordinary LP solver
tolerance (`~1e-7`); a discrepancy beyond that bound raises rather than
reporting an unverified result.

### 16.2 Public optimization boundary

Exact allocation optimization is performed **for 1–3 candidate sites**. For
4–12 sites the public application evaluates the defined benchmark
strategies (Section 19) and reports the best among those compared
strategies; it does not claim a global optimum for that case. This is a
deployment policy of the public application, not a limit of the engine,
which is `N`-general (Section 23).

---

## 17. Co-optimality and non-uniqueness

Because `J` is convex piecewise-linear, its minimizing set can be a face
rather than a single point: at particular `lambda` values, whole families
of allocations share the same objective value or differ by less than the
solver can resolve. Such allocations are **effectively tied**.

Each result carries `is_unique_within_tolerance`. Where it is `false`, the
allocation shown is **one representative** of a tied set; a different,
equally optimal allocation could have been returned. The flag is named for
what it certifies: no per-coordinate range wider than `1e-6` of a site's
own capacity was found among allocations whose LP objective lies within the
reported co-optimality tolerance (`max(1e-7, 1e-9 * |J*|)`, in objective
units) of the numerical optimum. It is **not** a mathematical proof of
uniqueness; an exactly unique optimum with a very small cost gradient
between sites can still be reported non-unique within tolerance.

Where a result is not unique, the model also reports, per site, the lowest
and highest capacity that site takes across the tied set. These are
**marginal ranges, one coordinate at a time**. They must **not** be read as
a box of jointly feasible allocations: the requirement constraint links the
coordinates, so taking every site at the top (or bottom) of its range
generally yields an allocation that is not feasible at all.

---

## 18. λ-sensitivity: regimes and break-even

`lambda` is set, not measured, so the durable result is the map of how the
answer changes across `lambda` values. Two such maps exist and are not the
same thing.

### 18.1 Decision regimes and boundaries

Over the full feasible set, the cost-minimizing allocation is **piecewise
constant** in `lambda`: it holds over a range, switches at a boundary, and
holds again. The ranges are decision regimes; the switch points are
boundaries. The competing allocations at a boundary are not known in
advance, so each boundary is **located and verified numerically** and
reported with the tolerance within which it was found, not as an exact
threshold. The allocations at regime interiors are exact solver results,
never interpolated. The terminal regime holds for every larger `lambda`
and is confirmed against a directly solved limiting program.

### 18.2 Break-even between fixed strategies

For two strategies `A` and `B` with fixed development costs and fixed
expected delay burdens, each objective is a straight line in `lambda`, and
they are indifferent where the lines cross:

```
lambda* = (C_B - C_A) / (E[L_A] - E[L_B])
```

`lambda*` is undefined when `E[L_A] = E[L_B]` (parallel lines). A pairwise
crossing is a switch of the preferred strategy only if it lies on the
lower envelope of all strategies being compared; a crossing above the
envelope changes nothing.

### 18.3 Why the two families differ

Benchmark switching values answer "which of the fixed strategies is best?"
Regime boundaries answer "where does the best allocation over the full
feasible set change?" The optimized allocation is generally none of the
benchmarks, so the two families are not expected to coincide, and a value
from one is not a value from the other.

---

## 19. Benchmark strategies

Three fixed, deterministic, non-searching rules provide interpretable
reference points. Ties within a rule are broken by input order, so the same
inputs always produce the same benchmark allocation.

| Public label | Canonical name | Rule |
|---|---|---|
| **Cost first** | cost concentration | Rank sites by `c_i`, cheapest first. Take each site's full capacity in turn until `D` is covered; the last site supplies the remainder. |
| **Schedule first** | speed / reliability | Rank sites by nominal full-service month `tau2_bar_i`, earliest first, breaking ties on the site's expected delay `E[delta_i]`. The two keys are compared in sequence, never combined into a score. Fill as above. |
| **Spread across sites** | diversified | Give every site the same fraction of its own capacity: `x_i = D * K_i / sum_j K_j`. If `D >= sum_j K_j`, every site is taken in full. |

None of the three is universally best; which has the lowest `J` depends on
the portfolio and on `lambda`, and the ranking changes as `lambda` changes.
On a particular portfolio one benchmark can be worse than another at every
`lambda` — a finding about that portfolio, not a defect: the rules are
fixed by design and are not adjusted to keep each competitive. The
benchmarks are three members of a continuous feasible set; the best
allocation in that set is usually none of them.

---

## 20. Exact evaluation and Monte Carlo

The joint delay space is handled one of two ways, and every metric is
defined identically in both.

- **Exact enumeration** builds every joint delay outcome, computes its
  exact probability `p_s` as the product of per-site outcome probabilities,
  verifies that the `p_s` sum to 1, and evaluates each metric as an exact
  probability-weighted sum. There is no sampling error; the result is the
  model's answer.
- **Monte Carlo** draws a fixed number of seeded samples from the same
  joint distribution (each site's delay drawn independently) and evaluates
  the same metrics as sample averages, each weight `1/M`. The quantity
  estimated is exactly what exact enumeration would return. A Monte Carlo
  result carries sampling error and is reported as an estimate, with the
  number of samples; no separate standard error or confidence interval is
  reported.

The engine selects exact enumeration while
`S_full = prod_i q_i <= max_exact_scenarios` and Monte Carlo above it. The
canonical configuration (`configs/model_defaults.yaml`) sets
`max_exact_scenarios = 100000`, `mc_samples = 10000`, and
`random_seed = 12345`; the public application passes its own export-cost
threshold (`50000`) for precomputed presets, leaving the engine's
switching behavior unchanged.

**Allocation optimization runs only on an exact scenario set.** The
optimizer rejects a Monte Carlo scenario set rather than silently
optimizing a sample: optimizing over a fixed sample is a sample-average
approximation whose in-sample optimum is a selection-biased estimate of the
true objective at that allocation, and this release does not do it. Every
result records which method produced it and how many joint outcomes or
samples were evaluated.

---

## 21. Reproducibility and determinism

- Exact enumeration involves no sampling: identical inputs always give
  identical outputs.
- Monte Carlo sampling is seeded: identical inputs and seed reproduce the
  identical sample and the identical numbers.
- The committed public example exports
  (`web/public/data/*.json`) are produced by exact enumeration of
  three-site scenarios and reproduce byte-for-byte (see
  [`reproducibility.md`](reproducibility.md)).

Verification here means the equations and implementation have been checked
against hand-verifiable cases, model invariants (Section 22), and limiting
cases with independently known answers. It is **not** validation against
realized project outcomes: the reference mappings are generalized values,
not a calibration fitted to observed delivery histories.

---

## 22. Validation invariants

The implementation is checked against invariants that must hold for any
valid inputs, among them:

1. `x_i <= K_i` for every site, and every allocated site id is known.
2. Every uncertainty state's probabilities sum to 1 (within `1e-9`).
3. Assembled joint scenario probabilities sum to 1 (within `1e-9`).
4. `tau2_bar_i > tau1_bar_i` for every burden state; shifting both by the
   same non-negative delay preserves the ordering.
5. `A_i(t,s)` is non-decreasing in `t`, bounded in `[0, K_i]`, and equals a
   0 / `alpha K_i` / `K_i` step.
6. `E[S] >= 0`, `E[L] >= 0`, `C_dev >= 0`, and `P_meet in [0, 1]`.
7. With `lambda = 0`, `J = C_dev` exactly.
8. If all uncertainty collapses to a zero delay with probability 1, the
   exact and Monte Carlo evaluations coincide.
9. Monte Carlo estimates converge to the exact values as the sample count
   grows, with spread shrinking on the order of `1 / sqrt(M)`.
10. The optimized allocation's LP objective and its evaluator-derived `J`
    agree within the justified numerical bound (Section 16.1).
11. The optimized allocation's `J` is less than or equal to that of each of
    the three benchmark strategies.

Invariant numbers in this list are stable; source assertions refer to them
by number.

---

## 23. Deployment versus mathematical boundary

The quantitative engine (`src/trackc/`) is `N`-general and
horizon-general: adding a site means supplying another data row, never
changing model code. The following are **public-application deployment
policies**, enforced in the application layer (`src/trackc_app/`), and
change no model behavior:

| Policy | Value | Rationale |
|---|---|---|
| Maximum sites accepted | 12 | UI and interaction scope. |
| Live allocation optimization | `N <= 3` | The joint-delay LP and the non-uniqueness probe grow quickly with `N`; larger portfolios use benchmark comparison, still fully evaluated. |
| Analysis horizon (public app) | 72 months, fixed | Bounds the evaluator's `(scenarios x sites x months)` tensors for the shared live service. |
| Live λ-envelope | precomputed only | The full envelope is a static artifact, never computed on a live request. |

In production the interactive API schema surfaces (`/docs`, `/redoc`,
`/openapi.json`) are disabled; see [`deployment.md`](deployment.md).
