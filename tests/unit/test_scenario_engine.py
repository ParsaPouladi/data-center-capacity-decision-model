"""Scenario engine tests (model spec), hand-calculated
against the baseline fixture's own site / uncertainty-state definitions.

Baseline scenario (sites in order A, B, C):

    A: U=3 -> delays [0, 9, 18], probs [0.40, 0.35, 0.25]   E[delta] = 7.65
    B: U=1 -> delays [0, 3, 6],  probs [0.80, 0.15, 0.05]   E[delta] = 0.75
    C: U=2 -> delays [0, 6, 12], probs [0.60, 0.30, 0.10]   E[delta] = 3.00

q = (3, 3, 3) -> S_full = prod_i q_i = 27.
All-zero-delay realization probability = 0.40 * 0.80 * 0.60 = 0.192.
Max-delay realization (18, 6, 12) probability = 0.25 * 0.05 * 0.10 = 0.00125.
"""

from pathlib import Path

import numpy as np
import pytest

from trackc.model.scenario_engine import (
    ScenarioSet,
    build_scenario_set,
    enumerate_exact,
    sample_monte_carlo,
    scenario_count,
)
from trackc.model.schemas import (
    ModelDefaults,
    Scenario,
    Site,
    SystemInputs,
    UncertaintyStateConfig,
    load_scenario,
    load_uncertainty_states,
)


@pytest.fixture
def baseline(baseline_scenario_path: Path) -> Scenario:
    return load_scenario(baseline_scenario_path)


@pytest.fixture
def uncertainty(uncertainty_states_path: Path) -> UncertaintyStateConfig:
    return load_uncertainty_states(uncertainty_states_path)


# --- exact enumeration -----------------------------------------------------


def test_scenario_count_is_product_of_per_site_outcome_counts(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    assert scenario_count(baseline, uncertainty) == 27


def test_scenario_count_uses_product_not_power_when_q_differs(
    uncertainty: UncertaintyStateConfig,
) -> None:
    # A config where one state has 2 outcomes and another has 4: a scenario
    # mixing them must give prod_i q_i, which q^N could not express.
    cfg = UncertaintyStateConfig.model_validate(
        {
            "mapping_version": "test-uneven",
            "states": {
                1: {
                    "label": "two",
                    "interpretation": "two outcomes",
                    "delay_months": [0, 4],
                    "probabilities": [0.7, 0.3],
                },
                2: {
                    "label": "four",
                    "interpretation": "four outcomes",
                    "delay_months": [0, 3, 6, 9],
                    "probabilities": [0.4, 0.3, 0.2, 0.1],
                },
                3: uncertainty.states[3].model_dump(),
                4: uncertainty.states[4].model_dump(),
            },
        }
    )
    system = SystemInputs(
        required_capacity_mw=100, target_month=12, horizon_month=24, lambda_mw_month=0
    )
    sites = [
        Site(id="s1", capacity_mw=10, cost_per_mw=1, burden_state=1, uncertainty_state=1),
        Site(id="s2", capacity_mw=10, cost_per_mw=1, burden_state=1, uncertainty_state=2),
        Site(id="s3", capacity_mw=10, cost_per_mw=1, burden_state=1, uncertainty_state=3),
    ]
    scenario = Scenario(system=system, sites=sites)
    assert scenario_count(scenario, cfg) == 2 * 4 * 3  # == 24, not 3**3

    result = enumerate_exact(scenario, cfg)
    assert result.n_realizations == 24
    # Generality is not just the count: the uneven joint probabilities must
    # still normalize and still factor into the (unequal-length) per-site
    # marginals F(U_i).
    assert result.probabilities.sum() == pytest.approx(1.0)
    expected_marginals = {
        0: ([0.0, 4.0], [0.7, 0.3]),
        1: ([0.0, 3.0, 6.0, 9.0], [0.4, 0.3, 0.2, 0.1]),
        2: ([0.0, 9.0, 18.0], [0.40, 0.35, 0.25]),
    }
    for col, (delays, probs) in expected_marginals.items():
        for d, p in zip(delays, probs):
            mass = result.probabilities[result.delays[:, col] == d].sum()
            assert mass == pytest.approx(p)


def test_exact_enumeration_produces_s_full_realizations(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = enumerate_exact(baseline, uncertainty)
    assert result.method == "exact"
    assert result.random_seed is None
    assert result.n_samples is None
    assert result.site_ids == ("A", "B", "C")
    assert result.delays.shape == (27, 3)
    assert result.probabilities.shape == (27,)


def test_exact_joint_probabilities_sum_to_one(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    # a model validation invariant
    result = enumerate_exact(baseline, uncertainty)
    assert result.probabilities.sum() == pytest.approx(1.0, abs=1e-12)


def test_exact_enumeration_matches_hand_computed_endpoints(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = enumerate_exact(baseline, uncertainty)
    rows = {tuple(d): p for d, p in zip(result.delays.tolist(), result.probabilities.tolist())}

    assert rows[(0.0, 0.0, 0.0)] == pytest.approx(0.40 * 0.80 * 0.60)  # 0.192
    assert rows[(18.0, 6.0, 12.0)] == pytest.approx(0.25 * 0.05 * 0.10)  # 0.00125
    assert rows[(9.0, 3.0, 6.0)] == pytest.approx(0.35 * 0.15 * 0.30)


def test_exact_enumeration_last_site_varies_fastest(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = enumerate_exact(baseline, uncertainty)
    # first three rows: A=0, B=0, C sweeps its three outcomes [0, 6, 12]
    assert result.delays[0].tolist() == [0.0, 0.0, 0.0]
    assert result.delays[1].tolist() == [0.0, 0.0, 6.0]
    assert result.delays[2].tolist() == [0.0, 0.0, 12.0]


def test_exact_per_site_marginals_reproduce_F_of_U(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = enumerate_exact(baseline, uncertainty)
    expected = {
        0: ([0.0, 9.0, 18.0], [0.40, 0.35, 0.25]),
        1: ([0.0, 3.0, 6.0], [0.80, 0.15, 0.05]),
        2: ([0.0, 6.0, 12.0], [0.60, 0.30, 0.10]),
    }
    for col, (delays, probs) in expected.items():
        for d, p in zip(delays, probs):
            mass = result.probabilities[result.delays[:, col] == d].sum()
            assert mass == pytest.approx(p)


def test_exact_joint_probability_is_product_of_marginals(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    # Independence (FROZEN): P(delta_A, delta_B, delta_C) == P(A) P(B) P(C).
    result = enumerate_exact(baseline, uncertainty)
    for row in range(result.n_realizations):
        p_joint = result.probabilities[row]
        p_prod = 1.0
        for col in range(3):
            d = result.delays[row, col]
            p_prod *= result.probabilities[result.delays[:, col] == d].sum()
        assert p_joint == pytest.approx(p_prod)


def test_exact_weighted_mean_delay_matches_hand_values(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = enumerate_exact(baseline, uncertainty)
    np.testing.assert_allclose(result.weighted_mean_delay(), [7.65, 0.75, 3.00])


# --- degenerate / invariant cases ---------------------------------------------


def test_zero_delay_collapse_yields_single_certain_realization(
    baseline: Scenario,
) -> None:
    # a model validation invariant: if all uncertainty collapses to zero
    # delay, every realization is identical.
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
    exact = enumerate_exact(baseline, collapsed)
    assert exact.n_realizations == 1
    assert exact.probabilities.tolist() == [1.0]
    assert exact.delays.tolist() == [[0.0, 0.0, 0.0]]

    mc = sample_monte_carlo(baseline, collapsed, n_samples=50, random_seed=1)
    assert np.array_equal(mc.delays, np.zeros((50, 3)))


def test_scenario_set_rejects_probabilities_not_summing_to_one() -> None:
    with pytest.raises(ValueError, match="sum to 1"):
        ScenarioSet(
            site_ids=("a",),
            delays=np.zeros((2, 1)),
            probabilities=np.array([0.4, 0.4]),
            method="exact",
        )


def test_scenario_set_rejects_negative_delay() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        ScenarioSet(
            site_ids=("a",),
            delays=np.array([[-1.0]]),
            probabilities=np.array([1.0]),
            method="exact",
        )


# --- Monte Carlo ------------------------------------------------------------


def test_monte_carlo_shape_weights_and_metadata(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = sample_monte_carlo(baseline, uncertainty, n_samples=1000, random_seed=7)
    assert result.method == "monte_carlo"
    assert result.random_seed == 7
    assert result.n_samples == 1000
    assert result.delays.shape == (1000, 3)
    assert result.probabilities.tolist() == [1.0 / 1000] * 1000
    assert result.probabilities.sum() == pytest.approx(1.0)


def test_monte_carlo_identical_seed_reproduces_identical_results(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    # the model specification / a model validation invariant
    a = sample_monte_carlo(baseline, uncertainty, n_samples=2000, random_seed=42)
    b = sample_monte_carlo(baseline, uncertainty, n_samples=2000, random_seed=42)
    assert np.array_equal(a.delays, b.delays)
    assert np.array_equal(a.probabilities, b.probabilities)


def test_monte_carlo_different_seed_changes_draws(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    a = sample_monte_carlo(baseline, uncertainty, n_samples=2000, random_seed=1)
    b = sample_monte_carlo(baseline, uncertainty, n_samples=2000, random_seed=2)
    assert not np.array_equal(a.delays, b.delays)


def test_monte_carlo_only_ever_draws_configured_delay_values(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = sample_monte_carlo(baseline, uncertainty, n_samples=5000, random_seed=3)
    assert set(np.unique(result.delays[:, 0])).issubset({0.0, 9.0, 18.0})
    assert set(np.unique(result.delays[:, 1])).issubset({0.0, 3.0, 6.0})
    assert set(np.unique(result.delays[:, 2])).issubset({0.0, 6.0, 12.0})
    assert np.all(result.delays >= 0)


def test_monte_carlo_marginal_frequencies_approximate_F_of_U(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = sample_monte_carlo(baseline, uncertainty, n_samples=40000, random_seed=2024)
    freq_zero_A = np.mean(result.delays[:, 0] == 0.0)
    assert freq_zero_A == pytest.approx(0.40, abs=0.02)
    freq_zero_B = np.mean(result.delays[:, 1] == 0.0)
    assert freq_zero_B == pytest.approx(0.80, abs=0.02)


# --- automatic switching -------------------------------------------------------


def _defaults(max_exact: int) -> ModelDefaults:
    return ModelDefaults(
        alpha=0.5, max_exact_scenarios=max_exact, mc_samples=5000, random_seed=99
    )


def test_build_scenario_set_uses_exact_when_count_within_threshold(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = build_scenario_set(baseline, uncertainty, _defaults(max_exact=27))
    assert result.method == "exact"
    assert result.n_realizations == 27


def test_build_scenario_set_switches_to_monte_carlo_above_threshold(
    baseline: Scenario, uncertainty: UncertaintyStateConfig
) -> None:
    result = build_scenario_set(baseline, uncertainty, _defaults(max_exact=26))
    assert result.method == "monte_carlo"
    assert result.n_samples == 5000
    assert result.random_seed == 99
