"""Export the curated public example set for the public application.

NON-CANONICAL application build tooling. This is a small, purpose-built
driver script (not a general example framework) that
constructs three explicit curated scenarios, evaluates each through the
authoritative service path (`trackc_app.service.evaluate_showcase`), and
writes a sanitized public projection of the result to disk. It contains
no model mathematics and computes no model quantity itself -- every number
in the output comes from a `trackc` engine call routed through the
service layer.

The generated files are VERSIONED application artifacts (part of the
static-first public app), written to the static-serving location
`web/public/data/`.

Outputs (default `web/public/data/`):

* `balanced_portfolio.json`            -- an ordinary tradeoff: a mixed
  optimized allocation with partial deadline risk.
* `capacity_constrained_portfolio.json`-- the forced-allocation case
  (`sum(K) == D`): every site fully allocated, no choice to make.
* `cheap_site_risky_schedule.json`     -- the same portfolio as the
  engine's ground-truth fixture, evaluated at an overridden delay
  consequence inside the second decision regime, so it carries a genuine
  lambda envelope. The ground-truth fixture file itself is not modified.
* `mappings.json` -- the burden / schedule-uncertainty state-mapping
  tables (labels, interpretations, nominal stage months, delay outcomes,
  probabilities), sanitized of private provenance/version identifiers.
* `index.json`    -- the minimal example menu the public frontend reads.

Each example is a three-site scenario evaluated by exact enumeration of
the joint delay space, so there is no sampling and no seed: two runs of
this script produce byte-identical output.

The public projection is a SERIALIZATION SUBSET only. It drops export
provenance, engine/model/mapping version ids, application/deployment
metadata, concentration diagnostics, feasibility-status strings, and LP /
recursion solver diagnostics -- none of which the public pages consume. It
never changes, recomputes, or re-derives any value the engine returned.

Usage:  python scripts/export_showcase_data.py [--out-dir web/public/data]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from trackc.model.schemas import Scenario
from trackc_app.service import (
    EngineConfigs,
    build_mappings_bundle,
    evaluate_showcase,
    load_baseline_scenario,
    load_engine_configs,
)

_REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = _REPO_ROOT / "web" / "public" / "data"


# ---------------------------------------------------------------------------
# Curated scenarios
# ---------------------------------------------------------------------------


def _state_ids(configs: EngineConfigs) -> tuple[dict[str, int], dict[str, int]]:
    """`label -> ordinal state id` for the burden and uncertainty mappings.

    The curated scenarios below name each site's power-delivery complexity
    and schedule uncertainty by their published label ("Low", "Moderate",
    "High"). Those labels are resolved to ordinal state identifiers here
    from the loaded authoritative mapping definitions -- the labels are
    never treated as arithmetic values.
    """
    burden = {defn.label: sid for sid, defn in configs.burden.states.items()}
    uncertainty = {defn.label: sid for sid, defn in configs.uncertainty.states.items()}
    return burden, uncertainty


def _site(
    burden_ids: dict[str, int],
    uncertainty_ids: dict[str, int],
    *,
    id: str,
    capacity_mw: float,
    cost_per_mw: float,
    complexity: str,
    uncertainty: str,
) -> dict:
    return {
        "id": id,
        "capacity_mw": capacity_mw,
        "cost_per_mw": cost_per_mw,
        "burden_state": burden_ids[complexity],
        "uncertainty_state": uncertainty_ids[uncertainty],
    }


def balanced_portfolio_scenario(configs: EngineConfigs) -> Scenario:
    """An ordinary tradeoff. Mixed allocation, partial
    deadline risk; evaluated at a delay consequence inside a genuine
    tradeoff regime."""
    b, u = _state_ids(configs)
    return Scenario.model_validate(
        {
            "system": {
                "required_capacity_mw": 300,
                "target_month": 30,
                "horizon_month": 72,
                "lambda_mw_month": 0.05,
            },
            "sites": [
                _site(b, u, id="A", capacity_mw=300, cost_per_mw=1.00,
                      complexity="High", uncertainty="Low"),
                _site(b, u, id="B", capacity_mw=300, cost_per_mw=1.20,
                      complexity="Low", uncertainty="Low"),
                _site(b, u, id="C", capacity_mw=150, cost_per_mw=1.10,
                      complexity="Moderate", uncertainty="Low"),
            ],
        }
    )


def capacity_constrained_portfolio_scenario(configs: EngineConfigs) -> Scenario:
    """The forced-allocation case: total developable
    capacity exactly equals the requirement, so every site is fully
    allocated and there is no choice about where the capacity goes."""
    b, u = _state_ids(configs)
    scenario = Scenario.model_validate(
        {
            "system": {
                "required_capacity_mw": 600,
                "target_month": 30,
                "horizon_month": 72,
                "lambda_mw_month": 0.50,
            },
            "sites": [
                _site(b, u, id="A", capacity_mw=200, cost_per_mw=1.00,
                      complexity="Low", uncertainty="Low"),
                _site(b, u, id="B", capacity_mw=200, cost_per_mw=1.10,
                      complexity="Moderate", uncertainty="Low"),
                _site(b, u, id="C", capacity_mw=200, cost_per_mw=1.20,
                      complexity="High", uncertainty="Low"),
            ],
        }
    )
    total_k = sum(s.capacity_mw for s in scenario.sites)
    if total_k != scenario.system.required_capacity_mw:
        raise AssertionError(
            f"capacity-constrained example must satisfy sum(K) == D; got "
            f"sum(K)={total_k}, D={scenario.system.required_capacity_mw}"
        )
    return scenario


#: Delay consequence for the third example. It sits between the located
#: regime boundaries of the ground-truth portfolio (about 0.011 and 0.037),
#: so the optimized allocation is a genuine, unique, tradeoff-driven mix
#: rather than a corner solution. It is deliberately not 0 -- this example
#: is not the cost-only case.
CHEAP_SITE_LAMBDA = 0.025


def cheap_site_risky_schedule_scenario() -> Scenario:
    """The engine's ground-truth portfolio, evaluated at an overridden
    delay consequence. An application/export-layer copy is made with an
    immutable Pydantic copy; the canonical fixture file is not touched."""
    scenario = load_baseline_scenario()
    return scenario.model_copy(
        update={
            "system": scenario.system.model_copy(
                update={"lambda_mw_month": CHEAP_SITE_LAMBDA}
            )
        }
    )


# ---------------------------------------------------------------------------
# Public serialization projection -- structural subset only, no arithmetic.
# ---------------------------------------------------------------------------

#: `StrategyResult` fields the public pages actually read (Decision-page
#: Key Results and visuals, Technical Documentation tables and figures).
#: The engine-emitted model/mapping version ids, feasibility-status string,
#: and scenario-set seed/sample bookkeeping are dropped -- they are private
#: and unused by any public component.
_PUBLIC_STRATEGY_FIELDS = (
    "allocation",
    "development_cost",
    "p_meet",
    "expected_shortfall_mw",
    "expected_delay_burden_mw_months",
    "objective",
    "times",
    "delivered_capacity_trajectory",
)


def _project_strategy(result: dict) -> dict:
    return {k: result[k] for k in _PUBLIC_STRATEGY_FIELDS}


def _project_optimizer(optimizer: dict) -> dict:
    r = optimizer["result"]
    return {
        "at_lambda": optimizer["at_lambda"],
        "result": {
            "site_ids": r["site_ids"],
            "allocation": r["allocation"],
            "is_unique_within_tolerance": r["is_unique_within_tolerance"],
            "coordinate_bounds": r["coordinate_bounds"],
            "cooptimality_tolerance": r["cooptimality_tolerance"],
        },
        "evaluated": _project_strategy(optimizer["evaluated"]),
    }


def _project_envelope(envelope: dict) -> dict:
    return {
        "l_min": envelope["l_min"],
        "lambda_anchor": envelope["lambda_anchor"],
        "terminal_breakpoint_lambda": envelope["terminal_breakpoint_lambda"],
        "vertices": [
            {
                # The lambda this vertex was SOLVED at -- retained (structural
                # selection only, the engine already serializes it) because
                # `is_unique_within_tolerance` is a property of that solve, not
                # of the regime the vertex represents. Dropping it left the
                # public regime table with no way to say which lambda its
                # uniqueness flag came from, and a vertex first discovered by a
                # crossing probe carries the tie that exists AT the boundary.
                "lam": v["lam"],
                "allocation": v["allocation"],
                "is_unique_within_tolerance": v["is_unique_within_tolerance"],
                "cooptimality_tolerance": v["cooptimality_tolerance"],
                "coordinate_bounds": v["coordinate_bounds"],
                "strategy_result": _project_strategy(v["strategy_result"]),
            }
            for v in envelope["vertices"]
        ],
        "breakpoints": [
            {
                "lam_estimate": b["lam_estimate"],
                "tolerance": b["tolerance"],
                "co_optimal_at_breakpoint": b["co_optimal_at_breakpoint"],
                "left_vertex_allocation": b["left_vertex_allocation"],
                "right_vertex_allocation": b["right_vertex_allocation"],
            }
            for b in envelope["breakpoints"]
        ],
    }


def project_public_showcase(showcase: dict) -> dict:
    """A sanitized public subset of the authoritative `evaluate_showcase`
    result. Structural selection only -- every retained value is passed
    through byte-for-byte."""
    optimizer = showcase["optimizer"]
    envelope = showcase["lambda_envelope"]
    if optimizer is None or envelope is None:
        raise AssertionError(
            "every curated public example must carry both an optimizer "
            "result and a lambda envelope"
        )
    return {
        "scenario": showcase["scenario"],
        "scenario_set": {
            "method": showcase["scenario_set"]["method"],
            "n_realizations": showcase["scenario_set"]["n_realizations"],
        },
        "site_power_profiles": showcase["site_power_profiles"],
        "strategies": {
            name: _project_strategy(result)
            for name, result in showcase["strategies"].items()
        },
        "decision_boundaries": showcase["decision_boundaries"],
        "optimizer": _project_optimizer(optimizer),
        "lambda_envelope": _project_envelope(envelope),
    }


# ---------------------------------------------------------------------------
# Curated example set
# ---------------------------------------------------------------------------

#: `(file stem, public id, public title, scenario builder)`, in menu order.
#: The public id and file stem are stable; no identifier uses the word
#: "baseline".
_CURATED = (
    ("balanced_portfolio", "Balanced portfolio", balanced_portfolio_scenario),
    (
        "capacity_constrained_portfolio",
        "Capacity-constrained portfolio",
        capacity_constrained_portfolio_scenario,
    ),
    (
        "cheap_site_risky_schedule",
        "Cheap site, risky schedule",
        lambda _configs: cheap_site_risky_schedule_scenario(),
    ),
)


def build_example_payloads(configs: EngineConfigs) -> dict[str, dict]:
    """Every curated example, keyed by output file stem. Deterministic."""
    payloads: dict[str, dict] = {}
    for stem, title, builder in _CURATED:
        scenario = builder(configs)
        showcase = evaluate_showcase(
            scenario, configs, include_optimizer=True, include_envelope=True
        )
        payloads[stem] = {
            "preset": {"file": f"{stem}.json", "id": stem, "title": title},
            "showcase": project_public_showcase(showcase),
        }
    return payloads


def build_public_mappings_payload(configs: EngineConfigs) -> dict:
    """The state-mapping tables for the public app, sanitized of private
    provenance and version identifiers.

    Content kept: per-state label, interpretation, nominal stage months
    (burden) and delay outcomes / probabilities (uncertainty). Removed:
    the `provenance` block (engine version, source config paths, internal
    notes) and the `mapping_version` id on each table. The state values
    themselves are unchanged.
    """
    bundle = build_mappings_bundle(configs)
    return {
        "kind": "state mapping tables: power-delivery complexity and schedule uncertainty",
        "burden": {"states": bundle["burden"]["states"]},
        "uncertainty": {"states": bundle["uncertainty"]["states"]},
    }


def build_index_payload(example_payloads: dict[str, dict]) -> dict:
    """The minimal example menu the public frontend consumes: the mappings
    file name and, per example, its file / id / title."""
    return {
        "kind": "capacity-allocation example index",
        "mappings_file": "mappings.json",
        "presets": [payload["preset"] for payload in example_payloads.values()],
    }


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, allow_nan=False, sort_keys=True) + "\n"
    path.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out-dir",
        type=Path,
        default=DEFAULT_OUT_DIR,
        help=f"output directory (default: {DEFAULT_OUT_DIR.relative_to(_REPO_ROOT)})",
    )
    args = parser.parse_args()
    out_dir: Path = args.out_dir

    configs = load_engine_configs()

    example_payloads = build_example_payloads(configs)
    for stem, payload in example_payloads.items():
        _write_json(out_dir / f"{stem}.json", payload)
        opt = payload["showcase"]["optimizer"]
        alloc = ", ".join(
            f"{sid} {mw:g}" for sid, mw in opt["result"]["allocation"].items()
        )
        print(f"wrote {stem}.json  (lambda={opt['at_lambda']:g}, allocation {alloc})")

    _write_json(out_dir / "mappings.json", build_public_mappings_payload(configs))
    print("wrote mappings.json  (state mapping tables, sanitized)")

    _write_json(out_dir / "index.json", build_index_payload(example_payloads))
    print("wrote index.json")
    print(f"\nshowcase data -> {out_dir}")


if __name__ == "__main__":
    main()
