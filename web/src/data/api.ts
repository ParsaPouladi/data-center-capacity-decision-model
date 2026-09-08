/**
 * Client for the live Tier-2 API (src/trackc_app/api.py).
 *
 * Origin resolution:
 *   - Local dev / `vite preview`: `VITE_API_BASE_URL` is unset, so requests
 *     go to the same-origin path `/api` and Vite proxies them to the local
 *     FastAPI service (see web/vite.config.ts).
 *   - Staging / production (Cloudflare Pages + Render are different origins):
 *     the build receives `VITE_API_BASE_URL` = the API origin
 *     (e.g. `https://<service>.onrender.com`); requests then go to
 *     `<origin>/api/...`. The API grants CORS only to the exact deployed
 *     frontend origin(s). A blank or malformed value falls back to `/api`,
 *     so a misconfigured build degrades to "Tier 2 unavailable" rather than
 *     calling a wrong host.
 *
 * This module only sends the user's edited scenario / allocation and
 * returns the engine's authoritative response verbatim. It performs NO
 * model arithmetic: no J, no P_meet, no E[L], no feasibility, no power
 * profiles. The `/compare` and `/optimize` responses are the same
 * `ShowcaseExport` shape the static JSON uses (with `lambda_envelope`
 * always null — the full envelope is precomputed-only).
 */

import type {
  ApplicationMetadata,
  Provenance,
  Scenario,
  ScenarioSetSummary,
  ShowcaseExport,
  SiteAllocation,
  StrategyResult,
} from "../types/showcase";

/** Resolve the API base once at module load. `VITE_API_BASE_URL` should be a
 * bare origin; anything that is not a valid absolute http(s) URL is ignored
 * and the same-origin `/api` path (dev proxy) is used instead. */
function resolveApiBase(): string {
  const raw = import.meta.env.VITE_API_BASE_URL?.trim();
  if (!raw) return "/api";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/api";
    return `${url.origin}/api`;
  } catch {
    return "/api";
  }
}

const API_BASE = resolveApiBase();

export interface VersionInfo {
  trackc_version: string;
  application_layer: string;
  api: string;
  burden_mapping_version: string;
  uncertainty_mapping_version: string;
  mapping_version: string;
  git_commit: string | null;
}

export interface EvaluateResponse {
  provenance: Provenance;
  application_metadata: ApplicationMetadata;
  scenario: Scenario;
  scenario_set: ScenarioSetSummary;
  allocation_input: SiteAllocation;
  evaluation: StrategyResult;
}

export interface GuardrailBody {
  error: "public_app_guardrail";
  reason: string;
  message: string;
  max_sites?: number;
  n_sites?: number;
  available?: string[];
}

/** The capacity-feasibility condition — the required capacity D exceeds Σ Kᵢ,
 * so there is no allocation to optimize. `/optimize` returns this
 * domain-specific envelope;
 * `/compare` and `/evaluate` instead report it in-band as
 * `feasibility_status: "system_insufficient"`. */
export interface SystemInsufficientBody {
  error: "system_insufficient";
  message: string;
  required_capacity_mw?: number;
  total_developable_capacity_mw?: number;
}

export type ApiResult<T> =
  | { kind: "ok"; data: T }
  | { kind: "guardrail"; status: number; body: GuardrailBody }
  | { kind: "system_insufficient"; status: number; body: SystemInsufficientBody }
  | { kind: "error"; status: number; message: string };

async function requestJson<T>(
  path: string,
  init: RequestInit,
): Promise<ApiResult<T>> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      kind: "error",
      status: 0,
      message: `Could not reach the analysis service (${message}).`,
    };
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.ok) {
    return { kind: "ok", data: payload as T };
  }
  if (
    res.status === 409 &&
    payload &&
    typeof payload === "object" &&
    (payload as GuardrailBody).error === "public_app_guardrail"
  ) {
    return { kind: "guardrail", status: res.status, body: payload as GuardrailBody };
  }
  if (
    payload &&
    typeof payload === "object" &&
    (payload as SystemInsufficientBody).error === "system_insufficient"
  ) {
    return {
      kind: "system_insufficient",
      status: res.status,
      body: payload as SystemInsufficientBody,
    };
  }
  const message =
    payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message: unknown }).message)
      : `Request failed (${res.status} ${res.statusText}).`;
  return { kind: "error", status: res.status, message };
}

function postJson<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return requestJson<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getVersion(): Promise<ApiResult<VersionInfo>> {
  return requestJson<VersionInfo>("/version", { method: "GET" });
}

/** One numeric input's authoritative public domain. `max: null` means there
 * is NO authoritative upper bound — the editor must not invent one. */
export interface NumericInputDomain {
  min: number;
  max: number | null;
  min_exclusive?: boolean;
  integer?: boolean;
  must_be_less_than?: string;
  editable?: boolean;
  authority?: string;
}

export interface InputDomain {
  required_capacity_mw: NumericInputDomain;
  target_month: NumericInputDomain;
  lambda_mw_month: NumericInputDomain;
  site_capacity_mw: NumericInputDomain;
  site_cost_per_mw: NumericInputDomain;
  burden_state: { allowed: number[] };
  uncertainty_state: { allowed: number[] };
  n_sites: NumericInputDomain;
  horizon_month: NumericInputDomain;
  relations: string[];
  note: string;
}

export interface PublicAppPolicy {
  max_sites: number;
  live_optimization_max_sites: number;
  max_request_bytes: number;
  max_horizon_month: number;
  input_domain: InputDomain;
  note: string;
}

export interface PublicAppConfig {
  public_app_policy: PublicAppPolicy;
  [key: string]: unknown;
}

export function getConfig(): Promise<ApiResult<PublicAppConfig>> {
  return requestJson<PublicAppConfig>("/p1/config", { method: "GET" });
}

export function postCompare(
  scenario: Scenario,
): Promise<ApiResult<ShowcaseExport>> {
  return postJson<ShowcaseExport>("/p1/compare", scenario);
}

export function postOptimize(
  scenario: Scenario,
): Promise<ApiResult<ShowcaseExport>> {
  return postJson<ShowcaseExport>("/p1/optimize", scenario);
}

export function postEvaluate(
  scenario: Scenario,
  allocation: SiteAllocation,
): Promise<ApiResult<EvaluateResponse>> {
  return postJson<EvaluateResponse>("/p1/evaluate", {
    scenario,
    allocation: { by_site: allocation },
  });
}
