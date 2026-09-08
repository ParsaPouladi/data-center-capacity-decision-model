"""Structural invariants for the comparator (model spec). The
acceptance criterion is "the system can explain mathematically why
strategy rankings change" -- these are the structural properties that any
such explanation implicitly relies on: dominance must behave like a genuine
partial order component, the concentration metric must stay in its
mathematical range, and the Pareto frontier must never retain a dominated
point.
"""

import numpy as np
import pytest

from trackc.model.comparator import (
    concentration_metric,
    dominates,
    global_switching_boundaries,
    pareto_frontier,
    preferred_strategy_at_lambda,
)
from trackc.model.evaluator import evaluate_strategy
from trackc.model.schemas import Allocation, BurdenStateConfig, Scenario, UncertaintyStateConfig

ALPHA = 0.50


def _random_results(baseline: Scenario, burden, uncertainty, exact_set, seed: int, n: int = 6):
    rng = np.random.default_rng(seed)
    caps = {s.id: s.capacity_mw for s in baseline.sites}
    results = []
    for _ in range(n):
        x = {sid: float(rng.uniform(0, k)) for sid, k in caps.items()}
        results.append(
            evaluate_strategy(
                baseline, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
            )
        )
    return results


# --- dominance is irreflexive and asymmetric --------------------------------


@pytest.mark.parametrize("seed", range(5))
def test_dominates_is_irreflexive_and_asymmetric(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    seed: int,
) -> None:
    results = _random_results(baseline, burden, uncertainty, exact_set, seed)
    for r in results:
        assert not dominates(r, r)  # irreflexive: nothing dominates itself
    for a in results:
        for b in results:
            if a is b:
                continue
            if dominates(a, b):
                assert not dominates(b, a)  # asymmetric


# --- Pareto frontier never retains a dominated point ------------------------


@pytest.mark.parametrize("seed", range(5))
def test_pareto_frontier_excludes_every_dominated_point(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    seed: int,
) -> None:
    results = _random_results(baseline, burden, uncertainty, exact_set, seed, n=10)
    frontier = pareto_frontier(results)
    frontier_ids = {id(r) for r in frontier}

    for r in results:
        is_dominated = any(dominates(other, r) for other in results if other is not r)
        assert (id(r) in frontier_ids) == (not is_dominated)


@pytest.mark.parametrize("seed", range(3))
def test_pareto_frontier_is_a_subset_of_its_input(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    seed: int,
) -> None:
    results = _random_results(baseline, burden, uncertainty, exact_set, seed)
    frontier = pareto_frontier(results)
    assert all(any(r is orig for orig in results) for r in frontier)
    assert len(frontier) <= len(results)
    assert len(frontier) >= 1  # the cheapest strategy is always non-dominated on cost


# --- concentration metric stays within its mathematical range ---------------


@pytest.mark.parametrize("seed", range(5))
def test_concentration_metric_weights_sum_to_one_and_hhi_in_range(
    baseline: Scenario, seed: int
) -> None:
    rng = np.random.default_rng(seed)
    caps = {s.id: s.capacity_mw for s in baseline.sites}
    site_ids = tuple(caps)
    x = {sid: float(rng.uniform(0, k)) for sid, k in caps.items()}
    weights, hhi = concentration_metric(Allocation(by_site=x), site_ids)

    assert sum(weights.values()) == pytest.approx(1.0)
    assert all(0.0 <= w <= 1.0 for w in weights.values())
    n = len(site_ids)
    assert 1.0 / n - 1e-9 <= hhi <= 1.0 + 1e-9  # HHI in [1/N, 1] for N sites


# --- global_switching_boundaries: structural properties (model spec) --
#
# preferred_strategy_at_lambda's own brute-force argmin is used here as the
# independent ground truth (it does not call global_switching_boundaries),
# so this checks the boundary function's segments against a from-scratch
# minimum at each midpoint, not against its own internal bookkeeping.


@pytest.mark.parametrize("seed", range(5))
def test_global_switching_boundaries_are_strictly_increasing_and_start_at_zero(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    seed: int,
) -> None:
    results_list = _random_results(baseline, burden, uncertainty, exact_set, seed, n=5)
    results = {f"r{i}": r for i, r in enumerate(results_list)}
    boundaries = global_switching_boundaries(results)

    assert boundaries[0][0] == 0.0
    lambdas = [lam for lam, _ in boundaries]
    assert lambdas == sorted(lambdas)
    assert len(set(lambdas)) == len(lambdas)  # no duplicate breakpoints
    names = [name for _, name in boundaries]
    assert all(a != b for a, b in zip(names, names[1:]))  # no two consecutive segments tied


@pytest.mark.parametrize("seed", range(5))
def test_global_switching_boundaries_winners_are_independently_confirmed_minimal(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    seed: int,
) -> None:
    results_list = _random_results(baseline, burden, uncertainty, exact_set, seed, n=5)
    results = {f"r{i}": r for i, r in enumerate(results_list)}
    boundaries = global_switching_boundaries(results)

    for (start, winner), (end, _) in zip(
        boundaries, [*boundaries[1:], (boundaries[-1][0] + 1.0, None)]
    ):
        lam = (start + end) / 2.0
        # independent brute-force minimum at this lambda -- not calling
        # preferred_strategy_at_lambda's own implementation twice, but
        # recomputing J by hand from the raw StrategyResult fields.
        j_by_name = {
            name: r.development_cost + lam * r.expected_delay_burden_mw_months
            for name, r in results.items()
        }
        brute_force_winner = min(j_by_name, key=j_by_name.get)
        assert winner == brute_force_winner


def test_global_switching_boundaries_single_strategy_is_the_only_segment(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    from trackc.model.comparator import cost_concentration_allocation

    r = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    assert global_switching_boundaries({"only": r}) == [(0.0, "only")]
    assert preferred_strategy_at_lambda({"only": r}, 5.0) == "only"
