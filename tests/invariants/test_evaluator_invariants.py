"""Hard-gate invariants (the model validation invariants -- the subset
that only exists once the evaluator does). The input/scenario invariants
are covered elsewhere (a further evaluator-level restatement is in
``tests/convergence/test_evaluator_mc_convergence.py``).
"""

import numpy as np
import pytest

from trackc.model.evaluator import delivered_site_capacity, evaluate_strategy, site_availability
from trackc.model.power_profile import time_grid
from trackc.model.scenario_engine import ScenarioSet, enumerate_exact
from trackc.model.schemas import Allocation, BurdenStateConfig, Scenario, UncertaintyStateConfig

# baseline / burden / uncertainty / exact_set fixtures are shared via
# tests/conftest.py.

ALPHA = 0.50


# --- #14, #15: delivered capacity bounds and additivity ---------------------


def test_delivered_site_capacity_never_exceeds_x_or_availability(
    baseline: Scenario, burden: BurdenStateConfig, exact_set: ScenarioSet
) -> None:
    x = np.array([100.0, 300.0, 100.0])
    times = time_grid(baseline.system.horizon_month)
    availability = site_availability(baseline, exact_set, burden, ALPHA, times)
    Y_i = delivered_site_capacity(x, availability)

    assert np.all(Y_i <= x[None, :, None] + 1e-12)
    assert np.all(Y_i <= availability + 1e-12)
    assert np.all(Y_i >= 0.0)


def test_total_delivered_equals_sum_of_site_delivered(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    x = np.array([500.0, 300.0, 250.0])
    times = time_grid(baseline.system.horizon_month)
    availability = site_availability(baseline, exact_set, burden, ALPHA, times)
    Y_i = delivered_site_capacity(x, availability)
    Y = Y_i.sum(axis=1)

    r = evaluate_strategy(
        baseline,
        Allocation(by_site={"A": 500, "B": 300, "C": 250}),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    # expected total trajectory = probability-weighted sum over realizations
    # of Y(t,s), which is exactly the sum over sites of Y_i(t,s), weighted.
    expected_trajectory = exact_set.probabilities @ Y
    np.testing.assert_allclose(r.delivered_capacity_trajectory, expected_trajectory)


# --- #16, #17, #18: non-negativity and probability bounds -------------------


@pytest.mark.parametrize(
    "x,lam",
    [
        ({"A": 500, "B": 300, "C": 250}, 0.0),
        ({"A": 0, "B": 0, "C": 0}, 5.0),
        ({"A": 100, "B": 300, "C": 100}, 1.5),
        ({"A": 50, "B": 300, "C": 100}, 0.0),
        ({"A": 500, "B": 0, "C": 250}, 10.0),
    ],
)
def test_delay_burden_and_shortfall_are_non_negative_and_probability_metrics_are_bounded(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
    x: dict[str, float],
    lam: float,
) -> None:
    scenario = baseline.model_copy(
        update={"system": baseline.system.model_copy(update={"lambda_mw_month": lam})}
    )
    r = evaluate_strategy(
        scenario, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
    )
    assert r.expected_delay_burden_mw_months >= 0.0  # #16
    assert r.expected_shortfall_mw >= 0.0  # #17
    assert 0.0 <= r.p_meet <= 1.0  # #18


# --- #7: increasing usable capacity cannot worsen physical shortfall --------


@pytest.mark.parametrize(
    "x_small,x_large",
    [
        ({"A": 50, "B": 300, "C": 100}, {"A": 100, "B": 300, "C": 100}),
        ({"A": 0, "B": 0, "C": 0}, {"A": 500, "B": 300, "C": 250}),
        ({"A": 100, "B": 100, "C": 100}, {"A": 200, "B": 200, "C": 150}),
    ],
)
def test_larger_allocation_never_increases_shortfall_or_decreases_pmeet(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
    x_small: dict[str, float],
    x_large: dict[str, float],
) -> None:
    assert all(x_large[k] >= x_small[k] for k in x_small)  # elementwise x' >= x
    r_small = evaluate_strategy(
        baseline, Allocation(by_site=x_small), exact_set, burden, uncertainty, alpha=ALPHA
    )
    r_large = evaluate_strategy(
        baseline, Allocation(by_site=x_large), exact_set, burden, uncertainty, alpha=ALPHA
    )
    assert r_large.expected_shortfall_mw <= r_small.expected_shortfall_mw + 1e-9
    assert r_large.expected_delay_burden_mw_months <= r_small.expected_delay_burden_mw_months + 1e-9
    assert r_large.p_meet >= r_small.p_meet - 1e-9


# --- #6: later power delivery cannot improve P_meet --------------------------


def test_larger_schedule_delay_never_improves_pmeet_or_shortfall(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    x = {"A": 500, "B": 300, "C": 250}
    early = ScenarioSet(
        site_ids=("A", "B", "C"),
        delays=np.zeros((1, 3)),
        probabilities=np.array([1.0]),
        method="exact",
    )
    late = ScenarioSet(
        site_ids=("A", "B", "C"),
        delays=np.array([[18.0, 6.0, 12.0]]),  # each site's worst-case delay outcome
        probabilities=np.array([1.0]),
        method="exact",
    )
    r_early = evaluate_strategy(
        baseline, Allocation(by_site=x), early, burden, uncertainty, alpha=ALPHA
    )
    r_late = evaluate_strategy(
        baseline, Allocation(by_site=x), late, burden, uncertainty, alpha=ALPHA
    )
    assert r_late.p_meet <= r_early.p_meet
    assert r_late.expected_shortfall_mw >= r_early.expected_shortfall_mw
    assert r_late.expected_delay_burden_mw_months >= r_early.expected_delay_burden_mw_months


# --- #8: zero-delay collapse -> deterministic, identical realizations -------


def test_zero_delay_collapse_gives_deterministic_result(
    baseline: Scenario, burden: BurdenStateConfig
) -> None:
    collapsed = UncertaintyStateConfig.model_validate(
        {
            "mapping_version": "test-collapsed",
            "states": {
                k: {
                    "label": "certain",
                    "interpretation": "no delay",
                    "delay_months": [0],
                    "probabilities": [1.0],
                }
                for k in (1, 2, 3, 4)
            },
        }
    )
    scenario_set = enumerate_exact(baseline, collapsed)
    assert scenario_set.n_realizations == 1

    x = {"A": 100, "B": 300, "C": 100}
    r = evaluate_strategy(
        baseline, Allocation(by_site=x), scenario_set, burden, collapsed, alpha=ALPHA
    )
    # deterministic: P_meet must land exactly on 0 or 1, never a fractional value.
    assert r.p_meet in (0.0, 1.0)

    # hand check at t = T* = 36 with zero delay: A (tau1=30,tau2=42) is in
    # tranche 1 -> min(100, 250) = 100; B (tau1=24,tau2=30) is full -> min(300,300)=300;
    # C (tau1=18,tau2=24) is full -> min(100,250)=100. Y(36) = 500 = D -> meets.
    assert r.p_meet == 1.0
    assert r.expected_shortfall_mw == pytest.approx(0.0)


# --- #9: lambda = 0 => J = C_dev (property, randomized allocations) ---------


@pytest.mark.parametrize("seed", range(5))
def test_lambda_zero_objective_equals_development_cost_property(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
    seed: int,
) -> None:
    rng = np.random.default_rng(seed)
    caps = {"A": 500.0, "B": 300.0, "C": 250.0}
    x = {sid: float(rng.uniform(0, k)) for sid, k in caps.items()}
    scenario = baseline.model_copy(
        update={"system": baseline.system.model_copy(update={"lambda_mw_month": 0.0})}
    )
    r = evaluate_strategy(
        scenario, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
    )
    assert r.objective == pytest.approx(r.development_cost)


# --- #10: identical trajectory, cheaper cost -> favored economically --------


def test_cheaper_allocation_with_identical_trajectory_has_lower_objective(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set: ScenarioSet,
) -> None:
    x = {"A": 100, "B": 300, "C": 100}
    # `cheap` is baseline's own sites/costs verbatim (just lambda pinned to 0
    # explicitly, matching baseline's default, so this doesn't rely on that
    # default staying 0) -- `expensive` is the only side that actually differs.
    cheap = baseline.model_copy(
        update={"system": baseline.system.model_copy(update={"lambda_mw_month": 0.0})}
    )
    expensive = baseline.model_copy(
        update={
            "sites": [
                s.model_copy(update={"cost_per_mw": s.cost_per_mw + 0.5}) for s in baseline.sites
            ],
            "system": baseline.system.model_copy(update={"lambda_mw_month": 0.0}),
        }
    )

    r_cheap = evaluate_strategy(
        cheap, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
    )
    r_expensive = evaluate_strategy(
        expensive, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
    )

    # same allocation, same scenario_set -> identical delivered-capacity trajectory / P_meet / E[L].
    np.testing.assert_allclose(
        r_cheap.delivered_capacity_trajectory, r_expensive.delivered_capacity_trajectory
    )
    assert r_cheap.p_meet == pytest.approx(r_expensive.p_meet)
    assert r_cheap.expected_delay_burden_mw_months == pytest.approx(
        r_expensive.expected_delay_burden_mw_months
    )
    # only cost differs -> the cheaper strategy has the strictly lower objective.
    assert r_cheap.objective < r_expensive.objective
    assert r_expensive.development_cost - r_cheap.development_cost == pytest.approx(
        0.5 * sum(x.values())
    )
