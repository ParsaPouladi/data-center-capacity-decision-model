"""State-mapping layer: converts qualitative state identifiers (B, U) into
explicit synthetic physical parameters (model spec).

Important modeling rule (model spec): B and U are state identifiers,
not interval/ratio quantities. Nothing in this module performs arithmetic
directly on B or U values themselves -- they are only used as lookup keys
into the mapping configuration. All arithmetic operates on the resolved
physical parameters (tau1_bar, tau2_bar, delay months).
"""

from __future__ import annotations

from trackc.model.schemas import BurdenStateConfig, UncertaintyStateConfig


def resolve_burden(burden_state: int, config: BurdenStateConfig) -> tuple[float, float]:
    """B_i -> (tau1_bar, tau2_bar): nominal first-tranche and full-power months
    (model spec).
    """
    definition = config.states[burden_state]
    return definition.tau1_bar, definition.tau2_bar


def resolve_uncertainty(
    uncertainty_state: int, config: UncertaintyStateConfig
) -> tuple[list[float], list[float]]:
    """U_i -> (delay_months, probabilities): the discrete schedule-delay
    distribution F_i (model spec).
    """
    definition = config.states[uncertainty_state]
    return list(definition.delay_months), list(definition.probabilities)


def apply_delay(tau1_bar: float, tau2_bar: float, delta: float) -> tuple[float, float]:
    """Shift both tranche dates by the same schedule delay delta (spec
    section 12). The same delta is applied to tranche 1 and tranche 2 to
    preserve the internal structure of the delivery schedule; tranche dates
    must never be independently randomized in v1.
    """
    if delta < 0:
        raise ValueError(f"delta must be >= 0 in v1 (no early delivery), got {delta}")
    return tau1_bar + delta, tau2_bar + delta
