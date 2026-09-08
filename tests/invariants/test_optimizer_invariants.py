"""Hard-gate invariants for the optimizer (acceptance criterion:
"Optimizer decisions can be independently evaluated using the existing
strategy evaluator"). These are mathematical-property checks over the LP
formulation in ``trackc.model.optimizer``, distinct from the hand-verified
fixture checks in ``tests/unit/test_optimizer.py``.
"""

from __future__ import annotations

import itertools

import numpy as np
import pytest

from trackc.model.evaluator import evaluate_strategy
from trackc.model.optimizer import optimize_allocation
from trackc.model.scenario_engine import enumerate_exact
from trackc.model.schemas import Allocation, BurdenStateConfig, Scenario, UncertaintyStateConfig

ALPHA = 0.50


# ---------------------------------------------------------------------------
# Brute-force / grid cross-check (independent of optimizer.py's own LP code
# path -- built entirely from evaluate_strategy, a transparent alternative
# method per the approved validation plan).
# ---------------------------------------------------------------------------


def test_grid_search_confirms_lp_optimum_on_two_site_case(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    # Two of the baseline's three sites only (A, B), lambda > 0 so E[L]
    # actually matters and the grid must search a genuine 2D tradeoff
    # (not just "fill cheapest first").
    two_site_scenario = baseline.model_copy(
        update={
            "sites": [s for s in baseline.sites if s.id in ("A", "B")],
            "system": baseline.system.model_copy(
                update={"required_capacity_mw": 400.0, "lambda_mw_month": 0.05}
            ),
        }
    )
    scenario_set = enumerate_exact(two_site_scenario, uncertainty)

    result = optimize_allocation(
        two_site_scenario, scenario_set, burden, uncertainty, ALPHA
    )
    lp_j = evaluate_strategy(
        two_site_scenario, result.allocation, scenario_set, burden, uncertainty, ALPHA
    ).objective

    k_a = two_site_scenario.sites[0].capacity_mw  # A, 500
    k_b = two_site_scenario.sites[1].capacity_mw  # B, 300
    step = 5.0
    grid_a = np.arange(0.0, k_a + step, step)
    grid_b = np.arange(0.0, k_b + step, step)
    d = two_site_scenario.system.required_capacity_mw

    best_grid_j = np.inf
    best_point = None
    for x_a, x_b in itertools.product(grid_a, grid_b):
        if x_a + x_b < d:
            continue
        allocation = Allocation(by_site={"A": float(x_a), "B": float(x_b)})
        j = evaluate_strategy(
            two_site_scenario, allocation, scenario_set, burden, uncertainty, ALPHA
        ).objective
        if j < best_grid_j:
            best_grid_j = j
            best_point = (x_a, x_b)

    # The grid minimum can only be >= the true LP optimum (the LP searches
    # the full continuous feasible set, the grid searches a finite subset
    # of it) -- and cannot beat it by more than the grid's own resolution
    # allows (a conservative bound: the objective's steepest local slope is
    # bounded by lambda * (a full month's shortfall change per MW), so a
    # `step`-sized grid cannot systematically hide a large improvement).
    assert lp_j <= best_grid_j + 1e-6, (
        f"LP optimum ({lp_j}) is worse than the grid's best point {best_point} "
        f"({best_grid_j}) -- the LP should never lose to a subset of its own "
        "feasible set."
    )
    assert best_grid_j - lp_j < 5.0, (
        f"grid minimum ({best_grid_j} at {best_point}) is suspiciously far above "
        f"the LP optimum ({lp_j}) for a step={step} MW grid -- investigate "
        "before trusting either result."
    )


# ---------------------------------------------------------------------------
# Coordinate-bounds sanity
# ---------------------------------------------------------------------------


def test_representative_allocation_lies_within_its_own_coordinate_bounds(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    scenario = baseline.model_copy(
        update={"system": baseline.system.model_copy(update={"lambda_mw_month": 0.05})}
    )
    scenario_set = enumerate_exact(scenario, uncertainty)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty, ALPHA)

    for site_id, x_i in result.allocation.by_site.items():
        lo, hi = result.coordinate_bounds[site_id]
        assert lo <= hi
        # x_i (the representative allocation) is itself one point on the
        # optimal face, so it must lie within its own reported marginal
        # range, up to ordinary solver tolerance.
        assert lo - 1e-6 <= x_i <= hi + 1e-6


def test_coordinate_bounds_never_exceed_site_capacity(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    scenario_set = enumerate_exact(baseline, uncertainty)
    result = optimize_allocation(baseline, scenario_set, burden, uncertainty, ALPHA)
    capacities = {s.id: s.capacity_mw for s in baseline.sites}
    for site_id, (lo, hi) in result.coordinate_bounds.items():
        assert 0.0 <= lo <= hi <= capacities[site_id] + 1e-6


# ---------------------------------------------------------------------------
# LP objective never worse than the true optimum's own re-derivation via a
# second, independent transparent method (closed-form for a single-tranche,
# no-delay-ever construction: minimal-cost feasible fill).
# ---------------------------------------------------------------------------


def test_closed_form_minimal_cost_case_matches_lp() -> None:
    from trackc.model.schemas import (
        BurdenStateDefinition,
        Site,
        SystemInputs,
        UncertaintyStateConfig,
        UncertaintyStateDefinition,
    )

    zero_delay = UncertaintyStateDefinition(
        label="Deterministic (test-only)",
        interpretation="Single zero-delay outcome for a closed-form cross-check.",
        delay_months=[0.0],
        probabilities=[1.0],
    )
    uncertainty_config = UncertaintyStateConfig(
        mapping_version="v1-deterministic-invariant-test",
        states={1: zero_delay, 2: zero_delay, 3: zero_delay, 4: zero_delay},
    )
    # Full power effectively from t=0 for every state -- isolates this
    # closed-form cost-only check from tranche-timing effects (the
    # project's real `burden` fixture's state 1 reaches full power only at
    # month 24, which would introduce a real, non-zero delay burden here
    # unrelated to what this test is checking).
    immediate = BurdenStateDefinition(
        label="Immediate (test-only)",
        interpretation="Full power effectively from t=0.",
        tau1_bar=0.1,
        tau2_bar=0.2,
    )
    burden = BurdenStateConfig(
        mapping_version="v1-immediate-invariant-test",
        states={1: immediate, 2: immediate, 3: immediate, 4: immediate},
    )
    scenario = Scenario(
        system=SystemInputs(
            required_capacity_mw=550.0, target_month=6, horizon_month=12, lambda_mw_month=2.0
        ),
        sites=[
            Site(id="A", capacity_mw=300.0, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
            Site(id="B", capacity_mw=300.0, cost_per_mw=2.0, burden_state=1, uncertainty_state=1),
            Site(id="C", capacity_mw=300.0, cost_per_mw=3.0, burden_state=1, uncertainty_state=1),
        ],
    )
    scenario_set = enumerate_exact(scenario, uncertainty_config)
    result = optimize_allocation(scenario, scenario_set, burden, uncertainty_config, ALPHA)

    # Closed form: no delay ever occurs (deterministic zero-delay), so
    # E[L]=0 for ANY feasible allocation regardless of lambda -- the
    # problem collapses to plain minimal-cost greedy fill: cheapest site
    # first (A, all 300), then next cheapest (B) for the remaining 250.
    expected_cost = 300.0 * 1.0 + 250.0 * 2.0  # = 800.0
    eval_result = evaluate_strategy(
        scenario, result.allocation, scenario_set, burden, uncertainty_config, ALPHA
    )
    assert eval_result.expected_delay_burden_mw_months == pytest.approx(0.0, abs=1e-9)
    assert eval_result.development_cost == pytest.approx(expected_cost, abs=1e-6)
    assert result.allocation.by_site["A"] == pytest.approx(300.0, abs=1e-6)
    assert result.allocation.by_site["B"] == pytest.approx(250.0, abs=1e-6)
    assert result.allocation.by_site["C"] == pytest.approx(0.0, abs=1e-6)
