"""Curated-example regression.

The three public examples are constructed by the exporter from curated
inputs and evaluated by the frozen engine. This test pins the expected
results (approximate, with explicit tolerances) and the structural
guarantees the public pages depend on -- optimizer present, lambda envelope present, and for the
capacity-constrained example the forced-case invariant ``sum(K) == D``.

Nothing here is a handwritten model output: every asserted number is read
from ``project_public_showcase(evaluate_showcase(...))`` on the exporter's
own scenario objects.
"""

from __future__ import annotations

import pytest
from scripts.export_showcase_data import (
    balanced_portfolio_scenario,
    capacity_constrained_portfolio_scenario,
    cheap_site_risky_schedule_scenario,
    project_public_showcase,
)

from trackc_app.service import (
    evaluate_showcase,
    load_baseline_scenario,
    load_engine_configs,
)


@pytest.fixture(scope="module")
def configs():
    return load_engine_configs()


def _public(scenario, configs) -> dict:
    return project_public_showcase(
        evaluate_showcase(
            scenario, configs, include_optimizer=True, include_envelope=True
        )
    )


def test_balanced_portfolio(configs) -> None:
    sc = _public(balanced_portfolio_scenario(configs), configs)
    opt = sc["optimizer"]
    ev = opt["evaluated"]

    assert opt is not None
    assert sc["lambda_envelope"] is not None
    assert opt["at_lambda"] == 0.05

    alloc = opt["result"]["allocation"]
    assert alloc["A"] == pytest.approx(150.0, abs=1e-6)
    assert alloc["B"] == pytest.approx(0.0, abs=1e-6)
    assert alloc["C"] == pytest.approx(150.0, abs=1e-6)

    assert ev["p_meet"] == pytest.approx(0.64, abs=5e-3)
    assert ev["expected_shortfall_mw"] == pytest.approx(45.0, abs=1.0)
    assert ev["expected_delay_burden_mw_months"] == pytest.approx(168.75, abs=1.0)
    assert ev["development_cost"] == pytest.approx(315.0, abs=1.0)


def test_capacity_constrained_portfolio(configs) -> None:
    scenario = capacity_constrained_portfolio_scenario(configs)
    total_k = sum(s.capacity_mw for s in scenario.sites)
    assert total_k == scenario.system.required_capacity_mw == 600

    sc = _public(scenario, configs)
    opt = sc["optimizer"]
    ev = opt["evaluated"]

    assert opt is not None
    assert sc["lambda_envelope"] is not None

    for sid in ("A", "B", "C"):
        assert opt["result"]["allocation"][sid] == pytest.approx(200.0, abs=1e-6)

    assert ev["p_meet"] == 0.0
    assert ev["expected_shortfall_mw"] == pytest.approx(140.0, abs=1.0)
    assert ev["expected_delay_burden_mw_months"] == pytest.approx(1425.0, abs=2.0)
    assert ev["development_cost"] == pytest.approx(660.0, abs=1.0)
    # objective at lambda = 0.50
    assert ev["objective"] == pytest.approx(1372.5, abs=2.0)


def test_cheap_site_risky_schedule(configs) -> None:
    scenario = cheap_site_risky_schedule_scenario()

    # Same portfolio as the canonical ground-truth fixture, only the delay
    # consequence is overridden.
    canonical = load_baseline_scenario()
    assert scenario.system.lambda_mw_month == 0.025
    assert scenario.system.model_copy(
        update={"lambda_mw_month": canonical.system.lambda_mw_month}
    ) == canonical.system
    assert [s.model_dump() for s in scenario.sites] == [
        s.model_dump() for s in canonical.sites
    ]
    # The canonical config object is not mutated.
    assert load_baseline_scenario().system.lambda_mw_month == 0.0

    sc = _public(scenario, configs)
    opt = sc["optimizer"]

    assert opt is not None
    assert sc["lambda_envelope"] is not None
    assert opt["at_lambda"] == 0.025
    # not the lambda = 0 cost-only corner (which is A only)
    assert opt["result"]["allocation"]["A"] < 500.0
    assert sum(opt["result"]["allocation"].values()) == pytest.approx(500.0, abs=1e-6)
