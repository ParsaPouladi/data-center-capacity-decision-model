"""Golden-parity tests for the application data layer.

Every model/numeric field the application service (`trackc_app.service`)
emits, and every field written into the static showcase exports
(`scripts/export_showcase_data.py`), must equal a *direct* authoritative
`trackc` engine call on the same fixture. These tests assert exactly that,
plus the provenance / method / seed / sample-count disclosures and the
deployment-guardrail behavior.

The comparisons are exact (`==`): the service and the direct engine call
run the same deterministic code in the same process, and JSON round-trips
Python floats losslessly, so there is no tolerance to allow.
"""

from __future__ import annotations

import json
import subprocess
import sys
from itertools import combinations
from pathlib import Path

import pytest
import yaml

import trackc
from trackc.experiments.envelope import build_envelope
from trackc.experiments.scalability import generate_synthetic_portfolio
from trackc.model.comparator import (
    break_even_lambda,
    concentration_metric,
    global_switching_boundaries,
)
from trackc.model.evaluator import evaluate_strategy
from trackc.model.mappings import apply_delay, resolve_burden, resolve_uncertainty
from trackc.model.optimizer import optimize_allocation
from trackc.model.power_profile import site_power_profile, time_grid
from trackc.model.scenario_engine import build_scenario_set, scenario_count
from trackc_app import service
from trackc_app.service import (
    APP_LIVE_OPTIMIZATION_MAX_SITES,
    EngineConfigs,
    build_mappings_bundle,
    build_site_power_profiles,
    evaluate_showcase,
    load_baseline_scenario,
    load_engine_configs,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]


# ---------------------------------------------------------------------------
# Fixtures -- computed once per module.
# ---------------------------------------------------------------------------


@pytest.fixture(scope="module")
def configs() -> EngineConfigs:
    return load_engine_configs()


@pytest.fixture(scope="module")
def baseline_showcase(configs: EngineConfigs) -> dict:
    return evaluate_showcase(
        load_baseline_scenario(), configs, include_optimizer=True, include_envelope=True
    )


def _direct_benchmark_results(scenario, scenario_set, configs: EngineConfigs) -> dict:
    """Direct engine evaluation of the three benchmark allocations."""
    allocations = service.benchmark_allocations(scenario, configs)
    return {
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


# ---------------------------------------------------------------------------
# Charter / disclosure sanity
# ---------------------------------------------------------------------------


def test_cost_presentation_is_normalized_not_currency(baseline_showcase: dict) -> None:
    cost = baseline_showcase["application_metadata"]["cost_presentation"]
    assert cost["is_currency"] is False
    assert cost["units"] == "normalized_relative"
    # no currency symbols anywhere in the emitted metadata text
    blob = json.dumps(baseline_showcase["application_metadata"])
    assert "$" not in blob and "USD" not in blob and "dollar" not in blob.lower()


def test_provenance_traceable_to_engine_and_configs(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    prov = baseline_showcase["provenance"]
    assert prov["trackc_version"] == trackc.__version__
    assert prov["burden_mapping_version"] == configs.burden.mapping_version == "v1-baseline"
    assert (
        prov["uncertainty_mapping_version"]
        == configs.uncertainty.mapping_version
        == "v1-baseline"
    )
    assert prov["alpha"] == configs.defaults.alpha
    assert prov["engine_max_exact_scenarios"] == configs.defaults.max_exact_scenarios
    assert prov["engine_mc_samples"] == configs.defaults.mc_samples
    assert prov["engine_random_seed"] == configs.defaults.random_seed


# ---------------------------------------------------------------------------
# Baseline N=3 -- strategy / concentration / decision-boundary parity
# ---------------------------------------------------------------------------


def test_baseline_strategies_match_direct_engine(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    scenario = load_baseline_scenario()
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    assert scenario_set.method == "exact"

    direct = _direct_benchmark_results(scenario, scenario_set, configs)
    assert set(direct) == set(baseline_showcase["strategies"])
    for name, result in direct.items():
        assert (
            service._serialize_strategy_result(result)
            == baseline_showcase["strategies"][name]
        ), name


def test_baseline_concentration_matches_direct_engine(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    scenario = load_baseline_scenario()
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    site_ids = list(scenario_set.site_ids)
    allocations = service.benchmark_allocations(scenario, configs)
    for name, allocation in allocations.items():
        weights, hhi = concentration_metric(allocation, site_ids)
        got = baseline_showcase["concentration"][name]
        assert got["weights"] == {sid: float(w) for sid, w in weights.items()}
        assert got["hhi"] == float(hhi)


def test_baseline_decision_boundaries_match_direct_engine(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    scenario = load_baseline_scenario()
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = _direct_benchmark_results(scenario, scenario_set, configs)

    expected_pairwise = [
        {
            "strategy_a": a,
            "strategy_b": b,
            "break_even_lambda": (
                None
                if (be := break_even_lambda(direct[a], direct[b])) is None
                else float(be)
            ),
        }
        for a, b in combinations(direct, 2)
    ]
    assert (
        baseline_showcase["decision_boundaries"]["pairwise_break_even_lambda"]
        == expected_pairwise
    )

    expected_switching = [
        {"lambda_start": float(lam), "strategy": name, "co_optimal": [name]}
        for lam, name in global_switching_boundaries(direct)
    ]
    assert (
        baseline_showcase["decision_boundaries"]["global_switching_boundaries"]
        == expected_switching
    )
    # baseline benchmarks have a unique global winner on every segment
    assert (
        baseline_showcase["decision_boundaries"][
            "global_switching_has_cooptimal_segments"
        ]
        is False
    )


# ---------------------------------------------------------------------------
# Baseline N=3 -- optimizer + envelope parity
# ---------------------------------------------------------------------------


def test_baseline_optimizer_matches_direct_engine(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    scenario = load_baseline_scenario()
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = optimize_allocation(
        scenario,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )
    direct_eval = evaluate_strategy(
        scenario,
        direct.allocation,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )
    opt = baseline_showcase["optimizer"]
    assert opt["at_lambda"] == float(scenario.system.lambda_mw_month)
    assert opt["result"] == service._serialize_optimization_result(direct)
    assert opt["evaluated"] == service._serialize_strategy_result(direct_eval)
    # co-optimality contract fields are present and honestly typed
    assert isinstance(opt["result"]["is_unique_within_tolerance"], bool)
    assert set(opt["result"]["coordinate_bounds"]) == set(direct.site_ids)


def test_baseline_lambda_envelope_matches_direct_engine(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    scenario = load_baseline_scenario()
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct_env = build_envelope(
        scenario,
        scenario_set,
        configs.burden,
        configs.uncertainty,
        configs.defaults.alpha,
    )
    assert baseline_showcase["lambda_envelope"] == service._serialize_envelope(direct_env)
    # structural sanity on the baseline envelope
    env = baseline_showcase["lambda_envelope"]
    assert len(env["vertices"]) == 4
    assert len(env["breakpoints"]) == 3
    assert env["n_lp_solves"] == 10


# ---------------------------------------------------------------------------
# Extended N=6 -- exact-method parity
# ---------------------------------------------------------------------------


def test_extended_n6_is_exact_and_matches_direct_engine(configs: EngineConfigs) -> None:
    scenario = generate_synthetic_portfolio(6, 80_006)
    showcase = evaluate_showcase(scenario, configs, include_optimizer=False, include_envelope=False)

    assert showcase["scenario_set"]["method"] == "exact"
    assert showcase["scenario_set"]["s_full"] == scenario_count(scenario, configs.uncertainty)
    assert showcase["scenario_set"]["n_realizations"] == 3**6

    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = _direct_benchmark_results(scenario, scenario_set, configs)
    for name, result in direct.items():
        assert (
            service._serialize_strategy_result(result) == showcase["strategies"][name]
        ), name
    assert showcase["optimizer"] is None
    assert showcase["lambda_envelope"] is None


# ---------------------------------------------------------------------------
# Larger N=10 -- application Monte-Carlo guardrail
# ---------------------------------------------------------------------------


def test_larger_n10_uses_seeded_monte_carlo_guardrail(configs: EngineConfigs) -> None:
    scenario = generate_synthetic_portfolio(10, 80_010)
    showcase = evaluate_showcase(scenario, configs, include_optimizer=False, include_envelope=False)

    ss = showcase["scenario_set"]
    assert ss["method"] == "monte_carlo"
    assert ss["s_full"] == 3**10 == 59_049
    assert ss["n_samples"] == configs.defaults.mc_samples == 10_000
    assert ss["random_seed"] == configs.defaults.random_seed == 12_345
    assert ss["n_realizations"] == 10_000

    # parity: the SAME application defaults reproduce the same MC set + metrics
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = _direct_benchmark_results(scenario, scenario_set, configs)
    for name, result in direct.items():
        assert result.method == "monte_carlo"
        assert result.random_seed == 12_345
        assert (
            service._serialize_strategy_result(result) == showcase["strategies"][name]
        ), name


def test_engine_default_switching_behavior_is_not_changed_globally(
    configs: EngineConfigs,
) -> None:
    """The N=10 Monte-Carlo choice comes purely from the *application*
    threshold; with the canonical `configs/model_defaults.yaml` threshold
    the engine still selects exact enumeration for N=10."""
    scenario = generate_synthetic_portfolio(10, 80_010)
    canonical = build_scenario_set(scenario, configs.uncertainty, configs.defaults)
    assert canonical.method == "exact"
    assert configs.defaults.max_exact_scenarios == 100_000

    app_defaults = service.app_scenario_defaults(configs.defaults)
    assert app_defaults.max_exact_scenarios == service.APP_MAX_EXACT_SCENARIOS == 50_000
    # only the threshold differs
    assert app_defaults.model_dump(exclude={"max_exact_scenarios"}) == configs.defaults.model_dump(
        exclude={"max_exact_scenarios"}
    )


# ---------------------------------------------------------------------------
# Deployment guardrail behavior
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("flag", ["include_optimizer", "include_envelope"])
def test_optimizer_and_envelope_rejected_above_guardrail(
    configs: EngineConfigs, flag: str
) -> None:
    scenario = generate_synthetic_portfolio(6, 80_006)
    assert len(scenario.sites) > APP_LIVE_OPTIMIZATION_MAX_SITES
    with pytest.raises(ValueError, match="deployment guardrail"):
        evaluate_showcase(scenario, configs, **{flag: True})


# ---------------------------------------------------------------------------
# Exporter: service parity, determinism, verbatim evidence
# ---------------------------------------------------------------------------


def test_export_payloads_are_projections_of_service_calls(configs: EngineConfigs) -> None:
    """Each curated example file is `project_public_showcase()` applied to a
    full authoritative `evaluate_showcase()` result -- structural subset
    only, no changed value."""
    import scripts.export_showcase_data as exporter

    payloads = exporter.build_example_payloads(configs)
    assert list(payloads) == [
        "balanced_portfolio",
        "capacity_constrained_portfolio",
        "cheap_site_risky_schedule",
    ]
    for stem, payload in payloads.items():
        _title, builder = next(
            (t, b) for s, t, b in exporter._CURATED if s == stem
        )
        full = evaluate_showcase(
            builder(configs),
            configs,
            include_optimizer=True,
            include_envelope=True,
        )
        assert payload["showcase"] == exporter.project_public_showcase(full)
        assert payload["preset"] == {"file": f"{stem}.json", "id": stem, "title": _title}


def test_export_is_byte_deterministic(tmp_path: Path) -> None:
    out_a = tmp_path / "a"
    out_b = tmp_path / "b"
    for out in (out_a, out_b):
        subprocess.run(
            [sys.executable, str(_REPO_ROOT / "scripts" / "export_showcase_data.py"),
             "--out-dir", str(out)],
            check=True,
            cwd=_REPO_ROOT,
            capture_output=True,
        )
    files_a = sorted(p.name for p in out_a.iterdir())
    files_b = sorted(p.name for p in out_b.iterdir())
    assert files_a == files_b == [
        "balanced_portfolio.json",
        "capacity_constrained_portfolio.json",
        "cheap_site_risky_schedule.json",
        "index.json",
        "mappings.json",
    ]
    for name in files_a:
        assert (out_a / name).read_bytes() == (out_b / name).read_bytes(), name


def test_exported_json_is_service_projection(tmp_path: Path) -> None:
    import scripts.export_showcase_data as exporter

    subprocess.run(
        [sys.executable, str(_REPO_ROOT / "scripts" / "export_showcase_data.py"),
         "--out-dir", str(tmp_path)],
        check=True,
        cwd=_REPO_ROOT,
        capture_output=True,
    )
    configs = load_engine_configs()
    on_disk = json.loads((tmp_path / "cheap_site_risky_schedule.json").read_text())
    full = evaluate_showcase(
        exporter.cheap_site_risky_schedule_scenario(),
        configs,
        include_optimizer=True,
        include_envelope=True,
    )
    assert on_disk["showcase"] == exporter.project_public_showcase(full)


# ---------------------------------------------------------------------------
# mappings.json -- verbatim frozen-config serialization
# ---------------------------------------------------------------------------


def test_mappings_bundle_is_verbatim_frozen_config(configs: EngineConfigs) -> None:
    bundle = build_mappings_bundle(configs)

    # exact echo of the engine's own validated view of the config
    assert bundle["burden"] == configs.burden.model_dump(mode="json")
    assert bundle["uncertainty"] == configs.uncertainty.model_dump(mode="json")

    # and of the raw YAML on disk -- nothing renamed, rescaled, or dropped
    raw_burden = yaml.safe_load(
        (_REPO_ROOT / "configs" / "burden_states.yaml").read_text(encoding="utf-8")
    )
    raw_uncertainty = yaml.safe_load(
        (_REPO_ROOT / "configs" / "uncertainty_states.yaml").read_text(encoding="utf-8")
    )
    assert bundle["burden"]["mapping_version"] == raw_burden["mapping_version"] == "v1-baseline"
    assert (
        bundle["uncertainty"]["mapping_version"]
        == raw_uncertainty["mapping_version"]
        == "v1-baseline"
    )
    for state in ("1", "2", "3", "4"):
        rb = raw_burden["states"][int(state)]
        bb = bundle["burden"]["states"][state]
        assert bb == {
            "label": rb["label"],
            "interpretation": rb["interpretation"],
            "tau1_bar": float(rb["tau1_bar"]),
            "tau2_bar": float(rb["tau2_bar"]),
        }
        ru = raw_uncertainty["states"][int(state)]
        bu = bundle["uncertainty"]["states"][state]
        assert bu == {
            "label": ru["label"],
            "interpretation": ru["interpretation"],
            "delay_months": [float(d) for d in ru["delay_months"]],
            "probabilities": [float(p) for p in ru["probabilities"]],
        }


def test_public_mappings_payload_is_sanitized_service_bundle(configs: EngineConfigs) -> None:
    """The public `mappings.json` keeps every state value from the
    authoritative bundle, and drops only the private provenance block and
    the `mapping_version` id on each table."""
    import scripts.export_showcase_data as exporter

    bundle = build_mappings_bundle(configs)
    public = exporter.build_public_mappings_payload(configs)

    assert set(public) == {"kind", "burden", "uncertainty"}
    assert "provenance" not in public
    for table in ("burden", "uncertainty"):
        assert public[table] == {"states": bundle[table]["states"]}
        assert "mapping_version" not in public[table]
    # state values themselves are unchanged
    assert public["burden"]["states"] == configs.burden.model_dump(mode="json")["states"]
    assert (
        public["uncertainty"]["states"]
        == configs.uncertainty.model_dump(mode="json")["states"]
    )


# ---------------------------------------------------------------------------
# site_power_profiles -- every array is a direct engine call
# ---------------------------------------------------------------------------


def _assert_site_profiles_match_engine(
    scenario, configs: EngineConfigs, exported: list[dict]
) -> None:
    alpha = configs.defaults.alpha
    grid = time_grid(scenario.system.horizon_month)
    expected_times = [float(t) for t in grid]

    assert [p["site_id"] for p in exported] == [s.id for s in scenario.sites]
    for site, block in zip(scenario.sites, exported):
        tau1_bar, tau2_bar = resolve_burden(site.burden_state, configs.burden)
        delay_months, probabilities = resolve_uncertainty(
            site.uncertainty_state, configs.uncertainty
        )
        assert block["capacity_mw"] == float(site.capacity_mw)
        assert block["burden_state"] == int(site.burden_state)
        assert block["uncertainty_state"] == int(site.uncertainty_state)
        assert block["tau1_bar"] == float(tau1_bar)
        assert block["tau2_bar"] == float(tau2_bar)
        assert block["alpha"] == float(alpha)
        assert block["times"] == expected_times
        assert len(block["outcomes"]) == len(delay_months)
        for oc, delta, prob in zip(block["outcomes"], delay_months, probabilities):
            tau1, tau2 = apply_delay(tau1_bar, tau2_bar, delta)
            direct = site_power_profile(grid, site, delta, configs.burden, alpha)
            assert oc["delay_months"] == float(delta)
            assert oc["probability"] == float(prob)
            assert oc["tau1"] == float(tau1)
            assert oc["tau2"] == float(tau2)
            assert oc["profile_mw"] == [float(y) for y in direct]


def test_baseline_site_power_profiles_match_direct_engine(
    baseline_showcase: dict, configs: EngineConfigs
) -> None:
    scenario = load_baseline_scenario()
    _assert_site_profiles_match_engine(
        scenario, configs, baseline_showcase["site_power_profiles"]
    )
    # probabilities of each site's outcomes sum to 1 (a model validation invariant)
    for block in baseline_showcase["site_power_profiles"]:
        assert abs(sum(oc["probability"] for oc in block["outcomes"]) - 1.0) < 1e-9


@pytest.mark.parametrize("n_sites", [6, 10])
def test_synthetic_preset_site_power_profiles_match_direct_engine(
    configs: EngineConfigs, n_sites: int
) -> None:
    scenario = generate_synthetic_portfolio(n_sites, 80_000 + n_sites)
    showcase = evaluate_showcase(scenario, configs)
    _assert_site_profiles_match_engine(
        scenario, configs, showcase["site_power_profiles"]
    )


def test_exported_site_power_profiles_roundtrip_from_disk(tmp_path: Path) -> None:
    subprocess.run(
        [sys.executable, str(_REPO_ROOT / "scripts" / "export_showcase_data.py"),
         "--out-dir", str(tmp_path)],
        check=True,
        cwd=_REPO_ROOT,
        capture_output=True,
    )
    import scripts.export_showcase_data as exporter

    configs = load_engine_configs()
    on_disk = json.loads((tmp_path / "cheap_site_risky_schedule.json").read_text())
    assert on_disk["showcase"]["site_power_profiles"] == build_site_power_profiles(
        exporter.cheap_site_risky_schedule_scenario(), configs
    )
    mappings = json.loads((tmp_path / "mappings.json").read_text())
    assert mappings == exporter.build_public_mappings_payload(configs)
