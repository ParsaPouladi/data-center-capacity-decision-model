"""Allocation optimizer: x* = argmin_x J(x) via linear programming.

Independently reviewed against the model specification before
implementation. Implementation contract points this module follows:
LP/evaluator tolerance justification, the structured ``OptimizationResult``
contract, explicit LP bounds, the lambda-domain check, the exact-only
Monte Carlo boundary, "numerical solution" (not "exact vertex")
terminology, and the validation additions below.

Mathematical basis (re-derived and independently verified before
implementation, not merely asserted here):

* ``A_i(t,s)`` (model spec) depends only on ``K_i``, ``B_i``,
  the realized delay ``delta_{i,s}``, and ``alpha`` -- **never on x**. It is
  therefore *data*, computed once per (site, realization, month) via the
  same frozen :func:`trackc.model.evaluator.site_availability` the
  evaluator itself uses (no second implementation).
* ``Y_i(t,s) = min(x_i, A_i(t,s))`` is concave piecewise-linear in ``x_i``;
  ``Y(t,s) = sum_i Y_i`` is concave PL; ``Q(t,s) = max(0, D - Y(t,s))`` is
  convex PL; ``L_s = sum_{t=T*}^{H} Q(t,s)`` and ``E[L] = sum_s p_s L_s``
  (``p_s >= 0``) are convex PL; ``C_dev = sum_i c_i x_i`` is linear. Hence
  ``J = C_dev + lambda * E[L]`` (the model specification, FROZEN) is convex
  piecewise-linear in ``x`` whenever ``lambda >= 0`` (the model specification,
  enforced by ``schemas.SystemInputs.lambda_mw_month``'s ``ge=0``
  constraint -- re-checked defensively below, not merely assumed).
* The feasible set ``{0 <= x_i <= K_i, sum_i x_i >= D}`` (the model specification,
  25) is a polytope. The whole problem is therefore an **exact linear
  program** via the standard epigraph substitution below -- no integer
  variables, no local optima, no need for Monte-Carlo-in-the-loop or a
  second scenario representation: the existing exact
  :class:`~trackc.model.scenario_engine.ScenarioSet` already *is* the
  deterministic-equivalent scenario tree.

LP formulation, for every site ``i``, realization ``s``, and month ``t`` in
``[T*, H]`` (the only months the delay burden ``L_s`` sums over,
inclusive of ``T*``):

.. code-block:: text

    min   sum_i c_i x_i  +  lambda * sum_s p_s * sum_t z_{t,s}

    s.t.  0 <= x_i <= K_i                                  (model spec)
          sum_i x_i >= D                                   (the model specification;
                                                              load-bearing, not
                                                              redundant -- see
                                                              module note below)
          0 <= y_{i,t,s} <= A_i(t,s)                        [A is constant data;
                                                              enforced as an
                                                              explicit variable
                                                              bound, not a
                                                              separate row]
          y_{i,t,s} <= x_i
          z_{t,s} >= D - sum_i y_{i,t,s}
          z_{t,s} >= 0

``y``/``z`` are standard LP epigraph auxiliaries with no independent
economic meaning of their own -- not new decision variables in the
modeling sense, and never exposed in the public result contract (only
``x*`` is). At the optimum there *exists* a solution with
``y_{i,t,s} = min(x_i, A_i(t,s))`` and ``z_{t,s} = max(0, D - Y(t,s))``, so
the LP's optimal *objective value* equals ``J`` exactly (up to the ordinary
floating-point/solver tolerance discussed below) -- but individual ``y``
values are not guaranteed unique at optimum (once a ``z`` row is already
pinned at its lower bound by other sites/months, further slack in ``y`` is
objective-neutral), so this module never reads ``Y_i(t,s)`` off the raw LP
solution. All reported physical metrics come from re-evaluating ``x*``
through the existing, unmodified
:func:`trackc.model.evaluator.evaluate_strategy` -- the whole point of
keeping the optimizer as a single-source-of-truth-respecting search over
``x`` rather than a second metrics engine.

Why ``sum_i x_i >= D`` is load-bearing, not redundant: the unconstrained-
in-``D`` minimizer of ``J`` can rationally leave ``D`` unmet whenever the
marginal development cost of additional capacity at the cheapest remaining
site exceeds the marginal ``lambda``-weighted delay-cost reduction it buys
-- that is exactly the case the model specification is guarding against, and
exactly why this constraint changes the answer versus dropping it.

Overcapacity (``sum_i x_i > D``) causes no formulation or solver
complication: the constraint is ``>=``, not ``=`` (model spec), so a
larger allocation than strictly required is an ordinary feasible point,
and can be strictly preferred whenever hedging against delay (a positive
``lambda``) is worth more than the extra development cost.

Non-uniqueness (the same indifference-surfacing principle the strategy
comparator applies, mirroring
:func:`trackc.model.comparator.co_optimal_strategies_at_lambda`): after
solving for ``J*``, this module probes each site's marginal range
``[lo_i, hi_i]`` over every LP solution whose objective is within a
justified tolerance of ``J*`` (:func:`_cooptimality_tolerance`, reported as
:attr:`OptimizationResult.cooptimality_tolerance`), by minimizing and
maximizing ``x_i`` subject to the original constraints plus
``objective <= J* + tolerance``. **These per-coordinate intervals are
reported as marginal ranges among solutions within the reported
co-optimality tolerance of the numerical optimum only -- their Cartesian
product is NOT claimed to be "the optimal face," and the intervals
themselves are NOT exact mathematical optimal-face bounds.** An optimal
face is generally a lower-dimensional polytope; an arbitrary combination
of per-coordinate extrema need not itself be feasible or jointly optimal.
A solver-selected vertex (the representative ``allocation`` in
:class:`OptimizationResult`) is never presented as a uniquely preferred
answer when the probe finds a nonzero range.

**What ``is_unique_within_tolerance`` does and does not certify** (named
this way, not ``is_unique``, specifically to avoid this confusion): it
means "no coordinate range wider than
:data:`_COORDINATE_WIDTH_RELATIVE_TOLERANCE` of that site's own capacity
was found within :attr:`OptimizationResult.cooptimality_tolerance` of the
numerical optimum" -- a statement about what THIS finite-precision LP
solve can certify, not a mathematical uniqueness proof. In particular, a
mathematically UNIQUE optimum can still be reported
``is_unique_within_tolerance=False`` when the scenario's cost structure has
an extremely small (but strictly nonzero) cost differential between sites
relative to ``J*``'s own scale -- this was found and independently
confirmed, and is deliberately not "fixed" by tightening
:func:`_cooptimality_tolerance` further, because no finite tolerance
eliminates this ambiguity in general -- it only moves it to a smaller cost
scale. Treat ``is_unique_within_tolerance=False`` as "verify against the
scenario's own cost differentials before concluding this is genuine
economic indifference," not as an unconditional indifference finding.

Exact-enumeration only (v1 scope): this module requires
``scenario_set.method == "exact"`` and raises otherwise. Optimizing over a
fixed seeded Monte Carlo sample would be a sample-average approximation
(SAA); the in-sample optimized objective at ``x*`` is then a selection-
biased (optimistic) estimate of the true objective at that specific ``x*``
-- not a claim that every additive component (e.g. ``E[L]`` in isolation)
is universally downward-biased, which is a stronger and unjustified
statement this module does not make. If SAA optimization is ever
authorized, it must keep optimization and out-of-sample evaluation on
separate scenario sets/seeds; that is deferred and not implemented here.

Numerical note (the model's tolerance conventions, extended
per-item): :func:`trackc.model.evaluator.evaluate_strategy` clamps any
deadline/delay gap within ``evaluator._CAPACITY_TOLERANCE`` (1e-9 MW) to
exactly zero, guarding floating-point summation roundoff. The raw LP
constraints above do not apply that same clamp (it would not be
meaningful as a constant *bound* the way it is as a *post-hoc* comparison
clamp). This is a genuine, bounded, and quantified numerical difference
between "the LP's objective value" and "the evaluator's J at the same x"
-- never assumed to vanish, and never assumed too small to matter at any
scale. This module always re-evaluates its representative allocation
through the evaluator and asserts the two values agree within a tolerance
derived explicitly from that clamp, ``lambda``, the number of summed
months, and an ordinary LP solver numerical tolerance
(:func:`_lp_evaluator_tolerance`) -- and **fails loudly (raises), rather
than silently declaring the result verified**, if the discrepancy exceeds
that bound. A near-tied pair sitting right at the clamp boundary is
exactly the case this guards -- it is not claimed the clamp can *never*
reorder a near-tied comparison; it is bounded and checked, not asserted
away.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import numpy.typing as npt
from scipy import sparse
from scipy.optimize import linprog

from trackc import __version__ as _TRACKC_VERSION
from trackc.model.evaluator import CAPACITY_TOLERANCE as _CAPACITY_TOLERANCE
from trackc.model.evaluator import evaluate_strategy, site_availability
from trackc.model.power_profile import time_grid
from trackc.model.scenario_engine import ScenarioSet
from trackc.model.schemas import Allocation, BurdenStateConfig, Scenario, UncertaintyStateConfig

# Ordinary LP solver numerical tolerance (HiGHS's default primal/dual
# feasibility tolerances are of this order) -- a fixed, conservative floor
# for both tolerances below, not tuned per-run and not treated as a
# universal theorem about solver precision beyond "this order of
# magnitude, for problems of the sizes this module builds."
_SOLVER_TOLERANCE = 1e-7


def _lp_evaluator_tolerance(lam: float, n_months: int) -> float:
    """Justified bound on ``|J_LP - J_evaluator|`` for the SAME allocation
    ``x*`` (module docstring, "Numerical note").

    Composed of exactly the two sources of disagreement between the raw LP
    formulation and ``evaluator.evaluate_strategy``, and nothing else:

    * the evaluator's ``_CAPACITY_TOLERANCE`` (1e-9 MW) clamp, applied once
      per summed month and scaled by ``lambda`` (the clamp only affects the
      ``lambda``-weighted delay-burden term of ``J``, never the linear
      development-cost term, which both formulations compute identically);
    * :data:`_SOLVER_TOLERANCE`, an ordinary LP floating-point solve
      tolerance, unrelated to the clamp.

    This is a bound, not a claim that the two values are numerically
    identical -- see :func:`optimize_allocation`, which asserts the actual
    discrepancy is within this bound and raises (does not silently pass)
    if it is not.
    """
    return abs(lam) * n_months * _CAPACITY_TOLERANCE + _SOLVER_TOLERANCE


def _cooptimality_tolerance(j_star: float) -> float:
    """Tolerance (in ``J`` units) for the non-uniqueness probe's "co-optimal"
    constraint ``objective <= J* + tolerance`` (module docstring,
    "Non-uniqueness"). This is what :attr:`OptimizationResult.cooptimality_tolerance`
    reports -- it defines exactly what "co-optimal" means for
    :attr:`OptimizationResult.coordinate_bounds` and
    :attr:`OptimizationResult.is_unique_within_tolerance`.

    Relative to ``|J*|``, not the MW-scale ``evaluator._CAPACITY_TOLERANCE``
    convention: ``J`` mixes normalized development cost with ``lambda``
    (the model specification: "no universal real-world value" -- can be large or
    small by design), so a fixed absolute MW-scale tolerance would be
    either too loose or too tight depending on the scenario's own
    ``lambda``/cost scale. The relative factor is deliberately small
    (``1e-9``, matching the project-wide "tiny fixed tolerance" convention
    size, ``schemas._PROB_SUM_TOLERANCE``) -- a looser factor (e.g. ``1e-6``
    was tried during implementation) widens the co-optimal search window
    enough to sweep in allocations whose objective differs by a genuinely
    decision-irrelevant amount purely because of the window's own size, not
    because of real degeneracy; :func:`_probe_optimal_face`'s
    capacity-relative width check (not this function) is the actual
    uniqueness decision, so this tolerance only needs to be "generous
    enough to accommodate ordinary LP solver noise," not "generous enough
    to define what counts as a decision-relevant tie." :data:`_SOLVER_TOLERANCE`
    is the floor, for the ``J* == 0`` case (e.g. ``lambda == 0`` with a
    minimal-cost tie) and for small ``|J*|`` generally.

    IMPORTANT SCOPE NOTE: no finite
    tolerance here can distinguish, in general, "mathematically unique
    optimum with a tiny cost gradient between sites" from "genuinely
    near-degenerate optimum" -- both produce a small-but-nonzero
    co-optimal window when translated into MW (see
    :func:`_probe_optimal_face`'s docstring). This tolerance is
    deliberately NOT tightened further to try to eliminate that ambiguity
    -- doing so would just move the same ambiguity to a different,
    even-smaller cost-gradient scale, not remove it, since it is a
    fundamental limit of what finite-precision LP solving can certify, not
    an implementation defect. The correct fix is honest naming and
    reporting (``is_unique_within_tolerance``, ``cooptimality_tolerance``
    exposed on :class:`OptimizationResult`), not a smaller number.
    """
    return max(_SOLVER_TOLERANCE, 1e-9 * abs(j_star))


#: A per-site coordinate range narrower than this FRACTION of that site's own
#: `K_i` is treated as ordinary LP solver/probe-window noise, not a genuine
#: alternate optimum (module docstring, "Non-uniqueness"; see
#: `_probe_optimal_face`). Deliberately dimensionless and capacity-relative,
#: not an absolute MW constant: an absolute tolerance here (e.g. reusing
#: `evaluator._CAPACITY_TOLERANCE`, tried during implementation) is
#: systematically too tight whenever `_cooptimality_tolerance`'s J-unit
#: window is translated into MW through a finite cost gradient between
#: sites -- `width_i ~ tol_face / (marginal cost difference)`, which for
#: realistic cost differentials is comfortably larger than 1e-9 MW even for
#: a mathematically UNIQUE optimum (verified: baseline scenario's true
#: unique minimal-cost allocation was flagged as non-unique under that
#: absolute test before this fix). A width judged against the site's own
#: capacity scale avoids that false positive while still flagging genuine
#: degeneracy (e.g. two sites with identical cost/capacity/state, where the
#: tied range spans a decision-relevant fraction of K_i, not a sliver of it).
#:
#: This is STILL a finite, numerically-defined threshold, not a certificate
#: of mathematical uniqueness -- an extreme case (two sites whose cost
#: differs by a tiny but strictly nonzero amount, at a large `J*`) can
#: still translate a small `J`-unit co-optimality window into a
#: capacity-relative width that exceeds this threshold even though the
#: exact LP has a unique optimum (independently confirmed; see
#: `test_extreme_scale_tiny_cost_gradient_reports_non_unique_within_tolerance`
#: in `tests/unit/test_optimizer.py`). `is_unique_within_tolerance` is
#: named the way it is -- not `is_unique` -- specifically so a `False`
#: here is never read as "the exact LP has multiple mathematical optima."
_COORDINATE_WIDTH_RELATIVE_TOLERANCE = 1e-6


@dataclass(frozen=True, eq=False)
class OptimizationResult:
    """Structured result contract (never a bare solver-selected
    :class:`~trackc.model.schemas.Allocation`).

    ``eq=False`` for the same reason as
    :class:`~trackc.model.evaluator.StrategyResult` (holds fields whose
    ``==`` would be ambiguous or misleading for a struct like this).

    Authoritative model metrics (``C_dev``, ``E[L]``, ``J``, ``P_meet``,
    etc.) are deliberately **not** fields here -- call
    :func:`trackc.model.evaluator.evaluate_strategy` on ``allocation`` to
    get them from the single frozen source of truth.
    """

    model_version: str
    site_ids: tuple[str, ...]

    #: One representative optimal allocation. When
    #: ``is_unique_within_tolerance`` is ``False``, this is only ONE point
    #: among the co-optimal solutions found within ``cooptimality_tolerance``
    #: -- see ``coordinate_bounds`` for the marginal ranges, and do not
    #: present this allocation as uniquely preferred.
    allocation: Allocation

    #: Raw ``scipy.optimize.linprog`` solver outcome for the primary solve.
    success: bool
    status: int
    message: str

    #: The LP's own optimal objective value -- an INTERNAL cross-check
    #: quantity only (see module docstring, "Numerical note"). Callers
    #: needing the authoritative ``J`` must use the evaluator instead.
    lp_objective: float

    #: ``True`` only if every site's coordinate range in ``coordinate_bounds``
    #: has width within ``_COORDINATE_WIDTH_RELATIVE_TOLERANCE`` of that
    #: site's own capacity (module docstring, "Non-uniqueness").
    #:
    #: **Read this exactly as named: numerical uniqueness within
    #: `cooptimality_tolerance`, not a mathematical uniqueness
    #: certificate.** `False` means the reported `allocation` is one of (in
    #: general, infinitely many) allocations whose LP objective is within
    #: `cooptimality_tolerance` of the numerical optimum -- it does NOT by
    #: itself distinguish "genuinely mathematically degenerate" from "a
    #: mathematically unique optimum with a cost/capacity structure fine
    #: enough that finite-precision LP solving cannot certify uniqueness
    #: any tighter than this" (an extreme-scale/tiny-cost-differential case
    #: exhibits exactly the latter -- see `_cooptimality_tolerance`'s
    #: docstring).
    #: `True` means no such ambiguity was detected at this tolerance; it
    #: does not certify uniqueness to arbitrary precision either. Compare
    #: `coordinate_bounds` widths against the scenario's own cost
    #: differentials before treating a `False` here as an economically
    #: meaningful indifference finding.
    is_unique_within_tolerance: bool

    #: Per-site MARGINAL range ``{site_id: (lo, hi)}`` of ``x_i`` -- these
    #: are per-site ranges among solutions whose objective is within the
    #: reported ``cooptimality_tolerance`` of the numerical optimum
    #: (``lp_objective``), NOT exact mathematical optimal-face bounds. Two
    #: distinct approximations are stacked here, neither of them exact: (1)
    #: "within `cooptimality_tolerance`" is itself a finite window, not
    #: "exactly tied"; (2) even for an exact window, the Cartesian product
    #: of independent per-coordinate intervals is NOT a claim that every
    #: combination is jointly feasible or optimal -- an optimal face is
    #: generally a lower-dimensional polytope, and these are marginal
    #: (one-coordinate-at-a-time) projections of it. See module docstring,
    #: "Non-uniqueness".
    coordinate_bounds: dict[str, tuple[float, float]]

    #: The ``J``-unit (objective-space) tolerance actually used to define
    #: "co-optimal" for the non-uniqueness probe
    #: (:func:`_cooptimality_tolerance`) -- i.e. an allocation is only
    #: reflected in ``coordinate_bounds``/``is_unique_within_tolerance`` if
    #: its LP objective is within this many ``J`` units of ``lp_objective``.
    #: Exposed explicitly so downstream analysis knows precisely what
    #: "co-optimal" meant for THIS result, rather than assuming a fixed or
    #: universal number (this value scales with ``lp_objective``, see
    #: :func:`_cooptimality_tolerance`).
    cooptimality_tolerance: float


def optimize_allocation(
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    model_version: str = _TRACKC_VERSION,
) -> OptimizationResult:
    """Solve for ``x* = argmin_x J(x)`` (model spec) via the exact LP
    formulation in this module's docstring, then verify the result through
    the existing evaluator before returning it.

    ``scenario_set`` must be an EXACT :class:`ScenarioSet` (``method ==
    "exact"``) built from ``scenario`` -- e.g. via
    :func:`trackc.model.scenario_engine.enumerate_exact`, or
    :func:`trackc.model.scenario_engine.build_scenario_set` when
    ``scenario_count(...) <= defaults.max_exact_scenarios`` selects exact
    enumeration automatically. Monte Carlo scenario sets are rejected (v1
    scope, module docstring "Exact-enumeration only") -- this is never
    silently downgraded to optimizing a sample.

    Raises ``ValueError`` for a Monte Carlo ``scenario_set``, a mismatched
    ``scenario_set``, or system-level insufficiency (``sum_i K_i < D``,
    the model specification -- checked before the solve, so an infeasible
    *portfolio* is reported with a clear message rather than a raw solver
    status). Raises ``RuntimeError`` if the LP solver itself fails to
    converge (a genuine numerical/solver problem, distinct from a modeled
    infeasibility -- the LP is always feasible whenever ``sum_i K_i >= D``,
    since ``x = K`` trivially satisfies every constraint), or if the
    evaluator cross-check discrepancy exceeds the justified tolerance
    (module docstring, "Numerical note" -- this module never reports an
    unverified result).
    """
    if scenario_set.method != "exact":
        raise ValueError(
            "optimize_allocation only supports exact-enumeration ScenarioSets in "
            "v1 (Monte Carlo/SAA optimization is explicitly deferred, "
            "module docstring 'Exact-enumeration only') -- got "
            f"method={scenario_set.method!r}. Build scenario_set via "
            "trackc.model.scenario_engine.enumerate_exact(), or ensure "
            "scenario_count(scenario, uncertainty_config) <= "
            "defaults.max_exact_scenarios so build_scenario_set() selects exact "
            "enumeration automatically."
        )
    if set(scenario_set.site_ids) != {site.id for site in scenario.sites}:
        raise ValueError(
            "scenario_set.site_ids does not match scenario.sites -- was it built "
            f"from a different scenario? scenario_set: {sorted(scenario_set.site_ids)}, "
            f"scenario: {sorted(site.id for site in scenario.sites)}"
        )
    if not (0.0 < alpha < 1.0):
        raise ValueError(f"alpha must be in (0,1) (spec section 11), got {alpha}")

    lam = scenario.system.lambda_mw_month
    # Defense-in-depth (schemas.SystemInputs.lambda_mw_month already enforces
    # `ge=0` -- the convexity argument in this module's docstring requires
    # lambda >= 0, so this is re-checked here rather than merely assumed, the
    # same pattern evaluator.py uses for alpha).
    if lam < 0:
        raise ValueError(
            f"lambda_mw_month must be >= 0 for the LP formulation's convexity "
            f"argument to hold (spec section 8; schemas.SystemInputs already "
            f"enforces this, re-checked here defensively), got {lam}"
        )

    site_ids = scenario_set.site_ids
    sites_by_id = {s.id: s for s in scenario.sites}
    sites = [sites_by_id[sid] for sid in site_ids]
    n_sites = len(sites)

    K = np.asarray([s.capacity_mw for s in sites], dtype=np.float64)
    c = np.asarray([s.cost_per_mw for s in sites], dtype=np.float64)
    D = scenario.system.required_capacity_mw
    target_month = scenario.system.target_month
    horizon_month = scenario.system.horizon_month

    if float(K.sum()) < D:
        raise ValueError(
            f"system-level insufficiency (spec section 25): sum_i K_i={K.sum()} < "
            f"D={D}; no allocation can ever meet the required capacity regardless "
            "of x. This mirrors evaluator.evaluate_strategy's "
            "'system_insufficient' feasibility status."
        )

    # --- Build A_i(t,s) for t in [T*, H] via the SAME frozen primitive the
    # evaluator uses (no second implementation of the tranche physics). ---
    times = time_grid(horizon_month)
    availability_full = site_availability(
        scenario, scenario_set, burden_config, alpha, times
    )  # (S, N, T_full)
    target_idx = int(target_month)  # times[i] == i by construction (evaluator.py convention)
    A = availability_full[:, :, target_idx:]  # (S, N, T_L), T_L = H - T* + 1
    n_realizations, _, n_months = A.shape
    p = scenario_set.probabilities  # (S,)

    n_x = n_sites
    n_y = n_realizations * n_sites * n_months
    n_z = n_realizations * n_months
    n_vars = n_x + n_y + n_z

    # --- Objective: sum_i c_i x_i + lambda * sum_s p_s * sum_t z_{t,s} ----
    obj = np.zeros(n_vars, dtype=np.float64)
    obj[:n_x] = c
    obj[n_x + n_y :] = np.repeat(lam * p, n_months)

    # --- Bounds: y's upper bound IS A_i(t,s) (a constant), enforced as a
    # variable bound rather than a separate constraint row -- this is what
    # makes the "y <= A_i(t,s)" row in the module docstring's math
    # unnecessary as an explicit constraint below. All lower bounds
    # explicit (approved-design correction: never rely on linprog's
    # default bounds silently). ---
    lb = np.zeros(n_vars, dtype=np.float64)
    ub = np.full(n_vars, np.inf, dtype=np.float64)
    ub[:n_x] = K
    ub[n_x : n_x + n_y] = A.reshape(-1)  # flatten order matches (s, i, t) below
    bounds = list(zip(lb.tolist(), ub.tolist(), strict=True))

    A_ub, b_ub = _build_inequality_constraints(n_x, n_realizations, n_sites, n_months, D)

    res = linprog(obj, A_ub=A_ub, b_ub=b_ub, bounds=bounds, method="highs")

    if not res.success:
        raise RuntimeError(
            f"LP solver did not converge (status={res.status}, "
            f"message={res.message!r}); this indicates a numerical/solver "
            "problem, not a modeled infeasibility -- system-level insufficiency "
            "is checked before the solve, above, and the LP is always feasible "
            "whenever sum_i K_i >= D (x = K trivially satisfies every "
            "constraint)."
        )

    # Clip against ordinary solver floating-point tolerance only (order
    # 1e-9-1e-7) -- never large enough to mask a real bound violation.
    # Mirrors evaluator.py's _CAPACITY_TOLERANCE clamp convention for the
    # same class of floating-point roundoff at a variable's own bound.
    x_star = np.clip(res.x[:n_x], 0.0, K)
    j_lp = float(res.fun)

    allocation = Allocation(by_site=dict(zip(site_ids, x_star.tolist(), strict=True)))

    # --- Cross-check against the evaluator -- REQUIRED, never skipped. ---
    eval_result = evaluate_strategy(
        scenario,
        allocation,
        scenario_set,
        burden_config,
        uncertainty_config,
        alpha,
        model_version=model_version,
    )
    tol_cross = _lp_evaluator_tolerance(lam, n_months)
    discrepancy = abs(eval_result.objective - j_lp)
    if discrepancy > tol_cross:
        raise RuntimeError(
            f"LP objective ({j_lp}) and evaluator-derived J ({eval_result.objective}) "
            f"disagree by {discrepancy}, exceeding the justified tolerance "
            f"({tol_cross}, see _lp_evaluator_tolerance) -- this is treated as a "
            "correctness failure, not a numerical nuisance. Refusing to report an "
            "unverified optimizer result."
        )

    coordinate_bounds, is_unique_within_tolerance, tol_face = _probe_optimal_face(
        obj, A_ub, b_ub, bounds, j_lp, n_x, site_ids, K
    )

    return OptimizationResult(
        model_version=model_version,
        site_ids=site_ids,
        allocation=allocation,
        success=bool(res.success),
        status=int(res.status),
        message=str(res.message),
        lp_objective=j_lp,
        is_unique_within_tolerance=is_unique_within_tolerance,
        coordinate_bounds=coordinate_bounds,
        cooptimality_tolerance=tol_face,
    )


def _build_inequality_constraints(
    n_x: int, n_realizations: int, n_sites: int, n_months: int, D: float
) -> tuple[sparse.csr_matrix, npt.NDArray[np.float64]]:
    """Sparse ``A_ub``/``b_ub`` for the two remaining inequality families
    (module docstring): ``y_{i,t,s} - x_i <= 0`` and
    ``-sum_i y_{i,t,s} - z_{t,s} <= -D``, plus the single feasibility row
    ``-sum_i x_i <= -D`` (model spec). ``y``'s upper bound against
    ``A_i(t,s)`` is a variable bound, not a row here (see
    :func:`optimize_allocation`).

    Variable layout (must match ``optimize_allocation``'s flattening):
    ``[x (n_x), y (n_realizations x n_sites x n_months, row-major s,i,t),
    z (n_realizations x n_months, row-major s,t)]``.
    """
    n_y = n_realizations * n_sites * n_months
    n_rows_z = n_realizations * n_months

    # --- (1) y_{s,i,t} - x_i <= 0, one row per y variable -----------------
    s_idx, i_idx, _t_idx = np.unravel_index(
        np.arange(n_y), (n_realizations, n_sites, n_months)
    )
    row1 = np.concatenate([np.arange(n_y), np.arange(n_y)])
    col1 = np.concatenate([n_x + np.arange(n_y), i_idx])
    data1 = np.concatenate([np.ones(n_y), -np.ones(n_y)])
    b1 = np.zeros(n_y)

    # --- (2) -sum_i y_{s,i,t} - z_{s,t} <= -D, one row per (s,t) ----------
    s2, t2 = np.unravel_index(np.arange(n_rows_z), (n_realizations, n_months))
    s2_rep = np.repeat(s2, n_sites)
    t2_rep = np.repeat(t2, n_sites)
    i2_rep = np.tile(np.arange(n_sites), n_rows_z)
    col2_y = n_x + s2_rep * (n_sites * n_months) + i2_rep * n_months + t2_rep
    row2_y = np.repeat(np.arange(n_rows_z), n_sites)
    data2_y = -np.ones(n_rows_z * n_sites)

    row2_z = np.arange(n_rows_z)
    col2_z = n_x + n_y + np.arange(n_rows_z)
    data2_z = -np.ones(n_rows_z)

    row2 = np.concatenate([row2_y, row2_z]) + n_y  # offset past block (1)'s rows
    col2 = np.concatenate([col2_y, col2_z])
    data2 = np.concatenate([data2_y, data2_z])
    b2 = np.full(n_rows_z, -D)

    # --- (3) -sum_i x_i <= -D, one row -------------------------------------
    row3 = np.full(n_x, n_y + n_rows_z)
    col3 = np.arange(n_x)
    data3 = -np.ones(n_x)
    b3 = np.array([-D])

    n_vars = n_x + n_y + n_rows_z
    n_rows_total = n_y + n_rows_z + 1
    rows = np.concatenate([row1, row2, row3])
    cols = np.concatenate([col1, col2, col3])
    data = np.concatenate([data1, data2, data3])
    A_ub = sparse.csr_matrix((data, (rows, cols)), shape=(n_rows_total, n_vars))
    b_ub = np.concatenate([b1, b2, b3])
    return A_ub, b_ub


def _probe_optimal_face(
    obj: npt.NDArray[np.float64],
    A_ub: sparse.csr_matrix,
    b_ub: npt.NDArray[np.float64],
    bounds: list[tuple[float, float]],
    j_lp: float,
    n_x: int,
    site_ids: tuple[str, ...],
    K: npt.NDArray[np.float64],
) -> tuple[dict[str, tuple[float, float]], bool, float]:
    """Per-coordinate marginal range of each ``x_i`` over every LP solution
    within :func:`_cooptimality_tolerance` of ``j_lp`` (module docstring,
    "Non-uniqueness"). Returns ``(coordinate_bounds,
    is_unique_within_tolerance, tol_face)``.

    ``is_unique_within_tolerance`` uses
    :data:`_COORDINATE_WIDTH_RELATIVE_TOLERANCE` -- each site's own
    capacity ``K_i``, not an absolute MW constant -- to decide whether a
    range is "actually nonzero" versus ordinary solver floating-point
    noise (see that constant's docstring for why an absolute MW tolerance
    is systematically wrong here, AND for why this is fundamentally a
    numerical-tolerance decision, not a mathematical uniqueness
    certificate). This is deliberately a *different* tolerance from
    ``tol_face`` (``J`` units, used only to define the co-optimal
    constraint row's right-hand side) -- the two are not interchangeable
    units.
    """
    tol_face = _cooptimality_tolerance(j_lp)
    A_face = sparse.vstack([A_ub, sparse.csr_matrix(obj.reshape(1, -1))], format="csr")
    b_face = np.concatenate([b_ub, [j_lp + tol_face]])

    coordinate_bounds: dict[str, tuple[float, float]] = {}
    is_unique_within_tolerance = True
    for i, sid in enumerate(site_ids):
        probe_obj = np.zeros_like(obj)
        probe_obj[i] = 1.0
        lo_res = linprog(probe_obj, A_ub=A_face, b_ub=b_face, bounds=bounds, method="highs")
        hi_res = linprog(-probe_obj, A_ub=A_face, b_ub=b_face, bounds=bounds, method="highs")
        if not (lo_res.success and hi_res.success):
            raise RuntimeError(
                f"non-uniqueness probe LP failed for site {sid!r} "
                f"(lo status={lo_res.status}, hi status={hi_res.status}) -- this "
                "indicates a numerical/solver problem, not a modeled outcome."
            )
        lo = float(np.clip(lo_res.x[i], 0.0, K[i]))
        hi = float(np.clip(hi_res.x[i], 0.0, K[i]))
        coordinate_bounds[sid] = (lo, hi)
        if (hi - lo) > _COORDINATE_WIDTH_RELATIVE_TOLERANCE * K[i]:
            is_unique_within_tolerance = False

    return coordinate_bounds, is_unique_within_tolerance, tol_face
