"""Power-availability trajectory tests (model spec), hand-
calculated against the baseline scenario fixture's own site definitions.

Site A: B=3 -> (tau1_bar=30, tau2_bar=42), K=500. Using delta=9 (one of
        A's own U=3 outcomes [0,9,18]): tau1=39, tau2=51.
        A(t): 0 for t<39; 250 for 39<=t<51; 500 for t>=51.

Site B: B=2 -> (tau1_bar=24, tau2_bar=30), K=300. Using delta=0 (one of
        B's own U=1 outcomes [0,3,6]): tau1=24, tau2=30.
        A(t): 0 for t<24; 150 for 24<=t<30; 300 for t>=30.

Site C: B=1 -> (tau1_bar=18, tau2_bar=24), K=250. Using delta=6 (one of
        C's own U=2 outcomes [0,6,12]): tau1=24, tau2=30.
        A(t): 0 for t<24; 125 for 24<=t<30; 250 for t>=30.
"""

from pathlib import Path

import numpy as np
import pytest

from trackc.model.power_profile import power_availability, site_power_profile, time_grid
from trackc.model.schemas import load_burden_states, load_model_defaults, load_scenario

ALPHA = 0.50


def test_time_grid_is_inclusive_of_horizon() -> None:
    grid = time_grid(72)
    assert grid[0] == 0
    assert grid[-1] == 72
    assert len(grid) == 73


@pytest.mark.parametrize(
    "t,expected",
    [
        (0, 0.0),
        (38, 0.0),
        (39, 250.0),  # tranche 1 boundary, inclusive
        (45, 250.0),
        (50, 250.0),
        (51, 500.0),  # tranche 2 boundary, inclusive
        (72, 500.0),
    ],
)
def test_power_availability_site_a_hand_calculated(t: float, expected: float) -> None:
    result = power_availability(t, capacity_mw=500, tau1=39, tau2=51, alpha=ALPHA)
    assert float(result) == expected


def test_power_availability_site_b_hand_calculated() -> None:
    t = np.array([0, 23, 24, 29, 30, 72])
    expected = np.array([0.0, 0.0, 150.0, 150.0, 300.0, 300.0])
    result = power_availability(t, capacity_mw=300, tau1=24, tau2=30, alpha=ALPHA)
    np.testing.assert_array_equal(result, expected)


def test_power_availability_site_c_hand_calculated() -> None:
    t = np.array([0, 23, 24, 29, 30, 72])
    expected = np.array([0.0, 0.0, 125.0, 125.0, 250.0, 250.0])
    result = power_availability(t, capacity_mw=250, tau1=24, tau2=30, alpha=ALPHA)
    np.testing.assert_array_equal(result, expected)


def test_power_availability_never_exceeds_capacity() -> None:
    t = np.arange(0, 100)
    result = power_availability(t, capacity_mw=500, tau1=30, tau2=42, alpha=ALPHA)
    assert np.all(result <= 500)
    assert np.all(result >= 0)


def test_power_availability_rejects_bad_tranche_order() -> None:
    with pytest.raises(ValueError, match="tau2"):
        power_availability(10, capacity_mw=100, tau1=42, tau2=30, alpha=ALPHA)


def test_site_power_profile_end_to_end_site_a(
    burden_states_path: Path, model_defaults_path: Path, baseline_scenario_path: Path
) -> None:
    burden_config = load_burden_states(burden_states_path)
    alpha = load_model_defaults(model_defaults_path).alpha
    scenario = load_scenario(baseline_scenario_path)
    site_a = next(s for s in scenario.sites if s.id == "A")

    times = time_grid(scenario.system.horizon_month)
    profile = site_power_profile(times, site_a, delta=9, burden_config=burden_config, alpha=alpha)

    # t=0..38 -> 0
    assert np.all(profile[times < 39] == 0.0)
    # t=39..50 -> 250 (alpha * K)
    assert np.all(profile[(times >= 39) & (times < 51)] == 250.0)
    # t=51..72 -> 500 (K)
    assert np.all(profile[times >= 51] == 500.0)


def test_site_power_profile_zero_delay_matches_nominal_schedule(
    burden_states_path: Path, model_defaults_path: Path, baseline_scenario_path: Path
) -> None:
    burden_config = load_burden_states(burden_states_path)
    alpha = load_model_defaults(model_defaults_path).alpha
    scenario = load_scenario(baseline_scenario_path)
    site_b = next(s for s in scenario.sites if s.id == "B")

    times = time_grid(scenario.system.horizon_month)
    profile = site_power_profile(times, site_b, delta=0, burden_config=burden_config, alpha=alpha)

    assert np.all(profile[times < 24] == 0.0)
    assert np.all(profile[(times >= 24) & (times < 30)] == 150.0)
    assert np.all(profile[times >= 30] == 300.0)
