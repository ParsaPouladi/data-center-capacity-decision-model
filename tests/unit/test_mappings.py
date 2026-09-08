"""State-mapping resolution tests (model spec)."""

from pathlib import Path

import pytest

from trackc.model.mappings import apply_delay, resolve_burden, resolve_uncertainty
from trackc.model.schemas import load_burden_states, load_uncertainty_states


def test_resolve_burden_matches_spec_table(burden_states_path: Path) -> None:
    config = load_burden_states(burden_states_path)
    assert resolve_burden(1, config) == (18, 24)
    assert resolve_burden(2, config) == (24, 30)
    assert resolve_burden(3, config) == (30, 42)
    assert resolve_burden(4, config) == (42, 54)


def test_resolve_uncertainty_matches_spec_table(uncertainty_states_path: Path) -> None:
    config = load_uncertainty_states(uncertainty_states_path)
    delays, probs = resolve_uncertainty(1, config)
    assert delays == [0, 3, 6]
    assert probs == [0.80, 0.15, 0.05]
    delays, probs = resolve_uncertainty(4, config)
    assert delays == [0, 12, 24]
    assert probs == [0.25, 0.35, 0.40]


def test_apply_delay_shifts_both_tranches_equally() -> None:
    tau1, tau2 = apply_delay(30, 42, 9)
    assert tau1 == 39
    assert tau2 == 51
    # the shift amount is identical for both tranches
    assert tau2 - tau1 == 42 - 30


def test_apply_delay_zero_is_identity() -> None:
    assert apply_delay(18, 24, 0) == (18, 24)


def test_apply_delay_rejects_negative_delta() -> None:
    with pytest.raises(ValueError, match=">= 0"):
        apply_delay(18, 24, -1)


def test_apply_delay_preserves_tranche_ordering() -> None:
    # Since the same delta shifts both tranches, ordering (tau2 > tau1) is
    # preserved by construction for any non-negative delta.
    for delta in (0, 3, 6, 9, 12, 18, 24):
        tau1, tau2 = apply_delay(18, 24, delta)
        assert tau2 > tau1
