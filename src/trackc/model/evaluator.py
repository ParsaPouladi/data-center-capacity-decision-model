"""Strategy evaluator: allocation x = (x_1, ..., x_N) -> delivered-capacity
trajectory, deadline/delay metrics, cost, and the core objective
(the model specification).

Given a :class:`~trackc.model.schemas.Scenario`, a candidate
:class:`~trackc.model.schemas.Allocation`, and a
:class:`~trackc.model.scenario_engine.ScenarioSet`, this module computes, for
every realization ``s`` in the scenario set:

* delivered site capacity ``Y_i(t,s) = min(x_i, A_i(t,s))``;
* total delivered capacity ``Y(t,s) = sum_i Y_i(t,s)``;
* deadline shortfall ``S_s = max(0, D - Y(T*,s))`` and ``P_meet``;
* delay burden ``L_s = sum_{t=T*}^{H} max(0, D - Y(t,s))``, inclusive of
  ``T*`` (``docs/assumptions.md`` "Numerical convention");

then aggregates over realizations, probability-weighted, into
``E[S]``, ``P_meet``, ``E[L]``, development cost ``C_dev``, the core
objective ``J = C_dev + lambda * E[L]``, and strategy feasibility. See
the model specification for each.

This module does not modify the scenario engine; it composes it with
:func:`trackc.model.power_profile.power_availability`, which now broadcasts
over array-shaped ``tau1``/``tau2``/``capacity_mw`` (model spec) so
the per-realization, per-site availability ``A_i(t,s)`` can be computed for
the whole :class:`ScenarioSet` in one call instead of re-deriving the
tranche-step formula here -- see
``tests/unit/test_evaluator.py`` for a cross-check against
:func:`trackc.model.power_profile.site_power_profile` on individual
(site, realization) slices.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
import numpy.typing as npt

from trackc import __version__ as _TRACKC_VERSION
from trackc.model.mappings import resolve_burden
from trackc.model.power_profile import power_availability, time_grid
from trackc.model.scenario_engine import ScenarioSet
from trackc.model.schemas import (
    Allocation,
    BurdenStateConfig,
    Scenario,
    UncertaintyStateConfig,
    validate_allocation_against_sites,
)

FeasibilityStatus = Literal["feasible", "system_insufficient", "strategy_insufficient"]

# Absolute tolerance (MW) for the deadline/shortfall comparisons in
# `evaluate_strategy`, guarding against floating-point summation roundoff
# only (e.g. a delivered capacity that is mathematically exactly D landing
# ~1e-13 below it after summing several tranche fractions) -- never large
# enough to mask a real shortfall. Mirrors the project-wide convention of a
# tiny fixed tolerance for exact-equality comparisons on computed floats
# (`schemas._PROB_SUM_TOLERANCE`).
#
# Public name: promoted from module-private so `trackc.model.optimizer`
# and the envelope construction share the SAME constant via one public
# import rather than each reaching into a private name -- same value, same
# semantics. `_CAPACITY_TOLERANCE` is kept as an alias so no existing
# internal reference in this module needs to change.
CAPACITY_TOLERANCE = 1e-9
_CAPACITY_TOLERANCE = CAPACITY_TOLERANCE


def _validate_alpha(alpha: float) -> None:
    """`0 < alpha < 1` (model spec) -- re-checked here because `alpha`
    reaches this module as a bare float, not necessarily routed through the
    Pydantic-validated `schemas.ModelDefaults.alpha`.
    """
    if not (0.0 < alpha < 1.0):
        raise ValueError(f"alpha must be in (0,1) (spec section 11), got {alpha}")


# ---------------------------------------------------------------------------
# Delivered-capacity primitives (model spec)
# ---------------------------------------------------------------------------


def site_availability(
    scenario: Scenario,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    alpha: float,
    times: npt.NDArray[np.float64],
) -> npt.NDArray[np.float64]:
    """``A_i(t,s)`` for every site, realization, and time (the model specification,
    14), vectorized across a full :class:`ScenarioSet`.

    Sites are taken in ``scenario_set.site_ids`` order (which matches
    ``scenario.sites`` order -- both scenario-engine construction paths
    preserve it). Returns shape ``(n_realizations, n_sites, n_times)``.

    Tranche ordering (``tau2 > tau1``) is guaranteed structurally: it is
    enforced once at config-load time on ``(tau1_bar, tau2_bar)``
    (``BurdenStateDefinition``, a model validation invariant), and shifting
    both tranches by the same non-negative ``delta`` preserves
    the ordering -- ``power_availability``'s own runtime guard still applies
    as defense-in-depth, but can never fire on inputs built this way.
    """
    _validate_alpha(alpha)
    sites_by_id = {site.id: site for site in scenario.sites}
    missing = set(scenario_set.site_ids) - set(sites_by_id)
    if missing:
        raise ValueError(
            f"scenario_set references site id(s) not present in scenario.sites: "
            f"{sorted(missing)}"
        )
    sites = [sites_by_id[site_id] for site_id in scenario_set.site_ids]

    tau_bars = [resolve_burden(site.burden_state, burden_config) for site in sites]
    tau1_bar = np.asarray([t1 for t1, _ in tau_bars], dtype=np.float64)  # (N,)
    tau2_bar = np.asarray([t2 for _, t2 in tau_bars], dtype=np.float64)  # (N,)
    capacities = np.asarray([site.capacity_mw for site in sites], dtype=np.float64)  # (N,)

    delta = scenario_set.delays  # (S, N), already validated >= 0
    tau1 = tau1_bar[None, :] + delta  # (S, N)
    tau2 = tau2_bar[None, :] + delta  # (S, N)

    t = np.asarray(times, dtype=np.float64)[None, None, :]  # (1, 1, T)
    tau1_b = tau1[:, :, None]  # (S, N, 1)
    tau2_b = tau2[:, :, None]  # (S, N, 1)
    K_b = capacities[None, :, None]  # (1, N, 1)

    return power_availability(t, K_b, tau1_b, tau2_b, alpha)


def delivered_site_capacity(
    allocation_vector: npt.NDArray[np.float64],
    availability: npt.NDArray[np.float64],
) -> npt.NDArray[np.float64]:
    """``Y_i(t,s) = min(x_i, A_i(t,s))`` (model spec).

    ``allocation_vector`` is ``x_i`` in the same site order as
    ``availability``'s site axis, shape ``(n_sites,)``. ``availability`` is
    ``A_i(t,s)``, shape ``(S, N, T)``. Returns the same shape.
    """
    return np.minimum(allocation_vector[None, :, None], availability)


# ---------------------------------------------------------------------------
# Canonical result contract (model spec)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, eq=False)
class StrategyResult:
    """A fully evaluated strategy (model spec). Shape does not depend on
    whether the underlying :class:`ScenarioSet` was built by exact
    enumeration or Monte Carlo -- only the scenario-metadata fields differ.

    ``eq=False``: this dataclass holds ``numpy.ndarray`` fields, and the
    dataclass-generated ``__eq__`` would raise ("truth value of an array is
    ambiguous") the first time two results are compared -- compare specific
    scalar fields, or ``np.testing.assert_allclose`` for the array fields,
    instead of ``result1 == result2``.
    """

    model_version: str
    burden_mapping_version: str
    uncertainty_mapping_version: str

    site_ids: tuple[str, ...]
    n_sites: int
    allocation: dict[str, float]  # x_i by site id

    method: Literal["exact", "monte_carlo"]
    n_realizations: int
    random_seed: int | None
    n_samples: int | None

    development_cost: float  # C_dev (model spec)
    p_meet: float  # P_meet (model spec)
    expected_shortfall_mw: float  # E[S] (model spec)
    expected_delay_burden_mw_months: float  # E[L] (model spec)
    objective: float  # J = C_dev + lambda * E[L] (model spec)

    feasibility_status: FeasibilityStatus  # see the model specification
    times: npt.NDArray[np.float64]  # t = 0..H
    delivered_capacity_trajectory: npt.NDArray[np.float64]  # E[Y(t)], shape == times

    def __post_init__(self) -> None:
        if not (0.0 <= self.p_meet <= 1.0):
            raise ValueError(
                f"P_meet must be in [0,1] (spec section 39 invariant #18), got {self.p_meet}"
            )
        if self.expected_shortfall_mw < 0:
            raise ValueError(
                "expected deadline shortfall E[S] cannot be negative (spec section 39 "
                f"invariant #17), got {self.expected_shortfall_mw}"
            )
        if self.expected_delay_burden_mw_months < 0:
            raise ValueError(
                "expected delay burden E[L] cannot be negative (spec section 39 "
                f"invariant #16), got {self.expected_delay_burden_mw_months}"
            )
        if self.development_cost < 0:
            raise ValueError(
                f"development cost C_dev cannot be negative, got {self.development_cost}"
            )
        if self.delivered_capacity_trajectory.shape != self.times.shape:
            raise ValueError(
                f"delivered_capacity_trajectory shape {self.delivered_capacity_trajectory.shape} "
                f"must match times shape {self.times.shape}"
            )


# ---------------------------------------------------------------------------
# Evaluation
# ---------------------------------------------------------------------------


def evaluate_strategy(
    scenario: Scenario,
    allocation: Allocation,
    scenario_set: ScenarioSet,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    alpha: float,
    model_version: str = _TRACKC_VERSION,
) -> StrategyResult:
    """Evaluate one candidate allocation against one scenario's full
    :class:`ScenarioSet` (model spec).

    ``scenario_set`` must have been built from ``scenario`` (same site ids,
    same order) -- e.g. via :func:`trackc.model.scenario_engine.build_scenario_set`.
    ``uncertainty_config`` is only consulted for its ``mapping_version``
    (the model specification result contract) -- the scenario set already encodes
    the resolved delay distributions it was built from.
    """
    _validate_alpha(alpha)
    if set(scenario_set.site_ids) != {site.id for site in scenario.sites}:
        raise ValueError(
            "scenario_set.site_ids does not match scenario.sites -- was it built from "
            f"a different scenario? scenario_set: {sorted(scenario_set.site_ids)}, "
            f"scenario: {sorted(site.id for site in scenario.sites)}"
        )

    # a model validation invariant (x_i <= K_i); raises ValueError on violation.
    validate_allocation_against_sites(allocation, scenario.sites)

    sites_by_id = {site.id: site for site in scenario.sites}
    site_ids = scenario_set.site_ids
    sites = [sites_by_id[site_id] for site_id in site_ids]

    capacities = np.asarray([s.capacity_mw for s in sites], dtype=np.float64)  # K_i
    costs = np.asarray([s.cost_per_mw for s in sites], dtype=np.float64)  # c_i
    x = np.asarray([allocation.by_site.get(sid, 0.0) for sid in site_ids], dtype=np.float64)

    # --- Strategy feasibility (model spec) -----------------------------
    required_capacity = scenario.system.required_capacity_mw  # D
    total_capacity = float(capacities.sum())  # sum_i K_i
    total_allocated = float(x.sum())  # sum_i x_i
    if total_capacity < required_capacity:
        feasibility_status: FeasibilityStatus = "system_insufficient"
    elif total_allocated < required_capacity:
        feasibility_status = "strategy_insufficient"
    else:
        feasibility_status = "feasible"

    # --- Development cost (model spec) ---------------------------------
    development_cost = float(np.dot(costs, x))

    # --- Delivered-capacity trajectory over every realization ---------------
    times = time_grid(scenario.system.horizon_month)  # t = 0..H
    availability = site_availability(scenario, scenario_set, burden_config, alpha, times)
    Y_i = delivered_site_capacity(x, availability)  # (S, N, T), section 17
    Y = Y_i.sum(axis=1)  # (S, T), section 18

    target_month_idx = int(scenario.system.target_month)  # times[i] == i by construction
    Y_at_target = Y[:, target_month_idx]  # (S,)

    # --- Deadline shortfall and P_meet (model spec) ----------------
    # Gaps within _CAPACITY_TOLERANCE are treated as exactly met: a delivered
    # capacity that is mathematically exactly D can land a few ULPs below it
    # after summing several tranche fractions across sites, which must not
    # flip M_s from 1 to 0 or report a spurious nonzero shortfall.
    gap_at_target = required_capacity - Y_at_target  # (S,); positive means short
    met_at_target = gap_at_target <= _CAPACITY_TOLERANCE
    S_s = np.where(met_at_target, 0.0, np.maximum(0.0, gap_at_target))  # (S,)
    M_s = met_at_target.astype(np.float64)  # (S,)
    p = scenario_set.probabilities  # (S,)
    expected_shortfall_mw = float(p @ S_s)
    # Clip against floating-point summation roundoff only (e.g. p summing to
    # 1 + 1e-16 over many MC weights) -- M_s in {0,1} and p in [0,1] guarantee
    # p @ M_s in [0,1] exactly in real arithmetic; this never masks a real
    # out-of-range value (a model validation invariant).
    p_meet = float(np.clip(p @ M_s, 0.0, 1.0))

    # --- Delay burden (model spec), inclusive of T* --------------------
    gap_after_target = required_capacity - Y[:, target_month_idx:]  # (S, H-T*+1)
    Q_after_target = np.where(
        gap_after_target <= _CAPACITY_TOLERANCE, 0.0, np.maximum(0.0, gap_after_target)
    )
    L_s = Q_after_target.sum(axis=1)  # (S,)
    expected_delay_burden_mw_months = float(p @ L_s)

    # --- Delay consequence and core objective (model spec) ---------
    lam = scenario.system.lambda_mw_month
    objective = development_cost + lam * expected_delay_burden_mw_months

    # --- Expected delivered-capacity trajectory (model spec) -----------
    delivered_capacity_trajectory = p @ Y  # (T,)

    return StrategyResult(
        model_version=model_version,
        burden_mapping_version=burden_config.mapping_version,
        uncertainty_mapping_version=uncertainty_config.mapping_version,
        site_ids=site_ids,
        n_sites=len(site_ids),
        # full per-site vector as actually used above (a site absent from
        # allocation.by_site was scored as x_i=0, so it is reported as 0.0
        # here too, not omitted -- see evaluator.py finding on KeyError risk).
        allocation=dict(zip(site_ids, x.tolist(), strict=True)),
        method=scenario_set.method,
        n_realizations=scenario_set.n_realizations,
        random_seed=scenario_set.random_seed,
        n_samples=scenario_set.n_samples,
        development_cost=development_cost,
        p_meet=p_meet,
        expected_shortfall_mw=expected_shortfall_mw,
        expected_delay_burden_mw_months=expected_delay_burden_mw_months,
        objective=objective,
        feasibility_status=feasibility_status,
        times=times,
        delivered_capacity_trajectory=delivered_capacity_trajectory,
    )
