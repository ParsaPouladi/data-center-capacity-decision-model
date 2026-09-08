"""Strategy evaluator tests (model spec), hand-calculated
against the baseline fixture.

Baseline scenario (D=500, T*=36, H=72, alpha=0.5; sites A/B/C):

    A: K=500 c=1.00 B=3 (tau1_bar=30, tau2_bar=42) U=3 delays[0,9,18] p[.40,.35,.25]
    B: K=300 c=1.15 B=2 (tau1_bar=24, tau2_bar=30) U=1 delays[0,3,6]  p[.80,.15,.05]
    C: K=250 c=1.30 B=1 (tau1_bar=18, tau2_bar=24) U=2 delays[0,6,12] p[.60,.30,.10]

These values, and every expected number below, were independently hand-computed
(nested-loop script over all 27 exact realizations, not reusing evaluator.py)
before the implementation was checked against them. All match to
floating-point precision.
"""

import numpy as np
import pytest

from trackc.model.evaluator import StrategyResult, evaluate_strategy, site_availability
from trackc.model.mappings import apply_delay, resolve_burden
from trackc.model.power_profile import site_power_profile
from trackc.model.scenario_engine import (
    ScenarioSet,
    build_scenario_set,
    enumerate_exact,
    sample_monte_carlo,
)
from trackc.model.schemas import (
    Allocation,
    BurdenStateConfig,
    ModelDefaults,
    Scenario,
    Site,
    SystemInputs,
    UncertaintyStateConfig,
)

# baseline / burden / uncertainty / exact_set fixtures are shared via
# tests/conftest.py.

ALPHA = 0.50


def _evaluate(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    scenario_set: ScenarioSet,
    x: dict[str, float],
    lam: float = 0.0,
) -> StrategyResult:
    scenario = baseline.model_copy(
        update={"system": baseline.system.model_copy(update={"lambda_mw_month": lam})}
    )
    return evaluate_strategy(
        scenario, Allocation(by_site=x), scenario_set, burden, uncertainty, alpha=ALPHA
    )


# --- hand-calculated fixtures -----------------------------------------------


def test_full_allocation_meets_deadline_with_zero_shortfall(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    # x = K: at T*=36, worst-case realization is still Y(36) = 0 + 300 + 250 =
    # 550 >= D=500 (A's tau1=48 in the worst case, so A contributes 0; B and C
    # are already at full tranche 2 by t=36 even under their worst delay).
    r = _evaluate(baseline, burden, uncertainty, exact_set, {"A": 500, "B": 300, "C": 250}, lam=0.0)
    assert r.p_meet == pytest.approx(1.0)
    assert r.expected_shortfall_mw == pytest.approx(0.0)
    assert r.expected_delay_burden_mw_months == pytest.approx(0.0)
    assert r.development_cost == pytest.approx(1170.0)  # 500*1.00 + 300*1.15 + 250*1.30
    assert r.objective == pytest.approx(1170.0)
    assert r.feasibility_status == "feasible"


def test_zero_allocation_is_strategy_insufficient(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    r = _evaluate(baseline, burden, uncertainty, exact_set, {"A": 0, "B": 0, "C": 0}, lam=0.0)
    assert r.p_meet == pytest.approx(0.0)
    assert r.expected_shortfall_mw == pytest.approx(500.0)
    assert r.expected_delay_burden_mw_months == pytest.approx(18500.0)
    assert r.development_cost == pytest.approx(0.0)
    assert r.objective == pytest.approx(0.0)
    # sum_i K_i = 1050 >= D=500, so the portfolio itself is not the problem --
    # only this particular (zero) strategy is (model spec).
    assert r.feasibility_status == "strategy_insufficient"


def test_partial_allocation_hand_computed_metrics(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    r = _evaluate(baseline, burden, uncertainty, exact_set, {"A": 100, "B": 300, "C": 100}, lam=0.0)
    assert r.p_meet == pytest.approx(0.4)
    assert r.expected_shortfall_mw == pytest.approx(60.0, abs=1e-9)
    assert r.expected_delay_burden_mw_months == pytest.approx(405.0)
    assert r.development_cost == pytest.approx(575.0)  # 100*1.00 + 300*1.15 + 100*1.30
    assert r.objective == pytest.approx(575.0)
    # sum_i x_i = 500 == D, not < D -- not strategy_insufficient.
    assert r.feasibility_status == "feasible"


def test_smaller_allocation_hand_computed_metrics_and_is_strategy_insufficient(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    r = _evaluate(baseline, burden, uncertainty, exact_set, {"A": 50, "B": 300, "C": 100}, lam=0.0)
    assert r.p_meet == pytest.approx(0.0)
    assert r.expected_shortfall_mw == pytest.approx(80.0)
    assert r.expected_delay_burden_mw_months == pytest.approx(2052.5)
    assert r.development_cost == pytest.approx(525.0)
    assert r.objective == pytest.approx(525.0)
    assert r.feasibility_status == "strategy_insufficient"  # sum_i x_i = 450 < D=500


# --- a model validation invariant: lambda = 0 => J = C_dev ------------------


@pytest.mark.parametrize(
    "x", [{"A": 500, "B": 300, "C": 250}, {"A": 0, "B": 0, "C": 0}, {"A": 100, "B": 300, "C": 100}]
)
def test_lambda_zero_objective_equals_development_cost(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
    x: dict[str, float],
) -> None:
    r = _evaluate(baseline, burden, uncertainty, exact_set, x, lam=0.0)
    assert r.objective == pytest.approx(r.development_cost)


def test_nonzero_lambda_scales_objective_by_expected_delay_burden(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    x = {"A": 100, "B": 300, "C": 100}
    r0 = _evaluate(baseline, burden, uncertainty, exact_set, x, lam=0.0)
    r3 = _evaluate(baseline, burden, uncertainty, exact_set, x, lam=3.0)
    assert r3.development_cost == pytest.approx(r0.development_cost)
    assert r3.p_meet == pytest.approx(r0.p_meet)
    assert r3.expected_delay_burden_mw_months == pytest.approx(r0.expected_delay_burden_mw_months)
    assert r3.objective == pytest.approx(
        r0.development_cost + 3.0 * r0.expected_delay_burden_mw_months
    )
    assert r3.objective == pytest.approx(1790.0)


# --- feasibility (model spec) ------------------------------------------


def test_system_insufficiency_when_total_capacity_below_target(
    burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    system = SystemInputs(
        required_capacity_mw=1000, target_month=36, horizon_month=72, lambda_mw_month=0
    )
    sites = [Site(id="A", capacity_mw=500, cost_per_mw=1.0, burden_state=3, uncertainty_state=3)]
    scenario = Scenario(system=system, sites=sites)
    scenario_set = enumerate_exact(scenario, uncertainty)
    r = evaluate_strategy(
        scenario, Allocation(by_site={"A": 500}), scenario_set, burden, uncertainty, alpha=ALPHA
    )
    # sum_i K_i = 500 < D = 1000: the portfolio can never meet D, regardless of x.
    assert r.feasibility_status == "system_insufficient"


def test_evaluate_strategy_rejects_allocation_exceeding_site_capacity(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    # a model validation invariant, enforced via schemas.validate_allocation_against_sites.
    with pytest.raises(ValueError, match="exceeds site capacity"):
        evaluate_strategy(
            baseline,
            Allocation(by_site={"A": 501, "B": 300, "C": 250}),
            exact_set,
            burden,
            uncertainty,
            alpha=ALPHA,
        )


def test_evaluate_strategy_rejects_mismatched_scenario_set(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    other = ScenarioSet(
        site_ids=("X",), delays=np.zeros((1, 1)), probabilities=np.array([1.0]), method="exact"
    )
    with pytest.raises(ValueError, match="does not match"):
        evaluate_strategy(
            baseline, Allocation(by_site={"A": 100}), other, burden, uncertainty, alpha=ALPHA
        )


# --- result schema (model spec) ----------------------------------------


def test_result_schema_populated_for_exact(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    r = _evaluate(baseline, burden, uncertainty, exact_set, {"A": 500, "B": 300, "C": 250})
    assert r.site_ids == ("A", "B", "C")
    assert r.n_sites == 3
    assert r.allocation == {"A": 500, "B": 300, "C": 250}
    assert r.method == "exact"
    assert r.n_realizations == 27
    assert r.random_seed is None
    assert r.n_samples is None
    assert r.burden_mapping_version == burden.mapping_version
    assert r.uncertainty_mapping_version == uncertainty.mapping_version
    assert r.times.shape == (73,)  # t = 0..72 inclusive
    assert r.delivered_capacity_trajectory.shape == (73,)


def test_result_schema_populated_for_monte_carlo(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    mc_set = sample_monte_carlo(baseline, uncertainty, n_samples=1000, random_seed=7)
    r = evaluate_strategy(
        baseline,
        Allocation(by_site={"A": 500, "B": 300, "C": 250}),
        mc_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    assert r.method == "monte_carlo"
    assert r.n_realizations == 1000
    assert r.random_seed == 7
    assert r.n_samples == 1000


def test_monte_carlo_identical_seed_reproduces_identical_result(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    # a model validation invariant, at the evaluator level.
    x = {"A": 100, "B": 300, "C": 100}
    a_set = sample_monte_carlo(baseline, uncertainty, n_samples=2000, random_seed=42)
    b_set = sample_monte_carlo(baseline, uncertainty, n_samples=2000, random_seed=42)
    ra = evaluate_strategy(baseline, Allocation(by_site=x), a_set, burden, uncertainty, alpha=ALPHA)
    rb = evaluate_strategy(baseline, Allocation(by_site=x), b_set, burden, uncertainty, alpha=ALPHA)
    assert ra.p_meet == rb.p_meet
    assert ra.expected_shortfall_mw == rb.expected_shortfall_mw
    assert ra.expected_delay_burden_mw_months == rb.expected_delay_burden_mw_months
    np.testing.assert_array_equal(
        ra.delivered_capacity_trajectory, rb.delivered_capacity_trajectory
    )


def test_build_scenario_set_auto_switch_feeds_evaluator(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    defaults = ModelDefaults(
        alpha=ALPHA, max_exact_scenarios=100000, mc_samples=5000, random_seed=99
    )
    scenario_set = build_scenario_set(baseline, uncertainty, defaults)
    r = evaluate_strategy(
        baseline,
        Allocation(by_site={"A": 500, "B": 300, "C": 250}),
        scenario_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    assert r.method == "exact"  # 27 <= 100000


# --- no math drift against the tranche-step primitives --------------------


@pytest.mark.parametrize("burden_state,capacity", [(1, 250.0), (2, 300.0), (3, 500.0)])
def test_site_availability_matches_site_power_profile_for_single_realization(
    burden: BurdenStateConfig, burden_state: int, capacity: float
) -> None:
    # evaluator.site_availability recomputes A_i(t,s) vectorized (it cannot
    # call power_profile.power_availability directly -- that function's
    # tau2>tau1 guard assumes scalar tau1/tau2). This test guards against the
    # two implementations drifting apart.
    site = Site(
        id="S",
        capacity_mw=capacity,
        cost_per_mw=1.0,
        burden_state=burden_state,
        uncertainty_state=1,
    )
    system = SystemInputs(
        required_capacity_mw=1, target_month=1, horizon_month=60, lambda_mw_month=0
    )
    scenario = Scenario(system=system, sites=[site])
    delta = 7.0
    scenario_set = ScenarioSet(
        site_ids=("S",), delays=np.array([[delta]]), probabilities=np.array([1.0]), method="exact"
    )
    times = np.arange(0, 61, dtype=np.float64)

    batched = site_availability(scenario, scenario_set, burden, alpha=0.5, times=times)[0, 0, :]
    reference = site_power_profile(times, site, delta, burden, alpha=0.5)
    np.testing.assert_allclose(batched, reference)

    # and cross-check against mappings.apply_delay + resolve_burden directly.
    tau1_bar, tau2_bar = resolve_burden(burden_state, burden)
    tau1, tau2 = apply_delay(tau1_bar, tau2_bar, delta)
    assert np.all(batched[times < tau1] == 0.0)
    assert np.all(batched[(times >= tau1) & (times < tau2)] == 0.5 * capacity)
    assert np.all(batched[times >= tau2] == capacity)
