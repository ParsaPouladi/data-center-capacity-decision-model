"""Model invariants for the state-mapping and power-profile layer
(the model validation invariants):

  0 <= A_i(t,s) <= K_i        for all t, s
  A_i(t,s) is non-decreasing in t (monotone step function)
  tau2 > tau1 after any non-negative delay shift
"""

from pathlib import Path

import numpy as np
import pytest

from trackc.model.mappings import apply_delay, resolve_burden
from trackc.model.power_profile import power_availability, time_grid
from trackc.model.schemas import load_burden_states

CAPACITY_MW = 500.0
ALPHA = 0.50
DELTAS_TO_TEST = (0, 3, 6, 9, 12, 18, 24)


@pytest.fixture
def burden_config(burden_states_path: Path):
    return load_burden_states(burden_states_path)


@pytest.mark.parametrize("burden_state", [1, 2, 3, 4])
@pytest.mark.parametrize("delta", DELTAS_TO_TEST)
def test_availability_bounds_and_monotonicity(
    burden_config, burden_state: int, delta: float
) -> None:
    tau1_bar, tau2_bar = resolve_burden(burden_state, burden_config)
    tau1, tau2 = apply_delay(tau1_bar, tau2_bar, delta)

    # tranche ordering invariant (a model validation invariant)
    assert tau2 > tau1

    times = time_grid(int(tau2) + 30)
    profile = power_availability(times, CAPACITY_MW, tau1, tau2, ALPHA)

    # A_i(t) >= 0 and A_i(t) <= K_i (model spec)
    assert np.all(profile >= 0.0)
    assert np.all(profile <= CAPACITY_MW)

    # A_i(t) is non-decreasing in t: later power delivery cannot reduce
    # availability (a model validation invariant, applied at the availability level).
    assert np.all(np.diff(profile) >= 0.0)


@pytest.mark.parametrize("burden_state", [1, 2, 3, 4])
def test_zero_delay_uses_nominal_schedule(burden_config, burden_state: int) -> None:
    tau1_bar, tau2_bar = resolve_burden(burden_state, burden_config)
    tau1, tau2 = apply_delay(tau1_bar, tau2_bar, 0)
    assert (tau1, tau2) == (tau1_bar, tau2_bar)


@pytest.mark.parametrize("burden_state", [1, 2, 3, 4])
def test_larger_delay_never_advances_availability(burden_config, burden_state: int) -> None:
    """Later power delivery cannot improve availability at any fixed time
    (a model validation invariant, applied at the site-availability level -- the
    strategy-level P_meet version of this invariant is the evaluator's job).
    """
    tau1_bar, tau2_bar = resolve_burden(burden_state, burden_config)
    times = time_grid(int(tau2_bar) + 60)

    small_delta, large_delta = 0, 12
    tau1_a, tau2_a = apply_delay(tau1_bar, tau2_bar, small_delta)
    tau1_b, tau2_b = apply_delay(tau1_bar, tau2_bar, large_delta)

    profile_small_delay = power_availability(times, CAPACITY_MW, tau1_a, tau2_a, ALPHA)
    profile_large_delay = power_availability(times, CAPACITY_MW, tau1_b, tau2_b, ALPHA)

    # at every time t, more delay can only leave availability the same or lower
    assert np.all(profile_large_delay <= profile_small_delay)
