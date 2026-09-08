"""Live HTTP API for the public application.

================================  CHARTER  ================================

**Status: NON-CANONICAL application code.** Subordinate to the model
specification and assumptions documents. If anything here appears to
conflict with the canonical documents, they win and this module yields.

This module is a **thin HTTP boundary** over :mod:`trackc_app.service`,
which is itself a thin orchestration boundary over the frozen `trackc`
engine. Route handlers only:

* parse/validate the request with the engine's own pydantic schemas;
* apply **public-application deployment policy** (max site count, the
  ``N <= 3`` live-optimization guardrail, a request-size cap) -- none of
  which changes any model behavior;
* call one existing :mod:`trackc_app.service` function;
* serialize its result to JSON.

It does **not**, and must never:

* reimplement, re-derive, approximate, or modify any model equation, the
  scenario logic, the evaluator, the comparator, or the optimizer;
* compute a model quantity the engine did not return;
* call :func:`trackc.experiments.envelope.build_envelope` or otherwise
  compute a live lambda-envelope -- the full lambda-envelope is a
  precomputed static artifact only. Every ``evaluate_showcase`` call here
  passes ``include_envelope=False``.

Parity: `tests/api/test_api_parity.py` asserts every route's structured
output equals a direct :mod:`trackc_app.service` / engine call on the same
fixture -- the same standard the precomputed exports are held to.

Run locally:  ``uvicorn trackc_app.api:app --reload``  (needs the ``app``
extra: ``pip install -e ".[app]"``). The frontend reaches it through the
Vite dev proxy (`web/vite.config.ts`); production CORS / rate-limiting /
timeouts are handled at deployment.

=========================================================================
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from starlette.middleware.trustedhost import TrustedHostMiddleware

from trackc import __version__ as _TRACKC_VERSION
from trackc.model.schemas import Allocation, Scenario
from trackc_app import service
from trackc_app.service import (
    APP_LIVE_OPTIMIZATION_MAX_SITES,
    EngineConfigs,
    load_engine_configs,
)

_LOG = logging.getLogger("trackc_app.api")
_REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Public-application deployment policy (NOT model parameters or limits).
# ---------------------------------------------------------------------------

#: The public UI renders at most this many sites. A deployment policy, not
#: a structural model limitation -- the engine is N-general. Requests above
#: it are refused with 409.
PUBLIC_APP_MAX_SITES = 12

#: Reject request bodies larger than this (bytes) with 413. A stylized
#: 12-site scenario is well under 10 KiB; this is basic abuse protection,
#: not full production hardening.
MAX_REQUEST_BYTES = 262_144

#: This application uses a 72-month analysis horizon as a
#: DEPLOYMENT POLICY. The underlying trackc engine is horizon-general; this
#: is not a structural model constraint and must not be described as one.
#: It is enforced here because ``horizon_month`` has no schema upper bound,
#: is not a user control in the v1 UI (it is carried fixed from the chosen
#: preset), and is the one input that scales the evaluator's
#: (realizations x sites x times) tensors without limit -- an unbounded
#: value is the main out-of-memory / request-timeout vector for the public
#: service. Requests above it are refused with a structured 409 *before*
#: any engine/model call.
PUBLIC_APP_MAX_HORIZON_MONTHS = 72


# ---------------------------------------------------------------------------
# Request models -- reuse the engine's own schemas.
# ---------------------------------------------------------------------------


class EvaluateRequest(BaseModel):
    """A user-supplied allocation to evaluate against a user-supplied
    scenario, at that scenario's own ``lambda_mw_month``."""

    scenario: Scenario
    allocation: Allocation


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _git_commit() -> str | None:
    """Best-effort short commit SHA for provenance, or ``None`` -- never a
    fabricated value."""
    try:
        proc = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=_REPO_ROOT,
            capture_output=True,
            text=True,
            timeout=2,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    out = proc.stdout.strip()
    return out if proc.returncode == 0 and out else None


def _guardrail_response(reason: str, message: str, **extra: object) -> JSONResponse:
    """A structured HTTP 409 application-guardrail refusal (a deployment
    policy; the model itself is untouched). Machine-readable ``reason``."""
    return JSONResponse(
        status_code=409,
        content={
            "error": "public_app_guardrail",
            "reason": reason,
            "message": message,
            **extra,
        },
    )


def _reject_if_too_many_sites(scenario: Scenario) -> JSONResponse | None:
    n = len(scenario.sites)
    if n > PUBLIC_APP_MAX_SITES:
        return _guardrail_response(
            "max_sites_exceeded",
            (
                f"This public application accepts at most {PUBLIC_APP_MAX_SITES} "
                f"sites; the request has {n}. This is a UI deployment policy, not a "
                "limit of the model (the trackc engine is N-general)."
            ),
            max_sites=PUBLIC_APP_MAX_SITES,
            n_sites=n,
        )
    return None


def _reject_if_horizon_too_long(scenario: Scenario) -> JSONResponse | None:
    """Refuse a scenario whose ``horizon_month`` exceeds the public
    application's fixed analysis horizon, *before* any engine/model call.
    See :data:`PUBLIC_APP_MAX_HORIZON_MONTHS`."""
    h = scenario.system.horizon_month
    if h > PUBLIC_APP_MAX_HORIZON_MONTHS:
        return _guardrail_response(
            "max_horizon_exceeded",
            (
                f"This application uses a "
                f"{PUBLIC_APP_MAX_HORIZON_MONTHS}-month analysis horizon as a "
                f"deployment policy; this request asks for horizon_month={h}. The "
                "underlying trackc engine is horizon-general -- this is a limit of "
                "the public service, not a structural model constraint. Set "
                f"horizon_month to {PUBLIC_APP_MAX_HORIZON_MONTHS} or below."
            ),
            max_horizon_month=PUBLIC_APP_MAX_HORIZON_MONTHS,
            horizon_month=h,
        )
    return None


def _reject_public_scenario(scenario: Scenario) -> JSONResponse | None:
    """All scenario-level public-application guardrails, in the order they
    should fire. Returns the first refusal, or ``None`` if the scenario is
    within every public-service policy."""
    return _reject_if_too_many_sites(scenario) or _reject_if_horizon_too_long(scenario)


# ---------------------------------------------------------------------------
# Capacity-feasibility condition: sum_i K_i < D.
# ---------------------------------------------------------------------------

#: Stable prefix of the frozen engine's capacity-feasibility message.
#: Matched only to *classify* the response envelope -- the engine's text is
#: never forwarded, so no internal module/function reference reaches a client.
_SYSTEM_INSUFFICIENT_MARKER = "system-level insufficiency (spec section 25)"

#: Public-facing text for that condition: it states only the domain fact.
_SYSTEM_INSUFFICIENT_MESSAGE = (
    "Required capacity exceeds total developable portfolio capacity."
)


def _system_insufficient_response(
    required_capacity_mw: float | None = None,
    total_developable_capacity_mw: float | None = None,
) -> JSONResponse:
    """The domain-specific envelope for the capacity-feasibility condition.
    Status 422 is retained (the request cannot be optimised as posed); ``error`` is
    ``"system_insufficient"``, not the generic ``"invalid_model_input"``."""
    content: dict[str, object] = {
        "error": "system_insufficient",
        "message": _SYSTEM_INSUFFICIENT_MESSAGE,
    }
    if required_capacity_mw is not None:
        content["required_capacity_mw"] = float(required_capacity_mw)
    if total_developable_capacity_mw is not None:
        content["total_developable_capacity_mw"] = float(total_developable_capacity_mw)
    return JSONResponse(status_code=422, content=content)


def _reject_if_system_insufficient(scenario: Scenario) -> JSONResponse | None:
    """``/optimize`` only: ``sum_i K_i < D`` is the capacity-feasibility
    condition -- there is no allocation to search, so the
    frozen optimizer (correctly) raises. Classify that here as the
    domain-specific ``system_insufficient`` outcome instead of the generic
    ``invalid_model_input``. ``/compare`` and ``/evaluate`` are unaffected --
    they keep reporting the same condition in-band via ``feasibility_status``.

    This performs no model computation: it is the same ``sum(K) < D``
    comparison the engine itself makes, used only to
    choose the response envelope."""
    total_k = sum(site.capacity_mw for site in scenario.sites)
    if total_k < scenario.system.required_capacity_mw:
        return _system_insufficient_response(
            scenario.system.required_capacity_mw, total_k
        )
    return None


def _summarize_validation_errors(errors: list[dict]) -> str:
    """A short public-facing summary of a request-schema failure. The raw
    ``RequestValidationError.errors()`` list leaks ``loc`` / ``ctx`` / ``url``
    internals; this keeps only the field name and the human message for at
    most the first few problems."""
    parts: list[str] = []
    for err in errors[:3]:
        loc = ".".join(
            str(p)
            for p in err.get("loc", ())
            if p not in ("body", "query", "path", "header")
        )
        msg = str(err.get("msg", "invalid value")).strip()
        parts.append(f"{loc}: {msg}" if loc else msg)
    summary = "; ".join(p for p in parts if p)
    return summary or "The request did not match the expected schema."


def _public_input_domain(configs: EngineConfigs) -> dict:
    """The domain of every user-editable scenario input in the public editor.

    Lower bounds are the canonical ``trackc`` input schema. ``n_sites`` and
    ``horizon_month`` maxima are public-application
    deployment policy, not model limits (the engine is N-general and
    horizon-general). Inputs whose ``max`` is ``null`` have **no**
    authoritative upper bound -- the editor must not invent one."""
    burden_states = sorted(int(k) for k in configs.burden.states)
    uncertainty_states = sorted(int(k) for k in configs.uncertainty.states)
    return {
        "required_capacity_mw": {"min": 0, "min_exclusive": True, "max": None},
        "target_month": {
            "min": 1,
            "max": None,
            "integer": True,
            "must_be_less_than": "horizon_month",
        },
        "lambda_mw_month": {"min": 0, "min_exclusive": False, "max": None},
        "site_capacity_mw": {"min": 0, "min_exclusive": True, "max": None},
        "site_cost_per_mw": {"min": 0, "min_exclusive": False, "max": None},
        "burden_state": {"allowed": burden_states},
        "uncertainty_state": {"allowed": uncertainty_states},
        "n_sites": {
            "min": 1,
            "max": PUBLIC_APP_MAX_SITES,
            "authority": "public_application_policy",
        },
        "horizon_month": {
            "min": 1,
            "max": PUBLIC_APP_MAX_HORIZON_MONTHS,
            "editable": False,
            "authority": "public_application_policy",
        },
        "relations": ["sum(site_capacity_mw) >= required_capacity_mw"],
        "note": (
            "Lower bounds are the canonical trackc input schema. n_sites and "
            "horizon_month maxima are public-application "
            "deployment policy, not model limits. Inputs with max=null have no "
            "authoritative upper bound."
        ),
    }


_MODEL_ERROR_MAX_LEN = 400


def _sanitize_model_error(message: str) -> str:
    """Return the user-meaningful part of an engine input-validation
    ``ValueError`` message, with developer-facing tails removed.

    The engine's genuine input errors -- unknown site id, ``x_i > K_i``,
    ``horizon <= target`` -- are a single short clause with no source path
    or internal function name, so they pass through unchanged. Anything that
    carries a ``Use ``foo()`` ...`` developer instruction or a source path
    is replaced with a generic message; the full text is still logged
    server-side."""
    text = " ".join(message.split())
    for marker in (". Use ", "; use ", ". use ", " Use "):
        idx = text.find(marker)
        if idx != -1:
            text = text[:idx].rstrip(" .;") + "."
            break
    lowered = text.lower()
    if ".py" in lowered or "/src/" in lowered or "traceback" in lowered:
        return "The model rejected these inputs as invalid."
    return text[:_MODEL_ERROR_MAX_LEN]


# ---------------------------------------------------------------------------
# Deployment settings -- environment-driven, no secrets.
# ---------------------------------------------------------------------------

#: ``TRACKC_APP_ENV`` values that keep local developer conveniences (the
#: interactive ``/docs``, ``/redoc`` and ``/openapi.json``). Anything else
#: -- including an unrecognised value -- is treated as a public deployment
#: and those surfaces are disabled (fail safe).
_DEV_ENV_TOKENS = frozenset({"development", "dev", "local", "test"})


def _split_csv(raw: str | None) -> tuple[str, ...]:
    """Parse a comma-separated environment value into a tuple of non-empty,
    stripped entries (order preserved, duplicates kept out)."""
    if not raw:
        return ()
    seen: list[str] = []
    for part in raw.split(","):
        item = part.strip()
        if item and item not in seen:
            seen.append(item)
    return tuple(seen)


@dataclass(frozen=True, slots=True)
class DeploymentSettings:
    """Runtime deployment posture for the public API, sourced from the
    environment. Carries no secret and no model parameter -- only the
    public-service hardening switches described below.

    * ``env`` -- ``"development"`` (default) keeps ``/docs`` etc.; ``"staging"``
      and ``"production"`` disable them.
    * ``cors_origins`` -- exact allowed browser origins. Empty means *no*
      CORS middleware (same-origin dev via the Vite proxy). Never a wildcard.
    * ``trusted_hosts`` -- allowed ``Host`` header values for the directly
      exposed service. Empty means the check is not installed.
    * ``commit`` -- build/release commit id for provenance, from
      ``TRACKC_APP_COMMIT`` / ``RENDER_GIT_COMMIT`` / ``CF_PAGES_COMMIT_SHA``;
      never fabricated.
    """

    env: str = "development"
    cors_origins: tuple[str, ...] = ()
    trusted_hosts: tuple[str, ...] = ()
    commit: str | None = None

    @property
    def is_public_deployment(self) -> bool:
        return self.env not in _DEV_ENV_TOKENS

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> DeploymentSettings:
        env_map = os.environ if environ is None else environ
        raw_env = (env_map.get("TRACKC_APP_ENV") or "").strip().lower()
        if not raw_env or raw_env in _DEV_ENV_TOKENS:
            env = "development"
        elif raw_env == "staging":
            env = "staging"
        else:
            # Unrecognised -> fail safe as a public deployment.
            env = "production"
        commit = (
            env_map.get("TRACKC_APP_COMMIT")
            or env_map.get("RENDER_GIT_COMMIT")
            or env_map.get("CF_PAGES_COMMIT_SHA")
            or ""
        ).strip()[:40] or None
        return cls(
            env=env,
            cors_origins=_split_csv(env_map.get("TRACKC_APP_CORS_ORIGINS")),
            trusted_hosts=_split_csv(env_map.get("TRACKC_APP_TRUSTED_HOSTS")),
            commit=commit,
        )


# ---------------------------------------------------------------------------
# Request-body size enforcement on bytes actually received (not only the
# declared Content-Length).
# ---------------------------------------------------------------------------


class _RequestBodyTooLarge(HTTPException):
    """Raised from the ASGI receive wrapper when a streamed request body
    (e.g. a chunked upload with no ``Content-Length``) crosses
    :data:`MAX_REQUEST_BYTES`. Subclasses ``HTTPException`` so FastAPI's
    body-parsing re-raises it unchanged; a handler renders the structured
    413 envelope."""

    def __init__(self) -> None:
        super().__init__(status_code=413, detail="request body too large")


class _BodySizeLimitMiddleware:
    """Refuse request bodies larger than ``max_bytes``. A declared oversize
    ``Content-Length`` is rejected immediately; a body without one is counted
    as it streams and aborted once it crosses the cap, so the header cannot
    be used to bypass the limit."""

    def __init__(self, app, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        for name, value in scope.get("headers", ()):
            if name == b"content-length":
                try:
                    declared = int(value)
                except ValueError:
                    break
                if declared > self.max_bytes:
                    await self._send_413(send)
                    return
                break

        received = 0

        async def limited_receive():
            nonlocal received
            message = await receive()
            if message.get("type") == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _RequestBodyTooLarge()
            return message

        await self.app(scope, limited_receive, send)

    async def _send_413(self, send) -> None:
        body = json.dumps(
            {
                "error": "request_too_large",
                "message": (
                    f"Request body exceeds the {self.max_bytes}-byte "
                    "public-application limit."
                ),
            }
        ).encode()
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode()),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})


# ---------------------------------------------------------------------------
# App factory
# ---------------------------------------------------------------------------


def create_app(
    configs: EngineConfigs | None = None,
    settings: DeploymentSettings | None = None,
) -> FastAPI:
    """Build the FastAPI app. ``configs`` defaults to the canonical
    ``configs/`` bundle loaded once via the engine's own loaders; ``settings``
    defaults to :meth:`DeploymentSettings.from_env` (development posture when
    the environment is unset)."""
    settings = settings or DeploymentSettings.from_env()

    # In any public deployment the interactive schema surfaces are turned off;
    # development keeps them.
    docs_kwargs: dict[str, str | None] = {}
    if settings.is_public_deployment:
        docs_kwargs = {"docs_url": None, "redoc_url": None, "openapi_url": None}

    app = FastAPI(
        title="Data Center Capacity Decision Model API",
        version=_TRACKC_VERSION,
        description=(
            "Non-canonical application service. Orchestrates the frozen trackc "
            "engine via trackc_app.service; computes no model quantity itself."
        ),
        **docs_kwargs,
    )
    app.state.configs = configs or load_engine_configs()
    app.state.settings = settings

    # Middleware. add_middleware prepends, so the last added is outermost:
    # final order is CORS -> TrustedHost -> body-size -> routes.
    app.add_middleware(_BodySizeLimitMiddleware, max_bytes=MAX_REQUEST_BYTES)
    if settings.trusted_hosts:
        app.add_middleware(
            TrustedHostMiddleware, allowed_hosts=list(settings.trusted_hosts)
        )
    if settings.cors_origins:
        # Exact origin allow-list only -- never a wildcard. No credentials
        # are used.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(settings.cors_origins),
            allow_credentials=False,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type"],
            max_age=600,
        )

    @app.exception_handler(_RequestBodyTooLarge)
    async def _body_too_large_handler(
        request: Request, exc: _RequestBodyTooLarge
    ) -> JSONResponse:
        _LOG.warning(
            "Request body exceeded %d bytes in %s %s",
            MAX_REQUEST_BYTES,
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=413,
            content={
                "error": "request_too_large",
                "message": (
                    f"Request body exceeds the {MAX_REQUEST_BYTES}-byte "
                    "public-application limit."
                ),
            },
        )

    @app.exception_handler(RequestValidationError)
    async def _request_validation_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # Request-schema failures (e.g. lambda_mw_month < 0, missing field,
        # non-integer target_month) use the application's own
        # {error, message} envelope instead of leaking the raw pydantic
        # error list (loc / ctx / url internals). Full details are logged.
        _LOG.warning(
            "Schema-invalid request in %s %s: %s",
            request.method,
            request.url.path,
            exc.errors(),
        )
        return JSONResponse(
            status_code=422,
            content={
                "error": "invalid_request_schema",
                "message": _summarize_validation_errors(exc.errors()),
            },
        )

    @app.exception_handler(ValueError)
    async def _value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
        # Engine/model input rules (e.g. x_i > K_i, unknown site id,
        # horizon <= target) surface as ValueError -> 422. The full text is
        # logged; the client sees only the sanitized user-facing clause.
        text = str(exc)
        _LOG.warning(
            "Rejected model input in %s %s: %s", request.method, request.url.path, exc
        )
        if text.startswith(_SYSTEM_INSUFFICIENT_MARKER):
            # Capacity-feasibility condition: a known domain outcome, not bad input.
            # Return the same envelope the /optimize pre-check uses -- the
            # engine's message (which names an internal function) is never
            # forwarded.
            return _system_insufficient_response()
        return JSONResponse(
            status_code=422,
            content={
                "error": "invalid_model_input",
                "message": _sanitize_model_error(text),
            },
        )

    @app.exception_handler(Exception)
    async def _unexpected_handler(request: Request, exc: Exception) -> JSONResponse:
        _LOG.exception("Unhandled error in %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "message": "An internal error occurred while evaluating the model.",
            },
        )

    def _configs() -> EngineConfigs:
        return app.state.configs

    # -- health -------------------------------------------------------------

    @app.get("/healthz")
    def healthz() -> dict:
        """Liveness probe for the hosting platform's health check. Does no
        optimizer/evaluator/config work and exposes nothing internal."""
        return {"status": "ok"}

    # -- provenance / metadata ------------------------------------------------

    @app.get("/api/version")
    def version() -> dict:
        configs = _configs()
        return {
            "trackc_version": _TRACKC_VERSION,
            "application_layer": (
                "Data Center Capacity Decision Model API"
            ),
            "api": "v1",
            "burden_mapping_version": configs.burden.mapping_version,
            "uncertainty_mapping_version": configs.uncertainty.mapping_version,
            "mapping_version": configs.burden.mapping_version,
            "git_commit": settings.commit or _git_commit(),
        }

    @app.get("/api/p1/config")
    def config() -> dict:
        configs = _configs()
        return {
            "provenance": service._provenance(configs),
            "application_metadata": service._application_metadata(),
            "mappings": service.build_mappings_bundle(configs),
            "public_app_policy": {
                "max_sites": PUBLIC_APP_MAX_SITES,
                "live_optimization_max_sites": APP_LIVE_OPTIMIZATION_MAX_SITES,
                "max_request_bytes": MAX_REQUEST_BYTES,
                "max_horizon_month": PUBLIC_APP_MAX_HORIZON_MONTHS,
                "input_domain": _public_input_domain(configs),
                "note": (
                    "Deployment policy for the public application, not model limits. "
                    "The trackc engine is N-general and "
                    "horizon-general; larger portfolios are refused live optimization "
                    "but still evaluated and compared, and the "
                    f"{PUBLIC_APP_MAX_HORIZON_MONTHS}-month analysis horizon is a "
                    "public-service limit, not a structural model constraint. The full "
                    "lambda-envelope is precomputed only and is never computed "
                    "on a live request."
                ),
            },
        }

    # -- live evaluation / comparison --------------------------------------

    @app.post("/api/p1/evaluate")
    def evaluate(req: EvaluateRequest) -> dict:
        refusal = _reject_public_scenario(req.scenario)
        if refusal is not None:
            return refusal
        return service.evaluate_allocation(req.scenario, req.allocation, _configs())

    @app.post("/api/p1/compare")
    def compare(scenario: Scenario) -> dict:
        refusal = _reject_public_scenario(scenario)
        if refusal is not None:
            return refusal
        return service.evaluate_showcase(
            scenario, _configs(), include_optimizer=False, include_envelope=False
        )

    @app.post("/api/p1/optimize")
    def optimize(scenario: Scenario) -> dict:
        refusal = _reject_public_scenario(scenario) or _reject_if_system_insufficient(
            scenario
        )
        if refusal is not None:
            return refusal
        n = len(scenario.sites)
        if n > APP_LIVE_OPTIMIZATION_MAX_SITES:
            # Refuse BEFORE invoking the optimizer.
            return _guardrail_response(
                "live_optimization_site_limit",
                (
                    f"Live optimization is serviced only for N <= "
                    f"{APP_LIVE_OPTIMIZATION_MAX_SITES} sites in this public "
                    f"application; the request has {n}. This is a deployment "
                    "guardrail, not a model limit. "
                    "Evaluation and benchmark comparison remain available for this "
                    "portfolio via /api/p1/evaluate and /api/p1/compare."
                ),
                max_sites=APP_LIVE_OPTIMIZATION_MAX_SITES,
                n_sites=n,
                available=["/api/p1/evaluate", "/api/p1/compare", "/api/p1/profiles"],
            )
        return service.evaluate_showcase(
            scenario, _configs(), include_optimizer=True, include_envelope=False
        )

    @app.post("/api/p1/profiles")
    def profiles(scenario: Scenario) -> dict:
        refusal = _reject_public_scenario(scenario)
        if refusal is not None:
            return refusal
        configs = _configs()
        return {
            "provenance": service._provenance(configs),
            "scenario": scenario.model_dump(mode="json"),
            "site_power_profiles": service.build_site_power_profiles(scenario, configs),
        }

    return app


app = create_app()
