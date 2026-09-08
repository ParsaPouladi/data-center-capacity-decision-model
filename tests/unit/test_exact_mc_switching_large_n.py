"""Exact/Monte-Carlo method-selection verification at larger N.

``tests/unit/test_scenario_engine.py`` already covers the generalized
product-form scenario count (non-uniform ``q_i``, the model specification) and
boundary switching AT N=3. This file exercises the SAME generalized
mechanism at larger N (up to the production default threshold's own
practical ceiling, N=10 under the current v1-baseline mapping's
q=3-per-site, and beyond it at N=11+), using the REAL
``configs/model_defaults.yaml`` values wherever practical, plus an explicit
off-by-one boundary check at a non-N=3 scale to confirm the boundary logic
is not an N=3-specific coincidence.
"""

from __future__ import annotations

import pytest

from trackc.model.scenario_engine import build_scenario_set, enumerate_exact, scenario_count
from trackc.model.schemas import (
    ModelDefaults,
    Scenario,
    Site,
    SystemInputs,
    UncertaintyStateConfig,
)

_SYSTEM = SystemInputs(
    required_capacity_mw=100.0, target_month=12, horizon_month=24, lambda_mw_month=0.0
)


def _uniform_scenario(n_sites: int) -> Scenario:
    """N sites, uncertainty_state cycling 1-4 (all q_i=3 under v1-baseline,
    the model specification) -- only the COUNT of sites matters for scenario_count,
    not their K/c, so this stays deliberately minimal.
    """
    sites = [
        Site(
            id=f"s{i}",
            capacity_mw=10.0,
            cost_per_mw=1.0,
            burden_state=1,
            uncertainty_state=(i % 4) + 1,
        )
        for i in range(n_sites)
    ]
    return Scenario(system=_SYSTEM, sites=sites)


# ---------------------------------------------------------------------------
# Generalized product form at larger N (not just N=3)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("n_sites", [3, 5, 10, 20, 50])
def test_scenario_count_matches_3_to_the_n_at_larger_n(
    n_sites: int, uncertainty: UncertaintyStateConfig
) -> None:
    # Every v1-baseline state has q_i=3 (model spec), so the general
    # product formula S_full = prod_i q_i happens to reduce to 3^N here --
    # verified explicitly at every N the model specification names, not assumed.
    scenario = _uniform_scenario(n_sites)
    assert scenario_count(scenario, uncertainty) == 3**n_sites


def test_exact_probabilities_still_sum_to_one_at_n10(
    uncertainty: UncertaintyStateConfig,
) -> None:
    # a model validation invariant, re-checked at N=10 (59,049 realizations,
    # summed in floating point) -- not just the N=3 (27-realization) case,
    # since floating-point summation error can in principle grow with the
    # number of summed terms.
    scenario = _uniform_scenario(10)
    result = enumerate_exact(scenario, uncertainty)
    assert result.n_realizations == 59_049
    assert result.probabilities.sum() == pytest.approx(1.0, abs=1e-9)


# ---------------------------------------------------------------------------
# Boundary switching with the REAL production default threshold (100_000)
# ---------------------------------------------------------------------------


def test_production_threshold_selects_exact_up_to_n10(
    uncertainty: UncertaintyStateConfig, model_defaults
) -> None:
    # 3**10 == 59_049 <= 100_000 (configs/model_defaults.yaml's real value).
    scenario = _uniform_scenario(10)
    result = build_scenario_set(scenario, uncertainty, model_defaults)
    assert result.method == "exact"
    assert result.n_realizations == 59_049


def test_production_threshold_switches_to_monte_carlo_at_n11(
    uncertainty: UncertaintyStateConfig, model_defaults
) -> None:
    # 3**11 == 177_147 > 100_000 (configs/model_defaults.yaml's real value):
    # this is the actual N at which the shipped configuration switches
    # methods -- not merely a threshold artificially lowered for the test.
    scenario = _uniform_scenario(11)
    result = build_scenario_set(scenario, uncertainty, model_defaults)
    assert result.method == "monte_carlo"
    assert result.n_samples == model_defaults.mc_samples
    assert result.random_seed == model_defaults.random_seed


# ---------------------------------------------------------------------------
# Off-by-one boundary EXACTNESS at a non-N=3 scale (generalizes
# test_scenario_engine.py's N=3 boundary tests to confirm the mechanism,
# not an N=3 coincidence)
# ---------------------------------------------------------------------------


def test_boundary_is_exact_at_n5_not_just_n3(uncertainty: UncertaintyStateConfig) -> None:
    scenario = _uniform_scenario(5)  # S_full = 243
    at_threshold = ModelDefaults(alpha=0.5, max_exact_scenarios=243, mc_samples=1000, random_seed=1)
    just_below = ModelDefaults(alpha=0.5, max_exact_scenarios=242, mc_samples=1000, random_seed=1)

    assert build_scenario_set(scenario, uncertainty, at_threshold).method == "exact"
    assert build_scenario_set(scenario, uncertainty, just_below).method == "monte_carlo"
