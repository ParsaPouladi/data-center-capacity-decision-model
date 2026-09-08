"""Input/config schema and validation tests (a model validation invariant-5)."""

from pathlib import Path

import pytest
from pydantic import ValidationError

from trackc.model.schemas import (
    Allocation,
    ModelDefaults,
    Scenario,
    Site,
    SystemInputs,
    load_burden_states,
    load_model_defaults,
    load_scenario,
    load_uncertainty_states,
    validate_allocation_against_sites,
)

# ---------------------------------------------------------------------------
# Config loading (real files)
# ---------------------------------------------------------------------------


def test_burden_states_config_loads(burden_states_path: Path) -> None:
    config = load_burden_states(burden_states_path)
    assert config.mapping_version == "v1-baseline"
    assert set(config.states) == {1, 2, 3, 4}
    # the model specification exact values
    assert config.states[1].tau1_bar == 18
    assert config.states[1].tau2_bar == 24
    assert config.states[4].tau1_bar == 42
    assert config.states[4].tau2_bar == 54


def test_uncertainty_states_config_loads(uncertainty_states_path: Path) -> None:
    config = load_uncertainty_states(uncertainty_states_path)
    assert config.mapping_version == "v1-baseline"
    assert set(config.states) == {1, 2, 3, 4}
    for state in config.states.values():
        assert abs(sum(state.probabilities) - 1.0) < 1e-9
    # the model specification exact values for state 3
    assert config.states[3].delay_months == [0, 9, 18]
    assert config.states[3].probabilities == [0.40, 0.35, 0.25]


def test_model_defaults_config_loads(model_defaults_path: Path) -> None:
    defaults = load_model_defaults(model_defaults_path)
    assert defaults.alpha == 0.50
    assert defaults.max_exact_scenarios == 100000
    assert defaults.mc_samples == 10000
    assert defaults.random_seed == 12345


def test_baseline_scenario_round_trips(baseline_scenario_path: Path) -> None:
    scenario = load_scenario(baseline_scenario_path)
    assert scenario.system.required_capacity_mw == 500
    assert scenario.system.target_month == 36
    assert scenario.system.horizon_month == 72
    assert scenario.system.lambda_mw_month == 0.0
    assert [s.id for s in scenario.sites] == ["A", "B", "C"]
    site_a = scenario.sites[0]
    assert site_a.capacity_mw == 500
    assert site_a.cost_per_mw == 1.00
    assert site_a.burden_state == 3
    assert site_a.uncertainty_state == 3


# ---------------------------------------------------------------------------
# Rejection paths (a model validation invariant-5)
# ---------------------------------------------------------------------------


def test_negative_capacity_rejected() -> None:
    with pytest.raises(ValidationError):
        Site(id="X", capacity_mw=-10, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)


def test_zero_capacity_rejected() -> None:
    with pytest.raises(ValidationError):
        Site(id="X", capacity_mw=0, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)


def test_negative_cost_rejected() -> None:
    with pytest.raises(ValidationError):
        Site(id="X", capacity_mw=100, cost_per_mw=-0.5, burden_state=1, uncertainty_state=1)


@pytest.mark.parametrize("bad_burden_state", [0, 5, -1])
def test_invalid_burden_state_rejected(bad_burden_state: int) -> None:
    with pytest.raises(ValidationError):
        Site(
            id="X",
            capacity_mw=100,
            cost_per_mw=1.0,
            burden_state=bad_burden_state,
            uncertainty_state=1,
        )


@pytest.mark.parametrize("bad_uncertainty_state", [0, 5, -1])
def test_invalid_uncertainty_state_rejected(bad_uncertainty_state: int) -> None:
    with pytest.raises(ValidationError):
        Site(
            id="X",
            capacity_mw=100,
            cost_per_mw=1.0,
            burden_state=1,
            uncertainty_state=bad_uncertainty_state,
        )


def test_negative_required_capacity_rejected() -> None:
    with pytest.raises(ValidationError):
        SystemInputs(
            required_capacity_mw=-500, target_month=36, horizon_month=72, lambda_mw_month=0.0
        )


def test_negative_lambda_rejected() -> None:
    with pytest.raises(ValidationError):
        SystemInputs(
            required_capacity_mw=500, target_month=36, horizon_month=72, lambda_mw_month=-1.0
        )


def test_horizon_must_exceed_target() -> None:
    with pytest.raises(ValidationError):
        SystemInputs(
            required_capacity_mw=500, target_month=36, horizon_month=36, lambda_mw_month=0.0
        )
    with pytest.raises(ValidationError):
        SystemInputs(
            required_capacity_mw=500, target_month=36, horizon_month=20, lambda_mw_month=0.0
        )


def test_allocation_negative_value_rejected() -> None:
    with pytest.raises(ValidationError):
        Allocation(by_site={"A": -1.0})


def test_allocation_exceeding_capacity_rejected() -> None:
    sites = [Site(id="A", capacity_mw=100, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)]
    allocation = Allocation(by_site={"A": 150.0})
    with pytest.raises(ValueError, match="exceeds site capacity"):
        validate_allocation_against_sites(allocation, sites)


def test_allocation_within_capacity_accepted() -> None:
    sites = [Site(id="A", capacity_mw=100, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)]
    allocation = Allocation(by_site={"A": 100.0})
    validate_allocation_against_sites(allocation, sites)  # must not raise


def test_allocation_unknown_site_rejected() -> None:
    sites = [Site(id="A", capacity_mw=100, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)]
    allocation = Allocation(by_site={"Z": 10.0})
    with pytest.raises(ValueError, match="unknown site id"):
        validate_allocation_against_sites(allocation, sites)


def test_duplicate_site_ids_rejected() -> None:
    site_kwargs = dict(capacity_mw=100, cost_per_mw=1.0, burden_state=1, uncertainty_state=1)
    system = SystemInputs(
        required_capacity_mw=500, target_month=36, horizon_month=72, lambda_mw_month=0.0
    )
    with pytest.raises(ValidationError, match="duplicate"):
        Scenario(
            system=system,
            sites=[Site(id="A", **site_kwargs), Site(id="A", **site_kwargs)],
        )


def test_tranche2_before_tranche1_rejected() -> None:
    from trackc.model.schemas import BurdenStateDefinition

    with pytest.raises(ValidationError, match="tau2_bar"):
        BurdenStateDefinition(label="Bad", interpretation="x", tau1_bar=30, tau2_bar=20)


def test_uncertainty_probabilities_must_sum_to_one() -> None:
    from trackc.model.schemas import UncertaintyStateDefinition

    with pytest.raises(ValidationError, match="sum to 1"):
        UncertaintyStateDefinition(
            label="Bad",
            interpretation="x",
            delay_months=[0, 6, 12],
            probabilities=[0.5, 0.3, 0.1],  # sums to 0.9
        )


def test_uncertainty_probabilities_sum_tolerance_is_tight() -> None:
    # The per-state sum check shares one tolerance with the scenario engine's
    # assembled-joint check (1e-9). A vector off by 1e-7 -- comfortably inside
    # the old 1e-6 tolerance -- must now be rejected, so a barely-invalid
    # config cannot slip through state validation and then blow up during
    # joint enumeration over N sites.
    from trackc.model.schemas import UncertaintyStateDefinition

    with pytest.raises(ValidationError, match="sum to 1"):
        UncertaintyStateDefinition(
            label="Bad",
            interpretation="x",
            delay_months=[0, 6, 12],
            probabilities=[0.6, 0.3, 0.1 + 1e-7],
        )


def test_uncertainty_negative_delay_rejected() -> None:
    from trackc.model.schemas import UncertaintyStateDefinition

    with pytest.raises(ValidationError, match="non-negative"):
        UncertaintyStateDefinition(
            label="Bad",
            interpretation="x",
            delay_months=[-3, 0, 6],
            probabilities=[0.2, 0.5, 0.3],
        )


_VALID_DEFAULTS = dict(max_exact_scenarios=100000, mc_samples=10000, random_seed=12345)


def test_model_defaults_alpha_out_of_range_rejected() -> None:
    with pytest.raises(ValidationError):
        ModelDefaults(alpha=1.5, **_VALID_DEFAULTS)
    with pytest.raises(ValidationError):
        ModelDefaults(alpha=0.0, **_VALID_DEFAULTS)


def test_model_defaults_scenario_engine_fields_validated() -> None:
    with pytest.raises(ValidationError):
        ModelDefaults(alpha=0.5, max_exact_scenarios=0, mc_samples=10000, random_seed=0)
    with pytest.raises(ValidationError):
        ModelDefaults(alpha=0.5, max_exact_scenarios=100, mc_samples=0, random_seed=0)
    with pytest.raises(ValidationError):
        ModelDefaults(alpha=0.5, max_exact_scenarios=100, mc_samples=10, random_seed=-1)
