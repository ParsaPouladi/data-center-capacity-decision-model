"""Engine-facing application service layer for the public application.

================================  CHARTER  ================================

**Status: NON-CANONICAL application code.** Subordinate to the canonical
modeling documents (the model specification and assumptions documents). If anything here
appears to conflict with those, they win and this module yields.

This module is a **thin orchestration boundary** around the frozen `trackc`
engine (`src/trackc/`). Its entire job is to *call* existing engine
functionality, *assemble* the results into serializable structures, and
*attach* provenance and application-policy metadata.

It does **not**, and must never:

* reimplement, re-derive, approximate, or modify any model equation,
  scenario logic, the evaluator, the comparator, or the optimizer;
* compute a model quantity the engine did not return;
* aggregate authoritative engine outputs into a new numerical meaning
  (e.g. recomputing ``J = C_dev + lambda * E[L]`` outside the engine, or
  re-scaling ``C_dev`` into a normalized index and presenting it as a
  model result).

Every numeric field this module emits is produced by a direct engine call
and passed through with structural conversion only (``float()`` / ``list()``
/ ``dict()`` / pydantic ``model_dump()``). Golden-parity tests
(`tests/golden/`) assert exactly that against direct engine calls on the
same fixtures.

What this module *may* legitimately do:

* select an engine-*supported* option -- specifically, the scenario
  engine's already-parameterized exact/Monte-Carlo threshold, via an
  application-specific :class:`~trackc.model.schemas.ModelDefaults`
  (:data:`APP_MAX_EXACT_SCENARIOS`). The canonical
  `configs/model_defaults.yaml` and the engine's switching *behavior* are
  unchanged; only the value passed on a given call differs, which is what
  ``build_scenario_set(scenario, uncertainty_config, defaults)`` exists to
  allow (the comparator's own sweeps pass their own defaults the same way).
* enforce deployment guardrails (:data:`APP_GUARDRAILS`) that change no
  model behavior -- they only decide which requests this application layer
  is willing to service live vs. precomputed.
* carry disclosure metadata (synthetic-assumption, independence,
  exact/Monte-Carlo, co-optimality, normalized-cost interpretation)
  faithfully.

No FastAPI routes live here -- this is the data/service layer only.

=========================================================================
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations
from pathlib import Path

from trackc import __version__ as _TRACKC_VERSION
from trackc.experiments.envelope import (
    EnvelopeBreakpoint,
    EnvelopeResult,
    EnvelopeVertex,
    build_envelope,
)
from trackc.model.comparator import (
    break_even_lambda,
    co_optimal_strategies_at_lambda,
    concentration_metric,
    cost_concentration_allocation,
    diversified_allocation,
    global_switching_boundaries,
    speed_reliability_allocation,
)
from trackc.model.evaluator import StrategyResult, evaluate_strategy
from trackc.model.mappings import apply_delay, resolve_burden, resolve_uncertainty
from trackc.model.optimizer import OptimizationResult, optimize_allocation
from trackc.model.power_profile import site_power_profile, time_grid
from trackc.model.scenario_engine import ScenarioSet, build_scenario_set, scenario_count
from trackc.model.schemas import (
    Allocation,
    BurdenStateConfig,
    ModelDefaults,
    Scenario,
    UncertaintyStateConfig,
    load_burden_states,
    load_model_defaults,
    load_scenario,
    load_uncertainty_states,
    validate_allocation_against_sites,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIGS_DIR = _REPO_ROOT / "configs"


# ---------------------------------------------------------------------------
# Application policy constants (NOT model parameters).
# ---------------------------------------------------------------------------

#: Live optimize / envelope requests are only serviced for portfolios up to
#: this many sites in public-app v1. This is a DEPLOYMENT GUARDRAIL, never a
#: model limit -- the engine is N-general. The optimizer's
#: non-uniqueness probe and the joint-delay LP grow quickly with N, so
#: restricting live optimize/envelope requests to N<=3 keeps them
#: interactive; larger portfolios remain fully usable for precomputed
#: evaluation and comparison.
APP_LIVE_OPTIMIZATION_MAX_SITES = 3

#: Exact/Monte-Carlo threshold the *application* passes to the scenario
#: engine for precomputed showcase presets, as an export-cost policy. With
#: the v1-baseline uncertainty mapping (q_i = 3 for every state) the exact
#: joint count is S_full = 3^N, so this value keeps N <= 9 exact
#: (3^9 = 19_683) and pushes N = 10 (3^10 = 59_049) onto the engine's own
#: Monte-Carlo path. The canonical `configs/model_defaults.yaml` threshold
#: (100_000) and the engine's exact/Monte-Carlo switching *behavior* are
#: unchanged -- this is only the value handed to
#: `build_scenario_set(..., defaults)` on application calls.
APP_MAX_EXACT_SCENARIOS = 50_000

APP_GUARDRAILS: dict[str, object] = {
    "live_optimization_max_sites": APP_LIVE_OPTIMIZATION_MAX_SITES,
    "live_envelope_max_sites": APP_LIVE_OPTIMIZATION_MAX_SITES,
    "live_optimization_rationale": (
        "Deployment guardrail for the public application, not a model limit: the "
        "trackc engine is N-general. The optimizer non-uniqueness probe and the "
        "joint-delay LP become expensive for larger portfolios, so live "
        "optimize/envelope requests are restricted to N<=3 to keep them "
        "interactive; larger portfolios remain available for precomputed "
        "evaluation and comparison."
    ),
    "precomputed_max_exact_scenarios": APP_MAX_EXACT_SCENARIOS,
    "precomputed_scenario_method_policy": (
        "Precomputed showcase presets enumerate the joint delay space exactly while "
        f"S_full = prod_i q_i <= {APP_MAX_EXACT_SCENARIOS}; above that the engine's own "
        "Monte-Carlo path is used, with mc_samples and random_seed taken unchanged from "
        "configs/model_defaults.yaml, and the method / sample count / seed disclosed on "
        "every result. This is an application export-cost policy applied via ModelDefaults; "
        "the canonical configs/model_defaults.yaml threshold (100000) and the engine's "
        "exact/Monte-Carlo switching behavior are not changed."
    ),
}

APP_COST_PRESENTATION: dict[str, object] = {
    "units": "normalized_relative",
    "is_currency": False,
    "reference_anchor": (
        "c_i is development cost per MW on a normalized relative "
        "scale, not a currency amount. The baseline fixture anchors Site A at 1.00, so a "
        "site at 1.15 costs 15% more per MW than the anchor. Synthetic portfolios use "
        "the same normalized scale without a 1.00-anchored site. C_dev and every other "
        "cost figure in these exports is the engine's own value, unmodified -- the "
        "application layer does not rescale it into a derived index."
    ),
}

APP_LAMBDA_PARAMETER: dict[str, object] = {
    "interpretation": (
        "lambda is the economic consequence per MW-month of unmet "
        "capacity. It is a user-controlled model-experiment parameter -- do NOT assume a "
        "universal real-world value."
    ),
}

APP_UNCERTAINTY_DISCLOSURE: dict[str, object] = {
    "site_delays": (
        "Site schedule delays are modeled as independent across sites (v1). "
        "Any diversification / overcapacity-hedging interpretation "
        "of these results is conditional on that independence assumption; the "
        "correlated-delay stress test is deferred and unrun."
    ),
    "synthetic": (
        "The burden-state and uncertainty-state mappings, and every non-baseline "
        "portfolio in these exports, are SYNTHETIC constructions for a stylized model "
        "-- not empirical data about any real site, utility, or "
        "facility."
    ),
    "exact_vs_monte_carlo": (
        "Each result records how its scenario set was built ('exact' enumeration vs "
        "'monte_carlo' sampling) plus the sample count and random seed when sampling was "
        "used. Identical inputs and seed reproduce identical outputs."
    ),
}

APP_COOPTIMALITY_DISCLOSURE: dict[str, object] = {
    "note": (
        "When optimizer.is_unique_within_tolerance is false, the reported allocation is "
        "ONE representative point among numerically co-optimal allocations within "
        "cooptimality_tolerance of the optimum; coordinate_bounds are marginal "
        "per-coordinate ranges among those solutions, NOT exact optimal-face bounds and "
        "NOT a claim that every combination of per-coordinate extrema is jointly optimal "
        "(src/trackc/model/optimizer.py contract). is_unique_within_tolerance is "
        "numerical uniqueness within that tolerance, not a mathematical uniqueness "
        "certificate."
    ),
}


# ---------------------------------------------------------------------------
# Config bundle
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EngineConfigs:
    """The canonical engine configuration objects, loaded from `configs/`."""

    burden: BurdenStateConfig
    uncertainty: UncertaintyStateConfig
    defaults: ModelDefaults


def load_engine_configs(configs_dir: str | Path = CONFIGS_DIR) -> EngineConfigs:
    """Load the canonical `configs/` bundle via the engine's own loaders.

    No values are altered here -- this is a straight passthrough of
    `configs/burden_states.yaml`, `configs/uncertainty_states.yaml`, and
    `configs/model_defaults.yaml`.
    """
    configs_dir = Path(configs_dir)
    return EngineConfigs(
        burden=load_burden_states(configs_dir / "burden_states.yaml"),
        uncertainty=load_uncertainty_states(configs_dir / "uncertainty_states.yaml"),
        defaults=load_model_defaults(configs_dir / "model_defaults.yaml"),
    )


def load_baseline_scenario(configs_dir: str | Path = CONFIGS_DIR) -> Scenario:
    """The canonical 3-site / 27-scenario baseline fixture."""
    return load_scenario(Path(configs_dir) / "baseline_scenario.yaml")


def app_scenario_defaults(defaults: ModelDefaults) -> ModelDefaults:
    """A copy of ``defaults`` with the application's export-cost exact/MC
    threshold (:data:`APP_MAX_EXACT_SCENARIOS`), everything else identical.

    Used for precomputed showcase presets so the expensive exact N=10 case
    is exported via the engine's Monte-Carlo path instead. See the charter
    and :data:`APP_GUARDRAILS`.
    """
    return defaults.model_copy(update={"max_exact_scenarios": APP_MAX_EXACT_SCENARIOS})


def build_showcase_scenario_set(
    scenario: Scenario, configs: EngineConfigs
) -> ScenarioSet:
    """Build the scenario set for a showcase preset, applying the
    application exact/MC threshold policy (:func:`app_scenario_defaults`).
    """
    return build_scenario_set(
        scenario, configs.uncertainty, app_scenario_defaults(configs.defaults)
    )


def benchmark_allocations(
    scenario: Scenario, configs: EngineConfigs
) -> dict[str, Allocation]:
    """The three canonical benchmark allocations,
    each built by its existing comparator constructor -- nothing new here.
    """
    return {
        "cost_concentration": cost_concentration_allocation(scenario),
        "speed_reliability": speed_reliability_allocation(
            scenario, configs.burden, configs.uncertainty
        ),
        "diversified": diversified_allocation(scenario),
    }


# ---------------------------------------------------------------------------
# Serialization helpers -- structural conversion only, no arithmetic.
# ---------------------------------------------------------------------------


def _lam_to_json(lam: float) -> float | str:
    """``float('inf')`` (the X_hi terminal-regime marker) is not valid JSON;
    emit the string ``"inf"`` for it and pass every finite lambda through
    unchanged."""
    return "inf" if math.isinf(lam) else float(lam)


def _serialize_scenario(scenario: Scenario) -> dict:
    """Verbatim dump of the pydantic-validated scenario inputs."""
    return scenario.model_dump(mode="json")


def _serialize_scenario_set(scenario_set: ScenarioSet, s_full: int) -> dict:
    return {
        "method": scenario_set.method,
        "n_realizations": scenario_set.n_realizations,
        "random_seed": scenario_set.random_seed,
        "n_samples": scenario_set.n_samples,
        "s_full": int(s_full),
    }


def _serialize_strategy_result(result: StrategyResult) -> dict:
    return {
        "model_version": result.model_version,
        "burden_mapping_version": result.burden_mapping_version,
        "uncertainty_mapping_version": result.uncertainty_mapping_version,
        "site_ids": list(result.site_ids),
        "n_sites": result.n_sites,
        "allocation": {sid: float(x) for sid, x in result.allocation.items()},
        "method": result.method,
        "n_realizations": result.n_realizations,
        "random_seed": result.random_seed,
        "n_samples": result.n_samples,
        "development_cost": float(result.development_cost),
        "p_meet": float(result.p_meet),
        "expected_shortfall_mw": float(result.expected_shortfall_mw),
        "expected_delay_burden_mw_months": float(result.expected_delay_burden_mw_months),
        "objective": float(result.objective),
        "feasibility_status": result.feasibility_status,
        "times": [float(t) for t in result.times],
        "delivered_capacity_trajectory": [
            float(y) for y in result.delivered_capacity_trajectory
        ],
    }


def _serialize_optimization_result(opt: OptimizationResult) -> dict:
    return {
        "model_version": opt.model_version,
        "site_ids": list(opt.site_ids),
        "allocation": {sid: float(x) for sid, x in opt.allocation.by_site.items()},
        "success": bool(opt.success),
        "status": int(opt.status),
        "message": opt.message,
        "lp_objective": float(opt.lp_objective),
        "is_unique_within_tolerance": bool(opt.is_unique_within_tolerance),
        "coordinate_bounds": {
            sid: [float(lo), float(hi)] for sid, (lo, hi) in opt.coordinate_bounds.items()
        },
        "cooptimality_tolerance": float(opt.cooptimality_tolerance),
    }


def _serialize_envelope_vertex(vertex: EnvelopeVertex) -> dict:
    out: dict = {
        "lam": _lam_to_json(vertex.lam),
        "is_x_hi": bool(vertex.is_x_hi),
        "allocation": {sid: float(x) for sid, x in vertex.allocation.by_site.items()},
        "strategy_result": _serialize_strategy_result(vertex.strategy_result),
        "is_unique_within_tolerance": vertex.is_unique_within_tolerance,
        "cooptimality_tolerance": (
            None
            if vertex.cooptimality_tolerance is None
            else float(vertex.cooptimality_tolerance)
        ),
        "coordinate_bounds": (
            None
            if vertex.coordinate_bounds is None
            else {
                sid: [float(lo), float(hi)]
                for sid, (lo, hi) in vertex.coordinate_bounds.items()
            }
        ),
    }
    return out


def _serialize_envelope_breakpoint(bp: EnvelopeBreakpoint) -> dict:
    return {
        "lam_estimate": float(bp.lam_estimate),
        "tolerance": float(bp.tolerance),
        "co_optimal_at_breakpoint": bool(bp.co_optimal_at_breakpoint),
        "left_vertex_allocation": {
            sid: float(x) for sid, x in bp.left_vertex.allocation.by_site.items()
        },
        "right_vertex_allocation": {
            sid: float(x) for sid, x in bp.right_vertex.allocation.by_site.items()
        },
        "left_vertex_cost_delay": [
            float(bp.left_vertex.development_cost),
            float(bp.left_vertex.expected_delay_burden),
        ],
        "right_vertex_cost_delay": [
            float(bp.right_vertex.development_cost),
            float(bp.right_vertex.expected_delay_burden),
        ],
    }


def _serialize_envelope(env: EnvelopeResult) -> dict:
    return {
        "l_min": float(env.l_min),
        "l_min_buffer": float(env.l_min_buffer),
        "lambda_anchor": float(env.lambda_anchor),
        "terminal_breakpoint_lambda": (
            None
            if env.terminal_breakpoint_lambda is None
            else float(env.terminal_breakpoint_lambda)
        ),
        "x_hi_matches_terminal_vertex": bool(env.x_hi_matches_terminal_vertex),
        "no_new_vertex_tolerance": {
            k: float(v) for k, v in env.no_new_vertex_tolerance.items()
        },
        "n_lp_solves": int(env.n_lp_solves),
        "max_recursion_depth_hit": bool(env.max_recursion_depth_hit),
        "unresolved_brackets": [dict(b) for b in env.unresolved_brackets],
        "x_hi": _serialize_envelope_vertex(env.x_hi),
        "vertices": [_serialize_envelope_vertex(v) for v in env.vertices],
        "breakpoints": [_serialize_envelope_breakpoint(b) for b in env.breakpoints],
    }


# ---------------------------------------------------------------------------
# Frozen state-mapping tables -- verbatim serialization of the canonical
# configs, no reinterpretation. B_i / U_i stay ordinal identifiers;
# nothing here does arithmetic on a state number.
# ---------------------------------------------------------------------------


def serialize_burden_mapping(config: BurdenStateConfig) -> dict:
    """Verbatim dump of `configs/burden_states.yaml` (the frozen
    ``mapping_version: v1-baseline`` B_i -> (tau1_bar, tau2_bar) table),
    exactly as the engine's own pydantic model round-trips it. No field is
    renamed, rescaled, reordered, or dropped.
    """
    return config.model_dump(mode="json")


def serialize_uncertainty_mapping(config: UncertaintyStateConfig) -> dict:
    """Verbatim dump of `configs/uncertainty_states.yaml` (the frozen
    ``mapping_version: v1-baseline`` U_i -> (delay_months, probabilities)
    table), exactly as the engine's own pydantic model round-trips it.
    """
    return config.model_dump(mode="json")


def build_mappings_bundle(configs: EngineConfigs) -> dict:
    """The two frozen state-mapping tables plus their provenance, for the
    Tier-1 ``mappings.json`` artifact. Pure serialization of already-
    authoritative frozen config values -- see the module charter.
    """
    return {
        "kind": (
            "frozen state-mapping tables "
            "(Tier-1, verbatim from configs/)"
        ),
        "provenance": {
            "trackc_version": _TRACKC_VERSION,
            "source_files": [
                "configs/burden_states.yaml",
                "configs/uncertainty_states.yaml",
            ],
            "note": (
                "Verbatim serialization of the frozen v1-baseline burden and "
                "uncertainty state-mapping tables. NOT recomputed, reinterpreted, or "
                "simplified -- the application layer copies these authoritative values "
                "unchanged. B_i and U_i are ordinal state identifiers, never used "
                "arithmetically; the physical parameters below "
                "(tau1_bar, tau2_bar, delay_months, probabilities) are what the model "
                "actually operates on. These mappings are SYNTHETIC modeling "
                "assumptions, not empirical facility data."
            ),
        },
        "burden": serialize_burden_mapping(configs.burden),
        "uncertainty": serialize_uncertainty_mapping(configs.uncertainty),
    }


# ---------------------------------------------------------------------------
# Per-site phased-delivery profiles -- one engine `site_power_profile` call
# per (site, enumerated schedule-delay outcome). No profile mathematics is
# reproduced here; every array below is a direct engine return value.
# ---------------------------------------------------------------------------


def build_site_power_profiles(scenario: Scenario, configs: EngineConfigs) -> list[dict]:
    """For each site, the step-function power-availability profile
    ``A_i(t)`` under every discrete schedule-delay outcome of its
    uncertainty state, plus that outcome's probability.

    Every numeric array is produced by a direct call to
    :func:`trackc.model.power_profile.site_power_profile` (which itself
    routes through :mod:`trackc.model.mappings`); the resolved
    ``(tau1_bar, tau2_bar)`` and per-outcome ``(tau1, tau2)`` come straight
    from :func:`trackc.model.mappings.resolve_burden` /
    :func:`~trackc.model.mappings.apply_delay`. This module performs no
    tranche arithmetic of its own.
    """
    alpha = float(configs.defaults.alpha)
    times = [float(t) for t in time_grid(scenario.system.horizon_month)]
    grid = time_grid(scenario.system.horizon_month)

    profiles: list[dict] = []
    for site in scenario.sites:
        tau1_bar, tau2_bar = resolve_burden(site.burden_state, configs.burden)
        delay_months, probabilities = resolve_uncertainty(
            site.uncertainty_state, configs.uncertainty
        )
        outcomes: list[dict] = []
        for delta, prob in zip(delay_months, probabilities):
            tau1, tau2 = apply_delay(tau1_bar, tau2_bar, delta)
            profile = site_power_profile(grid, site, delta, configs.burden, alpha)
            outcomes.append(
                {
                    "delay_months": float(delta),
                    "probability": float(prob),
                    "tau1": float(tau1),
                    "tau2": float(tau2),
                    "profile_mw": [float(y) for y in profile],
                }
            )
        profiles.append(
            {
                "site_id": site.id,
                "capacity_mw": float(site.capacity_mw),
                "burden_state": int(site.burden_state),
                "uncertainty_state": int(site.uncertainty_state),
                "tau1_bar": float(tau1_bar),
                "tau2_bar": float(tau2_bar),
                "alpha": alpha,
                "times": times,
                "outcomes": outcomes,
            }
        )
    return profiles


# ---------------------------------------------------------------------------
# The showcase assembler (Tier 1 precompute today; the same call is the
# Tier 2 live path for N <= 3 later).
# ---------------------------------------------------------------------------


def _provenance(configs: EngineConfigs) -> dict:
    return {
        "trackc_version": _TRACKC_VERSION,
        "burden_mapping_version": configs.burden.mapping_version,
        "uncertainty_mapping_version": configs.uncertainty.mapping_version,
        "alpha": float(configs.defaults.alpha),
        "engine_max_exact_scenarios": int(configs.defaults.max_exact_scenarios),
        "engine_mc_samples": int(configs.defaults.mc_samples),
        "engine_random_seed": int(configs.defaults.random_seed),
        "application_max_exact_scenarios": APP_MAX_EXACT_SCENARIOS,
        "generated_by": "trackc_app/service.py:evaluate_showcase",
    }


def _application_metadata() -> dict:
    return {
        "layer": "non-canonical application (data/service layer)",
        "cost_presentation": APP_COST_PRESENTATION,
        "lambda_parameter": APP_LAMBDA_PARAMETER,
        "uncertainty_disclosure": APP_UNCERTAINTY_DISCLOSURE,
        "cooptimality_disclosure": APP_COOPTIMALITY_DISCLOSURE,
        "computation_guardrails": APP_GUARDRAILS,
    }


def _coincident_benchmark_classes(
    results: dict[str, StrategyResult],
) -> list[list[str]]:
    """Partition the benchmark names into indifference classes: two
    benchmarks share a class **iff** their
    ``(development_cost, expected_delay_burden_mw_months)`` pair -- the two
    and only two axes of the frozen objective ``J = C_dev + lambda * E[L]``
    -- are exactly equal, so their ``J(lambda)`` lines
    coincide for every ``lambda``.

    This is a plain equality test on values the engine already computed, not
    a tie calculation: the application layer invents no tolerance and no tie
    mathematics here. Classes are returned in first-appearance order, each
    ordered as in ``results``.
    """
    classes: list[list[str]] = []
    by_key: dict[tuple[float, float], list[str]] = {}
    for name, result in results.items():
        key = (
            result.development_cost,
            result.expected_delay_burden_mw_months,
        )
        bucket = by_key.get(key)
        if bucket is None:
            bucket = [name]
            by_key[key] = bucket
            classes.append(bucket)
        else:
            bucket.append(name)
    return classes


def _global_switching_boundaries_tolerant(
    results: dict[str, StrategyResult],
) -> tuple[list[dict], bool]:
    """The globally preferred benchmark as a piecewise function of
    ``lambda``, tolerant of a genuine full-interval indifference between
    two or more benchmarks.

    The engine's :func:`trackc.model.comparator.global_switching_boundaries`
    is the authoritative computation and is always tried first. It raises
    ``ValueError`` only when a segment interior is itself a tie -- i.e. two
    or more benchmarks share an identical ``J(lambda)`` over a whole
    ``lambda`` interval (equal development cost *and* equal expected delay
    burden). That is a real indifference state, not a client error, so this
    wrapper does not let it surface as a 4xx: it removes the exact
    duplicates (:func:`_coincident_benchmark_classes`), re-runs the **same**
    engine function on one representative per class (no coincident pair
    remains, so it cannot raise), and then re-attaches every tied name to
    the segment it wins.

    Returns ``(segments, has_cooptimal_segments)``. Each segment dict keeps
    the existing ``lambda_start`` / ``strategy`` contract -- ``strategy`` is
    a single representative name (the first of the tied class, in
    ``results`` order) -- and adds ``co_optimal``: the list of every
    benchmark co-optimal on that segment (a single-element list on the
    ordinary unique-winner path). No tie mathematics is performed here; only
    the engine's own comparator functions are called.
    """
    try:
        segments = global_switching_boundaries(results)
    except ValueError:
        segments = None

    if segments is not None:
        return (
            [
                {"lambda_start": float(lam), "strategy": name, "co_optimal": [name]}
                for lam, name in segments
            ],
            False,
        )

    classes = _coincident_benchmark_classes(results)
    representatives = {cls[0]: results[cls[0]] for cls in classes}

    rep_segments = global_switching_boundaries(representatives)
    starts = [lam for lam, _ in rep_segments]
    # A probe lambda strictly inside each segment. For the final open-ended
    # segment, any lambda past the last boundary yields the same co-optimal
    # set -- two J(lambda) lines that have already crossed never cross again
    # (comparator.global_switching_boundaries' own reasoning for its
    # lambda_max choice).
    probes = [
        (starts[i] + starts[i + 1]) / 2.0 if i + 1 < len(starts) else starts[i] + 1.0
        for i in range(len(starts))
    ]

    out: list[dict] = []
    for (lam, _rep_name), probe in zip(rep_segments, probes):
        tied = co_optimal_strategies_at_lambda(results, probe)
        entry = {
            "lambda_start": float(lam),
            "strategy": tied[0],
            "co_optimal": list(tied),
        }
        if not out or out[-1]["co_optimal"] != entry["co_optimal"]:
            out.append(entry)
    return out, True


def evaluate_allocation(
    scenario: Scenario,
    allocation: Allocation,
    configs: EngineConfigs,
) -> dict:
    """Evaluate ONE caller-supplied allocation through the authoritative
    engine evaluator, at the scenario's own ``lambda_mw_month``.

    This adds no mathematics: it is the exact call
    :func:`evaluate_showcase` already makes for each benchmark allocation
    (:func:`trackc.model.evaluator.evaluate_strategy` on the same
    application scenario set), with a caller-provided ``x`` instead of a
    comparator-constructed one. Used by the live Tier-2 ``/api/p1/evaluate``
    route so the frontend never has to compute ``J`` / ``P_meet`` / ``E[L]``.

    ``x_i <= K_i`` and "site id is known" are checked first via
    :func:`trackc.model.schemas.validate_allocation_against_sites` -- the
    engine's own rule (a model validation invariant), raised as
    ``ValueError``. Feasibility relative to ``D`` is reported by the
    evaluator in ``feasibility_status`` exactly as for a benchmark.
    """
    validate_allocation_against_sites(allocation, scenario.sites)

    s_full = scenario_count(scenario, configs.uncertainty)
    scenario_set = build_showcase_scenario_set(scenario, configs)
    result = evaluate_strategy(
        scenario,
        allocation,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )
    return {
        "provenance": _provenance(configs),
        "application_metadata": _application_metadata(),
        "scenario": _serialize_scenario(scenario),
        "scenario_set": _serialize_scenario_set(scenario_set, s_full),
        "allocation_input": {sid: float(x) for sid, x in allocation.by_site.items()},
        "evaluation": _serialize_strategy_result(result),
    }


def evaluate_showcase(
    scenario: Scenario,
    configs: EngineConfigs,
    *,
    include_optimizer: bool = False,
    include_envelope: bool = False,
) -> dict:
    """Assemble a complete showcase result for one scenario, entirely from
    engine calls.

    Contents:

    * ``scenario`` -- verbatim inputs;
    * ``scenario_set`` -- how the joint delay space was represented
      (exact vs Monte-Carlo, realization / sample count, seed);
    * ``site_power_profiles`` -- per site, the engine ``site_power_profile``
      step function under every enumerated schedule-delay outcome, with
      that outcome's probability (:func:`build_site_power_profiles`);
    * ``strategies`` -- each benchmark allocation
      (:func:`benchmark_allocations`) run through
      :func:`trackc.model.evaluator.evaluate_strategy`;
    * ``concentration`` -- :func:`trackc.model.comparator.concentration_metric`
      per benchmark;
    * ``decision_boundaries`` -- pairwise
      :func:`trackc.model.comparator.break_even_lambda` and the global
      :func:`trackc.model.comparator.global_switching_boundaries` over the
      benchmarks;
    * ``optimizer`` (only if ``include_optimizer``) --
      :func:`trackc.model.optimizer.optimize_allocation` plus the
      evaluator re-run of ``x*``;
    * ``lambda_envelope`` (only if ``include_envelope``) --
      :func:`trackc.experiments.envelope.build_envelope`.

    ``include_optimizer`` / ``include_envelope`` are rejected with
    ``ValueError`` when ``scenario`` has more than
    :data:`APP_LIVE_OPTIMIZATION_MAX_SITES` sites -- the deployment
    guardrail (:data:`APP_GUARDRAILS`), not a model limit.
    """
    n_sites = len(scenario.sites)
    if (include_optimizer or include_envelope) and n_sites > APP_LIVE_OPTIMIZATION_MAX_SITES:
        raise ValueError(
            f"optimizer/envelope requested for N={n_sites}, but the public-app v1 "
            f"deployment guardrail (APP_LIVE_OPTIMIZATION_MAX_SITES="
            f"{APP_LIVE_OPTIMIZATION_MAX_SITES}) only services those live for N<="
            f"{APP_LIVE_OPTIMIZATION_MAX_SITES}. This is an application policy, not a "
            "model limit (the engine is N-general); larger portfolios are still "
            "evaluated and compared, just without a live optimize/envelope."
        )

    s_full = scenario_count(scenario, configs.uncertainty)
    scenario_set = build_showcase_scenario_set(scenario, configs)

    allocations = benchmark_allocations(scenario, configs)
    strategy_results: dict[str, StrategyResult] = {
        name: evaluate_strategy(
            scenario,
            allocation,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        for name, allocation in allocations.items()
    }

    site_ids = list(scenario_set.site_ids)
    concentration = {}
    for name, allocation in allocations.items():
        weights, hhi = concentration_metric(allocation, site_ids)
        concentration[name] = {
            "weights": {sid: float(w) for sid, w in weights.items()},
            "hhi": float(hhi),
        }

    pairwise_break_even = [
        {
            "strategy_a": a,
            "strategy_b": b,
            "break_even_lambda": (
                None
                if (be := break_even_lambda(strategy_results[a], strategy_results[b]))
                is None
                else float(be)
            ),
        }
        for a, b in combinations(strategy_results, 2)
    ]
    switching, switching_has_cooptimal = _global_switching_boundaries_tolerant(
        strategy_results
    )

    out: dict = {
        "provenance": _provenance(configs),
        "application_metadata": _application_metadata(),
        "scenario": _serialize_scenario(scenario),
        "scenario_set": _serialize_scenario_set(scenario_set, s_full),
        "site_power_profiles": build_site_power_profiles(scenario, configs),
        "strategies": {
            name: _serialize_strategy_result(result)
            for name, result in strategy_results.items()
        },
        "concentration": concentration,
        "decision_boundaries": {
            "pairwise_break_even_lambda": pairwise_break_even,
            "global_switching_boundaries": switching,
            "global_switching_has_cooptimal_segments": switching_has_cooptimal,
        },
        "optimizer": None,
        "lambda_envelope": None,
    }

    if include_optimizer:
        opt = optimize_allocation(
            scenario,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        opt_eval = evaluate_strategy(
            scenario,
            opt.allocation,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        out["optimizer"] = {
            "at_lambda": float(scenario.system.lambda_mw_month),
            "result": _serialize_optimization_result(opt),
            "evaluated": _serialize_strategy_result(opt_eval),
        }

    if include_envelope:
        env = build_envelope(
            scenario,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        out["lambda_envelope"] = _serialize_envelope(env)

    return out
