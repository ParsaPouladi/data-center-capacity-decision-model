"""Scenario-engine convergence gate (a model validation invariant).

For the 3-site baseline case exact enumeration is available, so Monte Carlo
estimates can be checked directly against exact values as the sample size
grows (the model specification: "For small cases where exact
enumeration is possible, compare Monte Carlo estimates against exact values").

`P_meet`, `E[S]`, `E[L]` are evaluator metrics and are not used here, so this
gate uses two scenario-engine-level proxies computed straight from the scenario set:

* a mean-type proxy: the probability-weighted realized delay per site,
  `E[delta_i]` -- exact value [7.65, 0.75, 3.00];
* a probability-type proxy: `P(all three sites have zero delay)` -- exact
  value 0.40 * 0.80 * 0.60 = 0.192.

Both are evaluated with fixed seeds, so this test is fully reproducible.

Two levels of check per proxy:

* a single-seed smoke check (one noisy draw lands near exact and beats the
  small-M estimate); and
* a noise-averaged convergence gate over many independent seeds, asserting the
  estimator's across-seed spread shrinks like ``1 / sqrt(M)`` -- the actual
  statement of Monte Carlo convergence (model spec).
"""

from pathlib import Path

import numpy as np
import pytest

from trackc.model.scenario_engine import enumerate_exact, sample_monte_carlo
from trackc.model.schemas import (
    Scenario,
    UncertaintyStateConfig,
    load_scenario,
    load_uncertainty_states,
)

SAMPLE_SIZES = (1_000, 5_000, 10_000, 50_000)
SEED = 20_240_827


@pytest.fixture
def baseline(baseline_scenario_path: Path) -> Scenario:
    return load_scenario(baseline_scenario_path)


@pytest.fixture
def uncertainty(uncertainty_states_path: Path) -> UncertaintyStateConfig:
    return load_uncertainty_states(uncertainty_states_path)


def _p_all_zero(delays: np.ndarray, weights: np.ndarray) -> float:
    return float(weights[np.all(delays == 0.0, axis=1)].sum())


def test_mc_mean_delay_converges_to_exact(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    # Single-seed smoke check: one Monte Carlo draw is noisy, so per-step
    # error is not monotone in M (e.g. M=5000 can beat M=10000 by luck). This
    # test only asserts the large-M estimate lands near exact and beats the
    # small-M estimate; the actual convergence gate is
    # test_mc_mean_delay_converges_across_independent_seeds below, which
    # averages out single-draw luck.
    exact_mean = enumerate_exact(baseline, uncertainty).weighted_mean_delay()

    errors = []
    for m in SAMPLE_SIZES:
        mc = sample_monte_carlo(baseline, uncertainty, n_samples=m, random_seed=SEED)
        assert mc.probabilities.sum() == pytest.approx(1.0)
        errors.append(float(np.max(np.abs(mc.weighted_mean_delay() - exact_mean))))

    assert errors[-1] < 0.15
    assert errors[-1] < errors[0]


def test_mc_probability_proxy_converges_to_exact(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    exact = enumerate_exact(baseline, uncertainty)
    exact_p = _p_all_zero(exact.delays, exact.probabilities)
    assert exact_p == pytest.approx(0.192)

    errors = []
    for m in SAMPLE_SIZES:
        mc = sample_monte_carlo(baseline, uncertainty, n_samples=m, random_seed=SEED)
        errors.append(abs(_p_all_zero(mc.delays, mc.probabilities) - exact_p))

    assert errors[-1] < 0.01
    assert errors[-1] < errors[0]


# Seeds for the noise-averaged convergence gates below. Enough seeds that the
# across-seed sample standard deviation is itself a stable estimate of the
# Monte Carlo standard error (SE of a sample std ~ sigma / sqrt(2*(n-1)),
# ~15% for n = 24).
CONVERGENCE_SEEDS = tuple(range(1, 25))

# Theoretical MC standard error shrinks as 1 / sqrt(M), so growing M by 50x
# (1_000 -> 50_000) shrinks the across-seed spread by sqrt(50) ~ 7.07. Require
# at least a 4x shrink -- comfortably below 7.07, but far above what a biased,
# draw-reusing, or cross-site-correlated sampler would produce.
_MIN_SPREAD_SHRINK = 4.0


def _spread_and_error_by_m(estimator, exact_value: np.ndarray) -> tuple[list[float], list[float]]:
    """For each sample size, return (across-seed max-over-component std,
    max-over-component |seed-mean estimate - exact|)."""
    spread_by_m: list[float] = []
    err_by_m: list[float] = []
    for m in SAMPLE_SIZES:
        ests = np.array([estimator(m, s) for s in CONVERGENCE_SEEDS])
        spread_by_m.append(float(np.max(np.std(ests, axis=0))))
        err_by_m.append(float(np.max(np.abs(ests.mean(axis=0) - exact_value))))
    return spread_by_m, err_by_m


def test_mc_mean_delay_converges_across_independent_seeds(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    # The actual statement of Monte Carlo convergence: the estimator's spread
    # across independent seeds must shrink like 1 / sqrt(M) (the model specification;
    # a model validation invariant). This is far more stable to the choice of seed
    # set / SAMPLE_SIZES than an endpoint error ratio on a single seed-mean.
    exact_mean = enumerate_exact(baseline, uncertainty).weighted_mean_delay()

    def estimator(m: int, s: int) -> np.ndarray:
        return sample_monte_carlo(
            baseline, uncertainty, n_samples=m, random_seed=s
        ).weighted_mean_delay()

    spread_by_m, err_by_m = _spread_and_error_by_m(estimator, exact_mean)

    # spread shrinks by at least 4x from the smallest to the largest M ...
    assert spread_by_m[0] / spread_by_m[-1] >= _MIN_SPREAD_SHRINK
    # ... and never grows by more than sampling noise on the std estimate as M
    # increases (no divergence; allows a mild non-monotone wobble).
    for prev, cur in zip(spread_by_m, spread_by_m[1:]):
        assert cur <= prev * 1.35
    # and the seed-averaged estimate is essentially unbiased at the largest M.
    assert err_by_m[-1] < 0.05


def test_mc_probability_proxy_converges_across_independent_seeds(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    # Same noise-averaged convergence gate for the probability-type proxy
    # P(all three sites zero delay), exact value 0.192.
    exact = enumerate_exact(baseline, uncertainty)
    exact_p = np.array([_p_all_zero(exact.delays, exact.probabilities)])

    def estimator(m: int, s: int) -> np.ndarray:
        mc = sample_monte_carlo(baseline, uncertainty, n_samples=m, random_seed=s)
        return np.array([_p_all_zero(mc.delays, mc.probabilities)])

    spread_by_m, err_by_m = _spread_and_error_by_m(estimator, exact_p)

    assert spread_by_m[0] / spread_by_m[-1] >= _MIN_SPREAD_SHRINK
    for prev, cur in zip(spread_by_m, spread_by_m[1:]):
        assert cur <= prev * 1.35
    assert err_by_m[-1] < 0.005
