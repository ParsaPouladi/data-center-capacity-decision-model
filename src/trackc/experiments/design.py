"""Deliberate portfolio construction for the lambda-envelope validation suite.

The recursive lambda-envelope (:mod:`trackc.experiments.envelope`) is only
sound if its completeness is checked, not assumed. That check needs
portfolios built to a known structure:

* :func:`reference_portfolio` -- ``N`` identical sites (portfolio "R"). No
  cost/schedule tradeoff exists by construction, so any structure the
  optimizer reports on it is degeneracy (co-optimality), never a genuine
  decision. It is the adversarial input the envelope's "no new vertex"
  tolerance is stress-tested against.

Nothing here performs arithmetic on the burden/uncertainty state
identifiers themselves; the state integers are passed straight through to
:class:`~trackc.model.schemas.Site` and resolved to physical parameters by
the mapping layer.
"""

from __future__ import annotations

from trackc.model.schemas import Scenario, Site, SystemInputs


def _make_scenario(
    sites: list[Site],
    required_capacity_mw: float,
    target_month: int,
    horizon_month: int,
    lambda_mw_month: float = 0.0,
) -> Scenario:
    return Scenario(
        system=SystemInputs(
            required_capacity_mw=required_capacity_mw,
            target_month=target_month,
            horizon_month=horizon_month,
            lambda_mw_month=lambda_mw_month,
        ),
        sites=sites,
    )


def reference_portfolio(
    n_sites: int,
    capacity_mw: float,
    cost_per_mw: float,
    burden_state: int,
    uncertainty_state: int,
    required_capacity_mw: float,
    target_month: int,
    horizon_month: int,
    lambda_mw_month: float = 0.0,
    site_id_prefix: str = "R",
) -> Scenario:
    """Portfolio "R": ``n_sites`` IDENTICAL sites. No tradeoff exists by
    construction -- any structure the optimizer reports on this portfolio is
    degeneracy (co-optimality) or a bug, never a decision-relevant finding.
    """
    sites = [
        Site(
            id=f"{site_id_prefix}{i + 1}",
            capacity_mw=capacity_mw,
            cost_per_mw=cost_per_mw,
            burden_state=burden_state,
            uncertainty_state=uncertainty_state,
        )
        for i in range(n_sites)
    ]
    return _make_scenario(sites, required_capacity_mw, target_month, horizon_month, lambda_mw_month)
