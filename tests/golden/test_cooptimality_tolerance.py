"""`evaluate_showcase` tolerates a genuine benchmark indifference state
(the model specification) instead of raising.

A full-interval tie between two or more benchmark strategies is a valid
model indifference state, not a client error. `/compare` and `/optimize`
must expose the co-optimal set rather than surface the engine's
single-answer `ValueError`. The application layer
must use the engine's own authoritative co-optimality query
(`co_optimal_strategies_at_lambda`) and invent no tie mathematics.

These tests pin three cases:

* ordinary unique optimum -> `co_optimal` is a 1-element list on every
  segment, `global_switching_has_cooptimal_segments` is False, and the
  segments are byte-identical to the engine's own
  `global_switching_boundaries`;
* exact indifference -> two benchmarks coincide, the engine's single-answer
  path raises, and `evaluate_showcase` still returns, with the tied names
  in `co_optimal` and the flag True;
* genuinely invalid input still raises the appropriate error.
"""

from __future__ import annotations

import pytest

from trackc.model.comparator import global_switching_boundaries
from trackc.model.evaluator import evaluate_strategy
from trackc.model.schemas import Scenario
from trackc_app import service
from trackc_app.service import (
    EngineConfigs,
    evaluate_showcase,
    load_baseline_scenario,
    load_engine_configs,
)


@pytest.fixture(scope="module")
def configs() -> EngineConfigs:
    return load_engine_configs()


def _tie_scenario() -> Scenario:
    """A 2-site portfolio where the cost-concentration and speed-reliability
    benchmarks are forced to the *identical* allocation: site A is both
    strictly cheaper (1.0 < 2.0) and strictly faster (burden state 1,
    tau2_bar 24 < state 2, tau2_bar 30) than site B, and D lies between
    K_A and K_A + K_B, so both benchmarks fill [A, B] the same way. The
    diversified benchmark (proportional to capacity) stays distinct.
    """
    return Scenario.model_validate(
        {
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
    )


# ---------------------------------------------------------------------------
# Case 1 -- ordinary unique optimum
# ---------------------------------------------------------------------------


def test_unique_optimum_matches_engine_and_flags_no_cooptimality(
    configs: EngineConfigs,
) -> None:
    scenario = load_baseline_scenario()
    showcase = evaluate_showcase(scenario, configs)
    boundaries = showcase["decision_boundaries"]

    assert boundaries["global_switching_has_cooptimal_segments"] is False

    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = {
        name: evaluate_strategy(
            scenario,
            allocation,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        for name, allocation in service.benchmark_allocations(scenario, configs).items()
    }
    expected = [
        {"lambda_start": float(lam), "strategy": name, "co_optimal": [name]}
        for lam, name in global_switching_boundaries(direct)
    ]
    assert boundaries["global_switching_boundaries"] == expected
    for segment in boundaries["global_switching_boundaries"]:
        assert segment["co_optimal"] == [segment["strategy"]]


# ---------------------------------------------------------------------------
# Case 2 -- exact indifference state
# ---------------------------------------------------------------------------


def test_engine_single_answer_path_raises_on_the_tie_scenario(
    configs: EngineConfigs,
) -> None:
    """Guard the premise: the engine's own single-answer global-switching
    query really does raise for this portfolio, so the tolerance below is
    exercising a real indifference state, not a no-op."""
    scenario = _tie_scenario()
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    direct = {
        name: evaluate_strategy(
            scenario,
            allocation,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        for name, allocation in service.benchmark_allocations(scenario, configs).items()
    }
    assert (
        direct["cost_concentration"].development_cost
        == direct["speed_reliability"].development_cost
    )
    assert (
        direct["cost_concentration"].expected_delay_burden_mw_months
        == direct["speed_reliability"].expected_delay_burden_mw_months
    )
    with pytest.raises(ValueError, match="no unique preferred strategy"):
        global_switching_boundaries(direct)


def test_evaluate_showcase_tolerates_the_tie_and_exposes_cooptimal_set(
    configs: EngineConfigs,
) -> None:
    scenario = _tie_scenario()
    showcase = evaluate_showcase(scenario, configs)  # must not raise
    boundaries = showcase["decision_boundaries"]

    assert boundaries["global_switching_has_cooptimal_segments"] is True

    segments = boundaries["global_switching_boundaries"]
    assert segments, "expected at least one switching segment"
    assert segments[0]["lambda_start"] == 0.0

    tied_segments = [s for s in segments if len(s["co_optimal"]) > 1]
    assert tied_segments, "expected a segment with a co-optimal benchmark set"
    for seg in tied_segments:
        assert set(seg["co_optimal"]) == {"cost_concentration", "speed_reliability"}
        # the single representative is still one of the tied names
        assert seg["strategy"] in seg["co_optimal"]
        # representative is the first tied name in benchmark iteration order
        assert seg["strategy"] == seg["co_optimal"][0] == "cost_concentration"

    # every co_optimal list is ordered as the benchmark dict is
    order = list(service.benchmark_allocations(scenario, configs))
    for seg in segments:
        assert seg["co_optimal"] == sorted(seg["co_optimal"], key=order.index)

    # the rest of the showcase is unaffected -- strategies still parity-match
    scenario_set = service.build_showcase_scenario_set(scenario, configs)
    for name, allocation in service.benchmark_allocations(scenario, configs).items():
        direct = evaluate_strategy(
            scenario,
            allocation,
            scenario_set,
            configs.burden,
            configs.uncertainty,
            configs.defaults.alpha,
        )
        assert showcase["strategies"][name] == service._serialize_strategy_result(direct)


def test_optimizer_path_also_tolerates_the_tie(configs: EngineConfigs) -> None:
    """`evaluate_showcase(include_optimizer=True)` runs the same benchmark
    switching computation before the optimizer block, so the N<=3 optimize
    route must tolerate the tie too."""
    scenario = _tie_scenario()
    showcase = evaluate_showcase(scenario, configs, include_optimizer=True)
    assert showcase["optimizer"] is not None
    assert (
        showcase["decision_boundaries"]["global_switching_has_cooptimal_segments"]
        is True
    )


# ---------------------------------------------------------------------------
# Case 3 -- genuinely invalid input still errors
# ---------------------------------------------------------------------------


def test_guardrail_violation_still_raises(configs: EngineConfigs) -> None:
    from trackc.experiments.scalability import generate_synthetic_portfolio

    scenario = generate_synthetic_portfolio(6, 80_006)
    with pytest.raises(ValueError, match="deployment guardrail"):
        evaluate_showcase(scenario, configs, include_optimizer=True)
