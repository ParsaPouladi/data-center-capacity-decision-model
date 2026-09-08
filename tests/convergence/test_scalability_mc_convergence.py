"""Monte-Carlo convergence gate at N=10: where exact enumeration remains
possible, compare Monte Carlo against exact ground truth -- generalizing
``tests/convergence/test_evaluator_mc_convergence.py``'s N=3 baseline gate
to confirm convergence is not an artifact of the tiny 3-site fixture.

N=10 (3^10 = 59,049 exact realizations) is the largest N under the
production ``configs/model_defaults.yaml`` threshold (100,000) where exact
enumeration remains available as ground truth (model spec). Uses a
synthetic portfolio (``trackc.experiments.scalability``) and the
cost-concentration benchmark allocation, chosen (seed=81011,
required_capacity_fraction=0.3) because it gives a genuinely non-degenerate
exact ``P_meet`` (0.60, not 0 or 1) -- see the sibling evaluator
convergence gate for why a degenerate probability gives the estimator
nothing to converge from. The diversified benchmark was tried first and rejected:
at N=10 it produces P_meet in {0, ~1} for every seed/fraction combination
tried (every random 10-site draw includes at least one very-late-tranche
site whose share is never met by T*, or effectively always is).

Uses fewer independent seeds (10, not the sibling gates' 24) to keep this
test's contribution to the ordinary suite runtime bounded (a
testing guideline: keep ordinary CI tests fast) -- the spread-shrink
threshold is unchanged, since the theoretical 1/sqrt(M) shrink over a 50x
sample-size increase (sqrt(50) ~ 7.07) comfortably clears it even with a
noisier per-seed std estimate at n=10.
"""

from __future__ import annotations

import numpy as np
import pytest

from trackc.experiments.scalability import generate_synthetic_portfolio
from trackc.model.comparator import cost_concentration_allocation
from trackc.model.evaluator import evaluate_strategy
from trackc.model.scenario_engine import enumerate_exact, sample_monte_carlo

N_SITES = 10
PORTFOLIO_SEED = 81_011
REQUIRED_CAPACITY_FRACTION = 0.3
SAMPLE_SIZES = (1_000, 5_000, 10_000, 50_000)
CONVERGENCE_SEEDS = tuple(range(1, 11))
_MIN_SPREAD_SHRINK = 4.0


@pytest.fixture(scope="module")
def n10_scenario():
    return generate_synthetic_portfolio(
        N_SITES, PORTFOLIO_SEED, required_capacity_fraction=REQUIRED_CAPACITY_FRACTION
    )


def _exact_metrics(n10_scenario, burden, uncertainty, alpha):
    exact_set = enumerate_exact(n10_scenario, uncertainty)
    allocation = cost_concentration_allocation(n10_scenario)
    r = evaluate_strategy(n10_scenario, allocation, exact_set, burden, uncertainty, alpha)
    return r.p_meet, r.expected_shortfall_mw, r.expected_delay_burden_mw_months


def _mc_metrics(n10_scenario, burden, uncertainty, alpha, m, seed):
    mc_set = sample_monte_carlo(n10_scenario, uncertainty, n_samples=m, random_seed=seed)
    allocation = cost_concentration_allocation(n10_scenario)
    r = evaluate_strategy(n10_scenario, allocation, mc_set, burden, uncertainty, alpha)
    return r.p_meet, r.expected_shortfall_mw, r.expected_delay_burden_mw_months


def test_n10_exact_fixture_is_non_degenerate(
    n10_scenario, burden, uncertainty, model_defaults
) -> None:
    p_meet, e_s, e_l = _exact_metrics(n10_scenario, burden, uncertainty, model_defaults.alpha)
    assert 0.05 < p_meet < 0.95
    assert p_meet == pytest.approx(0.60, abs=1e-9)


def test_n10_mc_pmeet_shortfall_and_delay_burden_converge_to_exact(
    n10_scenario, burden, uncertainty, model_defaults
) -> None:
    alpha = model_defaults.alpha
    exact_p, exact_s, exact_l = _exact_metrics(n10_scenario, burden, uncertainty, alpha)

    draws_by_m = {"p_meet": [], "expected_shortfall": [], "expected_delay_burden": []}
    for m in SAMPLE_SIZES:
        p_draws, s_draws, l_draws = [], [], []
        for seed in CONVERGENCE_SEEDS:
            p, s, ell = _mc_metrics(n10_scenario, burden, uncertainty, alpha, m, seed)
            p_draws.append(p)
            s_draws.append(s)
            l_draws.append(ell)
        draws_by_m["p_meet"].append(np.array(p_draws))
        draws_by_m["expected_shortfall"].append(np.array(s_draws))
        draws_by_m["expected_delay_burden"].append(np.array(l_draws))

    exact_by_metric = {
        "p_meet": exact_p,
        "expected_shortfall": exact_s,
        "expected_delay_burden": exact_l,
    }
    err_thresholds = {"p_meet": 0.03, "expected_shortfall": 15.0, "expected_delay_burden": 60.0}

    for name, draws_list in draws_by_m.items():
        spread_by_m = [float(np.std(d)) for d in draws_list]
        err_by_m = [float(abs(d.mean() - exact_by_metric[name])) for d in draws_list]

        assert spread_by_m[0] / spread_by_m[-1] >= _MIN_SPREAD_SHRINK, (
            f"{name}: spread did not shrink by >= {_MIN_SPREAD_SHRINK}x from M="
            f"{SAMPLE_SIZES[0]} to M={SAMPLE_SIZES[-1]} ({spread_by_m})"
        )
        assert err_by_m[-1] < err_thresholds[name], (
            f"{name}: seed-averaged error at largest M ({err_by_m[-1]}) exceeds "
            f"threshold ({err_thresholds[name]})"
        )
