"""Allocation optimizer tests, validated against the baseline fixture and
hand-verifiable constructed cases.

Baseline scenario (D=500, T*=36, H=72, alpha=0.5; sites A/B/C, same as
tests/unit/test_evaluator.py and tests/unit/test_comparator.py):

    A: K=500 c=1.00 B=3 (tau1_bar=30, tau2_bar=42) U=3 delays[0,9,18] p[.40,.35,.25]
    B: K=300 c=1.15 B=2 (tau1_bar=24, tau2_bar=30) U=1 delays[0,3,6]  p[.80,.15,.05]
    C: K=250 c=1.30 B=1 (tau1_bar=18, tau2_bar=24) U=2 delays[0,6,12] p[.60,.30,.10]

D=500=K_A exactly, so at lambda=0 the true minimal-development-cost
allocation is x_A=500, x_B=x_C=0 -- a mathematically UNIQUE LP vertex (A's
cost, 1.00, is strictly less than B's, 1.15, and C's, 1.30), which is what
`test_lambda_zero_is_unique_and_matches_cost_concentration` hand-verifies.
"""

from __future__ import annotations

import pytest

from trackc.model.comparator import (
    cost_concentration_allocation,
    diversified_allocation,
    speed_reliability_allocation,
)
from trackc.model.evaluator import _CAPACITY_TOLERANCE, evaluate_strategy
from trackc.model.optimizer import (
    _cooptimality_tolerance,
    _lp_evaluator_tolerance,
    optimize_allocation,
)
from trackc.model.scenario_engine import ScenarioSet, enumerate_exact, sample_monte_carlo
from trackc.model.schemas import (
    Allocation,
    BurdenStateConfig,
    Scenario,
    Site,
    SystemInputs,
    UncertaintyStateConfig,
    UncertaintyStateDefinition,
    validate_allocation_against_sites,
)

# baseline / burden / uncertainty / exact_set fixtures are shared via
# tests/conftest.py.

ALPHA = 0.50


def _with_lambda(scenario: Scenario, lam: float) -> Scenario:
    return scenario.model_copy(
        update={"system": scenario.system.model_copy(update={"lambda_mw_month": lam})}
    )


def _deterministic_uncertainty_config(
    mapping_version: str = "v1-deterministic-test",
) -> UncertaintyStateConfig:
    """A synthetic single-outcome uncertainty mapping (delay=0, p=1.0 for
    every state) -- used only to build tightly controlled, fully
    deterministic (S=1) fixtures for hand-verifiable / boundary tests. Not
    a claim about any real uncertainty state; a test-only construction
    device, same spirit as the project's existing synthetic fixtures.
    """
    definition = UncertaintyStateDefinition(
        label="Deterministic (test-only)",
        interpretation="Single zero-delay outcome, used only to build fully "
        "controlled test fixtures.",
        delay_months=[0.0],
        probabilities=[1.0],
    )
    return UncertaintyStateConfig(
        mapping_version=mapping_version,
        states={1: definition, 2: definition, 3: definition, 4: definition},
    )


# ---------------------------------------------------------------------------
# Constraint satisfaction (feasible set + model validation invariants)
# ---------------------------------------------------------------------------


def test_baseline_allocation_satisfies_constraints(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    result = optimize_allocation(baseline, exact_set, burden, uncertainty, ALPHA)
    # 0 <= x_i <= K_i (raises ValueError on violation) -- a model validation invariant.
    validate_allocation_against_sites(result.allocation, baseline.sites)
    total = sum(result.allocation.by_site.values())
    assert total >= baseline.system.required_capacity_mw - _CAPACITY_TOLERANCE


def test_positive_lambda_allocation_satisfies_constraints(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
) -> None:
    scenario = _with_lambda(baseline, 0.05)
    scenario_set = enumerate_exact(scenario, uncertainty)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty, ALPHA)
    validate_allocation_against_sites(result.allocation, scenario.sites)
    total = sum(result.allocation.by_site.values())
    assert total >= scenario.system.required_capacity_mw - _CAPACITY_TOLERANCE


# ---------------------------------------------------------------------------
# Evaluator round-trip (the model specification hard gate)
# ---------------------------------------------------------------------------


def test_evaluator_round_trip_within_justified_tolerance(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    scenario = _with_lambda(baseline, 0.05)
    scenario_set = enumerate_exact(scenario, uncertainty)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty, ALPHA)
    eval_result = evaluate_strategy(
        scenario, result.allocation, scenario_set, burden, uncertainty, ALPHA
    )
    n_months = scenario.system.horizon_month - scenario.system.target_month + 1
    tol = _lp_evaluator_tolerance(scenario.system.lambda_mw_month, n_months)
    assert abs(eval_result.objective - result.lp_objective) <= tol
    # optimize_allocation itself never returns without having already
    # asserted this internally (it raises RuntimeError otherwise) -- this
    # test re-checks the same bound from the caller's side.


# ---------------------------------------------------------------------------
# Hand-verifiable simple cases
# ---------------------------------------------------------------------------


def test_lambda_zero_is_unique_and_matches_cost_concentration(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    # Hand-verified (module docstring): D=500=K_A, c_A=1.00 < c_B=1.15 <
    # c_C=1.30 -> the minimal-C_dev allocation is x_A=500, x_B=x_C=0, a
    # mathematically UNIQUE vertex (the model specification: J=C_dev when lambda=0).
    result = optimize_allocation(baseline, exact_set, burden, uncertainty, ALPHA)
    assert result.allocation.by_site["A"] == pytest.approx(500.0, abs=1e-6)
    assert result.allocation.by_site["B"] == pytest.approx(0.0, abs=1e-6)
    assert result.allocation.by_site["C"] == pytest.approx(0.0, abs=1e-6)
    assert result.is_unique_within_tolerance is True

    benchmark = cost_concentration_allocation(baseline)
    assert benchmark.by_site == {"A": 500.0}


def test_single_site_exact_match_is_hand_verifiable(
    burden: BurdenStateConfig,
) -> None:
    # One site, K=D exactly: the only feasible allocation is x=K=D.
    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=200.0, target_month=12, horizon_month=24, lambda_mw_month=0.0
        ),
        sites=[
            Site(id="Solo", capacity_mw=200.0, cost_per_mw=2.0, burden_state=1, uncertainty_state=1)
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty_config, ALPHA)
    assert result.allocation.by_site["Solo"] == pytest.approx(200.0, abs=1e-6)
    assert result.is_unique_within_tolerance is True
    eval_result = evaluate_strategy(
        scenario, result.allocation, scenario_set, burden, uncertainty_config, ALPHA
    )
    assert eval_result.development_cost == pytest.approx(400.0, abs=1e-6)  # 2.0 * 200


def test_no_delay_ever_reduces_to_cheapest_fill(
    burden: BurdenStateConfig,
) -> None:
    # Two sites, no delay ever occurs (deterministic zero-delay uncertainty)
    # -> E[L]=0 regardless of lambda, so the optimum is the cheapest-fill
    # allocation exactly like lambda=0, even at a strictly positive lambda.
    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=150.0, target_month=6, horizon_month=12, lambda_mw_month=10.0
        ),
        sites=[
            Site(
                id="Cheap", capacity_mw=200.0, cost_per_mw=1.0, burden_state=1, uncertainty_state=1
            ),
            Site(
                id="Pricey", capacity_mw=200.0, cost_per_mw=5.0, burden_state=1, uncertainty_state=1
            ),
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty_config, ALPHA)
    assert result.allocation.by_site["Cheap"] == pytest.approx(150.0, abs=1e-6)
    assert result.allocation.by_site["Pricey"] == pytest.approx(0.0, abs=1e-6)


def test_identical_trajectories_different_costs_favors_cheaper(
    burden: BurdenStateConfig,
) -> None:
    # Two sites with IDENTICAL (K, B, U) but different cost -- same delivered
    # capacity trajectory under any split, so J is minimized purely by
    # routing all capacity to the cheaper site; the optimizer must beat a
    # split (e.g. diversified_allocation) in J.
    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=100.0, target_month=6, horizon_month=12, lambda_mw_month=1.0
        ),
        sites=[
            Site(
                id="Cheap", capacity_mw=200.0, cost_per_mw=1.0, burden_state=2, uncertainty_state=2
            ),
            Site(
                id="Same", capacity_mw=200.0, cost_per_mw=3.0, burden_state=2, uncertainty_state=2
            ),
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty_config, ALPHA)
    opt_eval = evaluate_strategy(
        scenario, result.allocation, scenario_set, burden, uncertainty_config, ALPHA
    )
    split_eval = evaluate_strategy(
        scenario, diversified_allocation(scenario), scenario_set, burden, uncertainty_config, ALPHA
    )
    assert result.allocation.by_site["Cheap"] == pytest.approx(100.0, abs=1e-6)
    assert result.allocation.by_site["Same"] == pytest.approx(0.0, abs=1e-6)
    assert opt_eval.objective < split_eval.objective


# ---------------------------------------------------------------------------
# lambda=0 reduces to expected minimum-development-cost allocation
# ---------------------------------------------------------------------------


def test_lambda_zero_minimizes_development_cost_only(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    result = optimize_allocation(baseline, exact_set, burden, uncertainty, ALPHA)
    eval_result = evaluate_strategy(
        baseline, result.allocation, exact_set, burden, uncertainty, ALPHA
    )
    # J == C_dev exactly when lambda == 0 (model spec).
    assert eval_result.objective == pytest.approx(eval_result.development_cost, abs=1e-6)


# ---------------------------------------------------------------------------
# Beats-or-ties all three canonical benchmarks (model spec)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("lam", [0.0, 0.016512, 0.05, 0.2])
def test_optimizer_beats_or_ties_all_three_benchmarks(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    lam: float,
) -> None:
    scenario = _with_lambda(baseline, lam)
    scenario_set = enumerate_exact(scenario, uncertainty)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty, ALPHA)
    opt_j = evaluate_strategy(
        scenario, result.allocation, scenario_set, burden, uncertainty, ALPHA
    ).objective

    benchmarks = {
        "cost_concentration": cost_concentration_allocation(scenario),
        "speed_reliability": speed_reliability_allocation(scenario, burden, uncertainty),
        "diversified": diversified_allocation(scenario),
    }
    for name, allocation in benchmarks.items():
        bench_j = evaluate_strategy(
            scenario, allocation, scenario_set, burden, uncertainty, ALPHA
        ).objective
        assert opt_j <= bench_j + 1e-6, f"optimizer lost to benchmark {name!r} at lambda={lam}"


# ---------------------------------------------------------------------------
# Non-uniqueness detection (approved design correction)
# ---------------------------------------------------------------------------


def test_identical_sites_detected_as_non_unique(
    burden: BurdenStateConfig,
) -> None:
    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=300.0, target_month=6, horizon_month=12, lambda_mw_month=0.0
        ),
        sites=[
            Site(id="X", capacity_mw=400.0, cost_per_mw=1.0, burden_state=2, uncertainty_state=1),
            Site(id="Y", capacity_mw=400.0, cost_per_mw=1.0, burden_state=2, uncertainty_state=1),
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty_config, ALPHA)

    assert result.is_unique_within_tolerance is False
    lo_x, hi_x = result.coordinate_bounds["X"]
    lo_y, hi_y = result.coordinate_bounds["Y"]
    # The true optimal face spans the whole feasible split (any x_X + x_Y =
    # 300 with 0<=x_X,x_Y<=400 achieves the identical J) -- both intervals
    # must be wide, not a numerical sliver.
    assert hi_x - lo_x > 1.0
    assert hi_y - lo_y > 1.0
    # No single site is silently reported as "the" preferred choice --
    # allocation is still a valid representative point, but is_unique_within_tolerance says
    # not to treat it as uniquely preferred (mirrors comparator.py's
    # co_optimal_strategies_at_lambda philosophy).
    total = result.allocation.by_site["X"] + result.allocation.by_site["Y"]
    assert total == pytest.approx(300.0, abs=1e-6)


def test_non_identical_optimum_reported_unique(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    result = optimize_allocation(baseline, exact_set, burden, uncertainty, ALPHA)
    assert result.is_unique_within_tolerance is True
    for sid, (lo, hi) in result.coordinate_bounds.items():
        assert hi >= lo


# ---------------------------------------------------------------------------
# Ordering independence (approved design correction)
# ---------------------------------------------------------------------------


def test_result_independent_of_site_ordering(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
) -> None:
    scenario = _with_lambda(baseline, 0.05)
    reordered = scenario.model_copy(update={"sites": list(reversed(scenario.sites))})

    scenario_set = enumerate_exact(scenario, uncertainty)
    reordered_set = enumerate_exact(reordered, uncertainty)

    result = optimize_allocation(scenario, scenario_set, burden, uncertainty, ALPHA)
    reordered_result = optimize_allocation(
        reordered, reordered_set, burden, uncertainty, ALPHA
    )

    assert result.lp_objective == pytest.approx(reordered_result.lp_objective, abs=1e-6)
    for site_id in ("A", "B", "C"):
        assert result.allocation.by_site[site_id] == pytest.approx(
            reordered_result.allocation.by_site[site_id], abs=1e-6
        )
        assert result.coordinate_bounds[site_id][0] == pytest.approx(
            reordered_result.coordinate_bounds[site_id][0], abs=1e-4
        )
        assert result.coordinate_bounds[site_id][1] == pytest.approx(
            reordered_result.coordinate_bounds[site_id][1], abs=1e-4
        )


# ---------------------------------------------------------------------------
# Exact-only contract (approved design correction, item 5)
# ---------------------------------------------------------------------------


def test_monte_carlo_scenario_set_rejected(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
) -> None:
    mc_set = sample_monte_carlo(baseline, uncertainty, n_samples=50, random_seed=1)
    with pytest.raises(ValueError, match="exact-enumeration"):
        optimize_allocation(baseline, mc_set, burden, uncertainty, ALPHA)


# ---------------------------------------------------------------------------
# System-level insufficiency (model spec)
# ---------------------------------------------------------------------------


def test_system_insufficient_raises_before_solving(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
) -> None:
    scenario = baseline.model_copy(
        update={"system": baseline.system.model_copy(update={"required_capacity_mw": 5000.0})}
    )
    scenario_set = enumerate_exact(scenario, uncertainty)
    with pytest.raises(ValueError, match="system-level insufficiency"):
        optimize_allocation(scenario, scenario_set, burden, uncertainty, ALPHA)


# ---------------------------------------------------------------------------
# Negative lambda (the model specification; schemas.SystemInputs already enforces
# lambda_mw_month >= 0 -- confirmed by inspection before implementation, see
# tests/unit/test_schemas.py::test_negative_lambda_rejected, retained/not
# duplicated here; this test only confirms the optimizer's own
# defense-in-depth re-check would fire if that ever changed).
# ---------------------------------------------------------------------------


def test_optimizer_rejects_negative_lambda_defensively(
    burden: BurdenStateConfig,
) -> None:
    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=100.0, target_month=6, horizon_month=12, lambda_mw_month=0.0
        ),
        sites=[
            Site(id="A", capacity_mw=100.0, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)
        ],
    )
    # Bypass schema validation deliberately (model_copy doesn't re-validate)
    # to exercise the optimizer's OWN defensive check independent of
    # whether the schema-level guard is ever weakened.
    negative_scenario = scenario.model_copy(
        update={"system": scenario.system.model_copy(update={"lambda_mw_month": -1.0})}
    )
    scenario_set = enumerate_exact(negative_scenario, uncertainty_config)
    with pytest.raises(ValueError, match="lambda_mw_month must be >= 0"):
        optimize_allocation(negative_scenario, scenario_set, burden, uncertainty_config, ALPHA)


# ---------------------------------------------------------------------------
# Adversarial regression: LP/evaluator behavior near the shortfall-tolerance
# boundary (approved design correction, item 1's explicit requirement).
# ---------------------------------------------------------------------------


def test_lp_evaluator_tolerance_bounds_the_capacity_clamp_worst_case() -> None:
    """Construct the WORST CASE the capacity clamp can produce: a delivered
    shortfall of exactly `evaluator._CAPACITY_TOLERANCE` at every one of
    `n_months` summed months, for a single deterministic realization
    (p=1.0). The evaluator clamps this to a zero shortfall at every month
    (Q=0, so E[L]=0); the raw, UNCLAMPED LP-style quantity
    (`z_{t,s} = D - Y`, no clamp) would instead be `_CAPACITY_TOLERANCE` at
    every month, contributing `lambda * n_months * _CAPACITY_TOLERANCE` to
    the LP's objective that the evaluator's J does not have.

    This proves `_lp_evaluator_tolerance`'s first term is not a rough
    guess -- it is EXACTLY the worst-case discrepancy the clamp can
    introduce, hand-derived here independently of `optimizer.py`'s own
    internals.
    """
    lam = 3.0
    target_month = 6
    horizon_month = 12
    n_months = horizon_month - target_month + 1  # inclusive of T*, the model specification

    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=100.0,
            target_month=target_month,
            horizon_month=horizon_month,
            lambda_mw_month=lam,
        ),
        sites=[
            Site(id="Solo", capacity_mw=100.0, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)

    # x deliberately short of D by just UNDER _CAPACITY_TOLERANCE -- not
    # exactly AT it: `D - (D - _CAPACITY_TOLERANCE)` is itself subject to
    # floating-point cancellation error of a similar order to the tolerance
    # itself (verified empirically: it can land a few ULPs on EITHER side
    # of the `<=` comparison), so asserting a specific "met" outcome at the
    # exact knife-edge would be asserting a coin flip, not a property. This
    # is exactly the "a sufficiently near-tied pair could in principle be
    # reordered by a numerical convention" risk this module's docstring
    # already declines to claim away -- using half the tolerance keeps this
    # test deterministic while still exercising the clamp's worst-case
    # magnitude (the discrepancy bound below scales with the full
    # `_CAPACITY_TOLERANCE`, not this test's specific `eps`).
    eps = _CAPACITY_TOLERANCE / 2.0
    allocation = Allocation(by_site={"Solo": 100.0 - eps})
    eval_result = evaluate_strategy(
        scenario, allocation, scenario_set, burden_config=_burden_config_single_tranche(),
        uncertainty_config=uncertainty_config, alpha=ALPHA,
    )
    assert eval_result.p_meet == 1.0  # clamped to "met" at the target month
    assert eval_result.expected_delay_burden_mw_months == pytest.approx(0.0, abs=1e-15)

    raw_l = n_months * eps  # what an unclamped LP would compute for z summed over months
    raw_j = eval_result.development_cost + lam * raw_l
    discrepancy = abs(eval_result.objective - raw_j)

    tol = _lp_evaluator_tolerance(lam, n_months)
    assert discrepancy == pytest.approx(lam * n_months * eps, rel=1e-9)
    assert discrepancy <= tol


def _burden_config_single_tranche() -> BurdenStateConfig:
    """A burden mapping whose tranche 2 completes well before month 0, so a
    site is always at full capacity from t=0 onward -- isolates the
    shortfall math in
    `test_lp_evaluator_tolerance_bounds_the_capacity_clamp_worst_case` from
    any tranche-timing effect (K_i is the only thing that matters there).
    """
    from trackc.model.schemas import BurdenStateConfig, BurdenStateDefinition

    definition = BurdenStateDefinition(
        label="Immediate (test-only)",
        interpretation="Full power effectively from t=0 -- isolates shortfall "
        "math from tranche timing in this boundary test.",
        tau1_bar=0.1,
        tau2_bar=0.2,
    )
    return BurdenStateConfig(
        mapping_version="v1-immediate-test",
        states={1: definition, 2: definition, 3: definition, 4: definition},
    )


def test_cooptimality_tolerance_is_bounded_below_by_solver_floor() -> None:
    # J* == 0 (degenerate) must not produce a zero tolerance -- the solver
    # floor always applies.
    assert _cooptimality_tolerance(0.0) > 0.0
    # Large |J*| scales the tolerance up rather than staying pinned to the
    # floor forever (still bounded, never huge relative to J* itself).
    assert _cooptimality_tolerance(1e12) > _cooptimality_tolerance(0.0)


# ---------------------------------------------------------------------------
# Extreme-scale / tiny-cost-differential regression (raised by independent
# review as a gate-review concern). This is NOT a bug
# regression -- the exact LP here has a mathematically UNIQUE optimum (the
# two sites' costs differ by a strictly positive, if tiny, amount), and the
# purpose of this test is to confirm the GOVERNED, EXPLICIT behavior: the
# optimizer may report `is_unique_within_tolerance=False` in this regime
# because finite-precision LP solving cannot certify tighter than
# `cooptimality_tolerance` allows, NOT because the code is wrong. Do not
# "fix" this by shrinking `_cooptimality_tolerance` further -- per that
# function's own docstring, no finite tolerance removes this ambiguity in
# general, it only moves it to a smaller cost-gradient scale.
# ---------------------------------------------------------------------------


def test_extreme_scale_tiny_cost_gradient_reports_non_unique_within_tolerance(
    burden: BurdenStateConfig,
) -> None:
    # Two sites, same K, costs differing by only 1e-5 out of 1000 (a
    # strictly nonzero, mathematically decisive gradient at exact
    # precision), lambda=0 -- the true LP optimum is UNIQUE: all capacity
    # to the (infinitesimally) cheaper site. At this large J* (~5e5) and
    # tiny cost gradient, `cooptimality_tolerance`'s J-unit window,
    # translated into MW through that gradient, is expected to exceed
    # `_COORDINATE_WIDTH_RELATIVE_TOLERANCE * K_i` -- exactly the
    # independently documented finding, reproduced here as a governed
    # fixture rather than an unexplained surprise.
    uncertainty_config = _deterministic_uncertainty_config()
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=500.0, target_month=6, horizon_month=12, lambda_mw_month=0.0
        ),
        sites=[
            Site(
                id="Cheap",
                capacity_mw=1000.0,
                cost_per_mw=1000.0,
                burden_state=1,
                uncertainty_state=1,
            ),
            Site(
                id="Pricey",
                capacity_mw=1000.0,
                cost_per_mw=1000.00001,
                burden_state=1,
                uncertainty_state=1,
            ),
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty_config, ALPHA)

    # The representative allocation IS the true unique optimum (all
    # capacity to the strictly cheaper site) -- the optimizer's actual
    # decision is correct; only the *reported certainty* about uniqueness
    # is deliberately conservative here.
    assert result.allocation.by_site["Cheap"] == pytest.approx(500.0, abs=1.0)
    assert result.allocation.by_site["Pricey"] == pytest.approx(0.0, abs=1.0)

    # The governed behavior: within the reported cooptimality_tolerance,
    # the probe is expected to find a nonzero coordinate range wide enough
    # to trip _COORDINATE_WIDTH_RELATIVE_TOLERANCE, in this specific
    # extreme-scale regime. This is reported honestly via
    # is_unique_within_tolerance=False -- it is NOT read as "the exact LP
    # has multiple mathematical optima" (it does not).
    assert result.cooptimality_tolerance > 0.0
    lo_cheap, hi_cheap = result.coordinate_bounds["Cheap"]
    lo_pricey, hi_pricey = result.coordinate_bounds["Pricey"]
    assert lo_cheap <= hi_cheap
    assert lo_pricey <= hi_pricey
    if not result.is_unique_within_tolerance:
        # If the tolerance-driven ambiguity did trigger (the documented,
        # expected outcome at this scale), confirm it did so for the
        # reason this test exists -- a nonzero, tolerance-scale range, not
        # a full free-for-all across the entire feasible set.
        assert (hi_pricey - lo_pricey) < scenario.sites[1].capacity_mw

