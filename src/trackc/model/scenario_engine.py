"""Scenario engine: joint site-delay realizations for a scenario (spec
sections 30-33).

Given a :class:`~trackc.model.schemas.Scenario` (N sites, each with an
uncertainty state) and the uncertainty-state mapping, this module produces a
:class:`ScenarioSet`: a weighted collection of joint delay vectors
``(delta_1, ..., delta_N)``, one weight per realization, weights summing to 1.

Two construction paths, selected automatically by :func:`build_scenario_set`:

* **Exact enumeration** (:func:`enumerate_exact`) -- every joint combination of
  per-site delay outcomes. The number of realizations is

      S_full = prod_i q_i

  where ``q_i`` is the number of delay outcomes in site ``i``'s uncertainty
  state (model spec). ``q^N`` is only the special case where every site
  has the same outcome count, which is true of the current ``v1-baseline``
  mapping but is not a model law.
* **Monte Carlo sampling** (:func:`sample_monte_carlo`) -- ``M`` independent
  joint draws, each weight ``1/M``, from a seeded generator (model spec).

FROZEN modeling rule (the model specification, ``docs/assumptions.md``):
site delays are drawn **independently** of one another, so a joint
realization's probability is the product of its per-site outcome
probabilities, and Monte Carlo draws each site's delay independently. No
cross-site correlation is modeled in v1; do not add any here.
"""

from __future__ import annotations

from dataclasses import dataclass
from itertools import product
from typing import Literal

import numpy as np
import numpy.typing as npt

from trackc.model.mappings import resolve_uncertainty
from trackc.model.schemas import (
    _PROB_SUM_TOLERANCE,
    ModelDefaults,
    Scenario,
    UncertaintyStateConfig,
)

# Reuse the single project-wide probability-sum tolerance (a model
# validation invariant). Sharing one constant keeps the per-state config check
# and this assembled-joint check from diverging: a config that only just
# passes state validation must not then fail joint normalization here after
# the multiplicative enumeration over sites.


@dataclass(frozen=True)
class ScenarioSet:
    """A weighted set of joint site-delay realizations.

    ``delays[s, i]`` is the realized schedule delay (months, >= 0) for site
    ``site_ids[i]`` in realization ``s``. ``probabilities[s]`` is that
    realization's weight; the weights sum to 1.

    ``method`` records how the set was built. For ``"monte_carlo"``,
    ``random_seed`` and ``n_samples`` are populated (model spec); for
    ``"exact"`` they are ``None``.
    """

    site_ids: tuple[str, ...]
    delays: npt.NDArray[np.float64]
    probabilities: npt.NDArray[np.float64]
    method: Literal["exact", "monte_carlo"]
    random_seed: int | None = None
    n_samples: int | None = None

    def __post_init__(self) -> None:
        n_realizations, n_sites = self.delays.shape
        if n_sites != len(self.site_ids):
            raise ValueError(
                f"delays has {n_sites} site columns but {len(self.site_ids)} site ids"
            )
        if self.probabilities.shape != (n_realizations,):
            raise ValueError(
                f"probabilities shape {self.probabilities.shape} does not match "
                f"{n_realizations} realizations"
            )
        if np.any(self.delays < 0):
            raise ValueError("delays must be non-negative in v1 (no early delivery)")
        if np.any(self.probabilities < 0):
            raise ValueError("scenario probabilities must be non-negative")
        total = float(self.probabilities.sum())
        if abs(total - 1.0) > _PROB_SUM_TOLERANCE:
            raise ValueError(
                f"scenario probabilities must sum to 1 (spec section 31), got {total}"
            )

    @property
    def n_realizations(self) -> int:
        return self.delays.shape[0]

    def weighted_mean_delay(self) -> npt.NDArray[np.float64]:
        """Probability-weighted mean realized delay per site: ``sum_s p_s * delta_i(s)``.

        For an exact set this is the exact ``E[delta_i]``; for a Monte Carlo
        set it is the sample estimate (every weight ``1/M``). This is the
        scenario-engine convergence proxy -- ``P_meet``, ``E[S]``, ``E[L]``
        themselves are evaluator metrics.
        """
        return self.probabilities @ self.delays


def _per_site_distributions(
    scenario: Scenario, uncertainty_config: UncertaintyStateConfig
) -> list[tuple[list[float], list[float]]]:
    """Resolve each site's uncertainty state to its ``(delay_months, probabilities)``
    distribution, in ``scenario.sites`` order.
    """
    return [
        resolve_uncertainty(site.uncertainty_state, uncertainty_config)
        for site in scenario.sites
    ]


def scenario_count(scenario: Scenario, uncertainty_config: UncertaintyStateConfig) -> int:
    """Exact joint scenario count ``S_full = prod_i q_i`` (model spec)."""
    count = 1
    for delays, _ in _per_site_distributions(scenario, uncertainty_config):
        count *= len(delays)
    return count


def enumerate_exact(
    scenario: Scenario, uncertainty_config: UncertaintyStateConfig
) -> ScenarioSet:
    """Enumerate every joint site-delay combination exactly (model spec).

    Realization probability is the product of the chosen per-site outcome
    probabilities (site independence, FROZEN). Realizations are ordered by
    :func:`itertools.product` over per-site outcome indices, i.e. the last
    site varies fastest.
    """
    dists = _per_site_distributions(scenario, uncertainty_config)
    site_ids = tuple(site.id for site in scenario.sites)

    delay_rows: list[tuple[float, ...]] = []
    probs: list[float] = []
    for outcome in product(*(range(len(d)) for d, _ in dists)):
        row: list[float] = []
        p = 1.0
        for site_idx, outcome_idx in enumerate(outcome):
            site_delays, site_probs = dists[site_idx]
            row.append(site_delays[outcome_idx])
            p *= site_probs[outcome_idx]
        delay_rows.append(tuple(row))
        probs.append(p)

    return ScenarioSet(
        site_ids=site_ids,
        delays=np.asarray(delay_rows, dtype=np.float64).reshape(len(delay_rows), len(site_ids)),
        probabilities=np.asarray(probs, dtype=np.float64),
        method="exact",
    )


def sample_monte_carlo(
    scenario: Scenario,
    uncertainty_config: UncertaintyStateConfig,
    n_samples: int,
    random_seed: int,
) -> ScenarioSet:
    """Draw ``n_samples`` independent joint site-delay realizations (model spec).

    Each site's delay is drawn independently from its own distribution using a
    single :class:`numpy.random.Generator` seeded with ``random_seed``; sites
    are drawn in ``scenario.sites`` order. Every realization carries equal
    weight ``1 / n_samples``. Identical inputs and seed reproduce identical
    output (model spec).
    """
    if n_samples <= 0:
        raise ValueError(f"n_samples must be positive, got {n_samples}")

    dists = _per_site_distributions(scenario, uncertainty_config)
    site_ids = tuple(site.id for site in scenario.sites)
    rng = np.random.default_rng(random_seed)

    columns = [
        rng.choice(np.asarray(site_delays, dtype=np.float64), size=n_samples, p=site_probs)
        for site_delays, site_probs in dists
    ]
    delays = np.column_stack(columns) if columns else np.empty((n_samples, 0), dtype=np.float64)

    return ScenarioSet(
        site_ids=site_ids,
        delays=delays,
        probabilities=np.full(n_samples, 1.0 / n_samples, dtype=np.float64),
        method="monte_carlo",
        random_seed=random_seed,
        n_samples=n_samples,
    )


def build_scenario_set(
    scenario: Scenario,
    uncertainty_config: UncertaintyStateConfig,
    defaults: ModelDefaults,
) -> ScenarioSet:
    """Build a :class:`ScenarioSet`, choosing exact enumeration or Monte Carlo
    automatically (model spec).

    Exact enumeration is used while ``S_full = prod_i q_i <=
    defaults.max_exact_scenarios``; otherwise Monte Carlo with
    ``defaults.mc_samples`` draws and ``defaults.random_seed``.
    """
    if scenario_count(scenario, uncertainty_config) <= defaults.max_exact_scenarios:
        return enumerate_exact(scenario, uncertainty_config)
    return sample_monte_carlo(
        scenario, uncertainty_config, defaults.mc_samples, defaults.random_seed
    )
