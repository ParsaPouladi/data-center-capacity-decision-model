"""Strategy comparator and decision-boundary analysis (see the model
specification): canonical benchmark strategies, the concentration metric,
dominance/Pareto comparison, break-even lambda and global switching
boundaries, and parameter sweeps (deadline, uncertainty, mapping
sensitivity) over :func:`~trackc.model.evaluator.evaluate_strategy`.

This module adds no new state variable, risk penalty, or objective term --
every comparison here reads the evaluator's
:class:`~trackc.model.evaluator.StrategyResult`
fields (``development_cost``, ``expected_delay_burden_mw_months``, ``p_meet``,
``objective``) or a resolved physical parameter (``tau2_bar``,
``E[delta_i]``). Optimization (searching `x` for a minimal-J allocation)
lives in :mod:`trackc.model.optimizer` and is not implemented here -- the
three benchmark strategies below are heuristic constructions (the model
specification), not search results, and are documented as synthetic devices, not
empirical claims.

**Uncertainty sweeps are conceptually distinct from mapping sensitivity**,
even though the model specification allows an uncertainty-spread change as one
*example* of mapping sensitivity -- they are separate items, so this
module keeps them as two separate functions, never conflated:

* :func:`uncertainty_state_sweep` -- an **uncertainty sweep**: varies which
  ``U_i`` state each site is *assigned* (the model specification's per-site input),
  holding the uncertainty *mapping* (``UncertaintyStateConfig``, e.g.
  ``v1-baseline``) fixed. This asks "what if this site's own delay-risk
  profile were different?"
* :func:`mapping_sensitivity_sweep` -- **mapping sensitivity** (the model
  specification): holds every site's ``B_i``/``U_i`` state *assignments* fixed, and
  instead swaps in an alternative *mapping configuration* (compressed /
  baseline / stretched, +-10% timing or delay-spread). This asks "what if
  the synthetic mapping table itself were calibrated differently?"

Neither sweep introduces cross-site correlation -- site delays remain
independent throughout (``docs/assumptions.md``; FROZEN for v1). Any
diversification-related interpretation drawn from this module's output
(e.g. that a diversified strategy's `P_meet` is less sensitive to any one
site's realized delay) is conditional on that v1 independence assumption and
must be re-tested under a correlated-delay variant before being treated as
robust -- that stress test is DEFERRED, not performed here.
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from trackc.model.evaluator import StrategyResult, evaluate_strategy
from trackc.model.mappings import resolve_burden, resolve_uncertainty
from trackc.model.scenario_engine import build_scenario_set
from trackc.model.schemas import (
    Allocation,
    BurdenStateConfig,
    ModelDefaults,
    Scenario,
    Site,
    UncertaintyStateConfig,
)

# ---------------------------------------------------------------------------
# Concentration metric (model spec) -- an analytical descriptor only,
# never part of the objective.
# ---------------------------------------------------------------------------


def concentration_metric(
    allocation: Allocation, site_ids: Sequence[str]
) -> tuple[dict[str, float], float]:
    """``w_i = x_i / sum_j x_j`` and ``HHI_x = sum_i w_i^2`` (model spec).

    Returns ``({site_id: w_i}, HHI_x)``. If every ``x_i`` is 0 (no capacity
    allocated to concentrate), weights and ``HHI_x`` are both 0.0 rather than
    dividing by zero.
    """
    x = np.array([allocation.by_site.get(sid, 0.0) for sid in site_ids], dtype=np.float64)
    total = float(x.sum())
    if total <= 0.0:
        return {sid: 0.0 for sid in site_ids}, 0.0
    w = x / total
    weights = dict(zip(site_ids, w.tolist(), strict=True))
    hhi = float(np.sum(w**2))
    return weights, hhi


# ---------------------------------------------------------------------------
# Canonical benchmark strategies (model spec) -- heuristic allocation
# constructions, documented as synthetic devices, not search results.
# ---------------------------------------------------------------------------


def _fill_by_priority(scenario: Scenario, priority: Sequence[str]) -> Allocation:
    """Allocate ``x_i = min(K_i, remaining need)`` to sites in ``priority``
    order until ``sum_i x_i >= D`` or every site's ``K_i`` is exhausted.
    Shared by the three benchmark builders below -- they differ only in how
    they order the sites, not in how they fill once ordered.
    """
    capacities = {s.id: s.capacity_mw for s in scenario.sites}
    remaining = scenario.system.required_capacity_mw
    by_site: dict[str, float] = {}
    for site_id in priority:
        if remaining <= 0:
            break
        take = min(capacities[site_id], remaining)
        by_site[site_id] = take
        remaining -= take
    return Allocation(by_site=by_site)


def cost_concentration_allocation(scenario: Scenario) -> Allocation:
    """Benchmark: "prioritize the lowest-cost capacity" (model spec).

    Fills sites in ascending ``cost_per_mw`` order until ``D`` is met -- the
    minimal-``C_dev`` feasible allocation under a greedy cheapest-first rule.
    """
    priority = [s.id for s in sorted(scenario.sites, key=lambda s: s.cost_per_mw)]
    return _fill_by_priority(scenario, priority)


def speed_reliability_allocation(
    scenario: Scenario,
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
) -> Allocation:
    """Benchmark: "prioritize favorable power-delivery and uncertainty
    states" (model spec).

    Exact ranking rule: sites are ordered by a **lexicographic (tuple)
    comparison** on ``(tau2_bar, E[delta_i])``, ascending -- ``tau2_bar`` is
    the *primary* key (earlier full-power month ranks first); ``E[delta_i]``
    only *breaks ties* on ``tau2_bar``, it is never combined with it. This is
    explicitly **not** a ratio, weighted sum, or any other composite score --
    no arithmetic combination of the two quantities is computed anywhere
    (e.g. never ``tau2_bar / E[delta_i]`` or ``a*tau2_bar + b*E[delta_i]``);
    Python's tuple comparison performs two independent, sequential
    comparisons. "Favorable" is read off each site's *resolved* physical
    parameters, never off the raw ``B_i``/``U_i`` integers (the model specification:
    states are lookup keys only, never used arithmetically -- and that
    includes using their raw ordering, or any function of them, as a ranking
    proxy).

    This ordering is a **benchmark-strategy heuristic** (model spec),
    not a model equation: it exists solely to construct one illustrative,
    reproducible comparison allocation for the comparator to evaluate
    alongside the other benchmarks and any arbitrary user allocation. It
    feeds nothing back into the objective ``J``, feasibility logic, or any
    other model computation -- changing this ranking rule would change
    which allocation this *one benchmark* represents, not any frozen model
    quantity.
    """

    def favorability(site: Site) -> tuple[float, float]:
        _, tau2_bar = resolve_burden(site.burden_state, burden_config)
        delays, probs = resolve_uncertainty(site.uncertainty_state, uncertainty_config)
        expected_delay = float(np.dot(delays, probs))
        return (tau2_bar, expected_delay)

    priority = [s.id for s in sorted(scenario.sites, key=favorability)]
    return _fill_by_priority(scenario, priority)


def diversified_allocation(scenario: Scenario) -> Allocation:
    """Benchmark: "allocate across multiple sites" (model spec).

    Spreads ``D`` proportionally to each site's own capacity ``K_i``:
    ``x_i = D * K_i / sum_j K_j``. Because every site's share is the *same*
    fraction ``D / sum_j K_j`` of its own ``K_i``, a partial cap (one site
    hits ``K_i`` while others don't) is mathematically impossible for this
    proportional-to-capacity rule -- either every site's share is within its
    own ``K_i`` simultaneously (``D < sum_j K_j``), or every site's share
    would meet-or-exceed its own ``K_i`` simultaneously (``D >= sum_j K_j``,
    the whole portfolio is then allocated at full capacity; feasibility --
    whether that's still short of ``D`` -- is
    :func:`~trackc.model.evaluator.evaluate_strategy`'s responsibility, spec
    section 25).
    """
    capacities = {s.id: s.capacity_mw for s in scenario.sites}
    target = scenario.system.required_capacity_mw
    total_capacity = sum(capacities.values())

    if total_capacity <= 0:
        return Allocation(by_site=dict.fromkeys(capacities, 0.0))
    if target >= total_capacity:
        return Allocation(by_site=dict(capacities))
    return Allocation(by_site={sid: target * k / total_capacity for sid, k in capacities.items()})


# ---------------------------------------------------------------------------
# Dominance / cost-risk tradeoff: "dominance comparisons", "cost-risk
# tradeoffs"
# ---------------------------------------------------------------------------


def dominates(a: StrategyResult, b: StrategyResult) -> bool:
    """``True`` if ``a`` weakly dominates ``b``: no worse in either component
    of the core objective (``development_cost``, ``expected_delay_burden_mw_months``
    -- the model specification's two additive terms, the only axes the frozen
    objective defines) and strictly better in at least one.
    """
    no_worse = (
        a.development_cost <= b.development_cost
        and a.expected_delay_burden_mw_months <= b.expected_delay_burden_mw_months
    )
    strictly_better = (
        a.development_cost < b.development_cost
        or a.expected_delay_burden_mw_months < b.expected_delay_burden_mw_months
    )
    return no_worse and strictly_better


def pareto_frontier(results: Sequence[StrategyResult]) -> list[StrategyResult]:
    """Strategies in ``results`` not dominated by any other in ``results`` --
    the cost/expected-delay-burden tradeoff frontier. Order is preserved
    from the input.
    """
    return [
        r for r in results if not any(dominates(other, r) for other in results if other is not r)
    ]


# ---------------------------------------------------------------------------
# Break-even lambda (model spec)
# ---------------------------------------------------------------------------


def break_even_lambda(a: StrategyResult, b: StrategyResult) -> float | None:
    """``lambda*`` at which ``J_A(lambda) == J_B(lambda)`` (model spec):

        lambda* = (C_B - C_A) / (E[L_A] - E[L_B])

    Returns ``None`` when ``E[L_A] == E[L_B]`` (the two objectives are
    parallel lines in ``lambda`` -- no crossover exists; either the two
    strategies are tied at every ``lambda`` if ``C_A == C_B`` too, or one
    strictly dominates the other in cost alone at every ``lambda``).

    Any other value is returned as computed. Whether it is *economically*
    meaningful (``lambda* >= 0``, matching ``SystemInputs.lambda_mw_month``'s
    own ``>= 0`` constraint) is left to the caller to interpret -- a negative
    ``lambda*`` means the two strategies' objective lines cross only outside
    the model's valid ``lambda`` range, i.e. one strategy dominates the other
    for every ``lambda`` the model actually allows.

    **This is a PAIRWISE indifference point between exactly ``a`` and ``b``
    -- it is NOT, by itself, a claim that the GLOBALLY preferred strategy
    (the argmin of ``J`` over every candidate under consideration) switches
    at ``lambda*``.** A third strategy ``c`` can have a strictly lower
    ``J_c(lambda*)`` than both ``a`` and ``b`` at that exact ``lambda``, in
    which case ``a``/``b``'s crossing is invisible to anyone tracking only
    the globally preferred strategy -- see :func:`global_switching_boundaries`,
    which computes the actual ranking-switching points across a whole set of
    candidates, and ``tests/unit/test_comparator.py`` for a worked baseline
    example where exactly this happens.
    """
    delta_l = a.expected_delay_burden_mw_months - b.expected_delay_burden_mw_months
    if delta_l == 0.0:
        return None
    return (b.development_cost - a.development_cost) / delta_l


def co_optimal_strategies_at_lambda(
    results: dict[str, StrategyResult], lam: float, tol: float = 1e-9
) -> list[str]:
    """Every strategy in ``results`` whose ``J(lambda)`` (model spec) is
    tied for the minimum at this ``lambda``, within an absolute tolerance of
    ``tol`` -- i.e. every strategy actually on the lower envelope AT this
    exact ``lambda``, not just one of them.

    At a generic ``lambda`` this returns a single-element list. **At an
    exact break-even lambda** (model spec) between two or more
    strategies, it returns all of them: they are mathematically indifferent
    there (equal ``J``), and this function makes that indifference explicit
    rather than picking one. This is a read-only query over already-computed
    ``StrategyResult`` fields -- it changes no model quantity, formula, or
    FROZEN equation; it only reports which of the given strategies are tied.
    This is the analytical API for exact boundaries -- see
    :func:`preferred_strategy_at_lambda` for the single-answer query, which
    raises rather than guessing when this function would return more than
    one name.

    Order of the returned list matches ``results``' iteration order, not tie
    strength (there is no strength -- every returned name has the identical
    ``J``, within ``tol``).
    """
    j_by_name = {
        name: r.development_cost + lam * r.expected_delay_burden_mw_months
        for name, r in results.items()
    }
    best = min(j_by_name.values())
    return [name for name, j in j_by_name.items() if abs(j - best) <= tol]


def preferred_strategy_at_lambda(
    results: dict[str, StrategyResult], lam: float, tol: float = 1e-9
) -> str:
    """The name of the strategy in ``results`` with the (uniquely) lowest
    ``J(lambda) = C_dev + lambda * E[L]`` (model spec) at this specific
    ``lambda`` -- the GLOBAL preference among every candidate given, not a
    pairwise comparison.

    Internally calls :func:`co_optimal_strategies_at_lambda` with the same
    ``tol`` and returns its single result. **Raises ``ValueError`` if more
    than one strategy is co-optimal within ``tol``** -- most notably when
    ``lam`` equals a genuine :func:`break_even_lambda` between two or more
    strategies, where ``J`` is mathematically identical for more than one of
    them: a real indifference point, not a single preferred strategy. This
    function never silently picks one of several tied strategies (an earlier
    version did, via Python's ``min()``'s dict-iteration-order tie-break --
    that behavior has been removed as a presentation defect, not a model
    change: no equation, tolerance, or boundary calculation changed). At a
    genuine tie, use :func:`co_optimal_strategies_at_lambda` instead, which
    is designed to return the full indifference set rather than raise.

    This never raises for any ``lambda`` :func:`global_switching_boundaries`
    itself queries -- it deliberately samples each segment's interior
    *midpoint*, never a boundary/tie point, so a tie can only be encountered
    by a caller explicitly querying a boundary (or otherwise-coincidental)
    ``lambda`` directly.
    """
    co_optimal = co_optimal_strategies_at_lambda(results, lam, tol=tol)
    if len(co_optimal) > 1:
        raise ValueError(
            f"no unique preferred strategy at lambda={lam}: {sorted(co_optimal)} are "
            "co-optimal (tied within tolerance) -- this is a genuine indifference point "
            "(spec section 29), not a single preferred strategy. Use "
            "co_optimal_strategies_at_lambda() to get the full tied set instead of a "
            "single answer."
        )
    return co_optimal[0]


def global_switching_boundaries(
    results: dict[str, StrategyResult], lambda_max: float | None = None
) -> list[tuple[float, str]]:
    """The GLOBALLY preferred strategy -- lowest ``J(lambda)`` among every
    entry in ``results`` (model spec) -- as a piecewise function of
    ``lambda`` over ``[0, lambda_max]``. This is the actual "strategy
    ranking" the model has to explain ("why strategy rankings change"): a
    pairwise :func:`break_even_lambda` only locates where ONE
    pair ties -- it says nothing about whether a THIRD strategy in
    ``results`` is already preferred to both at that ``lambda``, and if so,
    that pairwise crossing is not a point where the *global* ranking changes
    at all.

    Returns a list of ``(lambda_at_which_this_segment_begins, strategy_name)``
    pairs, strictly increasing in ``lambda``, always starting at
    ``lambda=0.0``; consecutive segments with the same winner are collapsed
    into one, so every entry is a genuine switch of the globally preferred
    strategy. Only crossings among the given ``results`` are considered --
    this compares a *given, named* set of candidate strategies (the
    benchmarks, plus any arbitrary allocations the caller adds), not a search
    over allocation space (optimization lives in
    :mod:`trackc.model.optimizer`).

    **Each segment's ``strategy_name`` is the unique winner on the OPEN
    INTERIOR of that segment** (this function evaluates each segment at its
    *midpoint*, never at a boundary ``lambda`` itself). At every boundary
    ``lambda`` except possibly the first (``0.0``), the outgoing and
    incoming segments' strategies are, by construction, in an exact tie --
    that boundary IS a genuine :func:`break_even_lambda` between them, so
    ``J`` is mathematically identical for both there, not merely close. This
    function does not misrepresent that tie as belonging to one strategy;
    call :func:`co_optimal_strategies_at_lambda` with a returned boundary
    ``lambda`` to see both (or more) co-optimal strategies at that exact
    point explicitly.

    ``lambda_max`` defaults to ``1.1x`` the largest finite pairwise
    break-even ``lambda`` among ``results`` (or ``1.0`` if every pair is
    parallel / has no finite break-even) -- beyond every pairwise crossing,
    no candidate's relative ranking versus any other can change again for any
    larger ``lambda`` (each ``J`` is a straight line in ``lambda``: two lines
    that have already crossed do not cross a second time).
    """
    names = list(results)
    if len(names) <= 1:
        return [(0.0, names[0])] if names else []

    finite_break_evens = sorted(
        {
            lam
            for i, a in enumerate(names)
            for b in names[i + 1 :]
            if (lam := break_even_lambda(results[a], results[b])) is not None and lam > 0.0
        }
    )
    if lambda_max is None:
        lambda_max = finite_break_evens[-1] * 1.1 if finite_break_evens else 1.0

    boundaries = sorted({0.0, *[b for b in finite_break_evens if b < lambda_max], lambda_max})

    segments: list[tuple[float, str]] = []
    for start, end in zip(boundaries, boundaries[1:]):
        winner = preferred_strategy_at_lambda(results, (start + end) / 2.0)
        if not segments or segments[-1][1] != winner:
            segments.append((start, winner))
    return segments


# ---------------------------------------------------------------------------
# Parameter sweeps: "deadline sweeps", "uncertainty sweeps", "mapping
# sensitivity" (model spec). Uncertainty sweeps and
# mapping sensitivity are DELIBERATELY separate functions below -- see the
# module docstring for why they must not be conflated.
# ---------------------------------------------------------------------------


def deadline_sweep(
    scenario: Scenario,
    allocations: dict[str, Allocation],
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    defaults: ModelDefaults,
    target_months: Sequence[int],
) -> dict[int, dict[str, StrategyResult]]:
    """Evaluate every named allocation at every candidate ``T*`` in
    ``target_months``, holding sites/lambda/H/alpha fixed ("deadline
    sweeps"). Returns
    ``{target_month: {strategy_name: StrategyResult}}``.

    A fresh :class:`~trackc.model.scenario_engine.ScenarioSet` is built at
    each ``T*`` via the normal :func:`~trackc.model.scenario_engine.build_scenario_set`
    call -- ``T*`` does not itself change the delay distribution or
    ``scenario_count``, but this keeps each ``T*`` on its own independently
    constructed scenario set rather than assuming one is reusable across all.
    """
    results: dict[int, dict[str, StrategyResult]] = {}
    for t_star in target_months:
        swept_scenario = scenario.model_copy(
            update={"system": scenario.system.model_copy(update={"target_month": t_star})}
        )
        scenario_set = build_scenario_set(swept_scenario, uncertainty_config, defaults)
        results[t_star] = {
            name: evaluate_strategy(
                swept_scenario,
                allocation,
                scenario_set,
                burden_config,
                uncertainty_config,
                alpha=defaults.alpha,
            )
            for name, allocation in allocations.items()
        }
    return results


def uncertainty_state_sweep(
    scenario: Scenario,
    allocations: dict[str, Allocation],
    burden_config: BurdenStateConfig,
    uncertainty_config: UncertaintyStateConfig,
    defaults: ModelDefaults,
    site_uncertainty_variants: dict[str, dict[str, int]],
) -> dict[str, dict[str, StrategyResult]]:
    """**Uncertainty sweep** (distinct from "mapping sensitivity", see
    :func:`mapping_sensitivity_sweep` and the module docstring): evaluate
    every named allocation under alternative
    ``U_i`` state *assignments* for one or more sites, holding the
    uncertainty *mapping* (``uncertainty_config``, e.g. ``v1-baseline``)
    fixed throughout. This asks "what if this site's own delay-risk profile
    were different?" -- not "what if the mapping table itself were
    different?" (that is :func:`mapping_sensitivity_sweep`'s question).

    ``site_uncertainty_variants`` maps a variant name -> ``{site_id: U_i}``
    overrides; only the listed sites have their ``uncertainty_state``
    changed for that variant, every other site keeps its original
    ``scenario.sites`` assignment. ``U_i`` is still used purely as a lookup
    key into ``uncertainty_config`` (model spec) -- this sweep changes
    *which* discrete state is assigned, never performs arithmetic on the
    state number itself. Site delays remain independent throughout (no
    correlation is introduced by sweeping multiple sites' states in one
    variant -- each site's delay is still drawn/enumerated independently by
    the unmodified scenario engine). Returns
    ``{variant_name: {strategy_name: StrategyResult}}``.
    """
    results: dict[str, dict[str, StrategyResult]] = {}
    for variant_name, overrides in site_uncertainty_variants.items():
        swept_sites = [
            site.model_copy(update={"uncertainty_state": overrides[site.id]})
            if site.id in overrides
            else site
            for site in scenario.sites
        ]
        swept_scenario = scenario.model_copy(update={"sites": swept_sites})
        scenario_set = build_scenario_set(swept_scenario, uncertainty_config, defaults)
        results[variant_name] = {
            name: evaluate_strategy(
                swept_scenario,
                allocation,
                scenario_set,
                burden_config,
                uncertainty_config,
                alpha=defaults.alpha,
            )
            for name, allocation in allocations.items()
        }
    return results


def mapping_sensitivity_sweep(
    scenario: Scenario,
    allocations: dict[str, Allocation],
    burden_configs: dict[str, BurdenStateConfig],
    uncertainty_configs: dict[str, UncertaintyStateConfig],
    defaults: ModelDefaults,
) -> dict[str, dict[str, StrategyResult]]:
    """**Mapping sensitivity** (the model specification; distinct from "uncertainty
    sweeps", see :func:`uncertainty_state_sweep`
    and the module docstring): evaluate every named allocation under every
    named *mapping-configuration* variant, holding every site's ``B_i``/
    ``U_i`` state *assignments* fixed throughout (only the resolved
    ``(tau1_bar, tau2_bar)``/delay-distribution values the mapping produces
    for those same states change). This asks "what if the synthetic mapping
    table itself were calibrated differently?" (e.g. +-10% timing or
    delay-spread, the model specification's compressed/baseline/stretched examples)
    -- results are always synthetic baseline-fixture sensitivity checks, not
    general or empirical claims. ``burden_configs`` and ``uncertainty_configs``
    must share the same key set (the variant names, e.g.
    ``"compressed"``/``"baseline"``/``"stretched"``) -- pass the same config
    object for every variant on whichever axis (burden timing, uncertainty
    spread) is not being swept, to isolate the other. Returns
    ``{variant_name: {strategy_name: StrategyResult}}``.
    """
    if set(burden_configs) != set(uncertainty_configs):
        raise ValueError(
            "burden_configs and uncertainty_configs must share the same variant "
            f"names, got {sorted(burden_configs)} vs {sorted(uncertainty_configs)}"
        )
    results: dict[str, dict[str, StrategyResult]] = {}
    for variant, burden_config in burden_configs.items():
        uncertainty_config = uncertainty_configs[variant]
        scenario_set = build_scenario_set(scenario, uncertainty_config, defaults)
        results[variant] = {
            name: evaluate_strategy(
                scenario,
                allocation,
                scenario_set,
                burden_config,
                uncertainty_config,
                alpha=defaults.alpha,
            )
            for name, allocation in allocations.items()
        }
    return results
