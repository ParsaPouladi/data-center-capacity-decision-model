"""Counterintuitive-case regression (burden state High -> Very High).

This test exists to independently and mechanically confirm, against the
frozen engine, the exact narrative the Decision-page synthesis layer
(`web/src/lib/synthesis.ts`) is permitted to state about this
scenario: worsening Site A's burden state from High to Very High does NOT
"improve" the portfolio in any sense the model asserts. What actually
happens is a re-optimization -- given the harder site, a different, more
expensive allocation becomes the cost-minimizing one, and it happens to also
meet the deadline with certainty; that allocation was already feasible and
already evaluable at the ORIGINAL (High) scenario, it was simply not the
lowest-J allocation there. Holding the original decision fixed and only
changing site A's condition makes every metric on that fixed decision
worse, exactly as physically expected.

Every asserted number is read from `evaluate_showcase(...)` /
`evaluate_strategy(...)` on the frozen engine -- nothing here is a
hand-computed model output. This locks the verified behavior; the
TypeScript layer must never derive it independently or restate it as
cross-scenario causality on the live page.
"""

from __future__ import annotations

import pytest
from scripts.export_showcase_data import (
    CHEAP_SITE_LAMBDA,
    cheap_site_risky_schedule_scenario,
)

from trackc.model.evaluator import evaluate_strategy
from trackc.model.schemas import Allocation
from trackc_app.service import (
    build_showcase_scenario_set,
    evaluate_showcase,
    load_engine_configs,
)

# The system this test locks: D=500, T*=36, H=72, lambda=0.025.
_REQUIRED_CAPACITY_MW = 500.0
_TARGET_MONTH = 36
_HORIZON_MONTH = 72


@pytest.fixture(scope="module")
def configs():
    return load_engine_configs()


def _baseline_scenario():
    """The committed cheap_site_risky_schedule preset: A=High (state 3)."""
    scenario = cheap_site_risky_schedule_scenario()
    assert scenario.system.lambda_mw_month == CHEAP_SITE_LAMBDA == 0.025
    assert scenario.system.required_capacity_mw == _REQUIRED_CAPACITY_MW
    assert scenario.system.target_month == _TARGET_MONTH
    assert scenario.system.horizon_month == _HORIZON_MONTH
    return scenario


def _worsened_scenario():
    """The same scenario with ONLY Site A's burden state changed: High (3)
    -> Very High (4). Nothing else -- not lambda, not any other site --
    is touched."""
    scenario = _baseline_scenario()
    sites = []
    for site in scenario.sites:
        if site.id == "A":
            assert site.burden_state == 3, "baseline A must be High going in"
            sites.append(site.model_copy(update={"burden_state": 4}))
        else:
            sites.append(site)
    return scenario.model_copy(update={"sites": sites})


def test_baseline_optimized_result(configs) -> None:
    """Baseline: A=250, B=250, C=0 wins at A=High."""
    showcase = evaluate_showcase(
        _baseline_scenario(), configs, include_optimizer=True, include_envelope=False
    )
    ev = showcase["optimizer"]["evaluated"]
    alloc = showcase["optimizer"]["result"]["allocation"]

    assert alloc["A"] == pytest.approx(250.0, abs=1e-6)
    assert alloc["B"] == pytest.approx(250.0, abs=1e-6)
    assert alloc["C"] == pytest.approx(0.0, abs=1e-6)

    assert ev["development_cost"] == pytest.approx(537.5, abs=1e-6)
    assert ev["p_meet"] == pytest.approx(0.40, abs=1e-6)
    assert ev["expected_shortfall_mw"] == pytest.approx(150.0, abs=1e-6)
    assert ev["expected_delay_burden_mw_months"] == pytest.approx(1012.5, abs=1e-6)
    assert ev["objective"] == pytest.approx(562.8125, abs=1e-6)


def test_worsened_optimized_result_reoptimizes(configs) -> None:
    """At A=Very High, re-optimization moves capacity off A entirely and
    picks a MORE expensive, fully deadline-certain allocation."""
    showcase = evaluate_showcase(
        _worsened_scenario(), configs, include_optimizer=True, include_envelope=False
    )
    ev = showcase["optimizer"]["evaluated"]
    alloc = showcase["optimizer"]["result"]["allocation"]

    assert alloc["A"] == pytest.approx(0.0, abs=1e-6)
    assert alloc["B"] == pytest.approx(300.0, abs=1e-6)
    assert alloc["C"] == pytest.approx(200.0, abs=1e-6)

    assert ev["development_cost"] == pytest.approx(605.0, abs=1e-6)
    assert ev["p_meet"] == pytest.approx(1.0, abs=1e-6)
    assert ev["expected_shortfall_mw"] == pytest.approx(0.0, abs=1e-6)
    assert ev["expected_delay_burden_mw_months"] == pytest.approx(0.0, abs=1e-6)
    assert ev["objective"] == pytest.approx(605.0, abs=1e-6)


def test_worsened_objective_is_still_worse_than_baseline(configs) -> None:
    """The re-optimized objective (605) is strictly worse than the original
    baseline objective (562.8125) -- the harder site cost the portfolio
    money even after re-optimizing around it. Nothing "improved"."""
    baseline_showcase = evaluate_showcase(
        _baseline_scenario(), configs, include_optimizer=True, include_envelope=False
    )
    worsened_showcase = evaluate_showcase(
        _worsened_scenario(), configs, include_optimizer=True, include_envelope=False
    )
    baseline_objective = baseline_showcase["optimizer"]["evaluated"]["objective"]
    worsened_objective = worsened_showcase["optimizer"]["evaluated"]["objective"]

    assert baseline_objective == pytest.approx(562.8125, abs=1e-6)
    assert worsened_objective == pytest.approx(605.0, abs=1e-6)
    assert worsened_objective > baseline_objective


def test_fixed_original_allocation_under_worsened_scenario_is_worse(configs) -> None:
    """Holding the ORIGINAL decision (A=250, B=250, C=0) fixed and only
    worsening A's condition makes every metric on that fixed decision
    strictly worse -- the physically expected direction. This is the
    control that rules out "worse site conditions improve outcomes":
    the fixed allocation gets worse; only re-optimizing (previous test)
    finds a different, costlier allocation that happens to fully meet the
    deadline."""
    worsened_scenario = _worsened_scenario()
    scenario_set = build_showcase_scenario_set(worsened_scenario, configs)
    fixed_allocation = Allocation(by_site={"A": 250.0, "B": 250.0, "C": 0.0})

    result = evaluate_strategy(
        worsened_scenario,
        fixed_allocation,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )

    assert result.development_cost == pytest.approx(537.5, abs=1e-6)
    assert result.p_meet == pytest.approx(0.0, abs=1e-6)
    assert result.expected_shortfall_mw == pytest.approx(250.0, abs=1e-6)
    assert result.expected_delay_burden_mw_months == pytest.approx(3412.5, abs=1e-6)
    assert result.objective == pytest.approx(622.8125, abs=1e-6)


def test_the_100_percent_portfolio_was_already_feasible_but_pricier_at_baseline(
    configs,
) -> None:
    """The allocation the worsened scenario's optimizer selects (A=0, B=300,
    C=200) is a legal allocation of the ORIGINAL (A=High) portfolio too --
    x_i <= K_i holds against the baseline site capacities -- and evaluating
    it there shows it was already fully deadline-certain at baseline. It
    was not chosen at baseline only because it cost more than A=250/B=250/
    C=0's objective there (i.e., it was feasible-but-not-optimal, not
    newly created by A's condition change)."""
    baseline_scenario = _baseline_scenario()
    scenario_set = build_showcase_scenario_set(baseline_scenario, configs)
    hundred_percent_allocation = Allocation(by_site={"A": 0.0, "B": 300.0, "C": 200.0})

    result = evaluate_strategy(
        baseline_scenario,
        hundred_percent_allocation,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )

    # Feasible and fully deadline-certain at baseline already.
    assert result.p_meet == pytest.approx(1.0, abs=1e-6)
    assert result.development_cost == pytest.approx(605.0, abs=1e-6)
    assert result.objective == pytest.approx(605.0, abs=1e-6)

    # But strictly worse than the baseline's actual optimum (562.8125) --
    # which is exactly why the optimizer did not select it at baseline.
    baseline_showcase = evaluate_showcase(
        baseline_scenario, configs, include_optimizer=True, include_envelope=False
    )
    baseline_optimum = baseline_showcase["optimizer"]["evaluated"]["objective"]
    assert baseline_optimum == pytest.approx(562.8125, abs=1e-6)
    assert result.objective > baseline_optimum
