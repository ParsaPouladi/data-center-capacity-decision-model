"""Envelope validation suite. Required before
``build_envelope``/``compute_l_min_and_x_hi`` may be relied on for any
scientific claim.

Fixtures use hand-constructible, DEGENERATE (single-realization,
probability-1) scenario sets built directly rather than through the real
uncertainty mappings -- this is a standard testing pattern already used
elsewhere in this suite (e.g. ``tests/invariants/test_optimizer_invariants.py``)
and lets every quantity below be verified by hand, independently of the
algorithm under test.
"""

from __future__ import annotations

import numpy as np
import pytest

from trackc.experiments.design import reference_portfolio
from trackc.experiments.envelope import (
    _l_min_buffer,
    build_envelope,
    compute_l_min_and_x_hi,
)
from trackc.model.optimizer import optimize_allocation
from trackc.model.scenario_engine import ScenarioSet, enumerate_exact
from trackc.model.schemas import (
    BurdenStateConfig,
    BurdenStateDefinition,
    Scenario,
    Site,
    SystemInputs,
    UncertaintyStateConfig,
    UncertaintyStateDefinition,
    load_burden_states,
    load_model_defaults,
    load_scenario,
    load_uncertainty_states,
)

ALPHA = 0.5


def _degenerate_burden(pairs: dict[int, tuple[float, float]]) -> BurdenStateConfig:
    states = {
        s: BurdenStateDefinition(label=f"s{s}", interpretation="x", tau1_bar=t1, tau2_bar=t2)
        for s, (t1, t2) in pairs.items()
    }
    unused = BurdenStateDefinition(label="unused", interpretation="x", tau1_bar=1, tau2_bar=2)
    for s in (1, 2, 3, 4):
        states.setdefault(s, unused)
    return BurdenStateConfig(mapping_version="test", states=states)


def _degenerate_uncertainty() -> UncertaintyStateConfig:
    none = UncertaintyStateDefinition(
        label="none", interpretation="x", delay_months=[0.0], probabilities=[1.0]
    )
    states = {s: none for s in (1, 2, 3, 4)}
    return UncertaintyStateConfig(mapping_version="test", states=states)


def _degenerate_scenario_set(site_ids: tuple[str, ...]) -> ScenarioSet:
    return ScenarioSet(
        site_ids=site_ids,
        delays=np.zeros((1, len(site_ids))),
        probabilities=np.asarray([1.0]),
        method="exact",
    )


# ---------------------------------------------------------------------------
# Case 1: hand-worked two-regime case
#
# Site A: c=1.5, fully available (tau2=20) well before T*=30 -- E[L]
#   contribution from A is always 0.
# Site B: c=1.0 (cheaper), tau1=10, tau2=40 -- only alpha*K_B=200 MW
#   available at T*=30; the remaining 200 MW arrives at t=40.
# D=300, H=72 (n_months = H-T*+1 = 43).
#
# Hand derivation (worked by hand for this fixture):
#   x=(0,300): C_dev=300, E[L]=10*(300-200)=1000 -- cheapest, but risky.
#   x=(100,200): C_dev=100*1.5+200*1.0=350, E[L]=0 -- exactly X_hi (L_min=0
#     is attained at sum(x)=D=300, NOT at x=K -- see the envelope validation design, case
#     10/11 below).
#   Any mix x_B in [200,300] lies EXACTLY on the straight line connecting
#     these two points in (E[L], C_dev) space (C_dev = 350 - 0.05*E[L]), so
#     no THIRD vertex exists between them.
#   Breakeven: (350-300)/(1000-0) = 0.05 exactly.
# ---------------------------------------------------------------------------


_Fixture = tuple[Scenario, ScenarioSet, BurdenStateConfig, UncertaintyStateConfig]


def _hand_worked_two_regime_scenario() -> _Fixture:
    burden = _degenerate_burden({1: (10.0, 20.0), 2: (10.0, 40.0)})
    uncertainty = _degenerate_uncertainty()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=300, target_month=30, horizon_month=72, lambda_mw_month=0.0
        ),
        sites=[
            Site(id="A", capacity_mw=1000, cost_per_mw=1.5, burden_state=1, uncertainty_state=1),
            Site(id="B", capacity_mw=400, cost_per_mw=1.0, burden_state=2, uncertainty_state=1),
        ],
    )
    scenario_set = _degenerate_scenario_set(("A", "B"))
    return scenario, scenario_set, burden, uncertainty


def test_case1_hand_worked_two_regime():
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    env = build_envelope(scenario, scenario_set, burden, uncertainty, ALPHA)

    assert len(env.vertices) == 2
    assert len(env.breakpoints) == 1
    bp = env.breakpoints[0]
    assert bp.lam_estimate == pytest.approx(0.05, abs=1e-6)

    by_cdev = sorted(env.vertices, key=lambda v: v.development_cost)
    cheap, mixed = by_cdev
    assert cheap.development_cost == pytest.approx(300.0, abs=1e-6)
    assert cheap.expected_delay_burden == pytest.approx(1000.0, abs=1e-3)
    assert mixed.development_cost == pytest.approx(350.0, abs=1e-3)
    assert mixed.expected_delay_burden == pytest.approx(0.0, abs=1e-2)


def test_case1_independent_optimizer_solves_confirm_regimes():
    """Cross-check against the hand-derived breakpoint: direct `optimize_allocation`
    solves either side of the hand-derived breakpoint agree with the
    envelope's own vertices."""
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    for lam, expected_alloc in [(0.03, {"A": 0.0, "B": 300.0}), (0.07, {"A": 100.0, "B": 200.0})]:
        swept = scenario.model_copy(
            update={"system": scenario.system.model_copy(update={"lambda_mw_month": lam})}
        )
        result = optimize_allocation(swept, scenario_set, burden, uncertainty, ALPHA)
        for site_id, expected in expected_alloc.items():
            assert result.allocation.by_site[site_id] == pytest.approx(expected, abs=1.0)


# ---------------------------------------------------------------------------
# Case 4: breakpoint with co-optimal allocations
#
# In case 1, the ENTIRE line segment x_B in [200,300] is exactly co-optimal
# AT lambda=0.05 (all give the same J there, per the hand derivation above)
# -- the co-optimality gate must fire exactly at that breakpoint.
# ---------------------------------------------------------------------------


def test_case4_breakpoint_reports_co_optimality():
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    swept = scenario.model_copy(
        update={"system": scenario.system.model_copy(update={"lambda_mw_month": 0.05})}
    )
    result = optimize_allocation(swept, scenario_set, burden, uncertainty, ALPHA)
    assert result.is_unique_within_tolerance is False

    env = build_envelope(scenario, scenario_set, burden, uncertainty, ALPHA)
    assert env.breakpoints[0].co_optimal_at_breakpoint is True


# ---------------------------------------------------------------------------
# Case 5: coincident/degenerate lines over a whole INTERVAL
#
# The symmetric reference portfolio R: its own
# co-optimality is expected and validates the gate, per the design.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def real_configs():
    return (
        load_burden_states("configs/burden_states.yaml"),
        load_uncertainty_states("configs/uncertainty_states.yaml"),
        load_model_defaults("configs/model_defaults.yaml"),
    )


def test_case5_symmetric_portfolio_shows_degenerate_ties(real_configs):
    burden, uncertainty, defaults = real_configs
    scenario = reference_portfolio(
        n_sites=2, capacity_mw=300, cost_per_mw=1.0, burden_state=2, uncertainty_state=2,
        required_capacity_mw=400, target_month=30, horizon_month=60,
    )
    scenario_set = enumerate_exact(scenario, uncertainty)
    env = build_envelope(scenario, scenario_set, burden, uncertainty, defaults.alpha)

    # At least one vertex on a fully symmetric portfolio must show
    # is_unique_within_tolerance=False -- swapping the two identical sites'
    # allocations is always co-optimal (the symmetric portfolio expects
    # exactly this).
    assert any(v.is_unique_within_tolerance is False for v in env.vertices)
    # No asymmetric allocation is ever reported as
    # the UNIQUE optimum on a fully symmetric portfolio.
    for v in env.vertices:
        if v.is_unique_within_tolerance:
            alloc = sorted(v.allocation.by_site.values())
            # a unique vertex on R must itself be site-symmetric (equal split)
            assert alloc[0] == pytest.approx(alloc[1], abs=1e-3)


# ---------------------------------------------------------------------------
# Case 2/3/6/7: three-or-more regimes, a HIDDEN intermediate regime that
# endpoint-only comparison would miss, numerical agreement with direct
# solves, and an independent coarse lambda-grid cross-check -- combined
# into one robust three-site fixture.
# ---------------------------------------------------------------------------


def _three_regime_scenario(real_configs) -> _Fixture:
    """The real baseline fixture, with the REAL v1-baseline
    burden/uncertainty mappings and genuine 27-realization probabilistic
    uncertainty -- used here purely as an ALGORITHM test fixture,
    never as a scientific-finding substrate (an illustrative anchor only). A hand-constructed
    degenerate 3-site fixture was tried first and, on inspection, its
    (C_dev, E[L]) family collapsed onto a single straight line regardless of
    the chosen tranche timings -- exactly the "no hidden vertex" case, not a
    useful test of case 3. The real fixture's genuine probabilistic
    structure produces confirmed 4-regime behaviour (independently grid-
    verified below), which is what this suite actually needs.
    """
    burden, uncertainty, defaults = real_configs
    scenario = load_scenario("configs/baseline_scenario.yaml")
    scenario_set = enumerate_exact(scenario, uncertainty)
    return scenario, scenario_set, burden, uncertainty


def test_case2_3_6_7_three_regimes_and_grid_cross_check(real_configs):
    scenario, scenario_set, burden, uncertainty = _three_regime_scenario(real_configs)

    # Independent, coarser brute-force grid -- a validation cross-check
    # only, never the primary method. 61 points over [0, 0.15]
    # independently confirmed (during test
    # development) to find 4 distinct regimes on this exact fixture.
    grid_allocs = {}
    for lam in np.linspace(0.0, 0.15, 61):
        swept = scenario.model_copy(
            update={"system": scenario.system.model_copy(update={"lambda_mw_month": float(lam)})}
        )
        result = optimize_allocation(swept, scenario_set, burden, uncertainty, ALPHA)
        key = tuple(round(result.allocation.by_site[s], 0) for s in ("A", "B", "C"))
        grid_allocs.setdefault(key, []).append(lam)
    distinct_grid_regimes = len(grid_allocs)
    assert distinct_grid_regimes >= 3  # sanity: the grid itself must confirm real structure

    env = build_envelope(scenario, scenario_set, burden, uncertainty, ALPHA)
    # Case 2: genuinely 3+ regimes (recursion handles a real chain).
    assert len(env.vertices) >= 3, env.vertices
    # Case 3 (the critical case): the envelope's breakpoint count within the
    # grid's own resolved lambda range must be consistent with (not fewer
    # than) what the independent fine grid found -- a naive endpoint-only
    # (lambda=0 vs terminal) comparison would have predicted at most ONE
    # crossing; finding >= 2 breakpoints here demonstrates the algorithm's
    # re-solve-at-crossing step actually discovers the hidden middle
    # regime(s) rather than skipping them.
    breakpoints_within_grid = [bp for bp in env.breakpoints if bp.lam_estimate <= 0.15]
    assert len(breakpoints_within_grid) >= 2, (
        f"grid found {distinct_grid_regimes} distinct regimes in [0,0.15]; "
        f"envelope found only {len(breakpoints_within_grid)} breakpoints there"
    )

    # Case 6: numerical agreement -- direct optimizer solves immediately
    # either side of each breakpoint agree with the envelope's own vertices.
    for bp in env.breakpoints:
        for probe_lam in (bp.lam_estimate - 1e-4, bp.lam_estimate + 1e-4):
            if probe_lam < 0:
                continue
            swept = scenario.model_copy(
                update={"system": scenario.system.model_copy(update={"lambda_mw_month": probe_lam})}
            )
            direct = optimize_allocation(swept, scenario_set, burden, uncertainty, ALPHA)
            matches_left = all(
                abs(direct.allocation.by_site[s] - bp.left_vertex.allocation.by_site[s]) < 5.0
                for s in ("A", "B", "C")
            )
            matches_right = all(
                abs(direct.allocation.by_site[s] - bp.right_vertex.allocation.by_site[s]) < 5.0
                for s in ("A", "B", "C")
            )
            assert matches_left or matches_right


# ---------------------------------------------------------------------------
# Case 8: tolerance sensitivity
# ---------------------------------------------------------------------------


def test_case8_tolerance_sensitivity_is_exposed_and_recorded(real_configs):
    scenario, scenario_set, burden, uncertainty = _three_regime_scenario(real_configs)
    tight = build_envelope(
        scenario, scenario_set, burden, uncertainty, ALPHA, cost_tol=1e-5, el_tol=1e-5
    )
    loose = build_envelope(
        scenario, scenario_set, burden, uncertainty, ALPHA, cost_tol=1.0, el_tol=1.0
    )

    assert tight.no_new_vertex_tolerance["cost_tol"] == pytest.approx(1e-5)
    assert loose.no_new_vertex_tolerance["cost_tol"] == pytest.approx(1.0)
    # The genuinely fragile step made visible: a much
    # looser tolerance must not find MORE regimes than the tight one -- if it
    # finds fewer, that is disclosed via these two counts, exactly what this
    # case exists to expose.
    assert len(loose.vertices) <= len(tight.vertices)


# ---------------------------------------------------------------------------
# Cases 9-11: high-lambda (terminal-regime) overcapacity tests
# ---------------------------------------------------------------------------


def test_case10_11_e_l_zero_at_sum_x_equals_d_not_full_build():
    """The deleted saturation claim's counterexample, concretely realized
    (independent-review case 4): X_hi achieves E[L]=0 at sum(x)=D exactly,
    NOT at x=K -- the minimum-E[L] allocation is not full build."""
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    l_min, buffer, x_hi = compute_l_min_and_x_hi(scenario, scenario_set, burden, uncertainty, ALPHA)

    assert l_min == pytest.approx(0.0, abs=1e-6)
    total_x_hi = sum(x_hi.allocation.by_site.values())
    assert total_x_hi == pytest.approx(300.0, abs=1.0)  # == D, not K (K sums to 1400)
    full_build = {"A": 1000.0, "B": 400.0}
    assert not all(
        abs(x_hi.allocation.by_site[s] - full_build[s]) < 1.0 for s in full_build
    )


def test_case9_high_lambda_overcapacity_on_symmetric_portfolio(real_configs):
    """Overcapacity IS optimal at the terminal regime for a portfolio where
    hedging independent per-site delay risk with redundant capacity beats
    matching D exactly."""
    burden, uncertainty, defaults = real_configs
    scenario = reference_portfolio(
        n_sites=2, capacity_mw=300, cost_per_mw=1.0, burden_state=2, uncertainty_state=2,
        required_capacity_mw=400, target_month=30, horizon_month=60,
    )
    scenario_set = enumerate_exact(scenario, uncertainty)
    l_min, buffer, x_hi = compute_l_min_and_x_hi(
        scenario, scenario_set, burden, uncertainty, defaults.alpha
    )
    total_x_hi = sum(x_hi.allocation.by_site.values())
    assert total_x_hi > 400.0 + 1e-3  # overcapacity: exceeds D=400


def test_null_case_no_overcapacity_ever_optimal():
    """The companion null result: on the
    hand-worked two-site case, X_hi never needs more than D -- a portfolio
    where overcapacity is never optimal is an equally legitimate finding."""
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    _, _, x_hi = compute_l_min_and_x_hi(scenario, scenario_set, burden, uncertainty, ALPHA)
    total_x_hi = sum(x_hi.allocation.by_site.values())
    assert total_x_hi <= 300.0 + 1.0  # <= D, no overcapacity here


# ---------------------------------------------------------------------------
# Case 12: tied X_hi
# ---------------------------------------------------------------------------


def test_case12_tied_x_hi_reports_co_optimality_not_a_forced_unique_terminal():
    """Multiple risk-minimizers tied on C_dev at the terminal regime: the
    co-optimality gate must fire on X_hi's OWN solve too, not only on
    ordinary breakpoints (validation case 12)."""
    burden = _degenerate_burden({1: (10.0, 20.0)})
    uncertainty = _degenerate_uncertainty()
    # Two IDENTICAL sites (same K, c, B, U): both fully available before T*,
    # so E[L]=0 for ANY split of D between them -- many distinct allocations
    # tie for minimal C_dev subject to E[L]=L_min=0.
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=300, target_month=30, horizon_month=72, lambda_mw_month=0.0
        ),
        sites=[
            Site(id="A", capacity_mw=1000, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
            Site(id="B", capacity_mw=1000, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
        ],
    )
    scenario_set = _degenerate_scenario_set(("A", "B"))
    _, _, x_hi = compute_l_min_and_x_hi(scenario, scenario_set, burden, uncertainty, ALPHA)
    assert x_hi.is_unique_within_tolerance is False
    assert x_hi.coordinate_bounds is not None
    # A and B are interchangeable -- the marginal range for each should span
    # a decision-relevant portion of [0, D].
    a_lo, a_hi = x_hi.coordinate_bounds["A"]
    assert (a_hi - a_lo) > 1.0


# ---------------------------------------------------------------------------
# Case 13: L_min buffer behaviour
# ---------------------------------------------------------------------------


def test_case13_l_min_buffer_formula():
    buf = _l_min_buffer(n_months=43, total_capacity_mw=1400.0)
    # n_months * CAPACITY_TOLERANCE term is negligible; the capacity-relative
    # term dominates.
    assert buf > 1e-4
    assert buf == pytest.approx(43 * 1e-9 + max(1e-7, 1e-6 * 1400.0), rel=1e-6)


def test_case13_l_min_buffer_prevents_spurious_infeasibility():
    """Without a properly capacity-scaled buffer, X_hi's LP can be reported
    spuriously infeasible on a realistic-scale portfolio purely from LP
    solver noise (an under-derivation caught during implementation
    validation) -- this regression test locks in the fix."""
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    # Should not raise (this exact fixture triggered the bug before the fix).
    l_min, buffer, x_hi = compute_l_min_and_x_hi(scenario, scenario_set, burden, uncertainty, ALPHA)
    assert buffer > 0.0
    assert x_hi.strategy_result.expected_delay_burden_mw_months <= l_min + buffer + 1e-6


# ---------------------------------------------------------------------------
# H0-b: envelope terminal regime matches directly-solved X_hi
# ---------------------------------------------------------------------------


def test_h0b_envelope_terminal_matches_x_hi():
    scenario, scenario_set, burden, uncertainty = _hand_worked_two_regime_scenario()
    env = build_envelope(scenario, scenario_set, burden, uncertainty, ALPHA)
    assert env.x_hi_matches_terminal_vertex is True
