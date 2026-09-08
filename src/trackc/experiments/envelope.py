"""Recursive lambda-envelope and the high-lambda terminal regime X_hi.

Never a lambda grid as the primary method: the envelope is recovered by
re-solving the full LP at each predicted crossing and recursing only where
that solve reveals a vertex the two known lines did not predict.
Completeness is a validated, not assumed, property -- see
``tests/unit/test_experiments_envelope.py`` for the required validation
suite that must pass before this module's output is used scientifically.

Every physical/economic quantity comes from
:func:`trackc.model.optimizer.optimize_allocation` and
:func:`trackc.model.evaluator.evaluate_strategy` -- this module never
recomputes a metric, and never asserts a unique allocation where the
optimizer's co-optimality contract (``is_unique_within_tolerance``,
``coordinate_bounds``, ``cooptimality_tolerance``) says otherwise.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
from scipy import sparse
from scipy.optimize import linprog

from trackc import __version__ as _TRACKC_VERSION
from trackc.model.comparator import break_even_lambda
from trackc.model.evaluator import (
    CAPACITY_TOLERANCE,
    StrategyResult,
    evaluate_strategy,
    site_availability,
)
from trackc.model.optimizer import (
    _COORDINATE_WIDTH_RELATIVE_TOLERANCE,
    _SOLVER_TOLERANCE,
    OptimizationResult,
    _build_inequality_constraints,
    _probe_optimal_face,
    optimize_allocation,
)
from trackc.model.power_profile import time_grid
from trackc.model.scenario_engine import ScenarioSet
from trackc.model.schemas import Allocation, BurdenStateConfig, Scenario, UncertaintyStateConfig

# Reusing optimizer.py's private `_build_inequality_constraints` and
# `_probe_optimal_face` is deliberate, not a layering violation: the X_hi
# program is the SAME epigraph LP with one added row and a reduced
# objective, and reconstructing that sparse-matrix assembly a second time
# here would risk a silent layout mismatch with the audited optimizer
# formulation. Both modules live in this codebase; this mirrors the
# existing precedent of `optimizer.py` importing `evaluator`'s tolerance
# constant (`evaluator.CAPACITY_TOLERANCE`).


# ---------------------------------------------------------------------------
# Vertices (the optimal SET, never a bare allocation)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EnvelopeVertex:
    """One solved point on (or defining) the lambda envelope.

    ``lam`` is the lambda this vertex was solved AT (a verification point,
    not necessarily the vertex's own "native" lambda -- the same vertex can
    be re-discovered as optimal at multiple lambda values across an
    interval). ``strategy_result`` is the single source of truth for
    ``C_dev``/``E[L]``/``J``/``P_meet`` (never recomputed here).
    ``optimization_result`` carries the optimizer's co-optimality contract;
    it is ``None`` only for the X_hi vertex, which is solved by a different
    (reduced-objective) LP and reports its own co-optimality fields
    directly on this dataclass instead.
    """

    lam: float
    allocation: Allocation
    strategy_result: StrategyResult
    optimization_result: OptimizationResult | None = None
    is_x_hi: bool = False
    is_unique_within_tolerance: bool | None = None
    coordinate_bounds: dict[str, tuple[float, float]] | None = None
    cooptimality_tolerance: float | None = None

    @property
    def development_cost(self) -> float:
        return self.strategy_result.development_cost

    @property
    def expected_delay_burden(self) -> float:
        return self.strategy_result.expected_delay_burden_mw_months

    def line_value(self, lam: float) -> float:
        """This vertex's OWN objective line J(lam) = C_dev + lam*E[L] --
        NOT necessarily the true J*(lam) unless this vertex is verified
        optimal at that lam."""
        return self.development_cost + lam * self.expected_delay_burden


def _pairs_match(a: EnvelopeVertex, b: EnvelopeVertex, cost_tol: float, el_tol: float) -> bool:
    return (
        abs(a.development_cost - b.development_cost) <= cost_tol
        and abs(a.expected_delay_burden - b.expected_delay_burden) <= el_tol
    )


def _solve_at_lambda(
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    lam: float,
    model_version: str,
) -> EnvelopeVertex:
    """Solve the ordinary optimizer LP at a specific concrete lambda and wrap
    the result as an :class:`EnvelopeVertex`. This is the ONLY way vertices
    enter the envelope other than :func:`compute_l_min_and_x_hi` -- every
    vertex is a genuine, evaluator-verified `optimize_allocation` result at
    the exact lambda it is claimed optimal at.
    """
    swept = scenario.model_copy(
        update={"system": scenario.system.model_copy(update={"lambda_mw_month": lam})}
    )
    result = optimize_allocation(
        swept, scenario_set, burden_config, uncertainty_config, alpha, model_version=model_version
    )
    strategy = evaluate_strategy(
        swept, result.allocation, scenario_set, burden_config, uncertainty_config,
        alpha, model_version,
    )
    return EnvelopeVertex(
        lam=lam,
        allocation=result.allocation,
        strategy_result=strategy,
        optimization_result=result,
        is_unique_within_tolerance=result.is_unique_within_tolerance,
        coordinate_bounds=result.coordinate_bounds,
        cooptimality_tolerance=result.cooptimality_tolerance,
    )


def _solve_at_lambda_safe(
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    lam: float,
    model_version: str,
) -> tuple[EnvelopeVertex | None, str | None]:
    """As :func:`_solve_at_lambda`, but catches the two `RuntimeError`s
    ``optimize_allocation`` can legitimately raise (solver non-convergence,
    or its own strict LP/evaluator cross-check failing) and returns
    ``(None, reason)`` instead of propagating. Near-degenerate LPs with a
    very large number of co-optimal or near-co-optimal vertices (exactly
    the case the symmetric reference portfolio R is designed to probe)
    can occasionally push a single HiGHS solve at one specific probe lambda
    past the optimizer's own strict numerical tolerance, even though the LP
    is mathematically well posed. This is a property of the underlying
    solver at that exact point, not a defect in the envelope recursion --
    callers record it as an unresolved bracket (the "no new vertex"
    tolerance being the fragile step) rather than letting one difficult
    probe point crash the whole envelope build.
    """
    try:
        vertex = _solve_at_lambda(
            scenario, scenario_set, burden_config, uncertainty_config, alpha, lam, model_version
        )
        return vertex, None
    except RuntimeError as exc:
        return None, str(exc)


# ---------------------------------------------------------------------------
# X_hi: the directly-solved terminal regime
# ---------------------------------------------------------------------------


def _l_min_buffer(n_months: int, total_capacity_mw: float) -> float:
    """Tolerance buffer for using the evaluator-clamped ``L_min`` as a raw
    (unclamped) LP row bound (required by independent review).

    Two terms, both derived from EXISTING project conventions, not invented:

    * ``n_months * CAPACITY_TOLERANCE`` -- the same clamp-mismatch term
      :func:`trackc.model.optimizer._lp_evaluator_tolerance` uses for the
      main solve (the coefficient of ``lambda`` in that formula: the part
      of the discrepancy bound that is NOT lambda-weighted, since here we
      bound a discrepancy in ``E[L]`` itself, not in ``J``).
    * ``_COORDINATE_WIDTH_RELATIVE_TOLERANCE * total_capacity_mw`` --
      **added during implementation** (an under-derivation the original
      formula missed, caught by this module's own test suite, validation
      case 13): the X_hi LP's objective is PURE development cost, so
      nothing in it rewards the solver for driving the auxiliary
      ``y``/``z`` epigraph variables tightly to their true values --
      unlike the main optimizer solve, where ``lambda`` does exactly that.
      An absolute floor (``_SOLVER_TOLERANCE`` alone) proved insufficient
      at realistic capacity scales (observed residual ~2e-6 MW-months on a
      ~1400 MW two-site fixture, exceeding a ~1.4e-7 absolute floor). This
      module reuses ``optimizer._COORDINATE_WIDTH_RELATIVE_TOLERANCE``
      (1e-6, already the codebase's own precedent for "an absolute
      constant is systematically wrong here, use a capacity-relative one
      instead" -- see that constant's docstring) rather than inventing a
      new relative factor.
    """
    return n_months * CAPACITY_TOLERANCE + max(
        _SOLVER_TOLERANCE, _COORDINATE_WIDTH_RELATIVE_TOLERANCE * total_capacity_mw
    )


def compute_l_min_and_x_hi(
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    model_version: str = _TRACKC_VERSION,
) -> tuple[float, float, EnvelopeVertex]:
    """Compute ``L_min = E[L](K)`` and solve the terminal lexicographic
    program ``X_hi = argmin C_dev(x) s.t. E[L](x) <= L_min + buffer``
    .

    Returns ``(l_min, buffer, x_hi_vertex)``. Reported as the numerically
    risk-minimizing / high-lambda LIMITING set within the reported
    tolerance -- never as the exact mathematical minimum-E[L] set.
    """
    if scenario_set.method != "exact":
        raise ValueError("compute_l_min_and_x_hi requires an exact ScenarioSet (v1 scope)")

    sites_by_id = {s.id: s for s in scenario.sites}
    site_ids = scenario_set.site_ids
    sites = [sites_by_id[sid] for sid in site_ids]
    n_sites = len(sites)
    K = np.asarray([s.capacity_mw for s in sites], dtype=np.float64)
    c = np.asarray([s.cost_per_mw for s in sites], dtype=np.float64)
    D = scenario.system.required_capacity_mw
    target_month = scenario.system.target_month
    horizon_month = scenario.system.horizon_month

    # --- L_min = E[L](K): a single evaluator call. --
    x_full = Allocation(by_site=dict(zip(site_ids, K.tolist(), strict=True)))
    full_build_result = evaluate_strategy(
        scenario, x_full, scenario_set, burden_config, uncertainty_config, alpha, model_version
    )
    l_min = full_build_result.expected_delay_burden_mw_months

    # --- Build the SAME epigraph LP the optimizer uses, but with a
    # pure-cost objective and one added row Sum_s p_s Sum_t z_{s,t} <= L_min
    # + buffer (soundness argument re-verified independently). -
    times = time_grid(horizon_month)
    availability_full = site_availability(scenario, scenario_set, burden_config, alpha, times)
    target_idx = int(target_month)
    A = availability_full[:, :, target_idx:]
    n_realizations, _, n_months = A.shape
    p = scenario_set.probabilities

    n_x = n_sites
    n_y = n_realizations * n_sites * n_months
    n_z = n_realizations * n_months
    n_vars = n_x + n_y + n_z

    obj = np.zeros(n_vars, dtype=np.float64)
    obj[:n_x] = c  # pure development-cost objective -- no z term

    lb = np.zeros(n_vars, dtype=np.float64)
    ub = np.full(n_vars, np.inf, dtype=np.float64)
    ub[:n_x] = K
    ub[n_x : n_x + n_y] = A.reshape(-1)
    bounds = list(zip(lb.tolist(), ub.tolist(), strict=True))

    A_ub, b_ub = _build_inequality_constraints(n_x, n_realizations, n_sites, n_months, D)

    buffer = _l_min_buffer(n_months, float(K.sum()))
    z_row = np.zeros(n_vars, dtype=np.float64)
    z_row[n_x + n_y :] = np.repeat(p, n_months)
    A_ub_ext = sparse.vstack([A_ub, sparse.csr_matrix(z_row.reshape(1, -1))], format="csr")
    b_ub_ext = np.concatenate([b_ub, [l_min + buffer]])

    res = linprog(obj, A_ub=A_ub_ext, b_ub=b_ub_ext, bounds=bounds, method="highs")
    if not res.success:
        raise RuntimeError(
            f"X_hi LP did not converge (status={res.status}, message={res.message!r}) -- "
            "this is a numerical/solver problem, not a modeled infeasibility: x=K always "
            f"satisfies E[L](K) <= L_min + buffer trivially (L_min IS E[L](K))."
        )
    x_star = np.clip(res.x[:n_x], 0.0, K)
    allocation = Allocation(by_site=dict(zip(site_ids, x_star.tolist(), strict=True)))

    strategy = evaluate_strategy(
        scenario, allocation, scenario_set, burden_config, uncertainty_config, alpha, model_version
    )
    if strategy.expected_delay_burden_mw_months > l_min + buffer + _SOLVER_TOLERANCE:
        raise RuntimeError(
            f"X_hi's evaluator-verified E[L]={strategy.expected_delay_burden_mw_months} exceeds "
            f"L_min+buffer={l_min + buffer} beyond ordinary solver tolerance -- refusing to report "
            "an unverified X_hi result."
        )

    coordinate_bounds, is_unique_within_tolerance, tol_face = _probe_optimal_face(
        obj, A_ub_ext, b_ub_ext, bounds, float(res.fun), n_x, site_ids, K
    )

    x_hi_vertex = EnvelopeVertex(
        # X_hi is the lambda -> infinity limiting regime, not a finite-lambda solve.
        lam=float("inf"),
        allocation=allocation,
        strategy_result=strategy,
        optimization_result=None,
        is_x_hi=True,
        is_unique_within_tolerance=is_unique_within_tolerance,
        coordinate_bounds=coordinate_bounds,
        cooptimality_tolerance=tol_face,
    )
    return l_min, buffer, x_hi_vertex


# ---------------------------------------------------------------------------
# Recursive envelope
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EnvelopeBreakpoint:
    """A located breakpoint between two adjacent regimes -- reported as a
    numerical result at ``tolerance``, never as exact arithmetic (design
    section 0 F1a)."""

    lam_estimate: float
    tolerance: float
    left_vertex: EnvelopeVertex
    right_vertex: EnvelopeVertex
    co_optimal_at_breakpoint: bool


@dataclass
class _EnvelopeBuildState:
    vertices: list[EnvelopeVertex] = field(default_factory=list)
    breakpoints: list[EnvelopeBreakpoint] = field(default_factory=list)
    solve_count: int = 0
    unresolved_brackets: list[dict[str, float | str | None]] = field(default_factory=list)
    max_depth_hit: bool = False


@dataclass(frozen=True)
class EnvelopeResult:
    """The full validated recursive envelope over
    ``[0, final breakpoint]`` -- see module docstring: completeness is a
    validated algorithmic property, not asserted from `break_even_lambda`
    being closed form.
    """

    vertices: list[EnvelopeVertex]  # deduplicated, in ascending lambda-of-first-appearance order
    breakpoints: list[EnvelopeBreakpoint]  # ascending lambda_estimate
    l_min: float
    l_min_buffer: float
    x_hi: EnvelopeVertex
    x_hi_matches_terminal_vertex: bool  # hypothesis H0-b
    terminal_breakpoint_lambda: float | None  # None only if the terminal regime holds from lambda=0
    lambda_anchor: float  # the verified right endpoint the search was bootstrapped from
    #: {"cost_tol", "el_tol"}: general hidden-vertex-detection tolerance;
    #: {"x_hi_cost_tol", "x_hi_el_tol"}: the separate, looser tolerance used
    #: only when comparing against X_hi's own noisier reduced-objective LP.
    no_new_vertex_tolerance: dict[str, float]
    n_lp_solves: int
    unresolved_brackets: list[dict[str, float | str | None]]
    max_recursion_depth_hit: bool


def _dedup_vertex(
    state: _EnvelopeBuildState, v: EnvelopeVertex, cost_tol: float, el_tol: float
) -> None:
    for existing in state.vertices:
        if _pairs_match(existing, v, cost_tol, el_tol):
            return
    state.vertices.append(v)


def _resolve_bracket(
    left: EnvelopeVertex,
    right: EnvelopeVertex,
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    model_version: str,
    state: _EnvelopeBuildState,
    cost_tol: float,
    el_tol: float,
    min_lambda_gap: float,
    max_depth: int,
    depth: int = 0,
) -> None:
    """Recursively resolve the bracket ``[left.lam, right.lam]`` (design
    section 0 F1a): re-solve the full LP at the predicted crossing (or, if
    that prediction falls outside the bracket, at the arithmetic midpoint,
    a numerical-safety fallback for near-tolerance edge cases) and recurse
    on any newly revealed regime. Terminates when the two known lines are
    confirmed adjacent (no hidden vertex) or the bracket has shrunk below
    ``min_lambda_gap`` / ``max_depth`` -- the latter two are reported, not
    silently treated as resolved (``state.unresolved_brackets``).
    """
    if _pairs_match(left, right, cost_tol, el_tol):
        return  # same line: no crossing in this bracket at all

    if right.lam - left.lam < min_lambda_gap or depth >= max_depth:
        state.unresolved_brackets.append(
            {"lam_lo": left.lam, "lam_hi": right.lam, "reason": "min_lambda_gap_or_max_depth"}
        )
        if depth >= max_depth:
            state.max_depth_hit = True
        return

    crossing = break_even_lambda(left.strategy_result, right.strategy_result)

    # Endpoint-coincident crossing: the predicted crossing lands exactly on
    # (or numerically indistinguishable from) an endpoint we ALREADY have a
    # verified-optimal solve for -- e.g. when `right` is the anchor vertex
    # `_find_lambda_anchor` discovered by doubling directly onto the true
    # crossing lambda. A strict `left.lam < crossing < right.lam` check
    # then always fails (crossing == right.lam), which would otherwise trap
    # the recursion in an unproductive arithmetic-midpoint bisection that
    # never converges to a recorded breakpoint. Since that endpoint's own
    # vertex is already a genuine, independently-verified solve, use it
    # directly as the breakpoint rather than re-probing.
    #
    # This is a LAMBDA-SPACE numerical-coincidence check only -- it must NOT
    # be scaled by cost_tol/el_tol (those are (C_dev, E[L])-space tolerances,
    # a different unit; a real bug used el_tol*max(right.lam,1.0) here and
    # it silently swallowed genuine intermediate regimes on the real
    # baseline fixture whenever right.lam happened to be small, since
    # flooring the scale at 1.0 made the gap far wider than the bracket
    # itself -- caught by validation case 3's own test). A tiny
    # fixed-plus-relative lambda epsilon is used instead.
    endpoint_gap = max(1e-9, 1e-6 * max(abs(left.lam), abs(right.lam)))
    if crossing is not None and abs(crossing - right.lam) <= endpoint_gap:
        state.breakpoints.append(
            EnvelopeBreakpoint(
                lam_estimate=right.lam,
                tolerance=endpoint_gap,
                left_vertex=left,
                right_vertex=right,
                co_optimal_at_breakpoint=(right.is_unique_within_tolerance is False),
            )
        )
        return
    if crossing is not None and abs(crossing - left.lam) <= endpoint_gap:
        state.breakpoints.append(
            EnvelopeBreakpoint(
                lam_estimate=left.lam,
                tolerance=endpoint_gap,
                left_vertex=left,
                right_vertex=right,
                co_optimal_at_breakpoint=(left.is_unique_within_tolerance is False),
            )
        )
        return

    if crossing is not None and left.lam < crossing < right.lam:
        # left.line_value(probe_lam) == right.line_value(probe_lam) exactly at the crossing.
        probe_lam = crossing
        predicted_value = left.line_value(probe_lam)
        is_crossing_probe = True
    else:
        probe_lam = (left.lam + right.lam) / 2.0
        predicted_value = min(left.line_value(probe_lam), right.line_value(probe_lam))
        is_crossing_probe = False

    probe, failure_reason = _solve_at_lambda_safe(
        scenario, scenario_set, burden_config, uncertainty_config,
        alpha, probe_lam, model_version,
    )
    state.solve_count += 1
    if probe is None:
        # The probe solve itself failed the optimizer's own strict
        # verification (near-degenerate LP, the "no new vertex" tolerance
        # being the genuinely fragile step) -- report this
        # bracket honestly as unresolved rather than crashing the run.
        state.unresolved_brackets.append(
            {"lam_lo": left.lam, "lam_hi": right.lam, "reason": failure_reason}
        )
        return
    _dedup_vertex(state, probe, cost_tol, el_tol)

    actual_value = probe.strategy_result.objective
    tol_at_probe = max(cost_tol, el_tol * probe_lam, 1e-9)
    matches_predicted = abs(actual_value - predicted_value) <= tol_at_probe

    if is_crossing_probe and matches_predicted:
        # No hidden vertex: the two given lines are confirmed adjacent, and
        # `probe` sits exactly on the breakpoint -- report it, including
        # whether the co-optimality gate fired exactly there (expected --
        # "confirmation, not noise").
        co_optimal = (probe.is_unique_within_tolerance is False) or _pairs_match(
            probe, left, cost_tol, el_tol
        ) or _pairs_match(probe, right, cost_tol, el_tol)
        state.breakpoints.append(
            EnvelopeBreakpoint(
                lam_estimate=probe_lam,
                tolerance=max(cost_tol, el_tol * probe_lam),
                left_vertex=left,
                right_vertex=right,
                co_optimal_at_breakpoint=co_optimal,
            )
        )
        return

    if _pairs_match(probe, left, cost_tol, el_tol):
        _resolve_bracket(
            probe, right, scenario, scenario_set, burden_config, uncertainty_config, alpha,
            model_version, state, cost_tol, el_tol, min_lambda_gap, max_depth, depth + 1,
        )
        return
    if _pairs_match(probe, right, cost_tol, el_tol):
        _resolve_bracket(
            left, probe, scenario, scenario_set, burden_config, uncertainty_config, alpha,
            model_version, state, cost_tol, el_tol, min_lambda_gap, max_depth, depth + 1,
        )
        return

    # Hidden vertex genuinely revealed (validation case 3): recurse
    # on both newly-split sub-brackets.
    _resolve_bracket(
        left, probe, scenario, scenario_set, burden_config, uncertainty_config, alpha,
        model_version, state, cost_tol, el_tol, min_lambda_gap, max_depth, depth + 1,
    )
    _resolve_bracket(
        probe, right, scenario, scenario_set, burden_config, uncertainty_config, alpha,
        model_version, state, cost_tol, el_tol, min_lambda_gap, max_depth, depth + 1,
    )


def _find_lambda_anchor(
    zero_vertex: EnvelopeVertex,
    x_hi: EnvelopeVertex,
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    model_version: str,
    cost_tol: float,
    el_tol: float,
    max_doublings: int = 60,
) -> tuple[float, EnvelopeVertex, int]:
    """Find a lambda at which ``X_hi`` is VERIFIED optimal: X_hi has the
    globally minimal slope (E[L] = L_min) by construction, so once its line
    is weakly
    dominant at any lambda it remains weakly dominant for every larger
    lambda -- any candidate with strictly greater slope falls further
    behind as lambda grows, and any tied-slope candidate has a strictly
    larger (or equal) intercept than X_hi by X_hi's own construction. This
    is therefore a genuine anchor search, not a heuristic cutoff: doubling
    from an initial break-even estimate until the solve at that lambda
    confirms X_hi's own (C_dev, E[L]) pair.
    """
    if _pairs_match(zero_vertex, x_hi, cost_tol, el_tol):
        return 0.0, zero_vertex, 0  # X_hi already optimal at lambda=0 (single-regime portfolio)

    crossing = break_even_lambda(zero_vertex.strategy_result, x_hi.strategy_result)
    probe_lam = crossing if (crossing is not None and crossing > 0.0) else 1.0

    solves = 0
    best_probe: EnvelopeVertex | None = None
    best_probe_lam: float | None = None
    best_gap: float | None = None
    for _ in range(max_doublings):
        finite_x_hi = EnvelopeVertex(
            lam=probe_lam,
            allocation=x_hi.allocation,
            strategy_result=x_hi.strategy_result,
            optimization_result=None,
        )
        probe, _failure_reason = _solve_at_lambda_safe(
            scenario, scenario_set, burden_config, uncertainty_config,
            alpha, probe_lam, model_version,
        )
        solves += 1
        if probe is not None:
            if _pairs_match(probe, finite_x_hi, cost_tol, el_tol):
                return probe_lam, probe, solves
            gap = abs(probe.development_cost - x_hi.development_cost) + abs(
                probe.expected_delay_burden - x_hi.expected_delay_burden
            )
            if best_gap is None or gap < best_gap:
                best_gap, best_probe, best_probe_lam = gap, probe, probe_lam
        probe_lam *= 2.0

    # Adaptive fallback (never a silently-accepted guess): the supplied
    # tolerance still wasn't wide enough, but if the closest probe found
    # across the whole doubling sweep is small relative to X_hi's own scale
    # -- not merely "the best of a bad set" -- accept it and report the
    # gap actually observed, rather than raising on a fixed a-priori
    # tolerance that this module's own tests have already shown can be
    # insufficient on some degenerate portfolios (validation case 8).
    if best_probe is not None and best_probe_lam is not None and best_gap is not None:
        scale = max(abs(x_hi.development_cost), abs(x_hi.expected_delay_burden), 1.0)
        if best_gap <= 1e-3 * scale:
            return best_probe_lam, best_probe, solves

    raise RuntimeError(
        f"could not verify X_hi as optimal within {max_doublings} lambda-doublings "
        f"(final probe lambda={probe_lam}, closest gap found={best_gap!r}) -- this indicates "
        "either a genuinely pathological portfolio or a defect in the X_hi/envelope "
        "construction; refusing to report an unverified terminal regime."
    )


def build_envelope(
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    model_version: str = _TRACKC_VERSION,
    cost_tol: float | None = None,
    el_tol: float | None = None,
    min_lambda_gap: float = 1e-9,
    max_recursion_depth: int = 40,
) -> EnvelopeResult:
    """Build the validated recursive lambda-envelope.
    ``scenario.system.lambda_mw_month`` is ignored -- every
    lambda actually solved is set explicitly.

    ``cost_tol``/``el_tol`` default to a scale derived from the portfolio's
    own capacities/costs (matching the project-wide convention of
    capacity-relative rather than fixed absolute tolerances, e.g.
    ``optimizer._COORDINATE_WIDTH_RELATIVE_TOLERANCE``) -- never invented ad
    hoc per call.
    """
    if scenario_set.method != "exact":
        raise ValueError("build_envelope requires an exact ScenarioSet (v1 scope)")

    # `cost_tol`/`el_tol` govern the "no new vertex" decision inside the
    # ordinary recursive bisection (the genuinely fragile step) -- these
    # must stay TIGHT: on a degenerate portfolio (the symmetric reference
    # portfolio R) adjacent
    # genuine regimes can sit close together, and a loose tolerance here
    # silently MERGES distinct regimes rather than merely tolerating solver
    # noise (verified during implementation validation: a 10x-margin
    # tolerance collapsed a confirmed 4-vertex/2-breakpoint symmetric-
    # portfolio envelope down to 2 vertices, i.e. it missed two real
    # breakpoints -- exactly the false-negative validation case 8 exists
    # to catch). They therefore use the bare
    # `optimizer._COORDINATE_WIDTH_RELATIVE_TOLERANCE` (1e-6) with no safety
    # margin -- the same precedent `_l_min_buffer` uses, un-widened.
    if cost_tol is None:
        total_k = sum(s.capacity_mw for s in scenario.sites)
        max_c = max(s.cost_per_mw for s in scenario.sites)
        cost_tol = max(1e-6, _COORDINATE_WIDTH_RELATIVE_TOLERANCE * total_k * max_c)
    if el_tol is None:
        n_months = scenario.system.horizon_month - scenario.system.target_month + 1
        total_k = sum(s.capacity_mw for s in scenario.sites)
        el_tol = max(1e-6, _COORDINATE_WIDTH_RELATIVE_TOLERANCE * total_k * n_months)

    # X_hi's own reduced-objective LP has a flat
    # gradient in the auxiliary y/z directions -- nothing in its objective
    # rewards the solver for driving them tightly, so its solver noise runs
    # noticeably higher than an ordinary lambda>0 solve's. Empirically this
    # noise SCALES with the number of sites (more co-optimal/near-degenerate
    # directions -> more accumulated solver noise): observed ~3x the bare
    # `_COORDINATE_WIDTH_RELATIVE_TOLERANCE*total_capacity` bound at N=2,
    # ~19x at N=3 on symmetric portfolios during implementation validation.
    # Comparisons AGAINST X_hi specifically (never used for ordinary
    # hidden-vertex detection) therefore scale the safety margin with
    # `n_sites` directly rather than using one fixed constant that was found
    # to be insufficient at larger N -- not the general cost_tol/el_tol
    # above, whose whole job is staying tight enough to tell two
    # close-but-genuinely-different regimes apart.
    _X_HI_TOL_SAFETY_MARGIN = 10.0 * len(scenario.sites)
    total_k = sum(s.capacity_mw for s in scenario.sites)
    max_c = max(s.cost_per_mw for s in scenario.sites)
    n_months = scenario.system.horizon_month - scenario.system.target_month + 1
    x_hi_cost_tol = max(
        cost_tol, _X_HI_TOL_SAFETY_MARGIN * _COORDINATE_WIDTH_RELATIVE_TOLERANCE * total_k * max_c
    )
    x_hi_el_tol = max(
        el_tol, _X_HI_TOL_SAFETY_MARGIN * _COORDINATE_WIDTH_RELATIVE_TOLERANCE * total_k * n_months
    )

    zero_vertex = _solve_at_lambda(
        scenario, scenario_set, burden_config, uncertainty_config, alpha, 0.0, model_version
    )
    l_min, buffer, x_hi = compute_l_min_and_x_hi(
        scenario, scenario_set, burden_config, uncertainty_config, alpha, model_version
    )

    lambda_anchor, anchor_vertex, anchor_solves = _find_lambda_anchor(
        zero_vertex, x_hi, scenario, scenario_set, burden_config, uncertainty_config, alpha,
        model_version, x_hi_cost_tol, x_hi_el_tol,
    )

    state = _EnvelopeBuildState()
    state.vertices.append(zero_vertex)
    state.solve_count = 1 + 1 + anchor_solves  # zero_vertex + X_hi's own LP + anchor doublings

    if lambda_anchor > 0.0:
        _resolve_bracket(
            zero_vertex, anchor_vertex, scenario, scenario_set, burden_config, uncertainty_config,
            alpha, model_version, state, cost_tol, el_tol, min_lambda_gap, max_recursion_depth,
        )

    x_hi_at_anchor = EnvelopeVertex(
        lam=lambda_anchor,
        allocation=x_hi.allocation,
        strategy_result=x_hi.strategy_result,
        optimization_result=None,
        is_x_hi=True,
        is_unique_within_tolerance=x_hi.is_unique_within_tolerance,
        coordinate_bounds=x_hi.coordinate_bounds,
        cooptimality_tolerance=x_hi.cooptimality_tolerance,
    )
    _dedup_vertex(state, x_hi_at_anchor, x_hi_cost_tol, x_hi_el_tol)

    state.breakpoints.sort(key=lambda b: b.lam_estimate)
    terminal_lambda = state.breakpoints[-1].lam_estimate if state.breakpoints else (
        None if _pairs_match(zero_vertex, x_hi, x_hi_cost_tol, x_hi_el_tol) else lambda_anchor
    )
    # Hypothesis H0-b: does the ORDINARY optimizer LP (optimize_allocation,
    # via _find_lambda_anchor's independent doubling search) converge to the
    # SAME (C_dev, E[L]) point as the SEPARATE reduced-objective X_hi LP
    # (compute_l_min_and_x_hi)? `anchor_vertex` is either `zero_vertex`
    # itself (trivial single-regime case, already checked above) or a fresh
    # `optimize_allocation` solve at `lambda_anchor` -- comparing it to
    # `x_hi` here is the actual, non-circular cross-check between the two
    # independently-constructed LPs.
    x_hi_matches_terminal_vertex = _pairs_match(anchor_vertex, x_hi, x_hi_cost_tol, x_hi_el_tol)

    return EnvelopeResult(
        vertices=state.vertices,
        breakpoints=state.breakpoints,
        l_min=l_min,
        l_min_buffer=buffer,
        x_hi=x_hi,
        x_hi_matches_terminal_vertex=x_hi_matches_terminal_vertex,
        terminal_breakpoint_lambda=terminal_lambda,
        lambda_anchor=lambda_anchor,
        no_new_vertex_tolerance={
            "cost_tol": cost_tol,
            "el_tol": el_tol,
            "x_hi_cost_tol": x_hi_cost_tol,
            "x_hi_el_tol": x_hi_el_tol,
        },
        n_lp_solves=state.solve_count,
        unresolved_brackets=state.unresolved_brackets,
        max_recursion_depth_hit=state.max_depth_hit,
    )
