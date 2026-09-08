"""Convergence gate (a model validation invariant), restated for the
evaluator's own metrics (`P_meet`, `E[S]`, `E[L]`) -- the scenario-engine gate in
`tests/convergence/test_mc_vs_exact_convergence.py` only covers the
scenario-engine proxies (`weighted_mean_delay()`, `P(all sites zero delay)`),
which are not `P_meet` / `E[S]` / `E[L]`.

Uses the baseline scenario with the partial allocation x=(100,300,100),
lambda=0: exact P_meet=0.4, E[S]=60.0, E[L]=405.0 (hand-computed, see
`tests/unit/test_evaluator.py`) -- a genuinely non-degenerate probability
(not 0 or 1), so the Monte Carlo estimator actually has variance to shrink.
The full-allocation baseline is unsuitable here: P_meet=1.0 for every
realization (see `tests/unit/test_evaluator.py::test_full_allocation_...`),
so it would give a convergence test nothing to converge from.
"""

import numpy as np
import pytest

from trackc.model.evaluator import evaluate_strategy
from trackc.model.scenario_engine import enumerate_exact, sample_monte_carlo
from trackc.model.schemas import Allocation

# baseline / burden / uncertainty fixtures are shared via tests/conftest.py.

ALPHA = 0.50
X = {"A": 100.0, "B": 300.0, "C": 100.0}
SAMPLE_SIZES = (1_000, 5_000, 10_000, 50_000)
SEED = 20_240_827


def _exact_metrics(baseline, burden, uncertainty):
    exact_set = enumerate_exact(baseline, uncertainty)
    r = evaluate_strategy(
        baseline, Allocation(by_site=X), exact_set, burden, uncertainty, alpha=ALPHA
    )
    return r.p_meet, r.expected_shortfall_mw, r.expected_delay_burden_mw_months


def _mc_metrics(baseline, burden, uncertainty, m, seed):
    mc_set = sample_monte_carlo(baseline, uncertainty, n_samples=m, random_seed=seed)
    r = evaluate_strategy(baseline, Allocation(by_site=X), mc_set, burden, uncertainty, alpha=ALPHA)
    return r.p_meet, r.expected_shortfall_mw, r.expected_delay_burden_mw_months


def test_exact_metrics_match_hand_computed_fixture(baseline, burden, uncertainty) -> None:
    p_meet, e_s, e_l = _exact_metrics(baseline, burden, uncertainty)
    assert p_meet == pytest.approx(0.4)
    assert e_s == pytest.approx(60.0, abs=1e-9)
    assert e_l == pytest.approx(405.0)


def test_mc_metrics_converge_to_exact_single_seed_smoke(baseline, burden, uncertainty) -> None:
    exact_p, exact_s, exact_l = _exact_metrics(baseline, burden, uncertainty)

    p_errors, s_errors, l_errors = [], [], []
    for m in SAMPLE_SIZES:
        p, s, ell = _mc_metrics(baseline, burden, uncertainty, m, SEED)
        p_errors.append(abs(p - exact_p))
        s_errors.append(abs(s - exact_s))
        l_errors.append(abs(ell - exact_l))

    # single-seed smoke check: the largest-M estimate lands near exact and
    # beats the smallest-M estimate (the noise-averaged gate below is the
    # real convergence statement -- see test_*_converges_across_independent_seeds).
    assert p_errors[-1] < 0.02
    assert p_errors[-1] < p_errors[0]
    assert s_errors[-1] < 5.0
    assert s_errors[-1] < s_errors[0]
    assert l_errors[-1] < 30.0
    assert l_errors[-1] < l_errors[0]


# Same noise-averaged convergence-gate design as
# tests/convergence/test_mc_vs_exact_convergence.py (model spec): the
# estimator's spread across independent seeds must shrink like 1/sqrt(M).
CONVERGENCE_SEEDS = tuple(range(1, 25))
_MIN_SPREAD_SHRINK = 4.0  # theoretical shrink over 50x sample growth is sqrt(50) ~ 7.07

_METRIC_NAMES = ("p_meet", "expected_shortfall", "expected_delay_burden")


def _full_sweep(baseline, burden, uncertainty) -> dict[str, tuple[list[float], list[float]]]:
    """One 24-seed x 4-sample-size MC sweep, all three metrics computed
    together per (m, seed) draw -- `_mc_metrics` already returns all three
    from a single `evaluate_strategy` call, so sweeping once here (instead of
    once per metric) avoids tripling the MC workload (96 vs 288
    `evaluate_strategy` calls, ~170 MiB of arrays each at the 50_000 tier).

    Returns ``{metric_name: (spread_by_m, err_by_m)}``.
    """
    exact_by_metric = dict(zip(_METRIC_NAMES, _exact_metrics(baseline, burden, uncertainty)))

    draws_by_m = {name: [] for name in _METRIC_NAMES}
    for m in SAMPLE_SIZES:
        per_metric_draws = {name: [] for name in _METRIC_NAMES}
        for seed in CONVERGENCE_SEEDS:
            for name, value in zip(
                _METRIC_NAMES, _mc_metrics(baseline, burden, uncertainty, m, seed)
            ):
                per_metric_draws[name].append(value)
        for name in _METRIC_NAMES:
            draws_by_m[name].append(np.array(per_metric_draws[name]))

    return {
        name: (
            [float(np.std(draws)) for draws in draws_by_m[name]],
            [float(abs(draws.mean() - exact_by_metric[name])) for draws in draws_by_m[name]],
        )
        for name in _METRIC_NAMES
    }


def _assert_converges(
    spread_by_m: list[float], err_by_m: list[float], err_threshold: float
) -> None:
    assert spread_by_m[0] / spread_by_m[-1] >= _MIN_SPREAD_SHRINK
    for prev, cur in zip(spread_by_m, spread_by_m[1:]):
        assert cur <= prev * 1.35
    assert err_by_m[-1] < err_threshold


def test_pmeet_shortfall_and_delay_burden_converge_across_independent_seeds(
    baseline, burden, uncertainty
) -> None:
    sweep = _full_sweep(baseline, burden, uncertainty)
    _assert_converges(*sweep["p_meet"], err_threshold=0.01)
    _assert_converges(*sweep["expected_shortfall"], err_threshold=2.0)
    _assert_converges(*sweep["expected_delay_burden"], err_threshold=15.0)
