"""Strategy comparator and decision-boundary tests (the model
specification), hand-calculated against the baseline fixture.

Baseline scenario (D=500, T*=36, H=72, alpha=0.5; sites A/B/C, same as
tests/unit/test_evaluator.py):

    A: K=500 c=1.00 B=3 (tau1_bar=30, tau2_bar=42) U=3 delays[0,9,18] p[.40,.35,.25]
    B: K=300 c=1.15 B=2 (tau1_bar=24, tau2_bar=30) U=1 delays[0,3,6]  p[.80,.15,.05]
    C: K=250 c=1.30 B=1 (tau1_bar=18, tau2_bar=24) U=2 delays[0,6,12] p[.60,.30,.10]

Every hand-computed number below was independently re-derived (by hand, not
by re-running comparator.py) before being checked against the
implementation.
"""

import pytest

from trackc.model.comparator import (
    break_even_lambda,
    co_optimal_strategies_at_lambda,
    concentration_metric,
    cost_concentration_allocation,
    deadline_sweep,
    diversified_allocation,
    dominates,
    global_switching_boundaries,
    mapping_sensitivity_sweep,
    pareto_frontier,
    preferred_strategy_at_lambda,
    speed_reliability_allocation,
    uncertainty_state_sweep,
)
from trackc.model.evaluator import evaluate_strategy
from trackc.model.schemas import (
    BurdenStateConfig,
    Scenario,
    UncertaintyStateConfig,
    load_burden_states,
)

ALPHA = 0.50


# --- benchmark strategies (model spec) ---------------------------------


def test_cost_concentration_fills_cheapest_site_first(baseline: Scenario) -> None:
    # A is cheapest (c=1.00) and K_A=500=D exactly -> the whole allocation
    # lands on A alone.
    x = cost_concentration_allocation(baseline)
    assert x.by_site == {"A": 500.0}


def test_speed_reliability_prioritizes_earliest_full_power_sites(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    # Ranked by (tau2_bar, E[delta]): C (tau2_bar=24) < B (tau2_bar=30) < A
    # (tau2_bar=42) -- C then B fill exactly to D=500, A gets nothing.
    x = speed_reliability_allocation(baseline, burden, uncertainty)
    assert x.by_site == {"C": 250.0, "B": 250.0}


def test_diversified_spreads_proportional_to_site_capacity(baseline: Scenario) -> None:
    # No site's proportional share (500*K_i/1050) exceeds its own K_i, so no
    # water-filling cap is triggered -- a pure proportional split.
    x = diversified_allocation(baseline)
    assert x.by_site["A"] == pytest.approx(500.0 * 500.0 / 1050.0)
    assert x.by_site["B"] == pytest.approx(500.0 * 300.0 / 1050.0)
    assert x.by_site["C"] == pytest.approx(500.0 * 250.0 / 1050.0)
    assert sum(x.by_site.values()) == pytest.approx(500.0)


def test_diversified_allocates_full_portfolio_when_target_meets_or_exceeds_total_capacity() -> None:
    from trackc.model.schemas import Scenario as ScenarioModel
    from trackc.model.schemas import Site, SystemInputs

    # A proportional-to-K_i split gives every site the SAME fraction
    # (D / sum_j K_j) of its own K_i -- so a cap can only ever be all-or-
    # nothing across every site simultaneously, never partial (one site
    # capped while another isn't is mathematically impossible under this
    # rule). D=900=sum(K) is the boundary: every site's fraction is exactly
    # 1.0, so every site is allocated its full K_i.
    system = SystemInputs(
        required_capacity_mw=900, target_month=12, horizon_month=24, lambda_mw_month=0
    )
    sites = [
        Site(id="small", capacity_mw=100, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
        Site(id="big1", capacity_mw=400, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
        Site(id="big2", capacity_mw=400, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
    ]
    scenario = ScenarioModel(system=system, sites=sites)
    x = diversified_allocation(scenario)
    assert x.by_site == {"small": 100.0, "big1": 400.0, "big2": 400.0}


def test_diversified_still_allocates_full_portfolio_when_target_exceeds_total_capacity() -> None:
    from trackc.model.schemas import Scenario as ScenarioModel
    from trackc.model.schemas import Site, SystemInputs

    # D=1200 > sum(K)=900: the portfolio itself cannot meet D (system-level
    # insufficiency, the model specification -- evaluate_strategy's job to flag, not
    # this function's) -- diversified_allocation still returns the most it
    # meaningfully can: every site at its own full K_i.
    system = SystemInputs(
        required_capacity_mw=1200, target_month=12, horizon_month=24, lambda_mw_month=0
    )
    sites = [
        Site(id="small", capacity_mw=100, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
        Site(id="big1", capacity_mw=400, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
        Site(id="big2", capacity_mw=400, cost_per_mw=1.0, burden_state=1, uncertainty_state=1),
    ]
    scenario = ScenarioModel(system=system, sites=sites)
    x = diversified_allocation(scenario)
    assert x.by_site == {"small": 100.0, "big1": 400.0, "big2": 400.0}


# --- concentration metric (model spec) ---------------------------------


def test_concentration_metric_single_site_is_maximally_concentrated(baseline: Scenario) -> None:
    x = cost_concentration_allocation(baseline)
    weights, hhi = concentration_metric(x, ("A", "B", "C"))
    assert weights == {"A": 1.0, "B": 0.0, "C": 0.0}
    assert hhi == pytest.approx(1.0)


def test_concentration_metric_diversified_is_less_concentrated(baseline: Scenario) -> None:
    x = diversified_allocation(baseline)
    weights, hhi = concentration_metric(x, ("A", "B", "C"))
    assert sum(weights.values()) == pytest.approx(1.0)
    assert (
        1.0 / 3.0 < hhi < 1.0
    )  # spread across 3 unequal sites: between perfectly-even and single-site


def test_concentration_metric_zero_allocation_is_zero_not_a_division_error() -> None:
    from trackc.model.schemas import Allocation

    weights, hhi = concentration_metric(Allocation(by_site={}), ("A", "B", "C"))
    assert weights == {"A": 0.0, "B": 0.0, "C": 0.0}
    assert hhi == 0.0


# --- dominance / cost-risk tradeoff --------------------------------------


def test_benchmark_strategies_are_a_genuine_nondominated_tradeoff(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    cc = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    sr = evaluate_strategy(
        baseline,
        speed_reliability_allocation(baseline, burden, uncertainty),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    div = evaluate_strategy(
        baseline, diversified_allocation(baseline), exact_set, burden, uncertainty, alpha=ALPHA
    )

    # hand-computed: cc=(C_dev=500, E[L]=4425), sr=(C_dev=612.5, E[L]=0),
    # div=(C_dev=557.14.., E[L]=964.28..) -- cheaper always costs more delay
    # burden here, so no strategy weakly beats another on both axes.
    assert cc.development_cost == pytest.approx(500.0)
    assert cc.expected_delay_burden_mw_months == pytest.approx(4425.0)
    assert sr.development_cost == pytest.approx(612.5)
    assert sr.expected_delay_burden_mw_months == pytest.approx(0.0)
    # C_dev = (5000/21)*1.00 + (1000/7)*1.15 + (2500/21)*1.30 = 11700/21
    assert div.development_cost == pytest.approx(11700.0 / 21.0)
    assert div.expected_delay_burden_mw_months == pytest.approx(964.2857142857143)

    assert not dominates(cc, sr)
    assert not dominates(sr, cc)
    assert not dominates(cc, div)
    assert not dominates(div, cc)
    assert not dominates(sr, div)
    assert not dominates(div, sr)

    frontier = pareto_frontier([cc, sr, div])
    assert len(frontier) == 3  # all three are on the cost-risk tradeoff frontier


def test_dominates_is_strict_when_only_cost_differs_at_an_identical_trajectory(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    from trackc.model.schemas import Allocation

    x = {"A": 100, "B": 300, "C": 100}
    cheap = evaluate_strategy(
        baseline, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
    )
    pricier_sites = [
        s.model_copy(update={"cost_per_mw": s.cost_per_mw + 0.5}) for s in baseline.sites
    ]
    pricier_scenario = baseline.model_copy(update={"sites": pricier_sites})
    pricier = evaluate_strategy(
        pricier_scenario, Allocation(by_site=x), exact_set, burden, uncertainty, alpha=ALPHA
    )

    # identical allocation + scenario_set -> identical E[L]; only cost differs
    # -> cheap weakly-no-worse-and-strictly-better on cost alone dominates.
    assert cheap.expected_delay_burden_mw_months == pytest.approx(
        pricier.expected_delay_burden_mw_months
    )
    assert cheap.development_cost < pricier.development_cost
    assert dominates(cheap, pricier)
    assert not dominates(pricier, cheap)

    frontier = pareto_frontier([cheap, pricier])
    assert frontier == [cheap]  # pricier is strictly dominated, dropped from the frontier


# --- break-even lambda (model spec) ------------------------------------


def test_break_even_lambda_matches_hand_derivation(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    cc = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    sr = evaluate_strategy(
        baseline,
        speed_reliability_allocation(baseline, burden, uncertainty),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    # lambda* = (C_sr - C_cc) / (E[L_cc] - E[L_sr]) = (612.5-500)/(4425-0)
    lam_star = break_even_lambda(cc, sr)
    assert lam_star == pytest.approx(112.5 / 4425.0)

    # Verify the crossover explains the ranking change: below lambda*, cc's J
    # is lower (cheaper wins); above it, sr's J is lower (sr's zero delay
    # burden wins) -- recomputed directly from J = C_dev + lambda*E[L], not
    # from break_even_lambda's own formula, to cross-check independently.
    below = cc.development_cost + (lam_star - 0.001) * cc.expected_delay_burden_mw_months
    above = cc.development_cost + (lam_star + 0.001) * cc.expected_delay_burden_mw_months
    assert below < sr.objective  # cc still wins just below lambda*
    assert above > sr.objective  # sr wins just above lambda*


def test_break_even_lambda_matches_all_three_pairwise_baseline_crossings(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    # The three PAIRWISE indifference points among the baseline benchmarks
    # (model spec) -- audited independently against the session's
    # reported values. These are indifference points between exactly the two
    # named strategies; see test_global_switching_boundaries_* below for
    # which of these are (and are not) also global ranking-switch points.
    cc = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    sr = evaluate_strategy(
        baseline,
        speed_reliability_allocation(baseline, burden, uncertainty),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    div = evaluate_strategy(
        baseline, diversified_allocation(baseline), exact_set, burden, uncertainty, alpha=ALPHA
    )

    assert break_even_lambda(cc, div) == pytest.approx(0.01651, abs=1e-5)
    assert break_even_lambda(div, sr) == pytest.approx(0.05741, abs=1e-5)
    assert break_even_lambda(cc, sr) == pytest.approx(0.02542, abs=1e-5)


def test_break_even_lambda_is_none_when_delay_burdens_are_equal(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    from trackc.model.schemas import Allocation

    full = evaluate_strategy(
        baseline,
        Allocation(by_site={"A": 500, "B": 300, "C": 250}),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    full_again = evaluate_strategy(
        baseline,
        Allocation(by_site={"A": 500, "B": 300, "C": 250}),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    assert break_even_lambda(full, full_again) is None  # E[L]=E[L]=0 for both -- no crossover


# --- global switching boundaries: pairwise != global (model spec) -----
#
# A pairwise break_even_lambda only says where TWO strategies tie; it does
# NOT mean the globally preferred strategy switches there if a third
# strategy is already preferred to both at that lambda. On the baseline's
# three benchmarks: cc<->div ~0.01651 and div<->sr ~0.05741 ARE global
# switching boundaries (the lower-envelope winner changes at both), but
# cc<->sr ~0.02542 is NOT -- diversified is strictly cheaper (lower J) than
# both cc and sr at that exact lambda, so that pairwise crossing is entirely
# hidden from anyone tracking the globally preferred strategy.


def test_global_switching_boundaries_match_the_lower_envelope_of_all_three_benchmarks(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    cc = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    sr = evaluate_strategy(
        baseline,
        speed_reliability_allocation(baseline, burden, uncertainty),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    div = evaluate_strategy(
        baseline, diversified_allocation(baseline), exact_set, burden, uncertainty, alpha=ALPHA
    )
    results = {"cost_concentration": cc, "diversified": div, "speed_reliability": sr}

    boundaries = global_switching_boundaries(results)
    names = [name for _, name in boundaries]
    lambdas = [lam for lam, _ in boundaries]

    # exactly three segments: cc wins from lambda=0, div takes over at
    # cc<->div's break-even, sr takes over at div<->sr's break-even.
    assert names == ["cost_concentration", "diversified", "speed_reliability"]
    assert lambdas[0] == 0.0
    assert lambdas[1] == pytest.approx(0.01651, abs=1e-5)  # == break_even_lambda(cc, div)
    assert lambdas[2] == pytest.approx(0.05741, abs=1e-5)  # == break_even_lambda(div, sr)

    # regression coverage: the cc<->sr pairwise crossing (~0.02542) is a real
    # break_even_lambda value, but it must NEVER appear as a global switching
    # boundary -- it falls strictly inside the "diversified wins" segment.
    cc_sr_break_even = break_even_lambda(cc, sr)
    assert cc_sr_break_even == pytest.approx(0.02542, abs=1e-5)
    assert all(abs(lam - cc_sr_break_even) > 1e-6 for lam in lambdas)
    assert preferred_strategy_at_lambda(results, cc_sr_break_even) == "diversified"


@pytest.mark.parametrize(
    "lam,expected_winner",
    [
        (0.0, "cost_concentration"),
        (0.01, "cost_concentration"),  # below cc<->div break-even
        (0.02, "diversified"),  # between cc<->div and div<->sr break-evens
        (0.025423728813559324, "diversified"),  # AT the hidden cc<->sr break-even
        (0.04, "diversified"),  # still between cc<->div and div<->sr
        (0.1, "speed_reliability"),  # above div<->sr break-even
    ],
)
def test_preferred_strategy_at_lambda_matches_the_switching_boundaries(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    lam: float,
    expected_winner: str,
) -> None:
    cc = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    sr = evaluate_strategy(
        baseline,
        speed_reliability_allocation(baseline, burden, uncertainty),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    div = evaluate_strategy(
        baseline, diversified_allocation(baseline), exact_set, burden, uncertainty, alpha=ALPHA
    )
    results = {"cost_concentration": cc, "diversified": div, "speed_reliability": sr}
    assert preferred_strategy_at_lambda(results, lam) == expected_winner


# --- exact-tie representation at a true switching boundary ------------------
#
# A break_even_lambda IS an indifference point: J is mathematically identical
# for both strategies there, not merely close. preferred_strategy_at_lambda
# must not misrepresent that exact point as belonging to a single "winner" --
# it raises ValueError instead of arbitrarily picking one, and
# co_optimal_strategies_at_lambda
# remains the analytical API that returns the full tied set. No model
# quantity (J, break_even_lambda's formula, any boundary calculation) is
# changed by any of this -- these are read-only queries over StrategyResult.


def _baseline_benchmark_results(baseline, burden, uncertainty, exact_set):
    cc = evaluate_strategy(
        baseline,
        cost_concentration_allocation(baseline),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    sr = evaluate_strategy(
        baseline,
        speed_reliability_allocation(baseline, burden, uncertainty),
        exact_set,
        burden,
        uncertainty,
        alpha=ALPHA,
    )
    div = evaluate_strategy(
        baseline, diversified_allocation(baseline), exact_set, burden, uncertainty, alpha=ALPHA
    )
    return {"cost_concentration": cc, "diversified": div, "speed_reliability": sr}


def test_co_optimal_strategies_at_lambda_reports_both_strategies_at_each_boundary(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    results = _baseline_benchmark_results(baseline, burden, uncertainty, exact_set)
    boundaries = global_switching_boundaries(results)
    assert [lam for lam, _ in boundaries] == pytest.approx(
        [0.0, 0.016511867905056748, 0.057407407407407456]
    )

    # lambda=0.0: cost_concentration is strictly cheapest -- no tie.
    assert co_optimal_strategies_at_lambda(results, 0.0) == ["cost_concentration"]

    # the cc<->div break-even IS an exact tie between exactly those two --
    # J_cc(lambda*) == J_div(lambda*) mathematically, not approximately.
    cc_div_lambda = boundaries[1][0]
    tied = set(co_optimal_strategies_at_lambda(results, cc_div_lambda))
    assert tied == {"cost_concentration", "diversified"}
    j_cc = (
        results["cost_concentration"].development_cost
        + cc_div_lambda * results["cost_concentration"].expected_delay_burden_mw_months
    )
    j_div = (
        results["diversified"].development_cost
        + cc_div_lambda * results["diversified"].expected_delay_burden_mw_months
    )
    assert j_cc == pytest.approx(j_div, abs=1e-9)

    # the div<->sr break-even IS an exact tie between exactly those two.
    div_sr_lambda = boundaries[2][0]
    tied = set(co_optimal_strategies_at_lambda(results, div_sr_lambda))
    assert tied == {"diversified", "speed_reliability"}

    # an interior (non-boundary) lambda is never a tie among these three.
    assert co_optimal_strategies_at_lambda(results, 0.03) == ["diversified"]


def test_co_optimal_strategies_at_lambda_is_independent_of_dict_iteration_order(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    results = _baseline_benchmark_results(baseline, burden, uncertainty, exact_set)
    reordered = {
        "speed_reliability": results["speed_reliability"],
        "diversified": results["diversified"],
        "cost_concentration": results["cost_concentration"],
    }
    lam = break_even_lambda(results["cost_concentration"], results["diversified"])
    assert set(co_optimal_strategies_at_lambda(results, lam)) == set(
        co_optimal_strategies_at_lambda(reordered, lam)
    )


def test_preferred_strategy_at_lambda_returns_normally_when_winner_is_unique(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    # regression #1: unique-winner queries still return normally (no
    # exception), at both an interior point and lambda=0.0.
    results = _baseline_benchmark_results(baseline, burden, uncertainty, exact_set)
    assert preferred_strategy_at_lambda(results, 0.0) == "cost_concentration"
    assert preferred_strategy_at_lambda(results, 0.03) == "diversified"
    assert preferred_strategy_at_lambda(results, 0.1) == "speed_reliability"


@pytest.mark.parametrize(
    "pair_names",
    [("cost_concentration", "diversified"), ("diversified", "speed_reliability")],
)
def test_preferred_strategy_at_lambda_raises_at_both_baseline_global_boundaries(
    baseline: Scenario,
    burden: BurdenStateConfig,
    uncertainty: UncertaintyStateConfig,
    exact_set,
    pair_names: tuple[str, str],
) -> None:
    # regression #2: both baseline global switching boundaries (cc<->div and
    # div<->sr) are recognized as non-unique -- raises ValueError, not a
    # silently-picked single winner.
    results = _baseline_benchmark_results(baseline, burden, uncertainty, exact_set)
    a, b = pair_names
    lam = break_even_lambda(results[a], results[b])
    with pytest.raises(ValueError, match="no unique preferred strategy"):
        preferred_strategy_at_lambda(results, lam)


def test_preferred_strategy_at_lambda_raise_is_independent_of_dict_iteration_order(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig, exact_set
) -> None:
    # regression #3: behavior AT a tie -- raising, and the identified
    # co-optimal set within the exception message -- is independent of dict
    # insertion order (contrast with the pre-fix behavior, where different
    # orderings silently returned different single "winners").
    results = _baseline_benchmark_results(baseline, burden, uncertainty, exact_set)
    lam = break_even_lambda(results["cost_concentration"], results["diversified"])

    forward_order = {
        "cost_concentration": results["cost_concentration"],
        "diversified": results["diversified"],
        "speed_reliability": results["speed_reliability"],
    }
    reversed_order = {
        "diversified": results["diversified"],
        "cost_concentration": results["cost_concentration"],
        "speed_reliability": results["speed_reliability"],
    }

    with pytest.raises(ValueError) as forward_exc:
        preferred_strategy_at_lambda(forward_order, lam)
    with pytest.raises(ValueError) as reversed_exc:
        preferred_strategy_at_lambda(reversed_order, lam)

    # both orderings raise, and identify the SAME co-optimal set -- not two
    # different single "winners" as the pre-fix behavior would have.
    assert str(forward_exc.value) == str(reversed_exc.value)


# --- deadline sweep ----------------------------------------------------


def test_deadline_sweep_explains_pmeet_crossing_as_target_month_moves(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    from trackc.model.schemas import load_model_defaults

    defaults = load_model_defaults("configs/model_defaults.yaml")
    cc = cost_concentration_allocation(baseline)
    sr = speed_reliability_allocation(baseline, burden, uncertainty)
    sweep = deadline_sweep(
        baseline,
        {"cc": cc, "sr": sr},
        burden,
        uncertainty,
        defaults,
        target_months=[24, 36, 48, 60],
    )

    # cost_concentration (all on A, tau2_bar=42): P_meet is 0 until T* passes
    # A's tau2 under the realized delay, then rises as later T* absorbs more
    # of A's own delay outcomes -- hand-verified: 0.0, 0.0, 0.4, 1.0.
    cc_pmeet = [sweep[t]["cc"].p_meet for t in (24, 36, 48, 60)]
    assert cc_pmeet == pytest.approx([0.0, 0.0, 0.4, 1.0])
    # non-decreasing in T* (later deadline can only leave more time to
    # deliver, a model validation invariant's monotonicity applied to T*).
    assert all(b >= a for a, b in zip(cc_pmeet, cc_pmeet[1:]))

    # speed_reliability (C+B, tau2_bar 24/30): already meets D by T*=36 in
    # every realization; stays at 1.0 as T* moves later still.
    sr_pmeet = [sweep[t]["sr"].p_meet for t in (36, 48, 60)]
    assert sr_pmeet == pytest.approx([1.0, 1.0, 1.0])

    # the ranking (which strategy has higher P_meet) flips between T*=24
    # (tied at 0) and T*=36 (sr pulls ahead) -- a mathematically explainable
    # crossing driven by C/B's earlier tau2_bar than A's.
    assert sweep[24]["sr"].p_meet == sweep[24]["cc"].p_meet == pytest.approx(0.0)
    assert sweep[36]["sr"].p_meet > sweep[36]["cc"].p_meet


# --- mapping sensitivity (model spec) ------------------------------
#
# Mapping sensitivity holds every site's B_i/U_i state ASSIGNMENT fixed and
# swaps the mapping CONFIGURATION instead -- see test_uncertainty_state_sweep_*
# below for the conceptually distinct "uncertainty sweep" (fixed mapping,
# varied state assignment).


def test_mapping_sensitivity_sweep_shows_a_synthetic_baseline_fixture_result_that_is_not_robust(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    from trackc.model.schemas import load_model_defaults

    defaults = load_model_defaults("configs/model_defaults.yaml")
    stretched_burden = load_burden_states("configs/burden_states_stretched.yaml")
    cc = cost_concentration_allocation(baseline)
    sr = speed_reliability_allocation(baseline, burden, uncertainty)

    sweep = mapping_sensitivity_sweep(
        baseline,
        {"cc": cc, "sr": sr},
        burden_configs={"baseline": burden, "stretched": stretched_burden},
        uncertainty_configs={"baseline": uncertainty, "stretched": uncertainty},
        defaults=defaults,
    )

    # This is a SYNTHETIC baseline-fixture sensitivity result (the model
    # specification), not a general or empirical claim: on THIS baseline scenario, under
    # a +-10% burden-timing mapping variant, "sr always meets the baseline
    # deadline" is NOT robust -- hand-derived P(meet | stretched) =
    # P(delta_C in {0,6}) * P(delta_B in {0,3}) = 0.90 * 0.95 = 0.855 (see
    # module docstring derivation).
    assert sweep["baseline"]["sr"].p_meet == pytest.approx(1.0)
    assert sweep["stretched"]["sr"].p_meet == pytest.approx(0.855)

    # cost_concentration's P_meet=0 finding is unaffected either way (A is so
    # far from meeting D at T*=36 that a 10% shift in its own tau2 doesn't
    # change the qualitative outcome) -- also scoped to this one fixture.
    assert sweep["baseline"]["cc"].p_meet == pytest.approx(0.0)
    assert sweep["stretched"]["cc"].p_meet == pytest.approx(0.0)


def test_mapping_sensitivity_sweep_rejects_mismatched_variant_names(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    from trackc.model.schemas import load_model_defaults

    defaults = load_model_defaults("configs/model_defaults.yaml")
    with pytest.raises(ValueError, match="same variant"):
        mapping_sensitivity_sweep(
            baseline,
            {"cc": cost_concentration_allocation(baseline)},
            burden_configs={"baseline": burden},
            uncertainty_configs={"stretched": uncertainty},
            defaults=defaults,
        )


# --- uncertainty sweep -----------------------------------------------------
#
# Distinct from mapping sensitivity above: holds the uncertainty MAPPING
# fixed (v1-baseline throughout) and instead varies which U_i state a site is
# ASSIGNED. No correlation is introduced -- each variant still evaluates
# through the unmodified, independent scenario engine.


def test_uncertainty_state_sweep_holds_mapping_fixed_while_varying_site_assignment(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    from trackc.model.schemas import load_model_defaults

    defaults = load_model_defaults("configs/model_defaults.yaml")
    sr = speed_reliability_allocation(baseline, burden, uncertainty)

    # B's uncertainty state bumped from U=1 (delays [0,3,6] p=[.80,.15,.05])
    # to U=3 (delays [0,9,18] p=[.40,.35,.25]) -- same v1-baseline MAPPING
    # (uncertainty_config) passed for every variant, only the site's own
    # state assignment changes.
    sweep = uncertainty_state_sweep(
        baseline,
        {"sr": sr},
        burden,
        uncertainty,
        defaults,
        site_uncertainty_variants={"baseline": {}, "B_worse": {"B": 3}},
    )

    # baseline (unmodified) matches the mapping-sensitivity test's baseline
    # P_meet exactly -- same scenario, same allocation, same mapping.
    assert sweep["baseline"]["sr"].p_meet == pytest.approx(1.0)

    # hand-derived: with B at U=3, B is only full at t=36 when delta_B=0
    # (tau2_B = 30+0 = 30 <= 36); delta_B in {9,18} -> tau2_B in {39,48} > 36
    # -> B only in tranche 1 (150 MW) -> C(250)+B(150)=400 < D=500 -> miss.
    # C is unaffected (U=2 unchanged) and always full by t=36 regardless of
    # delta_C (worst case tau2_C=24+12=36, boundary "t<tau2" is false at
    # t=36 -> full). P(meet) = P(delta_B=0) = 0.40.
    assert sweep["B_worse"]["sr"].p_meet == pytest.approx(0.40)

    # every variant is still built through the unmodified, independent
    # scenario engine -- exact enumeration, same method/mapping.
    assert sweep["baseline"]["sr"].method == "exact"
    assert sweep["B_worse"]["sr"].method == "exact"
    assert sweep["baseline"]["sr"].uncertainty_mapping_version == uncertainty.mapping_version
    assert sweep["B_worse"]["sr"].uncertainty_mapping_version == uncertainty.mapping_version


def test_uncertainty_state_sweep_leaves_sites_not_named_in_overrides_unchanged(
    baseline: Scenario, burden: BurdenStateConfig, uncertainty: UncertaintyStateConfig
) -> None:
    from trackc.model.schemas import load_model_defaults

    defaults = load_model_defaults("configs/model_defaults.yaml")
    cc = cost_concentration_allocation(baseline)  # x={A:500}; A's own U is untouched below

    sweep = uncertainty_state_sweep(
        baseline,
        {"cc": cc},
        burden,
        uncertainty,
        defaults,
        site_uncertainty_variants={"B_and_C_only": {"B": 4, "C": 4}},
    )
    # cost_concentration only allocates to A, whose U is not in the override
    # dict -- A's own P_meet/E[L] must be identical to the unmodified
    # baseline (site_availability for A is untouched by this sweep).
    from trackc.model.scenario_engine import enumerate_exact

    unmodified = evaluate_strategy(
        baseline, cc, enumerate_exact(baseline, uncertainty), burden, uncertainty, alpha=ALPHA
    )
    assert sweep["B_and_C_only"]["cc"].p_meet == pytest.approx(unmodified.p_meet)
    assert sweep["B_and_C_only"]["cc"].expected_delay_burden_mw_months == pytest.approx(
        unmodified.expected_delay_burden_mw_months
    )
