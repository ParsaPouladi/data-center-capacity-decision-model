"""Synthetic multi-site portfolio construction for scale testing.

The quantitative engine is N-general: increasing the number of candidate
sites means supplying more site rows, never changing model code. This
module builds deterministic, reproducible ``N``-site synthetic portfolios
so the engine, service layer, and API can be exercised well beyond the
small baseline fixture.

It composes the frozen primitives only (:class:`~trackc.model.schemas.Site`,
:class:`~trackc.model.schemas.SystemInputs`,
:class:`~trackc.model.schemas.Scenario`) and never special-cases on ``N``.
All values are SYNTHETIC assumptions, not empirical data.
"""

from __future__ import annotations

import numpy as np

from trackc.model.schemas import Scenario, Site, SystemInputs

_K_RANGE_MW = (100.0, 500.0)  # roughly the baseline fixture's own K range
_COST_RANGE = (0.80, 1.50)  # roughly the baseline fixture's own c range
_REQUIRED_CAPACITY_FRACTION = 0.60  # D = fraction * sum(K_i): a genuine partial-fill problem
_TARGET_MONTH = 36  # T*, baseline fixture value, unchanged
_HORIZON_MONTH = 72  # H, baseline fixture value, unchanged
_LAMBDA_MW_MONTH = 1.0  # synthetic control (no universal delay-value)


def generate_synthetic_portfolio(
    n_sites: int,
    seed: int,
    *,
    required_capacity_fraction: float = _REQUIRED_CAPACITY_FRACTION,
    lambda_mw_month: float = _LAMBDA_MW_MONTH,
) -> Scenario:
    """A deterministic, reproducible ``n_sites``-site synthetic portfolio:
    the SAME ``(n_sites, seed)`` always reproduces the identical scenario.

    ``K_i``, ``c_i``, ``B_i``, ``U_i`` are drawn independently of one
    another from a single seeded :class:`numpy.random.Generator` -- no
    dimension is derived from another. ``required_capacity_fraction`` sets
    ``D = fraction * sum(K_i)``, so every ``N`` produces a genuine
    partial-fill decision problem (never trivially infeasible, never
    trivially over-provisioned) unless the caller deliberately passes
    ``1.0`` to construct the ``D == sum(K)`` degenerate/structural case.
    """
    if n_sites < 1:
        raise ValueError(f"n_sites must be >= 1, got {n_sites}")
    rng = np.random.default_rng(seed)
    capacities = rng.uniform(*_K_RANGE_MW, size=n_sites)
    costs = rng.uniform(*_COST_RANGE, size=n_sites)
    burden_states = rng.integers(1, 5, size=n_sites)  # {1,2,3,4}
    uncertainty_states = rng.integers(1, 5, size=n_sites)  # {1,2,3,4}, drawn independently of B

    sites = [
        Site(
            id=f"S{i:03d}",
            capacity_mw=float(capacities[i]),
            cost_per_mw=float(costs[i]),
            burden_state=int(burden_states[i]),
            uncertainty_state=int(uncertainty_states[i]),
        )
        for i in range(n_sites)
    ]
    required_capacity = required_capacity_fraction * float(capacities.sum())

    system = SystemInputs(
        required_capacity_mw=required_capacity,
        target_month=_TARGET_MONTH,
        horizon_month=_HORIZON_MONTH,
        lambda_mw_month=lambda_mw_month,
    )
    return Scenario(system=system, sites=sites)
