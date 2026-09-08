/**
 * Editable working copy of a synthetic scenario for the Decision page's
 * interactive path.
 *
 * The draft holds raw string inputs so the user can type freely; on submit
 * `validateDraft` performs INPUT-LEVEL checks only (present, numeric, in
 * range, ids unique) and produces a typed `Scenario` payload. It does NOT
 * decide model feasibility, `x_i <= K_i`, or anything the engine owns —
 * that comes back from the authoritative API. The engine / API re-validate
 * everything.
 */

import type { Scenario, SiteConfig } from "../types/showcase";

/** Public-application UI cap (deployment policy, not a model limit). */
export const MAX_UI_SITES = 12;

export interface SiteDraft {
  id: string;
  capacity_mw: string;
  cost_per_mw: string;
  /** 1..4 ordinal identifier once chosen; 0 means "not yet selected" on a
   * blank row — never used arithmetically, and it fails validation so a
   * blank row cannot silently stand in for a complete scenario. */
  burden_state: number;
  /** 1..4 ordinal identifier once chosen; 0 means "not yet selected". */
  uncertainty_state: number;
}

/** Sentinel for a per-site select the user has not touched yet. */
export const STATE_UNSET = 0;

export interface ScenarioDraft {
  system: {
    required_capacity_mw: string;
    target_month: string;
    /** Carried from the source preset; not user-editable in v1. */
    horizon_month: number;
    lambda_mw_month: string;
  };
  sites: SiteDraft[];
}

/**
 * The scenario a fresh visitor lands on: nothing filled in. The requirement
 * fields are empty, and three site rows are shown with their labels (A, B,
 * C) but no values, so the structure of the problem is visible without any
 * number standing in for a choice the visitor has not made. Loading a
 * worked example is always a deliberate action, never the initial state.
 */
export function blankDraft(): ScenarioDraft {
  return {
    system: {
      required_capacity_mw: "",
      target_month: "",
      horizon_month: 72,
      lambda_mw_month: "",
    },
    sites: [blankSite("A"), blankSite("B"), blankSite("C")],
  };
}

function blankSite(id: string): SiteDraft {
  return {
    id,
    capacity_mw: "",
    cost_per_mw: "",
    burden_state: STATE_UNSET,
    uncertainty_state: STATE_UNSET,
  };
}

export function draftFromScenario(s: Scenario): ScenarioDraft {
  return {
    system: {
      required_capacity_mw: String(s.system.required_capacity_mw),
      target_month: String(s.system.target_month),
      horizon_month: s.system.horizon_month,
      lambda_mw_month: String(s.system.lambda_mw_month),
    },
    sites: s.sites.map((site) => ({
      id: site.id,
      capacity_mw: String(site.capacity_mw),
      cost_per_mw: String(site.cost_per_mw),
      burden_state: site.burden_state,
      uncertainty_state: site.uncertainty_state,
    })),
  };
}

export function nextSiteId(existing: string[]): string {
  const singleLetters = existing.every((id) => /^[A-Z]$/.test(id));
  if (singleLetters && existing.length < 26) {
    for (let c = 65; c < 91; c += 1) {
      const letter = String.fromCharCode(c);
      if (!existing.includes(letter)) return letter;
    }
  }
  let n = existing.length + 1;
  while (existing.includes(`S${String(n).padStart(2, "0")}`)) n += 1;
  return `S${String(n).padStart(2, "0")}`;
}

export function addSite(draft: ScenarioDraft): ScenarioDraft {
  if (draft.sites.length >= MAX_UI_SITES) return draft;
  const id = nextSiteId(draft.sites.map((s) => s.id));
  return { ...draft, sites: [...draft.sites, blankSite(id)] };
}

export function removeSite(draft: ScenarioDraft, index: number): ScenarioDraft {
  if (draft.sites.length <= 1) return draft;
  return { ...draft, sites: draft.sites.filter((_, i) => i !== index) };
}

export interface PortfolioFeasibilityGap {
  /** D — required usable capacity (MW). */
  requiredCapacityMw: number;
  /** Σ Kᵢ — total developable capacity across all sites (MW). */
  totalDevelopableMw: number;
  /** D − Σ Kᵢ (> 0 when the portfolio cannot physically meet D). */
  gapMw: number;
}

export interface DraftValidation {
  ok: boolean;
  errors: string[];
  scenario?: Scenario;
  /** Set when Σ Kᵢ < D: a presentation-layer pre-check of the
   * capacity-feasibility condition. When present, `ok` is false and the
   * caller must block "Run analysis". The API re-checks this independently. */
  feasibility?: PortfolioFeasibilityGap;
}

function toNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function validateDraft(draft: ScenarioDraft): DraftValidation {
  const errors: string[] = [];

  const D = toNumber(draft.system.required_capacity_mw);
  const T = toNumber(draft.system.target_month);
  const lam = toNumber(draft.system.lambda_mw_month);
  const H = draft.system.horizon_month;

  if (D === null || D <= 0)
    errors.push("Enter a required capacity greater than 0 MW.");
  if (T === null || !Number.isInteger(T) || T <= 0)
    errors.push("Enter a target date as a whole month number.");
  if (T !== null && Number.isInteger(T) && T >= H)
    errors.push(`Enter a target date before month ${H}, the end of the modeled horizon.`);
  if (lam === null || lam < 0)
    errors.push("Enter a delay consequence of 0 or more.");

  if (draft.sites.length < 1) errors.push("Add at least one candidate site.");
  if (draft.sites.length > MAX_UI_SITES)
    errors.push(`This tool takes at most ${MAX_UI_SITES} candidate sites.`);

  const ids = draft.sites.map((s) => s.id.trim());
  if (new Set(ids).size !== ids.length) errors.push("Give each site a different name.");

  const sites: SiteConfig[] = [];
  draft.sites.forEach((s, i) => {
    const label = s.id.trim() || `Site ${i + 1}`;
    if (!s.id.trim()) errors.push(`Give site ${i + 1} a name.`);
    const K = toNumber(s.capacity_mw);
    const c = toNumber(s.cost_per_mw);
    if (K === null || K <= 0)
      errors.push(`${label}: enter a capacity greater than 0 MW.`);
    if (c === null || c < 0)
      errors.push(`${label}: enter a relative cost per MW of 0 or more.`);
    if (![1, 2, 3, 4].includes(s.burden_state))
      errors.push(`${label}: choose a power-delivery complexity level.`);
    if (![1, 2, 3, 4].includes(s.uncertainty_state))
      errors.push(`${label}: choose a schedule uncertainty level.`);
    if (K !== null && c !== null) {
      sites.push({
        id: s.id.trim(),
        capacity_mw: K,
        cost_per_mw: c,
        burden_state: s.burden_state,
        uncertainty_state: s.uncertainty_state,
      });
    }
  });

  // Presentation-layer pre-check of the capacity-feasibility condition
  // (Σ Kᵢ < D). Reported separately from `errors` so the UI
  // can render it as a neutral feasibility notice, not a red input error.
  // The API re-checks this condition independently and authoritatively.
  const sigmaK = totalCapacity(draft);
  let feasibility: PortfolioFeasibilityGap | undefined;
  if (D !== null && sigmaK !== null && sigmaK < D) {
    feasibility = {
      requiredCapacityMw: D,
      totalDevelopableMw: sigmaK,
      gapMw: D - sigmaK,
    };
  }

  if (
    errors.length > 0 ||
    feasibility !== undefined ||
    D === null ||
    T === null ||
    lam === null
  ) {
    return { ok: false, errors, feasibility };
  }

  return {
    ok: true,
    errors: [],
    scenario: {
      system: {
        required_capacity_mw: D,
        target_month: T,
        horizon_month: H,
        lambda_mw_month: lam,
      },
      sites,
    },
  };
}

/** Total developable capacity — a plain sum of user inputs, for an
 * inline "does the total even reach the requirement?" hint. Not a model
 * quantity: the engine's `feasibility_status` is the authoritative answer. */
export function totalCapacity(draft: ScenarioDraft): number | null {
  let sum = 0;
  for (const s of draft.sites) {
    const k = toNumber(s.capacity_mw);
    if (k === null) return null;
    sum += k;
  }
  return sum;
}

/** Running total for the builder's plain-language capacity line. Tolerates
 * a partly-filled portfolio: sums only the site rows that carry a number so
 * far, and reports how many that is. Presentation only. */
export function enteredCapacity(draft: ScenarioDraft): {
  sum: number;
  filled: number;
  total: number;
} {
  let sum = 0;
  let filled = 0;
  for (const s of draft.sites) {
    const k = toNumber(s.capacity_mw);
    if (k !== null) {
      sum += k;
      filled += 1;
    }
  }
  return { sum, filled, total: draft.sites.length };
}
