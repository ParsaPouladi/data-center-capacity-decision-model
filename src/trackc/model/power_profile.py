"""Power-availability profile generation: (K_i, tau1, tau2, alpha) -> A_i(t)
(model spec).

This module is the single source of truth for the tranche step function.
It knows nothing about scenario probabilities or delay distributions --
callers resolve (tau1, tau2) via `trackc.model.mappings` for a *specific*
schedule delay delta before calling here. Scenario enumeration over the
full delay distribution (multiple deltas with probabilities) is the
    scenario engine's
responsibility, not this module's.
"""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from trackc.model.mappings import apply_delay, resolve_burden
from trackc.model.schemas import BurdenStateConfig, Site


def time_grid(horizon_month: int) -> npt.NDArray[np.float64]:
    """Integer monthly grid t = 0, 1, ..., H inclusive."""
    return np.arange(0, horizon_month + 1, dtype=np.float64)


def power_availability(
    t: npt.ArrayLike,
    capacity_mw: npt.ArrayLike,
    tau1: npt.ArrayLike,
    tau2: npt.ArrayLike,
    alpha: float,
) -> npt.NDArray[np.float64]:
    """A_i(t) step function (model spec):

        A_i(t) = 0            for t <  tau1
        A_i(t) = alpha * K_i  for tau1 <= t < tau2
        A_i(t) = K_i          for t >= tau2

    Vectorized over `t`, and also over `capacity_mw`/`tau1`/`tau2` (broadcast
    together via standard numpy rules -- e.g. the evaluator calls this
    with `(n_realizations, n_sites, 1)`-shaped `tau1`/`tau2` against a
    `(1, 1, n_times)`-shaped `t` to get the full `A_i(t,s)` tensor in one
    call, rather than re-deriving this formula). Always returns an ndarray;
    all-scalar inputs yield a 0-d array (use `.item()` or index if a Python
    float is required).
    """
    tau1_arr = np.asarray(tau1, dtype=np.float64)
    tau2_arr = np.asarray(tau2, dtype=np.float64)
    if np.any(tau2_arr <= tau1_arr):
        raise ValueError(
            "tau2 must be strictly greater than tau1 everywhere; tranche 2 must not "
            "precede tranche 1 (spec section 39 invariant #5)."
        )
    t_arr = np.asarray(t, dtype=np.float64)
    profile = np.where(
        t_arr < tau1_arr,
        0.0,
        np.where(t_arr < tau2_arr, alpha * np.asarray(capacity_mw, dtype=np.float64), capacity_mw),
    )
    return profile


def site_power_profile(
    times: npt.ArrayLike,
    site: Site,
    delta: float,
    burden_config: BurdenStateConfig,
    alpha: float,
) -> npt.NDArray[np.float64]:
    """Full (K_i, B_i, U_i-resolved delta) -> A_i(t) pipeline for one site
    under one specific realized schedule delay `delta` (model spec).

    `delta` is a single realized delay value (e.g. one outcome drawn or
    enumerated from the site's uncertainty distribution) -- resolving the
    *distribution itself* is `trackc.model.mappings.resolve_uncertainty`,
    and enumerating/sampling scenarios across sites is the scenario engine.
    """
    tau1_bar, tau2_bar = resolve_burden(site.burden_state, burden_config)
    tau1, tau2 = apply_delay(tau1_bar, tau2_bar, delta)
    return power_availability(times, site.capacity_mw, tau1, tau2, alpha)
