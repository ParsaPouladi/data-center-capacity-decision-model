"""Direct-caller tests for the deployment hardening of the live API
(:mod:`trackc_app.api`).

Scope: an explicit production/staging environment mode that disables the
interactive schema surfaces, an exact-origin CORS allow-list, a
``Host``-header allow-list, request-body size enforced on the bytes actually
received (not only ``Content-Length``), a work-free health endpoint, and a
build/commit identity that can come from the environment. None of this
touches a model quantity or an existing compute guardrail -- that invariant
is re-checked here too.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

import trackc_app.api as api_mod
from trackc.experiments.scalability import generate_synthetic_portfolio
from trackc_app.api import DeploymentSettings
from trackc_app.service import (
    EngineConfigs,
    load_baseline_scenario,
    load_engine_configs,
)

_GOOD_ORIGIN = "https://app.example.test"
_BAD_ORIGIN = "https://evil.example"
_GOOD_HOST = "api.example.test"


@pytest.fixture(scope="module")
def configs() -> EngineConfigs:
    return load_engine_configs()


@pytest.fixture(scope="module")
def baseline_json() -> dict:
    return load_baseline_scenario().model_dump(mode="json")


def _app(configs: EngineConfigs, **settings_kwargs) -> TestClient:
    settings = DeploymentSettings(**settings_kwargs)
    return TestClient(
        api_mod.create_app(configs, settings=settings),
        raise_server_exceptions=False,
    )


# ---------------------------------------------------------------------------
# DeploymentSettings.from_env
# ---------------------------------------------------------------------------


def test_from_env_defaults_to_development_when_unset() -> None:
    s = DeploymentSettings.from_env({})
    assert s.env == "development"
    assert s.is_public_deployment is False
    assert s.cors_origins == () and s.trusted_hosts == () and s.commit is None


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("development", "development"),
        ("dev", "development"),
        ("local", "development"),
        ("staging", "staging"),
        ("production", "production"),
        ("prod", "production"),  # unrecognised -> fail safe as public
        ("nonsense", "production"),
    ],
)
def test_from_env_env_token_mapping(value: str, expected: str) -> None:
    s = DeploymentSettings.from_env({"TRACKC_APP_ENV": value})
    assert s.env == expected
    assert s.is_public_deployment is (expected != "development")


def test_from_env_parses_csv_lists_and_commit_sources() -> None:
    s = DeploymentSettings.from_env(
        {
            "TRACKC_APP_ENV": "staging",
            "TRACKC_APP_CORS_ORIGINS": f" {_GOOD_ORIGIN} , {_GOOD_ORIGIN} ,https://x.dev",
            "TRACKC_APP_TRUSTED_HOSTS": f"{_GOOD_HOST},,",
            "RENDER_GIT_COMMIT": "abcdef1234567890",
        }
    )
    assert s.cors_origins == (_GOOD_ORIGIN, "https://x.dev")  # trimmed, de-duped
    assert s.trusted_hosts == (_GOOD_HOST,)
    assert s.commit == "abcdef1234567890"


def test_from_env_explicit_commit_wins_over_platform_vars() -> None:
    s = DeploymentSettings.from_env(
        {"TRACKC_APP_COMMIT": "deadbeef", "RENDER_GIT_COMMIT": "cafe"}
    )
    assert s.commit == "deadbeef"


# ---------------------------------------------------------------------------
# Interactive schema surfaces: off in a public deployment, on in development
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_schema_surfaces_disabled_in_staging(configs: EngineConfigs, path: str) -> None:
    client = _app(configs, env="staging")
    assert client.get(path).status_code == 404


@pytest.mark.parametrize("path", ["/docs", "/redoc", "/openapi.json"])
def test_schema_surfaces_enabled_in_development(
    configs: EngineConfigs, path: str
) -> None:
    client = _app(configs, env="development")
    assert client.get(path).status_code == 200


# ---------------------------------------------------------------------------
# CORS -- exact origin allow-list, never a wildcard
# ---------------------------------------------------------------------------


def test_cors_grants_the_configured_origin(configs: EngineConfigs) -> None:
    client = _app(configs, env="staging", cors_origins=(_GOOD_ORIGIN,))
    r = client.get("/api/version", headers={"Origin": _GOOD_ORIGIN})
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == _GOOD_ORIGIN
    assert r.headers.get("access-control-allow-origin") != "*"


def test_cors_preflight_succeeds_for_the_configured_origin(
    configs: EngineConfigs,
) -> None:
    client = _app(configs, env="staging", cors_origins=(_GOOD_ORIGIN,))
    r = client.options(
        "/api/p1/compare",
        headers={
            "Origin": _GOOD_ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        },
    )
    assert r.status_code == 200
    assert r.headers.get("access-control-allow-origin") == _GOOD_ORIGIN


def test_cors_does_not_grant_an_unconfigured_origin(configs: EngineConfigs) -> None:
    client = _app(configs, env="staging", cors_origins=(_GOOD_ORIGIN,))
    r = client.get("/api/version", headers={"Origin": _BAD_ORIGIN})
    # The response itself is not blocked server-side, but no ACAO header is
    # granted, so a browser refuses to expose it cross-origin.
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_no_cors_headers_when_no_origins_configured(configs: EngineConfigs) -> None:
    client = _app(configs, env="development")
    r = client.get("/api/version", headers={"Origin": _GOOD_ORIGIN})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


# ---------------------------------------------------------------------------
# Trusted Host -- only when configured; must not exist by default
# ---------------------------------------------------------------------------


def test_trusted_host_rejects_an_unknown_host(configs: EngineConfigs) -> None:
    client = TestClient(
        api_mod.create_app(
            configs, settings=DeploymentSettings(env="staging", trusted_hosts=(_GOOD_HOST,))
        ),
        base_url=f"http://{_BAD_ORIGIN.removeprefix('https://')}",
        raise_server_exceptions=False,
    )
    assert client.get("/healthz").status_code == 400


def test_trusted_host_allows_the_configured_host(configs: EngineConfigs) -> None:
    client = TestClient(
        api_mod.create_app(
            configs, settings=DeploymentSettings(env="staging", trusted_hosts=(_GOOD_HOST,))
        ),
        base_url=f"http://{_GOOD_HOST}",
        raise_server_exceptions=False,
    )
    assert client.get("/healthz").status_code == 200


def test_no_trusted_host_check_by_default(configs: EngineConfigs) -> None:
    client = TestClient(
        api_mod.create_app(configs, settings=DeploymentSettings()),
        base_url="http://anything.example",
        raise_server_exceptions=False,
    )
    assert client.get("/healthz").status_code == 200


# ---------------------------------------------------------------------------
# Request-body size -- enforced on bytes received, not only Content-Length
# ---------------------------------------------------------------------------


def test_oversized_body_with_content_length_rejected(configs: EngineConfigs) -> None:
    client = _app(configs, env="staging")
    r = client.post("/api/p1/compare", json={"_pad": "x" * 300_000})
    assert r.status_code == 413
    assert r.json()["error"] == "request_too_large"


def test_oversized_streamed_body_without_content_length_rejected(
    configs: EngineConfigs,
) -> None:
    client = _app(configs, env="staging")

    def _chunks():
        # ~360 KiB total, no Content-Length -> httpx sends it chunked.
        for _ in range(90):
            yield b"x" * 4096

    r = client.post(
        "/api/p1/compare",
        content=_chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413
    assert r.json()["error"] == "request_too_large"


def test_body_at_or_below_the_cap_is_processed_normally(
    configs: EngineConfigs, baseline_json: dict
) -> None:
    client = _app(configs, env="staging")
    r = client.post("/api/p1/compare", json=baseline_json)
    assert r.status_code == 200


# ---------------------------------------------------------------------------
# Health endpoint -- work-free, leaks nothing
# ---------------------------------------------------------------------------


def test_health_endpoint_ok_and_minimal(configs: EngineConfigs) -> None:
    for env in ("development", "staging", "production"):
        client = _app(configs, env=env)
        r = client.get("/healthz")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}


def test_health_endpoint_exposes_no_internal_fields(configs: EngineConfigs) -> None:
    client = _app(configs, env="staging")
    body = client.get("/healthz").json()
    for leak in ("git_commit", "trackc_version", "provenance", "mapping_version"):
        assert leak not in body


# ---------------------------------------------------------------------------
# Build / release identity from the environment
# ---------------------------------------------------------------------------


def test_version_reports_the_environment_commit(configs: EngineConfigs) -> None:
    client = _app(configs, env="staging", commit="c1f086a")
    assert client.get("/api/version").json()["git_commit"] == "c1f086a"


# ---------------------------------------------------------------------------
# Existing compute guardrails are unchanged by the hardening
# ---------------------------------------------------------------------------


def test_existing_public_guardrails_still_fire(
    configs: EngineConfigs, baseline_json: dict
) -> None:
    client = _app(configs, env="staging", cors_origins=(_GOOD_ORIGIN,))

    over_sites = generate_synthetic_portfolio(13, 80_013).model_dump(mode="json")
    r_sites = client.post("/api/p1/compare", json=over_sites)
    assert r_sites.status_code == 409
    assert r_sites.json()["reason"] == "max_sites_exceeded"

    over_horizon = {
        **baseline_json,
        "system": {**baseline_json["system"], "horizon_month": 240},
    }
    r_horizon = client.post("/api/p1/compare", json=over_horizon)
    assert r_horizon.status_code == 409
    assert r_horizon.json()["reason"] == "max_horizon_exceeded"


def test_error_envelope_carries_no_traceback(
    configs: EngineConfigs, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _app(configs, env="staging")

    def _boom(*_a, **_k):
        raise RuntimeError("secret path /home/x/src/trackc/model/evaluator.py boom")

    monkeypatch.setattr(api_mod.service, "evaluate_showcase", _boom)
    r = client.post("/api/p1/compare", json={"_pad": "small"})
    # schema failure (422) or internal (500) -- either way, no leak
    assert r.status_code in (422, 500)
    raw = r.text.lower()
    assert "traceback" not in raw and "/home/" not in raw and ".py" not in raw
