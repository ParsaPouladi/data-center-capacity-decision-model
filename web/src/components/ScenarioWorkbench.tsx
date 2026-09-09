import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ScenarioEditor } from "./ScenarioEditor";
import { LargePortfolioNotice } from "./LargePortfolioNotice";
import { ProjectSpecificModelOffer } from "./ProjectSpecificModelOffer";
import {
  getConfig,
  getVersion,
  postCompare,
  postOptimize,
  type GuardrailBody,
  type InputDomain,
  type SystemInsufficientBody,
  type VersionInfo,
} from "../data/api";
import { fetchStaticJson } from "../data/fetchStaticJson";
import {
  blankDraft,
  draftFromScenario,
  validateDraft,
  type PortfolioFeasibilityGap,
  type ScenarioDraft,
} from "../lib/scenarioDraft";
import {
  clearWorkbench,
  loadWorkbench,
  saveWorkbench,
  type DurableAnalysis,
  type LoadedExample,
} from "../lib/workbenchSession";
import type { RawCapacityInputs } from "../lib/resultCase";
import { formatMw } from "../lib/format";
import type {
  DataIndex,
  MappingsBundle,
  PresetMeta,
  Scenario,
  ShowcaseExport,
} from "../types/showcase";

/**
 * The scenario builder: one editable scenario, analyzed on demand. Owns the
 * blank-first-load draft, the analysis state machine (optimize / compare /
 * load-example / clear), and the API probe. It renders the builder section
 * and then hands its result state to `children`, which draws the decision
 * journey (see `DecisionPage.tsx`).
 *
 * RESULT-TO-SCENARIO INTEGRITY. The single invariant this component exists to
 * hold is that a result is only ever shown as current when the draft on screen
 * is exactly the scenario that result was produced for. It is expressed once,
 * in `resultIsCurrent`, as an equality between the analyzed scenario's
 * normalized JSON and the draft's — never as "the draft is valid and differs",
 * which silently evaluates to "not stale" the moment an edit makes the draft
 * incomplete and lets a previous result reappear beside inputs that did not
 * produce it.
 *
 * Workbench state is also persisted per browser tab (`lib/workbenchSession`)
 * so following a Technical Documentation link and coming back does not
 * discard the scenario and its result.
 */

/** Portfolios up to this many sites get a live optimized allocation; larger
 * ones are still evaluated and compared strategy by strategy. The engine is
 * N-general; this bound is a public-build scope choice. */
const LIVE_OPTIMIZE_MAX_SITES = 3;

type ApiProbe =
  | { status: "checking" }
  | { status: "up"; info: VersionInfo }
  | { status: "down" };

export type Origin =
  | { kind: "blank" }
  | { kind: "example"; id: string; title: string }
  /** An example the visitor has since edited: no longer that example. */
  | { kind: "edited-example"; id: string; title: string };

export type Analysis =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "example"; showcase: ShowcaseExport; title: string }
  | { status: "ready"; showcase: ShowcaseExport; ranOptimize: boolean }
  | { status: "error"; message: string }
  /**
   * A bundled example could not be loaded, both attempts included. `meta` is
   * the example that failed, so the recovery action reloads exactly it — it
   * never falls back to analyzing the current draft. No raw browser error
   * text rides along; the message shown is composed at the render site.
   */
  | { status: "example_error"; meta: PresetMeta }
  | { status: "unavailable" }
  | { status: "guardrail"; body: GuardrailBody }
  | { status: "system_insufficient"; body: SystemInsufficientBody };

/** Everything the decision journey needs from the workbench's analysis state. */
export interface WorkbenchResult {
  analysis: Analysis;
  stale: boolean;
  origin: Origin;
  showcase: ShowcaseExport | null;
  rawCapacities: RawCapacityInputs;
  onRun: () => void;
  onClear: () => void;
  /**
   * Attach to the container that opens the result narrative. After a
   * successful user-initiated analysis the workbench moves the viewport and
   * programmatic focus here (see `pendingResultFocus`), so first-time users
   * are carried to the new result instead of leaving it below the fold.
   */
  resultRef: RefObject<HTMLDivElement | null>;
  /**
   * Set only while `analysis.status === "example_error"`: retries the exact
   * example that failed to load. `null` in every other state. Distinct from
   * `onRun` on purpose — retrying a failed example load must not analyze the
   * draft on screen.
   */
  onRetryExample: (() => void) | null;
}

function normalizedScenarioJson(scenario: Scenario): string {
  const v = validateDraft(draftFromScenario(scenario));
  return JSON.stringify(v.ok && v.scenario ? v.scenario : scenario);
}

/**
 * The envelope-defining identity of a scenario: every input `build_envelope()`
 * actually consumes, serialized in a stable order.
 *
 * `src/trackc/experiments/envelope.py` sets every solved λ explicitly and
 * documents that `scenario.system.lambda_mw_month` is ignored, because the
 * precomputed envelope is defined ACROSS λ. So two scenarios that differ only
 * in the delay consequence share one envelope identity, and a curated preset's
 * validated precomputed envelope still describes the portfolio after a
 * λ-only edit. Any change to an envelope-defining input — a site capacity or
 * cost, a site state, the requirement, the target date, the horizon, or site
 * membership — changes this identity, and the preset envelope stops applying.
 *
 * Built from the same `validateDraft` output as `normalizedScenarioJson`, so
 * the field order is fixed and two equal identities are byte-for-byte equal.
 */
function envelopeIdentity(scenario: Scenario): string {
  const { lambda_mw_month: _lambda, ...envelopeSystem } = scenario.system;
  return JSON.stringify({ system: envelopeSystem, sites: scenario.sites });
}

/** The envelope identity of a stored example's normalized scenario JSON, or
 * null when it cannot be parsed (a record from an older build). */
function exampleEnvelopeIdentity(scenarioJson: string): string | null {
  try {
    return envelopeIdentity(JSON.parse(scenarioJson) as Scenario);
  } catch {
    return null;
  }
}

/** The durable part of an analysis, or null when the state is transient. */
function durableAnalysis(analysis: Analysis): DurableAnalysis | null {
  if (analysis.status === "example") {
    return {
      status: "example",
      showcase: analysis.showcase,
      title: analysis.title,
    };
  }
  if (analysis.status === "ready") {
    return {
      status: "ready",
      showcase: analysis.showcase,
      ranOptimize: analysis.ranOptimize,
    };
  }
  return null;
}

export function ScenarioWorkbench({
  index,
  mappings,
  children,
}: {
  index: DataIndex | null;
  mappings: MappingsBundle | null;
  children: (result: WorkbenchResult) => ReactNode;
}) {
  // One restore attempt, at construction, so the first render already carries
  // the returning visitor's scenario rather than flashing a blank worksheet.
  const restored = useMemo(() => loadWorkbench(), []);

  const [draft, setDraft] = useState<ScenarioDraft>(
    () => restored?.draft ?? blankDraft(),
  );
  const [analysis, setAnalysis] = useState<Analysis>(
    () => restored?.analysis ?? { status: "idle" },
  );
  const [analyzedJson, setAnalyzedJson] = useState<string | null>(
    () => restored?.analyzedJson ?? null,
  );
  const [loadedExample, setLoadedExample] = useState<LoadedExample | null>(
    () => restored?.example ?? null,
  );
  const [exampleLoading, setExampleLoading] = useState<string | null>(null);
  // The builder starts blank; a fresh worksheet is not "wrong", so input
  // errors stay hidden until the visitor has actually edited something.
  const [interacted, setInteracted] = useState(restored?.interacted ?? false);

  // Post-analysis discoverability. A first-time user who submits a scenario
  // can miss that the completed result rendered below the fold. After a
  // SUCCESSFUL, USER-INITIATED analyze — not an example load, not a session
  // restore, not a failed or blocked run — the viewport and programmatic
  // focus are moved to the top of the result narrative and a polite
  // completion announcement is made. `pendingResultFocus` is armed in
  // `analyze()` and consumed once by the effect below when the ready result
  // has actually committed to the DOM.
  const resultRegionRef = useRef<HTMLDivElement | null>(null);
  const pendingResultFocus = useRef(false);
  const [completionAnnouncement, setCompletionAnnouncement] = useState("");

  const editDraft = (next: ScenarioDraft) => {
    setInteracted(true);
    setDraft(next);
    // Once inputs change the last result is no longer current, so the
    // "results are now available" announcement is withdrawn with it. A new
    // run re-arms it (see `analyze`).
    pendingResultFocus.current = false;
    setCompletionAnnouncement("");
  };

  const [api, setApi] = useState<ApiProbe>({ status: "checking" });
  const [inputDomain, setInputDomain] = useState<InputDomain | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersion().then((r) => {
      if (cancelled) return;
      setApi(r.kind === "ok" ? { status: "up", info: r.data } : { status: "down" });
    });
    getConfig().then((r) => {
      if (cancelled) return;
      setInputDomain(
        r.kind === "ok" ? r.data.public_app_policy.input_domain : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const validScenario = validation.ok ? validation.scenario ?? null : null;

  /**
   * The draft's scenario identity: its normalized JSON when the draft is a
   * complete, valid scenario, and `null` when it is not. `null` is the point:
   * an incomplete draft has no identity, so it can never equal an analyzed
   * scenario, and a previous result can never be current beside it.
   */
  const draftJson = validScenario ? JSON.stringify(validScenario) : null;

  /** The result on hand belongs to exactly the scenario on screen. */
  const resultIsCurrent =
    analyzedJson !== null && draftJson !== null && draftJson === analyzedJson;

  /** A result exists, and it is not the scenario on screen. */
  const stale = analyzedJson !== null && !resultIsCurrent;

  const resultShowcase: ShowcaseExport | null =
    resultIsCurrent &&
    (analysis.status === "ready" || analysis.status === "example")
      ? analysis.showcase
      : null;

  /** The draft is still, exactly, the example it was loaded from. */
  const exampleUnchanged =
    !!loadedExample && draftJson !== null && draftJson === loadedExample.scenarioJson;

  const origin: Origin = loadedExample
    ? exampleUnchanged
      ? { kind: "example", id: loadedExample.id, title: loadedExample.title }
      : {
          kind: "edited-example",
          id: loadedExample.id,
          title: loadedExample.title,
        }
    : { kind: "blank" };

  // Raw validated capacity strings for the exact forced-allocation check
  // (web/src/lib/resultCase.ts). Results only render when the draft matches
  // the analyzed scenario, so the current draft's strings are the ones that
  // produced `resultShowcase`.
  const rawCapacities = useMemo<RawCapacityInputs>(
    () => ({
      required: draft.system.required_capacity_mw,
      sites: draft.sites.map((s) => s.capacity_mw),
    }),
    [draft],
  );

  // Persist after every settled change. Transient states (loading, error,
  // unavailable, guardrail, insufficient) contribute no durable analysis, so
  // what is written back is the draft and the example identity alone.
  useEffect(() => {
    const durable = durableAnalysis(analysis);
    saveWorkbench({
      draft,
      interacted,
      analyzedJson: durable ? analyzedJson : null,
      example: loadedExample,
      analysis: durable,
    });
  }, [draft, interacted, analyzedJson, loadedExample, analysis]);

  // Consume a pending post-analysis transition once the successful result has
  // committed. Runs only for a `ready` analysis armed by `analyze()`; any
  // other status (example, loading, error, guardrail, insufficient, a session
  // restore) leaves the flag untouched and does nothing here.
  useEffect(() => {
    if (!pendingResultFocus.current) return;
    if (analysis.status !== "ready") return;
    pendingResultFocus.current = false;
    const node = resultRegionRef.current;
    if (!node) return;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    node.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      block: "start",
    });
    // `preventScroll` so focus does not override the scroll above with an
    // instant jump; the container carries `tabIndex={-1}` and no focus ring.
    node.focus({ preventScroll: true });
    setCompletionAnnouncement("Analysis complete. Results are now available.");
  }, [analysis]);

  const apiDown = api.status === "down";

  const loadExample = async (meta: PresetMeta) => {
    // Loading an example is not a user-initiated analysis: no post-analysis
    // viewport/focus transition, and no completion announcement.
    pendingResultFocus.current = false;
    setCompletionAnnouncement("");
    setExampleLoading(meta.id);
    try {
      const payload = await fetchStaticJson<{ showcase: ShowcaseExport }>(
        `/data/${meta.file}`,
      );
      const showcase = payload.showcase;
      const scenarioJson = normalizedScenarioJson(showcase.scenario);
      setDraft(draftFromScenario(showcase.scenario));
      setInteracted(true);
      setLoadedExample({
        id: meta.id,
        title: meta.title,
        scenarioJson,
        envelope: showcase.lambda_envelope ?? null,
      });
      setAnalysis({ status: "example", showcase, title: meta.title });
      setAnalyzedJson(scenarioJson);
    } catch {
      // Both attempts failed (fetchStaticJson has already retried once). The
      // draft, the analyzed-scenario identity and any prior loaded example are
      // left exactly as they were, so nothing stale is shown and the retry has
      // a clean starting point. The raw error is intentionally dropped here;
      // the failure copy is composed where it is rendered.
      setAnalysis({ status: "example_error", meta });
    } finally {
      setExampleLoading(null);
    }
  };

  const analyze = async () => {
    if (!validScenario) return;
    const scenario = validScenario;
    const scenarioJson = JSON.stringify(scenario);
    const wantOptimize = scenario.sites.length <= LIVE_OPTIMIZE_MAX_SITES;
    // Reset the live region so a repeat run re-announces completion even
    // though the text is unchanged; re-armed on success below.
    setCompletionAnnouncement("");
    setAnalysis({ status: "loading" });
    const res = wantOptimize
      ? await postOptimize(scenario)
      : await postCompare(scenario);
    if (res.kind === "ok") {
      // Re-analyzing a bundled example must not quietly cost the visitor the
      // sensitivity that example ships with. The λ envelope is a precomputed,
      // validated artifact of that example, defined ACROSS λ, so it still
      // describes the portfolio as long as no envelope-defining input has
      // changed — an edit that only moves the delay consequence keeps it,
      // any other edit drops it. It is carried over verbatim, never recomputed
      // and never synthesized.
      const exampleEnvId = loadedExample
        ? exampleEnvelopeIdentity(loadedExample.scenarioJson)
        : null;
      const carriedEnvelope =
        loadedExample &&
        loadedExample.envelope &&
        exampleEnvId !== null &&
        envelopeIdentity(scenario) === exampleEnvId
          ? loadedExample.envelope
          : null;
      const showcase: ShowcaseExport = carriedEnvelope
        ? { ...res.data, lambda_envelope: carriedEnvelope }
        : res.data;
      // A successful, user-initiated run: arm the post-analysis transition so
      // the effect above carries the visitor to the result once it renders.
      pendingResultFocus.current = true;
      setAnalysis({ status: "ready", showcase, ranOptimize: wantOptimize });
      setAnalyzedJson(scenarioJson);
    } else if (res.kind === "guardrail") {
      setAnalysis({ status: "guardrail", body: res.body });
      setAnalyzedJson(scenarioJson);
    } else if (res.kind === "system_insufficient") {
      setAnalysis({ status: "system_insufficient", body: res.body });
      setAnalyzedJson(scenarioJson);
    } else if (res.status === 0) {
      setAnalysis({ status: "unavailable" });
    } else {
      setAnalysis({ status: "error", message: res.message });
    }
  };

  const clearScenario = () => {
    pendingResultFocus.current = false;
    setCompletionAnnouncement("");
    setDraft(blankDraft());
    setInteracted(false);
    setLoadedExample(null);
    setAnalysis({ status: "idle" });
    setAnalyzedJson(null);
    clearWorkbench();
  };

  const feasibilityBlocked = !validation.ok && !!validation.feasibility;
  const canRun = !!validScenario && !apiDown;
  const largePortfolio = draft.sites.length > LIVE_OPTIMIZE_MAX_SITES;

  // Only a failed example load offers a retry, and it reloads that exact
  // example — never a draft analysis.
  const onRetryExample =
    analysis.status === "example_error"
      ? () => {
          void loadExample(analysis.meta);
        }
      : null;

  return (
    <>
      <section className="workbench" aria-labelledby="builder-heading">
        <div className="workbench__head">
          <div>
            <h2 id="builder-heading" className="section-heading">
              Build a scenario
            </h2>
            <p className="section-subheading">
              Enter the requirement and the candidate sites, or load a worked
              example to see a completed analysis.
            </p>
          </div>
        </div>

        <ScenarioEditor
          draft={draft}
          onChange={editDraft}
          mappings={mappings}
          errors={validation.errors}
          showErrors={interacted && !validation.ok}
          feasibility={interacted ? validation.feasibility : undefined}
          domain={inputDomain}
        />

        {largePortfolio ? (
          <LargePortfolioNotice
            siteCount={draft.sites.length}
            optimizerMaxSites={LIVE_OPTIMIZE_MAX_SITES}
          />
        ) : (
          // <= LIVE_OPTIMIZE_MAX_SITES sites: the public build still gives a
          // full optimized allocation, so there is no analysis-mode notice
          // to attach the offer to. It is shown on its own instead of being
          // hidden until a fourth site makes the portfolio "big enough" —
          // the reason a real project needs a custom model is usually the
          // decision's complexity, not merely its site count. Never
          // rendered alongside the notice above.
          <ProjectSpecificModelOffer variant="standalone" />
        )}

        <AnalyzeBar
          canRun={canRun}
          feasibilityBlocked={feasibilityBlocked}
          feasibility={validation.feasibility}
          running={analysis.status === "loading"}
          apiDown={apiDown}
          apiChecking={api.status === "checking"}
          onRun={analyze}
          onClear={clearScenario}
          example={
            <ExampleMenu
              index={index}
              loadingId={exampleLoading}
              origin={origin}
              onLoad={loadExample}
            />
          }
        />
      </section>

      {/* Polite completion announcement for assistive technology. Always in
          the DOM so the text change is what is announced; set only after a
          successful user-initiated analysis and cleared when the next run
          starts (or on clear / example load). */}
      <p className="visually-hidden" role="status">
        {completionAnnouncement}
      </p>

      {children({
        analysis,
        stale,
        origin,
        showcase: resultShowcase,
        rawCapacities,
        onRun: analyze,
        onClear: clearScenario,
        resultRef: resultRegionRef,
        onRetryExample,
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Example menu (secondary)                                           */
/* ------------------------------------------------------------------ */

function ExampleMenu({
  index,
  loadingId,
  origin,
  onLoad,
}: {
  index: DataIndex | null;
  loadingId: string | null;
  origin: Origin;
  onLoad: (meta: PresetMeta) => void;
}) {
  if (!index) return null;
  // Only an untouched example keeps the selector on its own name. Once the
  // scenario has been edited it is the visitor's, and a selector still
  // reading "Balanced portfolio" would be claiming a portfolio that is no
  // longer on screen. The provenance is kept as a note instead of a claim.
  const activeId = origin.kind === "example" ? origin.id : null;
  return (
    <div className="example-menu">
      <label className="example-menu__label" htmlFor="example-select">
        Load an example
      </label>
      <select
        id="example-select"
        className="field__input example-menu__select"
        aria-label="Load an example"
        value={activeId ?? ""}
        disabled={loadingId !== null}
        onChange={(e) => {
          const meta = index.presets.find((p) => p.id === e.target.value);
          if (meta) onLoad(meta);
        }}
      >
        <option value="" disabled>
          Choose an example…
        </option>
        {index.presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      {loadingId ? (
        <span className="field__hint example-menu__hint" role="status">
          Loading example…
        </span>
      ) : origin.kind === "edited-example" ? (
        <span className="field__hint example-menu__hint example-menu__edited">
          Edited from {origin.title}
        </span>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analyze bar                                                        */
/* ------------------------------------------------------------------ */

function AnalyzeBar({
  canRun,
  feasibilityBlocked,
  feasibility,
  running,
  apiDown,
  apiChecking,
  onRun,
  onClear,
  example,
}: {
  canRun: boolean;
  feasibilityBlocked: boolean;
  /** Set exactly when `feasibilityBlocked` is, from the same
   * `validation.feasibility` the Candidate Sites notice reads — one source
   * of the gap figure for both places it is shown. */
  feasibility?: PortfolioFeasibilityGap;
  running: boolean;
  apiDown: boolean;
  apiChecking: boolean;
  onRun: () => void;
  onClear: () => void;
  example: ReactNode;
}) {
  // The hint (or, when the portfolio is short of capacity, the local
  // blocker below) already says why the control is unavailable; naming it
  // as the button's description is what carries that reason to assistive
  // technology instead of leaving a disabled control with no stated reason.
  const hintId = "analyze-hint";
  return (
    <div className="analyze-bar">
      <div className="analyze-bar__actions">
        <button
          type="button"
          className="btn btn--primary btn--lg"
          onClick={onRun}
          disabled={!canRun || running}
          aria-describedby={hintId}
        >
          {running ? "Analyzing…" : "Analyze scenario"}
        </button>
        {example}
        <button type="button" className="btn btn--ghost" onClick={onClear}>
          Clear
        </button>
      </div>
      {feasibilityBlocked && feasibility ? (
        // The action-local reason, not a pointer back up the page: the
        // exact same gap the Candidate Sites notice shows, restated here so
        // nothing has to be re-read out of context.
        <p className="analyze-blocker" id={hintId}>
          {formatMw(feasibility.gapMw)} more capacity is needed before this
          scenario can be analyzed.
        </p>
      ) : (
        <p className="field__hint" id={hintId}>
          {apiChecking
            ? "Checking the live analysis service…"
            : apiDown
              ? "Live analysis is temporarily unavailable. You can still load an example to see a fully worked result."
              : !canRun
                ? "Enter the requirement and at least one site to analyze."
                : "Runs the quantitative engine on your scenario."}
        </p>
      )}
    </div>
  );
}
