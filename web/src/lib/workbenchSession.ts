/**
 * Session-scoped persistence for the scenario workbench.
 *
 * The application is a static multi-page build: following a Technical
 * Documentation link is a real navigation, so React state does not survive it.
 * Without this, a visitor who builds and analyzes a scenario, reads the
 * definition of the criterion, and comes back finds an empty worksheet.
 *
 * Deliberately small and deliberately session-scoped:
 *   - `sessionStorage`, so nothing outlives the browser tab. There is no
 *     reason for a scenario a visitor typed today to reappear next week.
 *   - Only DURABLE outcomes are written: an analyzed live result and a loaded
 *     example. Loading, error, unavailable, guardrail and insufficient-capacity
 *     states are transient reports about a request, not results, and are never
 *     restored as though they were.
 *   - Nothing here is authoritative. The stored showcase is the engine's own
 *     response, replayed verbatim; no model quantity is recomputed, adjusted
 *     or derived on the way in or out.
 *
 * Every read is defensive: a stored record from an older build, a quota
 * failure, or a browser with storage disabled all degrade to "no saved
 * scenario", never to a thrown error or a half-restored workbench.
 */

import type { ScenarioDraft } from "./scenarioDraft";
import type { LambdaEnvelope, ShowcaseExport } from "../types/showcase";

const STORAGE_KEY = "trackc.p1.workbench";

/** Bumped whenever the persisted shape changes; older records are dropped. */
const STORAGE_VERSION = 1;

/**
 * The bundled example the current draft came from, if any.
 *
 * `scenarioJson` is the normalized scenario the example ships with, which is
 * what decides whether the draft on screen is still that example (UI identity)
 * and whether the example's precomputed sensitivity still describes it.
 */
export interface LoadedExample {
  id: string;
  title: string;
  scenarioJson: string;
  /** The example's precomputed λ envelope, verbatim, or null if it has none. */
  envelope: LambdaEnvelope | null;
}

/** The subset of the analysis state that is a durable result. */
export type DurableAnalysis =
  | { status: "example"; showcase: ShowcaseExport; title: string }
  | { status: "ready"; showcase: ShowcaseExport; ranOptimize: boolean };

export interface PersistedWorkbench {
  draft: ScenarioDraft;
  interacted: boolean;
  /** The scenario the stored result was produced for, as normalized JSON. */
  analyzedJson: string | null;
  example: LoadedExample | null;
  analysis: DurableAnalysis | null;
}

interface StoredRecord extends PersistedWorkbench {
  v: number;
}

function storage(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Storage access can throw outright (blocked cookies, some privacy modes).
    return null;
  }
}

/** Persist the workbench, or clear the record when there is nothing to keep. */
export function saveWorkbench(state: PersistedWorkbench): void {
  const store = storage();
  if (!store) return;
  try {
    const record: StoredRecord = { v: STORAGE_VERSION, ...state };
    store.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Quota or serialization failure: persistence is a convenience, never a
    // precondition for the workbench working.
  }
}

export function clearWorkbench(): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isDurableAnalysis(value: unknown): value is DurableAnalysis {
  if (!value || typeof value !== "object") return false;
  const a = value as { status?: unknown; showcase?: unknown };
  if (a.status !== "example" && a.status !== "ready") return false;
  return !!a.showcase && typeof a.showcase === "object";
}

function isDraft(value: unknown): value is ScenarioDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as { system?: unknown; sites?: unknown };
  return (
    !!d.system && typeof d.system === "object" && Array.isArray(d.sites)
  );
}

/**
 * The saved workbench for this tab, or null when there is none, when it came
 * from an older build, or when it does not have the shape this build expects.
 */
export function loadWorkbench(): PersistedWorkbench | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearWorkbench();
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Partial<StoredRecord>;
  if (record.v !== STORAGE_VERSION) {
    clearWorkbench();
    return null;
  }
  if (!isDraft(record.draft)) {
    clearWorkbench();
    return null;
  }

  const analysis = isDurableAnalysis(record.analysis) ? record.analysis : null;
  // The analyzed-scenario identity and the result it belongs to are kept or
  // dropped together: a result without the scenario it was produced for could
  // not be checked against the draft on screen, which is precisely the check
  // that stops a stale result being shown as current.
  const analyzedJson =
    analysis && typeof record.analyzedJson === "string"
      ? record.analyzedJson
      : null;

  return {
    draft: record.draft,
    interacted: record.interacted === true,
    analyzedJson,
    example: normalizeExample(record.example),
    analysis: analyzedJson ? analysis : null,
  };
}

function normalizeExample(value: unknown): LoadedExample | null {
  if (!value || typeof value !== "object") return null;
  const e = value as Partial<LoadedExample>;
  if (
    typeof e.id !== "string" ||
    typeof e.title !== "string" ||
    typeof e.scenarioJson !== "string"
  ) {
    return null;
  }
  return {
    id: e.id,
    title: e.title,
    scenarioJson: e.scenarioJson,
    envelope: (e.envelope as LambdaEnvelope | undefined) ?? null,
  };
}
