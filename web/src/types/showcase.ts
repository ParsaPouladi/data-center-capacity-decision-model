/**
 * Structural types for the committed Tier-1 showcase exports
 * (web/public/data/*.json), produced by scripts/export_showcase_data.py via
 * src/trackc_app/service.py.
 *
 * These mirror the authoritative engine/application-service output exactly.
 * The frontend must never construct a value of these shapes from anything
 * other than a fetched export: no derived/recomputed model quantities in
 * the frontend.
 */

export type SiteAllocation = Record<string, number>;
export type CoordinateBounds = Record<string, [number, number]>;

export interface Provenance {
  trackc_version: string;
  burden_mapping_version: string;
  uncertainty_mapping_version: string;
  alpha: number;
  engine_max_exact_scenarios: number;
  engine_mc_samples: number;
  engine_random_seed: number;
  application_max_exact_scenarios: number;
  generated_by: string;
}

export interface CostPresentation {
  units: string;
  is_currency: boolean;
  reference_anchor: string;
}

export interface LambdaParameterMeta {
  interpretation: string;
}

export interface UncertaintyDisclosure {
  site_delays: string;
  synthetic: string;
  exact_vs_monte_carlo: string;
}

export interface CooptimalityDisclosure {
  note: string;
}

export interface ComputationGuardrails {
  live_optimization_max_sites: number;
  live_envelope_max_sites: number;
  live_optimization_rationale: string;
  precomputed_max_exact_scenarios: number;
  precomputed_scenario_method_policy: string;
}

export interface ApplicationMetadata {
  layer: string;
  cost_presentation: CostPresentation;
  lambda_parameter: LambdaParameterMeta;
  uncertainty_disclosure: UncertaintyDisclosure;
  cooptimality_disclosure: CooptimalityDisclosure;
  computation_guardrails: ComputationGuardrails;
}

export interface SystemConfig {
  required_capacity_mw: number;
  target_month: number;
  horizon_month: number;
  lambda_mw_month: number;
}

export interface SiteConfig {
  id: string;
  capacity_mw: number;
  cost_per_mw: number;
  /** Ordinal identifier only -- never used arithmetically (see the model specification). */
  burden_state: number;
  /** Ordinal identifier only -- never used arithmetically (see the model specification). */
  uncertainty_state: number;
}

export interface Scenario {
  system: SystemConfig;
  sites: SiteConfig[];
}

export interface ScenarioSetSummary {
  method: "exact" | "monte_carlo";
  n_realizations: number;
  /** Seed / sample bookkeeping. Present on the live API response and on
   * older test fixtures; the sanitized static example artifact omits it. */
  random_seed?: number | null;
  n_samples?: number | null;
  s_full?: number;
}

/**
 * One discrete schedule-delay outcome for a site: the realized delay in
 * months, its probability, the resulting tranche dates, and the engine's
 * step-function power-availability profile A_i(t) under that delay. Every
 * value is a direct `trackc` engine return (service.build_site_power_profiles);
 * the frontend never recomputes the step function.
 */
export interface SiteDeliveryOutcome {
  delay_months: number;
  probability: number;
  tau1: number;
  tau2: number;
  profile_mw: number[];
}

export interface SitePowerProfile {
  site_id: string;
  capacity_mw: number;
  burden_state: number;
  uncertainty_state: number;
  tau1_bar: number;
  tau2_bar: number;
  alpha: number;
  times: number[];
  outcomes: SiteDeliveryOutcome[];
}

/**
 * One evaluated allocation. The fields below the divider are the public
 * projection the sanitized static example artifact carries and the
 * redesigned pages read. The optional fields above are emitted by the live
 * API path and older test fixtures only; the static artifact drops them as
 * private (engine / mapping version ids, feasibility-status string, and
 * scenario-set seed / sample bookkeeping).
 */
export interface StrategyResult {
  model_version?: string;
  burden_mapping_version?: string;
  uncertainty_mapping_version?: string;
  site_ids?: string[];
  n_sites?: number;
  method?: "exact" | "monte_carlo";
  n_realizations?: number;
  random_seed?: number | null;
  n_samples?: number | null;
  feasibility_status?: string;

  allocation: SiteAllocation;
  development_cost: number;
  p_meet: number;
  expected_shortfall_mw: number;
  expected_delay_burden_mw_months: number;
  objective: number;
  times: number[];
  delivered_capacity_trajectory: number[];
}

export interface StrategySet {
  cost_concentration: StrategyResult;
  speed_reliability: StrategyResult;
  diversified: StrategyResult;
}

export interface PairwiseBreakEven {
  strategy_a: string;
  strategy_b: string;
  break_even_lambda: number;
}

export interface GlobalSwitchingBoundary {
  lambda_start: number;
  /** A single representative winner. When `co_optimal` has more than one
   * entry this is the first of a genuine indifference set (see the model
   * specification), not a claim of unique optimality. */
  strategy: string;
  /** Every benchmark co-optimal on this segment: one entry on the ordinary
   * unique-winner path, two or more at a full-interval indifference state.
   * Optional so a row from an older export (before this additive field) is
   * still safe to render — callers fall back to `[strategy]`. */
  co_optimal?: string[];
}

export interface DecisionBoundaries {
  pairwise_break_even_lambda: PairwiseBreakEven[];
  global_switching_boundaries: GlobalSwitchingBoundary[];
  /** True when two or more benchmarks share an identical J(lambda) over a
   * whole segment, so `strategy` on that segment is representative only. */
  global_switching_has_cooptimal_segments: boolean;
}

/**
 * The optimizer's returned allocation. `model_version` and the LP solver
 * diagnostics (`success` / `status` / `message` / `lp_objective`) are
 * emitted by the live API only; the sanitized static artifact keeps just
 * the fields the pages read.
 */
export interface OptimizerResult {
  model_version?: string;
  success?: boolean;
  status?: number;
  message?: string;
  lp_objective?: number;

  site_ids: string[];
  allocation: SiteAllocation;
  is_unique_within_tolerance: boolean;
  coordinate_bounds: CoordinateBounds;
  cooptimality_tolerance: number;
}

export interface Optimizer {
  at_lambda: number;
  result: OptimizerResult;
  evaluated: StrategyResult;
}

export interface EnvelopeVertex {
  /**
   * The λ this vertex was SOLVED at — a verification point, not the regime's
   * own extent. It matters publicly because `is_unique_within_tolerance` is a
   * property of that solve: a vertex first discovered by a crossing probe was
   * solved exactly at a located boundary, where a tie with the neighbouring
   * regime's allocation exists by construction and says nothing about the
   * regime's interior. Emitted as the string `"inf"` for the high-λ limiting
   * vertex, which is not solved at any finite λ.
   */
  lam?: number | string;
  is_x_hi?: boolean;
  allocation: SiteAllocation;
  strategy_result: StrategyResult;
  is_unique_within_tolerance: boolean;
  cooptimality_tolerance: number;
  coordinate_bounds: CoordinateBounds;
}

export interface EnvelopeBreakpoint {
  lam_estimate: number;
  tolerance: number;
  co_optimal_at_breakpoint: boolean;
  left_vertex_allocation: SiteAllocation;
  right_vertex_allocation: SiteAllocation;
  /** Diagnostic (cost, delay) pairs — live API / older fixtures only. */
  left_vertex_cost_delay?: [number, number];
  right_vertex_cost_delay?: [number, number];
}

/**
 * The precomputed λ envelope. The solver-diagnostic fields
 * (`n_lp_solves`, `max_recursion_depth_hit`, `unresolved_brackets`) and
 * the internal tolerance / anchor bookkeeping are emitted by the engine
 * but dropped from the sanitized static artifact; the pages read only the
 * regime geometry below.
 */
export interface LambdaEnvelope {
  l_min: number;
  lambda_anchor: number;
  terminal_breakpoint_lambda: number;
  vertices: EnvelopeVertex[];
  breakpoints: EnvelopeBreakpoint[];

  l_min_buffer?: number;
  x_hi_matches_terminal_vertex?: boolean;
  no_new_vertex_tolerance?: Record<string, number>;
  n_lp_solves?: number;
  max_recursion_depth_hit?: boolean;
  unresolved_brackets?: unknown[];
  x_hi?: EnvelopeVertex;
}

/**
 * The committed static example artifact (`web/public/data/<id>.json` under
 * a `showcase` key) and the live `/compare` / `/optimize` API response.
 * The static artifact is a sanitized projection — no provenance,
 * application/deployment metadata, or concentration diagnostics — so those
 * are not part of this shared shape.
 */
export interface ShowcaseExport {
  scenario: Scenario;
  scenario_set: ScenarioSetSummary;
  site_power_profiles: SitePowerProfile[];
  strategies: StrategySet;
  decision_boundaries: DecisionBoundaries;
  optimizer: Optimizer | null;
  lambda_envelope: LambdaEnvelope | null;
}

/**
 * `web/public/data/mappings.json` -- the burden and schedule-uncertainty
 * state-mapping tables for the public app. Sanitized of the private
 * provenance block and the `mapping_version` id; the state values
 * themselves are unchanged. Ordinal state ids are object
 * keys only; they are never used arithmetically.
 */
export interface BurdenStateDefinition {
  label: string;
  interpretation: string;
  tau1_bar: number;
  tau2_bar: number;
}

export interface UncertaintyStateDefinition {
  label: string;
  interpretation: string;
  delay_months: number[];
  probabilities: number[];
}

export interface MappingsBundle {
  kind: string;
  burden: { states: Record<string, BurdenStateDefinition> };
  uncertainty: { states: Record<string, UncertaintyStateDefinition> };
}

/** One entry in the public example menu (`index.json` `presets[]`, and the
 * `preset` key of each example file). */
export interface PresetMeta {
  file: string;
  id: string;
  title: string;
}

/** `web/public/data/index.json` -- the minimal example menu the frontend reads. */
export interface DataIndex {
  kind: string;
  mappings_file: string;
  presets: PresetMeta[];
}

export interface PresetExport {
  preset: PresetMeta;
  showcase: ShowcaseExport;
}
