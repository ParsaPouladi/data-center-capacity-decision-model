"""Contract / parity tests for the live API (:mod:`trackc_app.api`).

The gate: for every supported input the API's **structured** output must
equal the same authoritative :mod:`trackc_app.service` / `trackc` engine
call that the precomputed exports use. Formatted frontend strings are never
the comparison target -- the comparison is API JSON vs. service dict.

These also cover the public-application deployment policy that the
*model* does not own: the 12-site UI cap, the ``N <= 3`` live-optimization
guardrail (refused *before* the optimizer is invoked), request-size
protection, structured error semantics, deterministic reproducibility,
Monte-Carlo disclosure, and the standing rule that no live
lambda-envelope is ever computed.
"""

from __future__ import annotations

import ast
import inspect

import pytest
from fastapi.testclient import TestClient

import trackc
import trackc_app.api as api_mod
from trackc.experiments.scalability import generate_synthetic_portfolio
from trackc.model.evaluator import evaluate_strategy
from trackc.model.schemas import Allocation
from trackc_app import service
from trackc_app.service import (
    APP_LIVE_OPTIMIZATION_MAX_SITES,
    EngineConfigs,
    load_baseline_scenario,
    load_engine_configs,
)

_BASELINE_ALLOC = {"A": 300.0, "B": 200.0, "C": 0.0}


@pytest.fixture(scope="module")
def configs() -> EngineConfigs:
    return load_engine_configs()


@pytest.fixture(scope="module")
def client(configs: EngineConfigs) -> TestClient:
    return TestClient(api_mod.create_app(configs), raise_server_exceptions=False)


@pytest.fixture(scope="module")
def baseline_json() -> dict:
    return load_baseline_scenario().model_dump(mode="json")


# ---------------------------------------------------------------------------
# Provenance / metadata
# ---------------------------------------------------------------------------


def test_version_reports_engine_and_mapping_provenance(client: TestClient) -> None:
    r = client.get("/api/version")
    assert r.status_code == 200
    j = r.json()
    assert j["trackc_version"] == trackc.__version__
    assert j["burden_mapping_version"] == "v1-baseline"
    assert j["uncertainty_mapping_version"] == "v1-baseline"
    # best-effort only -- a real short SHA or null, never a fabricated value
    assert j["git_commit"] is None or isinstance(j["git_commit"], str)


def test_config_exposes_guardrails_and_verbatim_mappings(
    client: TestClient, configs: EngineConfigs
) -> None:
    r = client.get("/api/p1/config")
    assert r.status_code == 200
    j = r.json()
    assert j["mappings"] == service.build_mappings_bundle(configs)
    assert j["application_metadata"] == service._application_metadata()
    assert j["provenance"] == service._provenance(configs)
    pol = j["public_app_policy"]
    assert pol["live_optimization_max_sites"] == APP_LIVE_OPTIMIZATION_MAX_SITES == 3
    assert pol["max_sites"] == 12


# ---------------------------------------------------------------------------
# API/service golden parity
# ---------------------------------------------------------------------------


def test_compare_matches_service_evaluate_showcase(
    client: TestClient, configs: EngineConfigs, baseline_json: dict
) -> None:
    r = client.post("/api/p1/compare", json=baseline_json)
    assert r.status_code == 200
    assert r.json() == service.evaluate_showcase(
        load_baseline_scenario(),
        configs,
        include_optimizer=False,
        include_envelope=False,
    )


def test_optimize_n3_matches_service_and_carries_no_envelope(
    client: TestClient, configs: EngineConfigs, baseline_json: dict
) -> None:
    r = client.post("/api/p1/optimize", json=baseline_json)
    assert r.status_code == 200
    j = r.json()
    assert j["optimizer"] is not None
    assert j["lambda_envelope"] is None
    assert j == service.evaluate_showcase(
        load_baseline_scenario(),
        configs,
        include_optimizer=True,
        include_envelope=False,
    )


def test_evaluate_matches_direct_engine_and_service(
    client: TestClient, configs: EngineConfigs, baseline_json: dict
) -> None:
    r = client.post(
        "/api/p1/evaluate",
        json={"scenario": baseline_json, "allocation": {"by_site": _BASELINE_ALLOC}},
    )
    assert r.status_code == 200
    j = r.json()

    scenario = load_baseline_scenario()
    allocation = Allocation(by_site=dict(_BASELINE_ALLOC))
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = evaluate_strategy(
        scenario,
        allocation,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )
    assert j["evaluation"] == service._serialize_strategy_result(direct)
    assert j == service.evaluate_allocation(scenario, allocation, configs)


def test_profiles_matches_service_builder(
    client: TestClient, configs: EngineConfigs, baseline_json: dict
) -> None:
    r = client.post("/api/p1/profiles", json=baseline_json)
    assert r.status_code == 200
    assert r.json()["site_power_profiles"] == service.build_site_power_profiles(
        load_baseline_scenario(), configs
    )


def test_repeated_compare_is_byte_identical(
    client: TestClient, baseline_json: dict
) -> None:
    a = client.post("/api/p1/compare", json=baseline_json)
    b = client.post("/api/p1/compare", json=baseline_json)
    assert a.status_code == b.status_code == 200
    assert a.text == b.text


# ---------------------------------------------------------------------------
# Monte-Carlo disclosure (larger, still within the 12-site UI cap)
# ---------------------------------------------------------------------------


def test_compare_surfaces_monte_carlo_metadata(
    client: TestClient, configs: EngineConfigs
) -> None:
    scenario = generate_synthetic_portfolio(10, 80_010)
    r = client.post("/api/p1/compare", json=scenario.model_dump(mode="json"))
    assert r.status_code == 200
    ss = r.json()["scenario_set"]
    assert ss["method"] == "monte_carlo"
    assert ss["n_samples"] == configs.defaults.mc_samples
    assert ss["random_seed"] == configs.defaults.random_seed
    assert ss["s_full"] == 3**10


# ---------------------------------------------------------------------------
# Public-application deployment guardrails
# ---------------------------------------------------------------------------


def test_optimize_above_guardrail_refused_before_optimizer_runs(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """N=5 is > 3 (and <= 12): the API must return the structured 409
    guardrail response WITHOUT invoking the exact optimizer."""
    scenario = generate_synthetic_portfolio(5, 80_005)

    def _boom(*_a: object, **_k: object) -> object:
        raise AssertionError("optimize_allocation must not be invoked for N > 3")

    monkeypatch.setattr(service, "optimize_allocation", _boom)

    r = client.post("/api/p1/optimize", json=scenario.model_dump(mode="json"))
    assert r.status_code == 409
    j = r.json()
    assert j["error"] == "public_app_guardrail"
    assert j["reason"] == "live_optimization_site_limit"
    assert j["n_sites"] == 5
    assert j["max_sites"] == APP_LIVE_OPTIMIZATION_MAX_SITES
    assert "/api/p1/compare" in j["available"]


def test_compare_and_evaluate_remain_available_above_optimizer_guardrail(
    client: TestClient, configs: EngineConfigs
) -> None:
    scenario = generate_synthetic_portfolio(6, 80_006)
    body = scenario.model_dump(mode="json")

    r = client.post("/api/p1/compare", json=body)
    assert r.status_code == 200
    assert r.json()["optimizer"] is None

    first_site = scenario.sites[0].id
    r = client.post(
        "/api/p1/evaluate",
        json={"scenario": body, "allocation": {"by_site": {first_site: 10.0}}},
    )
    assert r.status_code == 200


def test_more_than_twelve_sites_refused_as_ui_policy(client: TestClient) -> None:
    scenario = generate_synthetic_portfolio(13, 80_013)
    r = client.post("/api/p1/compare", json=scenario.model_dump(mode="json"))
    assert r.status_code == 409
    j = r.json()
    assert j["error"] == "public_app_guardrail"
    assert j["reason"] == "max_sites_exceeded"
    assert j["n_sites"] == 13


_TIE_SCENARIO_JSON = {
    "system": {
        "required_capacity_mw": 400.0,
        "target_month": 36,
        "horizon_month": 72,
        "lambda_mw_month": 0.05,
    },
    "sites": [
        {
            "id": "A",
            "capacity_mw": 300.0,
            "cost_per_mw": 1.0,
            "burden_state": 1,
            "uncertainty_state": 1,
        },
        {
            "id": "B",
            "capacity_mw": 300.0,
            "cost_per_mw": 2.0,
            "burden_state": 2,
            "uncertainty_state": 1,
        },
    ],
}


def _horizon_scenario_json(horizon: int) -> dict:
    return {
        "system": {
            "required_capacity_mw": 300.0,
            "target_month": 36,
            "horizon_month": horizon,
            "lambda_mw_month": 0.0,
        },
        "sites": [
            {
                "id": "A",
                "capacity_mw": 300.0,
                "cost_per_mw": 1.0,
                "burden_state": 1,
                "uncertainty_state": 1,
            }
        ],
    }


@pytest.mark.parametrize("route", ["/api/p1/compare", "/api/p1/optimize", "/api/p1/profiles"])
def test_horizon_above_public_policy_refused_on_every_scenario_route(
    client: TestClient, route: str
) -> None:
    r = client.post(route, json=_horizon_scenario_json(73))
    assert r.status_code == 409
    j = r.json()
    assert j["error"] == "public_app_guardrail"
    assert j["reason"] == "max_horizon_exceeded"
    assert j["max_horizon_month"] == 72
    assert j["horizon_month"] == 73
    # must not be framed as a model limit
    assert "not a structural model constraint" in j["message"]


def test_horizon_above_public_policy_refused_on_evaluate(client: TestClient) -> None:
    r = client.post(
        "/api/p1/evaluate",
        json={
            "scenario": _horizon_scenario_json(240),
            "allocation": {"by_site": {"A": 10.0}},
        },
    )
    assert r.status_code == 409
    assert r.json()["reason"] == "max_horizon_exceeded"


def test_horizon_at_public_policy_limit_is_accepted(client: TestClient) -> None:
    r = client.post("/api/p1/compare", json=_horizon_scenario_json(72))
    assert r.status_code == 200


def test_horizon_guardrail_fires_before_any_engine_call(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A direct caller cannot bypass the horizon cap: the 409 is returned
    without the service / engine ever being reached, even for an
    astronomically large horizon."""

    def _boom(*_a: object, **_k: object) -> object:
        raise AssertionError("engine must not be reached for an over-policy horizon")

    monkeypatch.setattr(service, "evaluate_showcase", _boom)
    monkeypatch.setattr(service, "build_showcase_scenario_set", _boom)

    r = client.post("/api/p1/compare", json=_horizon_scenario_json(100_000))
    assert r.status_code == 409
    assert r.json()["reason"] == "max_horizon_exceeded"


def test_config_exposes_horizon_policy(client: TestClient) -> None:
    r = client.get("/api/p1/config")
    assert r.status_code == 200
    pol = r.json()["public_app_policy"]
    assert pol["max_horizon_month"] == 72
    assert "not a structural model constraint" in pol["note"]


def test_compare_tolerates_benchmark_indifference_state(client: TestClient) -> None:
    """A full-interval benchmark tie is a valid indifference state, not a
    4xx. `/compare` returns 200 and exposes
    the co-optimal set."""
    r = client.post("/api/p1/compare", json=_TIE_SCENARIO_JSON)
    assert r.status_code == 200
    boundaries = r.json()["decision_boundaries"]
    assert boundaries["global_switching_has_cooptimal_segments"] is True
    tied = [s for s in boundaries["global_switching_boundaries"] if len(s["co_optimal"]) > 1]
    assert tied
    assert set(tied[0]["co_optimal"]) == {"cost_concentration", "speed_reliability"}


def test_optimize_tolerates_benchmark_indifference_state(client: TestClient) -> None:
    r = client.post("/api/p1/optimize", json=_TIE_SCENARIO_JSON)
    assert r.status_code == 200
    j = r.json()
    assert j["optimizer"] is not None
    assert j["decision_boundaries"]["global_switching_has_cooptimal_segments"] is True


def test_model_input_error_message_is_sanitized(
    client: TestClient, baseline_json: dict
) -> None:
    r = client.post(
        "/api/p1/evaluate",
        json={"scenario": baseline_json, "allocation": {"by_site": {"A": 1e9}}},
    )
    assert r.status_code == 422
    msg = r.json()["message"]
    # still useful to the user...
    assert "capacity" in msg.lower()
    # ...but never leaks a source path or an internal function-name instruction
    assert ".py" not in msg.lower()
    assert "co_optimal_strategies_at_lambda" not in msg
    assert "Use " not in msg


def test_sanitize_model_error_strips_developer_tail_and_paths() -> None:
    keep = "allocation exceeds site capacity for: B: x=500.0 > K=300.0"
    assert api_mod._sanitize_model_error(keep) == keep

    with_tail = (
        "no unique preferred strategy at lambda=0.5: ['a', 'b'] are co-optimal. "
        "Use co_optimal_strategies_at_lambda() to get the full tied set instead."
    )
    out = api_mod._sanitize_model_error(with_tail)
    assert out.endswith(".")
    assert "Use " not in out
    assert "co_optimal_strategies_at_lambda()" not in out

    with_path = "boom in /home/x/src/trackc/model/comparator.py line 320"
    assert api_mod._sanitize_model_error(with_path) == (
        "The model rejected these inputs as invalid."
    )


def test_oversized_request_body_rejected(client: TestClient) -> None:
    body = {
        "system": {
            "required_capacity_mw": 1,
            "target_month": 1,
            "horizon_month": 2,
            "lambda_mw_month": 0,
        },
        "sites": [],
        "_pad": "x" * 300_000,
    }
    r = client.post("/api/p1/compare", json=body)
    assert r.status_code == 413
    assert r.json()["error"] == "request_too_large"


# ---------------------------------------------------------------------------
# Structured error semantics
# ---------------------------------------------------------------------------


def test_allocation_exceeding_capacity_returns_422(
    client: TestClient, baseline_json: dict
) -> None:
    r = client.post(
        "/api/p1/evaluate",
        json={"scenario": baseline_json, "allocation": {"by_site": {"A": 1e9}}},
    )
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_model_input"


def test_unknown_site_in_allocation_returns_422(
    client: TestClient, baseline_json: dict
) -> None:
    r = client.post(
        "/api/p1/evaluate",
        json={"scenario": baseline_json, "allocation": {"by_site": {"ZZZ": 1.0}}},
    )
    assert r.status_code == 422
    assert r.json()["error"] == "invalid_model_input"


def test_malformed_scenario_returns_422_app_envelope(client: TestClient) -> None:
    """A request-schema failure uses the application's own {error, message}
    envelope -- it does not leak the raw pydantic error list."""
    r = client.post(
        "/api/p1/compare",
        json={"system": {"required_capacity_mw": 100}, "sites": []},
    )
    assert r.status_code == 422
    j = r.json()
    assert j["error"] == "invalid_request_schema"
    assert isinstance(j["message"], str) and j["message"]
    assert "detail" not in j  # raw pydantic structure is not exposed
    assert "ctx" not in j["message"] and "loc" not in j["message"]


def test_negative_lambda_uses_app_error_envelope(client: TestClient) -> None:
    """`lambda_mw_month = -0.1` is rejected by the schema (`ge=0`). The
    client sees the normal {error, message} envelope naming the field, not a
    raw Pydantic ``detail`` list."""
    r = client.post(
        "/api/p1/compare",
        json={
            "system": {
                "required_capacity_mw": 300.0,
                "target_month": 36,
                "horizon_month": 72,
                "lambda_mw_month": -0.1,
            },
            "sites": [
                {
                    "id": "A",
                    "capacity_mw": 300.0,
                    "cost_per_mw": 1.0,
                    "burden_state": 1,
                    "uncertainty_state": 1,
                }
            ],
        },
    )
    assert r.status_code == 422
    j = r.json()
    assert j["error"] == "invalid_request_schema"
    assert "detail" not in j
    assert "lambda_mw_month" in j["message"]
    assert "greater than or equal to 0" in j["message"]


# ---------------------------------------------------------------------------
# capacity-feasibility condition: system-level insufficiency (sum_i K_i < D)
# ---------------------------------------------------------------------------


def _system_insufficient_scenario_json() -> dict:
    """Baseline sites (sum K = 1050) with D raised to 2000: the
    capacity-feasibility condition."""
    scenario = load_baseline_scenario().model_dump(mode="json")
    scenario["system"]["required_capacity_mw"] = 2000.0
    return scenario


def test_optimize_classifies_system_insufficiency_as_domain_outcome(
    client: TestClient,
) -> None:
    """`/optimize` on `sum(K) < D` returns the domain-specific
    ``system_insufficient`` envelope, NOT the generic ``invalid_model_input``
    bucket used for schema/allocation violations."""
    r = client.post("/api/p1/optimize", json=_system_insufficient_scenario_json())
    assert r.status_code == 422
    j = r.json()
    assert j["error"] == "system_insufficient"
    assert j["error"] != "invalid_model_input"
    assert j["message"] == (
        "Required capacity exceeds total developable portfolio capacity."
    )
    assert j["required_capacity_mw"] == 2000.0
    assert j["total_developable_capacity_mw"] == 1050.0
    # no internal module/function reference leaks to the client
    assert "evaluate_strategy" not in j["message"]
    assert "evaluator." not in j["message"]
    assert ".py" not in j["message"].lower()


def test_compare_and_evaluate_retain_canonical_system_insufficient_behavior(
    client: TestClient,
) -> None:
    """`/compare` and `/evaluate` still report the capacity-feasibility
    condition in-band (HTTP 200,
    ``feasibility_status == "system_insufficient"``) -- unchanged by the
    ``/optimize`` classification."""
    body = _system_insufficient_scenario_json()

    r = client.post("/api/p1/compare", json=body)
    assert r.status_code == 200
    for result in r.json()["strategies"].values():
        assert result["feasibility_status"] == "system_insufficient"

    r = client.post(
        "/api/p1/evaluate",
        json={"scenario": body, "allocation": {"by_site": {"A": 500.0}}},
    )
    assert r.status_code == 200
    assert r.json()["evaluation"]["feasibility_status"] == "system_insufficient"


def test_system_insufficiency_frozen_optimizer_exception_is_untouched() -> None:
    """The frozen engine still raises for the capacity-feasibility
    condition -- the API classifies that
    exception, it does not suppress or alter it. (Guards against 'fixing'
    the optimizer to produce the API behavior.)"""
    from trackc.model.optimizer import optimize_allocation

    configs = load_engine_configs()
    scenario = load_baseline_scenario().model_copy(
        update={
            "system": load_baseline_scenario().system.model_copy(
                update={"required_capacity_mw": 2000.0}
            )
        }
    )
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    with pytest.raises(ValueError, match="system-level insufficiency"):
        optimize_allocation(
            scenario,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )


def test_value_error_handler_maps_section25_message_without_leaking_internals(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Defense-in-depth: with the ``/optimize`` pre-check disabled, the
    capacity-feasibility ValueError raised by the frozen optimizer still
    reaches the client as
    the ``system_insufficient`` envelope -- and the engine's
    ``evaluator.evaluate_strategy`` reference is never forwarded."""
    monkeypatch.setattr(api_mod, "_reject_if_system_insufficient", lambda _s: None)
    r = client.post("/api/p1/optimize", json=_system_insufficient_scenario_json())
    assert r.status_code == 422
    j = r.json()
    assert j["error"] == "system_insufficient"
    assert "evaluate_strategy" not in j["message"]
    assert "spec section 25" not in j["message"]
    # the raw engine message *would* have leaked the internal reference:
    assert "evaluate_strategy" in api_mod._sanitize_model_error(
        "system-level insufficiency (spec section 25): x. This mirrors "
        "evaluator.evaluate_strategy's 'system_insufficient' feasibility status."
    )


def test_config_exposes_input_domain(client: TestClient) -> None:
    r = client.get("/api/p1/config")
    assert r.status_code == 200
    dom = r.json()["public_app_policy"]["input_domain"]
    # canonical schema lower bounds, no invented upper bounds
    assert dom["lambda_mw_month"]["min"] == 0
    assert dom["lambda_mw_month"]["max"] is None
    assert dom["required_capacity_mw"]["max"] is None
    assert dom["site_capacity_mw"]["min_exclusive"] is True
    assert dom["burden_state"]["allowed"] == [1, 2, 3, 4]
    assert dom["uncertainty_state"]["allowed"] == [1, 2, 3, 4]
    # public-application deployment maxima (not model limits)
    assert dom["n_sites"]["max"] == 12
    assert dom["horizon_month"]["max"] == 72
    assert "sum(site_capacity_mw) >= required_capacity_mw" in dom["relations"]


def test_horizon_not_after_target_returns_422(client: TestClient) -> None:
    r = client.post(
        "/api/p1/compare",
        json={
            "system": {
                "required_capacity_mw": 100,
                "target_month": 24,
                "horizon_month": 12,
                "lambda_mw_month": 0.0,
            },
            "sites": [
                {
                    "id": "A",
                    "capacity_mw": 100,
                    "cost_per_mw": 1.0,
                    "burden_state": 1,
                    "uncertainty_state": 1,
                }
            ],
        },
    )
    assert r.status_code == 422


# ---------------------------------------------------------------------------
# No live lambda-envelope, ever
# ---------------------------------------------------------------------------


def test_api_source_never_computes_a_live_envelope() -> None:
    """No call to ``build_envelope`` anywhere in the live request path, and
    no ``evaluate_showcase(..., include_envelope=True)``. Checked on the
    AST so the charter docstring's *mention* of the ban does not count."""
    tree = ast.parse(inspect.getsource(api_mod))
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = getattr(func, "attr", getattr(func, "id", None))
        assert name != "build_envelope", "api.py must never call build_envelope()"
        if name in {"evaluate_showcase", "evaluate_allocation"}:
            for kw in node.keywords:
                if kw.arg == "include_envelope":
                    assert not (
                        isinstance(kw.value, ast.Constant) and kw.value.value is True
                    ), "api.py must never request include_envelope=True"


def test_optimize_response_envelope_is_null(
    client: TestClient, baseline_json: dict
) -> None:
    r = client.post("/api/p1/optimize", json=baseline_json)
    assert r.status_code == 200
    assert r.json()["lambda_envelope"] is None
