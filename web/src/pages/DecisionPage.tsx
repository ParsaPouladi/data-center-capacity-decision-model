import { AllocationBars } from "../components/AllocationBars";
import {
  AppShell,
  AUTHOR_NAME,
  CONTACT_EMAIL,
  CONTACT_HREF,
} from "../components/AppShell";
import { CapacityOverTimeChart } from "../components/CapacityOverTimeChart";
import { ChoiceComparison } from "../components/ChoiceComparison";
import { HeadlineResults } from "../components/HeadlineResults";
import {
  SITE_STRIP_EXPLICIT_MAX,
  SiteDeliveryStrip,
} from "../components/SiteDeliveryStrip";
import {
  ScenarioWorkbench,
  type WorkbenchResult,
} from "../components/ScenarioWorkbench";
import { useJson } from "../data/useJson";
import {
  classifyResult,
  type ResultClassification,
} from "../lib/resultCase";
import { allocationHeading, OBJECTIVE_VERSUS_DIAGNOSTICS } from "../lib/explanation";
import { formatMw, formatTrimmed } from "../lib/format";
import {
  synthesizeDecision,
  type DecisionSynthesis,
  type SensitivityFact,
} from "../lib/synthesis";
import type { DataIndex, MappingsBundle, ShowcaseExport } from "../types/showcase";

export function DecisionPage() {
  const indexState = useJson<DataIndex>("/data/index.json");
  const mappingsState = useJson<MappingsBundle>("/data/mappings.json");
  const mappings = mappingsState.status === "ready" ? mappingsState.data : null;
  const index = indexState.status === "ready" ? indexState.data : null;

  return (
    <AppShell current="decision">
      <div className="app-canvas">
        <Hero />
        <ScenarioWorkbench index={index} mappings={mappings}>
          {(result) => <ResultsRegion {...result} />}
        </ScenarioWorkbench>
      </div>
    </AppShell>
  );
}

/* ================================================================== */
/* Lead: capability, authorship, engagement                            */
/* ================================================================== */

function Hero() {
  return (
    <section className="hero">
      <div className="hero__head">
        <div className="hero__main">
          <div className="hero__masthead">
            <h1 className="hero__title">
              Data center capacity allocation under limited information and
              uncertain power delivery
            </h1>
            <p className="hero__byline">
              Model development and design by <strong>{AUTHOR_NAME}</strong>
            </p>
          </div>
          <p className="hero__lede">
            A data center site decision often has to be made before every
            engineering detail is resolved, while phased power delivery,
            interconnection timing, and site conditions all carry real
            uncertainty. How should a required amount of electrical capacity
            be split across candidate sites when development cost, delivery
            risk, and deadline pressure pull in different directions? Build a
            portfolio below, analyze it, and read the allocation, the chance
            of hitting the target date, and what the choice costs against the
            alternatives.
          </p>
          {/* The thesis statement: how the model turns qualitative
              knowledge into quantitative analysis. Kept at lede
              weight, not demoted to a footnote, and it is not restated in
              these words anywhere else on the page -- the capability rail
              below elaborates the same three steps without repeating this
              sentence. */}
          <p className="hero__concept">
            Incomplete qualitative site knowledge is not converted into
            arbitrary risk scores. It is classified, mapped into explicit
            physical timing and probability distributions, and then evaluated
            through the quantitative model.
          </p>
          <EvidenceNote />
        </div>
        <ContactPanel />
      </div>
      <CapabilityRail />
    </section>
  );
}

/**
 * One external-evidence sentence naming the business stakes, with two
 * authoritative, independently citable sources. Not a data point the model
 * consumes -- it motivates the decision problem, so it stays to a single
 * sentence and does not expand into a statistics section (that belongs to
 * Technical Documentation).
 */
function EvidenceNote() {
  return (
    <p className="hero__evidence">
      <a
        href="https://eta.lbl.gov/publications/united-states-data-center-energy-2025"
        target="_blank"
        rel="noopener noreferrer"
        title="Lawrence Berkeley National Laboratory, United States Data Center Energy Usage Report: 2025 Update (2026)"
      >
        LBNL
      </a>{" "}
      estimates data centers could account for 11.8% of U.S. electricity use
      by 2030, while the{" "}
      <a
        href="https://www.iea.org/reports/energy-and-ai"
        target="_blank"
        rel="noopener noreferrer"
        title="International Energy Agency, Energy and AI (2025)"
      >
        IEA
      </a>{" "}
      estimates grid constraints could delay around 20% of global
      data-center capacity planned for construction by 2030.
    </p>
  );
}

/**
 * The lead engagement surface. Its job is discovery: a reader should be able
 * to tell within a second that Parsa builds analyses like this one to order.
 * It is framed by the client's problem, not by authorship — the byline under
 * the title already carries that — and it is deliberately the most saturated
 * element in the hero: an accent ground, an accent rule, the offer at heading
 * weight, and one high-contrast action. Still flat: no gradient, no shadow,
 * nothing that reads as a signup form.
 */
function ContactPanel() {
  return (
    <aside className="cta cta--lead" aria-label="Professional engagement">
      <div className="cta__body">
        <p className="cta__eyebrow">Project-specific decision modeling</p>
        <p className="cta__ask">
          Have a similar infrastructure decision under uncertainty?
        </p>
        <p className="cta__lead">
          Custom quantitative decision models, uncertainty analysis,
          optimization, and decision-support tools built around a
          project&rsquo;s own constraints.
        </p>
      </div>
      <p className="cta__action">
        <a className="cta__link" href={CONTACT_HREF}>
          <span className="cta__link-main">
            Discuss a project
            <span className="cta__link-arrow" aria-hidden="true">
              &#x2192;
            </span>
          </span>
          <span className="cta__link-addr">{CONTACT_EMAIL}</span>
        </a>
      </p>
    </aside>
  );
}

/**
 * The distinctive capability, as the model's own three steps: coarse project
 * knowledge in, explicit physical uncertainty in the middle, auditable
 * quantitative decisions out. A horizontal process band at desktop; a clean
 * stack on narrow screens.
 */
const CAPABILITY_STEPS: { title: string; body: string }[] = [
  {
    title: "Built for limited information",
    body:
      "Early-stage qualitative and ordinal site knowledge becomes structured input for consistent quantitative decision analysis.",
  },
  {
    title: "Uncertainty made physical and explicit",
    body:
      "Explicit mappings translate site-condition classifications into physical delivery timing and uncertainty distributions. The ordinal states are identifiers, not arithmetic scores.",
  },
  {
    title: "Auditable quantitative decisions",
    body:
      "The mathematical engine evaluates delivery uncertainty and returns the allocation, deadline risk, shortfall, delay burden, cost tradeoffs, and the thresholds at which the decision changes.",
  },
];

function CapabilityRail() {
  return (
    <ol className="capability" aria-label="How the model works">
      {CAPABILITY_STEPS.map((step, i) => (
        <li className="capability__step" key={step.title}>
          <span className="capability__index" aria-hidden="true">
            {i + 1}
          </span>
          <h2 className="capability__title">{step.title}</h2>
          <p className="capability__body">{step.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ================================================================== */
/* Results region — the decision story                                 */
/* ================================================================== */

/**
 * For a valid result the story runs: the decision (allocation + the four
 * decision numbers + any structural note + decision sensitivity) → the
 * tradeoff against alternatives → the portfolio delivery outcome over time →
 * the site-level physical mechanism that produces it. Every other status
 * (loading / stale / unavailable / error / guardrail / insufficient capacity)
 * short-circuits to its own note and shows nothing below it.
 */
function ResultsRegion({
  analysis,
  stale,
  showcase,
  rawCapacities,
  onRun,
  onClear,
  onRetryExample,
  resultRef,
}: WorkbenchResult) {
  if (analysis.status === "idle") {
    return <NotAnalyzedPanel />;
  }
  if (analysis.status === "loading") {
    // An indeterminate track, not a progress figure: the request reports no
    // progress, so nothing here claims a percentage or a remaining time. It
    // exists only so a longer run does not look like a frozen page.
    return (
      <div className="results-note callout" role="status">
        Running the analysis for your scenario…
        <span className="progress-track" aria-hidden="true">
          <span className="progress-track__bar" />
        </span>
      </div>
    );
  }
  if (analysis.status === "unavailable") {
    return (
      <div className="results-note callout callout--warn" role="alert">
        <strong>Live analysis is temporarily unavailable.</strong> The service
        did not respond, so this scenario could not be analyzed. Your inputs are
        unchanged. Try again shortly, load an example to inspect a fully
        worked result in the meantime, or{" "}
        <button type="button" className="btn btn--link" onClick={onClear}>
          clear the scenario
        </button>
        .
      </div>
    );
  }
  if (analysis.status === "error") {
    return (
      <div className="results-note callout callout--warn" role="alert">
        <strong>The analysis could not be completed.</strong> {analysis.message}{" "}
        Your inputs are preserved and nothing below has been updated. Adjust and
        analyze again, or{" "}
        <button type="button" className="btn btn--link" onClick={onClear}>
          clear the scenario
        </button>
        .
      </div>
    );
  }
  if (analysis.status === "example_error") {
    // A committed example did not load, after one automatic retry. No raw
    // browser error is shown; "Try again" reloads that same example (never a
    // draft analysis), and the current inputs are left untouched.
    return (
      <div className="results-note callout callout--warn" role="alert">
        <strong>This example could not be loaded.</strong> The request for its
        data did not complete. Your inputs are unchanged.{" "}
        {onRetryExample ? (
          <>
            <button
              type="button"
              className="btn btn--link"
              onClick={onRetryExample}
            >
              Try again
            </button>{" "}
            or{" "}
          </>
        ) : null}
        <button type="button" className="btn btn--link" onClick={onClear}>
          clear the scenario
        </button>
        .
      </div>
    );
  }
  // Before any state that reports on an ANALYZED scenario. A guardrail or an
  // insufficient-capacity finding is as specific to the scenario it was
  // computed for as a result is, and neither may stand beside inputs it does
  // not describe. `stale` is true whenever an analysis exists and the draft is
  // not exactly the scenario it was run on — including while the draft is
  // incomplete, which is the case that previously let an old result reappear.
  if (stale) {
    return (
      <div className="results-note callout callout--warn" role="status">
        <strong>Inputs changed since the last analysis.</strong> The previous
        result is hidden so it is not mistaken for the current scenario.{" "}
        <button type="button" className="btn btn--link" onClick={onRun}>
          Re-analyze
        </button>{" "}
        to update it.
      </div>
    );
  }
  if (analysis.status === "guardrail") {
    return (
      <div className="results-note callout callout--warn" role="alert">
        <strong>This request was outside the limits of the public analysis
        service.</strong>{" "}
        {analysis.body.message}{" "}
        <button type="button" className="btn btn--link" onClick={onClear}>
          Clear the scenario
        </button>
        .
      </div>
    );
  }
  if (analysis.status === "system_insufficient") {
    const b = analysis.body;
    const haveNumbers =
      typeof b.required_capacity_mw === "number" &&
      typeof b.total_developable_capacity_mw === "number";
    return (
      <div className="results-note callout" role="status">
        <strong>Not enough developable capacity.</strong>{" "}
        {haveNumbers
          ? `The required capacity ${formatMw(
              b.required_capacity_mw as number,
            )} exceeds the total developable capacity ${formatMw(
              b.total_developable_capacity_mw as number,
            )} (shortfall ${formatMw(
              (b.required_capacity_mw as number) -
                (b.total_developable_capacity_mw as number),
            )}). `
          : `${b.message} `}
        No allocation can meet the requirement, so there is no result for this
        scenario, and nothing below has been updated. Raise site capacity or
        lower the requirement above and analyze again, or{" "}
        <button type="button" className="btn btn--link" onClick={onClear}>
          clear the scenario
        </button>
        .
      </div>
    );
  }

  // ready | example, and the draft is exactly the analyzed scenario.
  if (!showcase) return null;
  const exampleTitle = analysis.status === "example" ? analysis.title : null;
  // The classification is computed once here and threaded down, so the
  // decision summary, the structural note, the sensitivity line and the
  // visuals all speak from the same structural result — with the exact
  // raw-decimal forced check.
  const classification = classifyResult(showcase, rawCapacities);
  // The one deterministic synthesis for this result -- computed once here
  // and threaded down, so the golden paragraph and every section's local
  // interpretation sentence speak from the same extracted facts.
  const synthesis = synthesizeDecision(showcase, classification);

  return (
    // `tabIndex={-1}` makes this a programmatic focus target: after a
    // successful user-initiated analysis the workbench moves the viewport and
    // focus to the top of this region so the result is met in reading order,
    // starting at "The decision". It carries no focus ring of its own
    // (see `.results:focus` in app.css).
    <div className="results" ref={resultRef} tabIndex={-1}>
      <DecisionSection
        showcase={showcase}
        classification={classification}
        synthesis={synthesis}
        exampleTitle={exampleTitle}
      />
      <ChoiceComparisonSection
        showcase={showcase}
        classification={classification}
        synthesis={synthesis}
      />
      <CapacityOverTimeSection
        showcase={showcase}
        classification={classification}
        synthesis={synthesis}
      />
      <SiteDeliverySection
        showcase={showcase}
        classification={classification}
        synthesis={synthesis}
      />
      <MethodNote />
    </div>
  );
}

/**
 * The close of the decision story: decision → tradeoff → portfolio outcome →
 * physical mechanism → mathematics and audit. A quiet in-content pointer,
 * not a third engagement surface — it carries no eyebrow, no panel and no button,
 * and it is present for every valid result, including a live custom run where
 * the example-only decision-sensitivity link does not exist.
 */
function MethodNote() {
  return (
    <p className="method-note">
      The equations, assumptions, state mappings, optimization method, and
      sensitivity methodology behind this result are set out in{" "}
      <a href="/technical-documentation.html">Technical Documentation</a>.
    </p>
  );
}

function NotAnalyzedPanel() {
  return (
    <p className="results-empty" role="status">
      Analyze a scenario, or load an example, to see a recommendation.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* 1. The decision                                                     */
/* ------------------------------------------------------------------ */

function DecisionSection({
  showcase,
  classification,
  synthesis,
  exampleTitle,
}: {
  showcase: ShowcaseExport;
  classification: ResultClassification;
  synthesis: DecisionSynthesis;
  exampleTitle: string | null;
}) {
  const { optimizer } = showcase;
  const { system } = showcase.scenario;
  const authoritative = optimizer
    ? optimizer.evaluated
    : classification.bestStrategy;
  const sensitivityMove = synthesis.facts.sensitivity;

  return (
    <section className="section section--decision" aria-labelledby="decision-heading">
      <div className="section-head">
        <h2 id="decision-heading" className="section-heading">
          The decision
        </h2>
        {exampleTitle ? (
          <p className="results-context">Example: {exampleTitle}</p>
        ) : null}
      </div>

      {/* The one executive synthesis: what was selected, why it wins under
          the model's own criterion, the main gain/give-up against the
          alternatives, the remaining target-date exposure, a conservative
          mechanism fact where one is supported, and the next validated
          sensitivity move. It replaces the former separate decision-lead and
          selection-criterion paragraphs rather than repeating them. */}
      {synthesis.whyThisDecision ? (
        <div className="decision-synthesis">
          <h3 className="decision-synthesis__heading">Why this decision</h3>
          <p className="decision-synthesis__text">{synthesis.whyThisDecision}</p>
        </div>
      ) : null}

      {/* A co-optimal (case C) result still needs the bar-legend sentence:
          how to read the marked span on the bars. Every other structural
          fact the old note carried (forced / cost-only / comparison /
          zero-chance) is now in the synthesis above, so it is not repeated
          here. */}
      {synthesis.coOptimalSpanLegend ? (
        <div className="decision-note" role="note">
          <ul className="decision-note__list">
            <li>
              {synthesis.coOptimalSpanLegend.map((seg, j) =>
                seg.emphasis ? (
                  <strong key={j}>{seg.text}</strong>
                ) : (
                  <span key={j}>{seg.text}</span>
                ),
              )}
            </li>
          </ul>
        </div>
      ) : null}

      {authoritative ? (
        <div className="decision-grid">
          <div className="decision-grid__allocation">
            <h3 className="subsection-heading">
              {allocationHeading(classification)}
            </h3>
            <AllocationBars
              sites={showcase.scenario.sites}
              allocation={authoritative.allocation}
              coordinateBounds={
                optimizer && !optimizer.result.is_unique_within_tolerance
                  ? optimizer.result.coordinate_bounds
                  : null
              }
            />
          </div>
          <div className="decision-grid__numbers">
            <h3 className="subsection-heading">Key results</h3>
            <HeadlineResults
              developmentCost={authoritative.development_cost}
              pMeet={authoritative.p_meet}
              expectedShortfall={authoritative.expected_shortfall_mw}
              expectedDelayBurden={
                authoritative.expected_delay_burden_mw_months
              }
              targetMonth={system.target_month}
            />
            {/* One scenario-specific target-date interpretation, so Key
                Results stands on its own even away from the golden
                paragraph above. */}
            {synthesis.keyResultsInterpretation ? (
              <p className="section-insight">
                {synthesis.keyResultsInterpretation}{" "}
                <a href="/technical-documentation.html#deadline-performance">
                  How this is evaluated
                </a>
                .
              </p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="fine-print">
          This portfolio has more candidate sites than the model resolves to a
          single allocation. Compare the strategies below.
        </p>
      )}

      {/* Exactly one pointer into the documentation's regime material: the
          sensitivity block carries its own, so the standalone note appears
          only when there is no sensitivity to report. */}
      {sensitivityMove ? (
        <DecisionSensitivity
          currentConsequence={system.lambda_mw_month}
          move={sensitivityMove}
        />
      ) : (
        <WorkedExampleNote
          href="/technical-documentation.html#regimes"
          linkText="See a worked example of how the allocation changes as the delay consequence moves"
        />
      )}
    </section>
  );
}

/**
 * A quiet pointer to one of the two worked-example figures in Technical
 * Documentation, at the point in the decision story where that figure answers
 * the reader's next question.
 *
 * Deliberately not a panel, a button or a third engagement surface: one line
 * of secondary text with a descriptive link. The figures it points at are
 * built from a committed example portfolio and its precomputed λ envelope,
 * which the Decision page does not compute for a live scenario — so every
 * pointer says "worked example" in its own link text, and the trailing clause
 * says plainly that it is not the scenario on screen. Nothing here reports a
 * sensitivity result, and nothing is hidden or replaced by an "unavailable"
 * message when the current result has no envelope.
 */
function WorkedExampleNote({
  href,
  linkText,
}: {
  href: string;
  linkText: string;
}) {
  return (
    <p className="worked-example-note">
      <a href={href}>{linkText}</a>. It uses a fixed example portfolio in
      Technical Documentation, not this scenario.
    </p>
  );
}

/* ------------------------------------------------------------------ */
/* Decision sensitivity — what would have to change                    */
/* ------------------------------------------------------------------ */

/**
 * One sentence on where a larger delay consequence would move capacity —
 * the answer to "what would have to change before this decision changes?".
 * `move` is `synthesis.facts.sensitivity` (`lib/synthesis.ts`), which is
 * null exactly when there is nothing to report here: no `lambda_envelope`,
 * no breakpoint above the scenario's current delay consequence, or a forced
 * allocation (case B), where the allocation cannot move at all. See that
 * module's `sensitivityMoveFor()` for the full gate — computed once there
 * and shared with the golden paragraph's own
 * bounded sensitivity sentence, rather than twice.
 */
function DecisionSensitivity({
  currentConsequence,
  move,
}: {
  currentConsequence: number;
  move: SensitivityFact;
}) {
  const current = currentConsequence;
  return (
    <div className="sensitivity">
      <h3 className="subsection-heading sensitivity__label">
        Decision sensitivity
      </h3>
      <div className="sensitivity__body">
        <p className="sensitivity__sentence">
          Above{" "}
          <strong className="sensitivity__threshold">
            {formatTrimmed(move.threshold, 3)}
          </strong>{" "}
          delay consequence, up from the scenario&rsquo;s{" "}
          {formatTrimmed(current, 3)}, the allocation changes,{" "}
          <strong className="sensitivity__shift">{move.clause}</strong>.
        </p>
      </div>
      {/* One pointer into the documentation's sensitivity material, not two.
          A second "Explore sensitivity" link sat here promising something
          scenario-specific and landing on the same fixed documentation
          example the note below already names, which is the promise the note
          exists to keep honest. */}
      <WorkedExampleNote
        href="/technical-documentation.html#regimes"
        linkText="See a worked example of how the allocation changes as the delay consequence moves"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 2. Choice comparison — the tradeoff against alternatives            */
/* ------------------------------------------------------------------ */

function ChoiceComparisonSection({
  showcase,
  classification,
  synthesis,
}: {
  showcase: ShowcaseExport;
  classification: ResultClassification;
  synthesis: DecisionSynthesis;
}) {
  // Case B: every strategy is the same forced allocation, so there is no
  // choice to compare and the section is not rendered at all.
  if (classification.base === "B") return null;

  return (
    <section className="section" aria-labelledby="choice-heading">
      <h2 id="choice-heading" className="section-heading">
        Choice comparison
      </h2>
      {/* How to read this: each row is a candidate allocation strategy,
          evaluated by the engine on the same portfolio; the columns are
          diagnostics, and selection follows the model's own combined
          criterion, not any one visible column. */}
      <p className="section-subheading">
        Each row is a candidate allocation strategy, evaluated by the engine
        on this portfolio. The columns report its chance of meeting the
        target date, its relative development cost, and its expected
        deadline shortfall and delay burden; the marked row is selected on
        relative development cost plus the delay consequence applied to the
        expected delay burden, not on any single column shown.
      </p>
      <ChoiceComparison showcase={showcase} classification={classification} />
      {/* What this means for your scenario: which row wins here, and the one
          tradeoff that matters against the closest alternative. */}
      {synthesis.choiceComparisonInterpretation ? (
        <p className="section-insight">
          {synthesis.choiceComparisonInterpretation}
        </p>
      ) : null}
      {/* Technical basis. Why the marked row can trail another row on a
          visible column is stated in plain language on purpose: the combined
          objective value is not added to this table as a column. */}
      <p className="section-basis">
        {OBJECTIVE_VERSUS_DIAGNOSTICS}{" "}
        <a href="/technical-documentation.html#objective">
          How this criterion is defined
        </a>
        {" · "}
        <a href="/technical-documentation.html#benchmarks">
          How the three strategies are defined
        </a>
        .
      </p>
      <WorkedExampleNote
        href="/technical-documentation.html#break-even"
        linkText="See a worked example of the development-cost versus expected-delay-burden tradeoff"
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 3. Delivery outlook — the portfolio outcome through time            */
/* ------------------------------------------------------------------ */

function CapacityOverTimeSection({
  showcase,
  classification,
  synthesis,
}: {
  showcase: ShowcaseExport;
  classification: ResultClassification;
  synthesis: DecisionSynthesis;
}) {
  const { optimizer, scenario } = showcase;
  // No allocation selector. The figure shows exactly the allocation that is
  // authoritative for the current result — the optimizer's evaluated result,
  // or (comparison mode) the strategy the ENGINE selected on its own
  // switching boundaries. No objective is sorted in the browser.
  const authoritative = optimizer
    ? optimizer.evaluated
    : classification.bestStrategy;
  if (!authoritative) return null;

  return (
    <section className="section" aria-labelledby="capacity-time-heading">
      <h2 id="capacity-time-heading" className="section-heading">
        Delivery outlook
      </h2>
      {/* How to read this: the plotted line and what it represents (merged
          with the former figure caption rather than stacked beside it). */}
      <p className="section-subheading">
        How usable capacity builds up over time under this allocation. The
        line is expected capacity across the modeled delay outcomes, not a
        guaranteed schedule; the uncertainty around it is carried by the
        chance of meeting the date above.
      </p>
      <CapacityOverTimeChart
        times={authoritative.times}
        trajectory={authoritative.delivered_capacity_trajectory}
        requiredCapacity={scenario.system.required_capacity_mw}
        targetMonth={scenario.system.target_month}
        seriesLabel={allocationHeading(classification).toLowerCase()}
      />
      {/* What this means for your scenario: one local reading of the plotted
          trajectory against the requirement, at the target month. */}
      {synthesis.deliveryOutlookInterpretation ? (
        <p className="section-insight">
          {synthesis.deliveryOutlookInterpretation}
        </p>
      ) : null}
      <p className="section-basis">
        <a href="/technical-documentation.html#delivered-capacity">
          How delivered capacity is defined
        </a>
        .
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* 4. Site delivery strip — the physical mechanism behind the outcome  */
/* ------------------------------------------------------------------ */

function SiteDeliverySection({
  showcase,
  classification,
  synthesis,
}: {
  showcase: ShowcaseExport;
  classification: ResultClassification;
  synthesis: DecisionSynthesis;
}) {
  const { optimizer, scenario } = showcase;
  const authoritative = optimizer
    ? optimizer.evaluated
    : classification.bestStrategy;
  if (!authoritative) return null;

  return (
    <section className="section" aria-labelledby="site-delivery-heading">
      <h2 id="site-delivery-heading" className="section-heading">
        Site delivery
      </h2>
      {/* How to read this: allocated bars, phased power availability, and
          how both relate to the target month (merged with the former figure
          caption). */}
      <p className="section-subheading">
        Site-level delivery profiles combine to produce the portfolio capacity
        trajectory above. One row per site, on a shared month axis. Each site
        delivers power in two stages: the bar is the capacity allocated there,
        and the steps are when that power becomes available,{" "}
        {showcase.site_power_profiles.length <= SITE_STRIP_EXPLICIT_MAX
          ? "with the lighter lines showing less likely delay outcomes."
          : "with the shaded band spanning the earliest and latest of the modeled delay outcomes."}
      </p>
      <SiteDeliveryStrip
        sites={scenario.sites}
        allocation={authoritative.allocation}
        profiles={showcase.site_power_profiles}
        targetMonth={scenario.system.target_month}
      />
      {/* What this means for your scenario: one conservative power-
          availability fact at the target month, when the exported profile
          supports it. */}
      {synthesis.siteDeliveryInterpretation ? (
        <p className="section-insight">{synthesis.siteDeliveryInterpretation}</p>
      ) : null}
      <p className="section-basis">
        <a href="/technical-documentation.html#phased-delivery">
          How phased power delivery is modeled
        </a>
        .
      </p>
    </section>
  );
}
