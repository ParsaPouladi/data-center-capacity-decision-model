# Assumptions

This document separates **assumptions** — choices about how the model is
built and parameterized, each of which a project-specific implementation
would revisit — from **mathematical identities**, which are defined in
[`model-specification.md`](model-specification.md) and are not assumptions.
[`limitations.md`](limitations.md) states where the model does not apply.

Every synthetic value below is labelled as synthetic. Nothing in this
repository is presented as observed facility-level, utility-level, or
project-level data.

---

## 1. Inputs and examples are synthetic and stylized

The baseline scenario, the sensitivity-variant configurations, the curated
example portfolios, and every number in the Technical Documentation's
worked examples are **synthetic constructions** for a stylized model. They
are chosen to exercise the mechanism (a cheap but power-risky site against
a faster, costlier one; a forced-allocation portfolio; a genuine tradeoff
regime), not to represent any real site, utility, or project. The
repository makes no claim to proprietary or facility-specific data.

---

## 2. Ordinal states are interpreted as identifiers

`B_i` (power-delivery complexity) and `U_i` (schedule uncertainty) are
treated strictly as classification identifiers, not as interval or ratio
quantities. State 4 is not "twice" state 2. Each state is a lookup key into
a published mapping table; the quantitative engine operates only on the
physical parameters and distributions those tables return, never on the
state integers or their ordering. This is a modeling commitment, not a
computational convenience.

---

## 3. State-to-parameter mappings are generalized reference values

The mapping tables in `configs/burden_states.yaml` and
`configs/uncertainty_states.yaml` (`mapping_version: v1-baseline`) assign:

- each `B_i` a nominal first-stage month and a nominal full-service month;
- each `U_i` a finite list of whole-month delay outcomes and their
  probabilities.

These are **generalized synthetic assumptions**, not measured utility
statistics, interconnection-queue data, or site-specific schedules. Results
are conditional on them: changing the mapping values moves the decision
regimes and boundaries. The compressed (`x0.9`) and stretched (`x1.1`)
variants exist to test the robustness of conclusions to a plausible
alternative calibration; they are not asserted to be more accurate than
the baseline. A project implementation calibrates these tables against its
own engineering evidence and performs the corresponding domain validation.

---

## 4. Delay distributions: support and probability

- Delays are **whole months** and **non-negative** — delivery can run late
  but never early. A mapped stage date is therefore a planned delivery
  date, not a statistical mean.
- Each site's delay distribution is **finite**, with a small number of
  outcomes (`q_i`, read per site; `q_i = 3` for every reference state).
- Each realized delay shifts **both** stage dates by the same amount, so
  the internal structure of the two-stage delivery schedule is preserved
  and the stage dates are never independently perturbed.
- Probabilities are taken as given by the mapping and are required to sum
  to 1 (within a `1e-9` tolerance).

---

## 5. Site delays are independent

In the reference model, site delivery delays are drawn **independently** of
one another: there is no shared cause that slips several sites at once
(common grid, regulatory, weather, or supply-chain drivers). Both the exact
enumeration and the Monte Carlo path assume this independence.

This assumption can **increase the apparent benefit of diversification**
relative to a portfolio with correlated delay drivers. Every
diversification-related result is therefore conditional on it. The model
does not quantify the direction or magnitude of that difference. A
project-specific implementation should represent cross-site dependence
where it is materially relevant.

---

## 6. Site characteristics are supplied independently

`K_i`, `c_i`, `B_i`, and `U_i` are independent inputs; none is derived from
another. In particular, cost is not assumed to rise or fall with
complexity or uncertainty. Encoding such a correlation in the inputs would
manufacture the cost/delay tradeoff the model exists to study; where a real
project exhibits such a relationship, it is expressed by choosing the input
values, not by a built-in rule.

---

## 7. Development cost is linear and relative

`C_dev = sum_i c_i x_i`. Cost is:

- **linear** in the allocation — no fixed site-opening cost, no economies
  of scale, no financing or time-value effect;
- **relative and normalized** — the `c_i` are dimensionless ratios, not
  currency. Only the ratios between them carry meaning, and `J` and `C_dev`
  are meaningful only as orderings, not as absolute figures.

---

## 8. The allocation is continuous and the requirement is a hard floor

- `x_i` is a continuous quantity in `[0, K_i]` (MW); the model does not
  impose integer plant sizes or discrete build increments.
- The requirement enters as `sum_i x_i >= D`, a hard feasibility floor.
  Over-provisioning (`sum_i x_i > D`) is allowed and can be preferred when
  `lambda` is high; whether it helps is a result, not an assumption.
- `P_meet` and `E[S]` are **diagnostics**, not constraints: the model
  carries no requirement that `P_meet` reach any particular level.

---

## 9. The analysis horizon bounds the delay burden

The expected delay burden accumulates unmet capacity from `T*` through the
analysis horizon `H`, inclusive, and stops there. Capacity still missing
after `H` contributes nothing further, and mapped delivery outcomes that
land beyond `H` fall outside the scored window. `H` is therefore a modeling
boundary that shapes the answer, not a neutral end-point: changing it
changes the expected delay burden of every allocation, and with it the
optimized allocation and the `lambda` values at which it changes. `H` must
be chosen long enough that the outcomes the decision cares about fall
inside it, and every reported delay burden is a figure over that window.
Time is evaluated on whole-month points one month apart.

---

## 10. The delay consequence is a user input

`lambda` is a position the user takes, not an empirical constant or a
market price. No value of `lambda` in this repository is a recommendation.
Because it is set rather than measured, the model's `lambda`-sensitivity
analysis (regimes, boundaries, break-even values) is the substantive
output, not the answer at any single `lambda`.

---

## 11. Deployment assumptions are separate from model assumptions

The public application enforces policies — at most 12 sites, live
allocation optimization only for `N <= 3`, a fixed 72-month analysis
horizon, a precomputed-only `lambda`-envelope — that are **properties of
the shared public service, not of the model**. The engine is `N`-general
and horizon-general. These policies are documented in
[`deployment.md`](deployment.md) and must not be read as structural model
constraints.
