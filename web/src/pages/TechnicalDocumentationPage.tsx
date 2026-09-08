import { useEffect, useState, type ReactNode } from "react";
import {
  AUTHOR_NAME,
  AppShell,
  DOI_URL,
  DOI_VALUE,
  PUBLIC_REPOSITORY_URL,
} from "../components/AppShell";
import { CostDelayScatter, type TradeoffPoint } from "../components/CostDelayScatter";
import { Equation, Var } from "../components/Equation";
import { LambdaAllocationChart } from "../components/LambdaAllocationChart";
import { MechanismDiagram } from "../components/MechanismDiagram";
import { useJson, type FetchState } from "../data/useJson";
import { DOC_EXAMPLE_PATH } from "../lib/docExample";
import { useHashScroll } from "../lib/useHashScroll";
import { formatMw, formatNumber } from "../lib/format";
import type {
  BurdenStateDefinition,
  EnvelopeVertex,
  MappingsBundle,
  PresetExport,
  ShowcaseExport,
  StrategyResult,
  UncertaintyStateDefinition,
} from "../types/showcase";

/**
 * Technical Documentation.
 *
 * One long-form document, twenty top-level sections, a persistent table of
 * contents, and hand-authored MathML for every display equation. It is
 * the page that DEFINES the model's notation, so canonical symbols are used
 * here and only here; every public label on the Decision page is mapped back
 * to its canonical term in the notation section below.
 *
 * Three rules govern the content:
 *   - every displayed equation is preceded by a plain-language sentence
 *     stating what it measures, carries an accessible text fallback, and
 *     carries a local `where:` definition of every symbol required
 *     to read it (enforced by the `Equation` component's required
 *     `definitions` prop, not by convention);
 *   - the first time any symbol appears anywhere in the document, it is
 *     identified in prose rather than left to be inferred from an equation;
 *   - no internal problem numbering, service caps, executor or
 *     performance figures, version strings, export provenance, or process
 *     history is rendered.
 *
 * Worked numbers come from one committed example export, read through
 * `DOC_EXAMPLE_PATH`; none of them is transcribed into prose.
 */

interface DocSection {
  id: string;
  title: string;
}

/** The twenty top-level sections, in order. */
const SECTIONS: DocSection[] = [
  {
    id: "introduction",
    title: "Why data-center capacity allocation under power uncertainty matters",
  },
  { id: "scope", title: "The decision framework" },
  { id: "mechanism", title: "The causal mechanism" },
  { id: "inputs", title: "Inputs and state mappings" },
  { id: "phased-delivery", title: "Phased power delivery" },
  { id: "timing-uncertainty", title: "Timing uncertainty" },
  { id: "scenarios", title: "Scenario construction" },
  { id: "delivered-capacity", title: "Delivered usable capacity" },
  { id: "deadline-performance", title: "Deadline performance" },
  { id: "development-cost", title: "Development cost" },
  { id: "delay-consequence", title: "Delay consequence" },
  { id: "objective", title: "The objective" },
  { id: "benchmarks", title: "Benchmark strategies" },
  { id: "optimization", title: "Allocation optimization" },
  { id: "co-optimality", title: "Co-optimal and effectively tied results" },
  { id: "lambda-sensitivity", title: "How the answer changes with the delay consequence" },
  { id: "exact-monte-carlo", title: "Exact evaluation and Monte Carlo" },
  { id: "reproducibility", title: "Reproducibility" },
  { id: "notation", title: "Complete notation and public labels" },
  { id: "scope-assumptions", title: "Assumptions and application boundary" },
];

const NUMBER_OF = new Map(SECTIONS.map((s, i) => [s.id, i + 1]));

/** Stable identity for the contents rail's observer dependency. */
const SECTION_IDS: readonly string[] = SECTIONS.map((s) => s.id);

export function TechnicalDocumentationPage() {
  // A deep link from the Decision page has to land on the section it names,
  // including on a cold load where the browser resolves the fragment before
  // this document exists. See lib/useHashScroll.
  useHashScroll();
  const mappingsState = useJson<MappingsBundle>("/data/mappings.json");
  const exampleState = useJson<PresetExport>(DOC_EXAMPLE_PATH);
  const showcase =
    exampleState.status === "ready" ? exampleState.data.showcase : null;

  return (
    <AppShell current="technical">
      <div className="doc-canvas">
        <section className="hero doc-hero">
          <div className="hero__masthead">
            <h1 className="hero__title">Technical Documentation</h1>
            {/* Authorship as a deliberate element of the masthead rather than
                a line of metadata: the role phrase stays quiet, the name is
                set at document scale, and both stay subordinate to the H1. */}
            <p className="hero__byline hero__byline--stacked">
              <span className="hero__byline-role">
                Model, application and technical documentation by
              </span>
              <strong className="hero__byline-name">{AUTHOR_NAME}</strong>
            </p>
          </div>
          <PublicationResources />
        </section>

        <div className="doc-layout">
          <TableOfContents />
          <div className="doc-main prose">
            <IntroductionSection />
            <ScopeSection />
            <MechanismSection />
            <InputsSection state={mappingsState} />
            <PhasedDeliverySection />
            <TimingUncertaintySection />
            <ScenarioSection />
            <DeliveredCapacitySection />
            <DeadlinePerformanceSection />
            <DevelopmentCostSection />
            <DelayConsequenceSection />
            <ObjectiveSection />
            <BenchmarkSection />
            <OptimizationSection />
            <CoOptimalitySection showcase={showcase} state={exampleState} />
            <LambdaSensitivitySection showcase={showcase} state={exampleState} />
            <ExactMonteCarloSection />
            <ReproducibilitySection />
            <NotationSection />
            <ScopeAssumptionsSection />
          </div>
        </div>
      </div>
    </AppShell>
  );
}

/* ================================================================== */
/* Document furniture                                                  */
/* ================================================================== */

/**
 * Source and citation for the released model: the public repository and the
 * DOI of the archived release.
 *
 * Neither exists yet, so neither is rendered. The values live in exactly one
 * place — `PUBLIC_REPOSITORY_URL`, `DOI_VALUE` and `DOI_URL` in AppShell — and
 * this row renders only the entries that are populated, and nothing at all
 * while all of them are null. No placeholder, no dead `#` anchor, and no
 * "coming soon" text reaches the page in the meantime; adding the real values
 * later requires filling those constants in and nothing else.
 */
function PublicationResources() {
  const items: { label: string; text: string; href: string | null }[] = [];

  if (PUBLIC_REPOSITORY_URL) {
    items.push({
      label: "Source",
      text: PUBLIC_REPOSITORY_URL,
      href: PUBLIC_REPOSITORY_URL,
    });
  }
  if (DOI_VALUE) {
    items.push({ label: "DOI", text: DOI_VALUE, href: DOI_URL });
  }
  if (items.length === 0) return null;

  return (
    <div className="doc-resources">
      <span className="doc-resources__title">Source and citation</span>
      <ul className="doc-resources__list">
        {items.map((item) => (
          <li key={item.label}>
            <span className="doc-resources__label">{item.label}</span>{" "}
            {item.href ? <a href={item.href}>{item.text}</a> : item.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The section the reader is currently in, for the contents rail.
 *
 * An IntersectionObserver over the section elements, not a scroll handler:
 * the browser does the geometry, and the rail simply names the last section
 * whose heading has passed the top of the viewport. Returns null before any
 * section has, so the rail shows no current item rather than guessing one.
 */
function useCurrentSection(ids: readonly string[]): string | null {
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => {
    if (typeof IntersectionObserver !== "function") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        // The LAST section in document order that is inside the band, i.e.
        // the most recent heading to reach the top of the viewport. Taking the
        // first instead kept naming the section above whenever the previous
        // one's box still touched the band, which reads as an off-by-one rail.
        let inBand: string | null = null;
        for (const id of ids) if (visible.has(id)) inBand = id;
        setCurrent((prev) => inBand ?? prev);
      },
      // A band across the upper part of the viewport, so the current section
      // is the one being read rather than whichever is tallest on screen.
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [ids]);
  return current;
}

function TableOfContents() {
  const current = useCurrentSection(SECTION_IDS);
  return (
    <nav className="doc-toc" aria-label="Contents">
      <div className="doc-toc__title">Contents</div>
      <ol>
        {SECTIONS.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className={
                s.id === current ? "doc-toc__link is-current" : "doc-toc__link"
              }
              aria-current={s.id === current ? "true" : undefined}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

function Section({ id, children }: { id: string; children: ReactNode }) {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown documentation section: ${id}`);
  return (
    <section className="doc-section" id={id} aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="section-heading">
        {NUMBER_OF.get(id)}. {section.title}
      </h2>
      {children}
    </section>
  );
}

function Subsection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="doc-subsection" id={id}>
      <h3 className="subsection-heading">{title}</h3>
      {children}
    </div>
  );
}

/** A short reference to another section, by its live number and title. */
function Ref({ id }: { id: string }) {
  const section = SECTIONS.find((s) => s.id === id);
  if (!section) throw new Error(`Unknown documentation section: ${id}`);
  return (
    <a href={`#${id}`}>
      section {NUMBER_OF.get(id)}, {section.title.toLowerCase()}
    </a>
  );
}

/** Neutral placeholder while an example or mapping file is being read. */
function Pending({ state, what }: { state: FetchState<unknown>; what: string }) {
  if (state.status === "loading") {
    return <p className="fine-print">Reading {what}…</p>;
  }
  return (
    <p className="fine-print">
      The {what} could not be loaded. The surrounding definitions remain
      available.
    </p>
  );
}

/* ================================================================== */
/* Local MathML fragments                                              */
/* ================================================================== */

/**
 * A parenthesised or bracketed group, in its own `<mrow>`.
 *
 * MathML stretches a fence to the tallest sibling in the row it belongs to.
 * A function's argument list left at the top level of an equation therefore
 * grows to the height of whatever else that equation contains — a summation
 * sign, a piecewise brace — and prints as two letters inside a pair of huge
 * parentheses. Confining each fence to its own row is both the fix and the
 * correct reading of the notation: these parentheses group an argument list,
 * they do not enclose the expression beside them. A fence that genuinely
 * should grow, such as the outer bracket of the objective, is written at the
 * level of the thing it encloses and stretches there.
 */
function Group({
  open,
  close,
  children,
}: {
  open: string;
  close: string;
  children: ReactNode;
}) {
  return (
    <mrow>
      <mo>{open}</mo>
      {children}
      <mo>{close}</mo>
    </mrow>
  );
}

/** The argument list `(t, s)`: a month and a delay scenario. */
function AtTS() {
  return (
    <Group open="(" close=")">
      <mi>t</mi>
      <mo>,</mo>
      <mi>s</mi>
    </Group>
  );
}

function Ki() {
  return (
    <msub>
      <mi>K</mi>
      <mi>i</mi>
    </msub>
  );
}

function Xi() {
  return (
    <msub>
      <mi>x</mi>
      <mi>i</mi>
    </msub>
  );
}

/**
 * Nominal stage date. The overbar is a stretchy OVERLINE (U+203E) inside a
 * plain `<mover>`, which is the one construction that actually paints a bar
 * in the shipping engines: `accent="true"` with a macron, a combining macron,
 * or a combining overline all render the base letter with no mark at all, and
 * accenting an `<msub>` draws the bar across the subscript as well. The bar
 * is the only thing distinguishing a nominal stage date from a realized one,
 * so this is checked visually rather than assumed.
 */
function TauNominal({ stage }: { stage: number }) {
  return (
    <msub>
      <mover>
        <mi>τ</mi>
        <mo stretchy="true">&#x203E;</mo>
      </mover>
      <mrow>
        <mi>i</mi>
        <mn>{stage}</mn>
      </mrow>
    </msub>
  );
}

function TauRealized({ stage }: { stage: number }) {
  return (
    <msubsup>
      <mi>τ</mi>
      <mrow>
        <mi>i</mi>
        <mn>{stage}</mn>
      </mrow>
      <mrow>
        <mo>(</mo>
        <mi>s</mi>
        <mo>)</mo>
      </mrow>
    </msubsup>
  );
}

function DeltaRealized() {
  return (
    <msubsup>
      <mi>δ</mi>
      <mi>i</mi>
      <mrow>
        <mo>(</mo>
        <mi>s</mi>
        <mo>)</mo>
      </mrow>
    </msubsup>
  );
}

/**
 * The argument parentheses are wrapped in their own `<mrow>`. A stretchy
 * fence stretches to the tallest sibling in the row it sits in, so left at
 * the top level of an equation these would grow to the height of whatever
 * else that equation contains -- against the three-row piecewise definition,
 * to the full height of the brace.
 */
function AvailableAt({ time }: { time: ReactNode }) {
  return (
    <>
      <msubsup>
        <mi>A</mi>
        <mi>i</mi>
        <mrow>
          <mo>(</mo>
          <mi>s</mi>
          <mo>)</mo>
        </mrow>
      </msubsup>
      <mrow>
        <mo>(</mo>
        {time}
        <mo>)</mo>
      </mrow>
    </>
  );
}

function SumI({ upper = true }: { upper?: boolean }) {
  if (!upper) {
    return (
      <munder>
        <mo movablelimits="false">&#x2211;</mo>
        <mi>i</mi>
      </munder>
    );
  }
  return (
    <munderover>
      <mo movablelimits="false">&#x2211;</mo>
      <mrow>
        <mi>i</mi>
        <mo>=</mo>
        <mn>1</mn>
      </mrow>
      <mi>N</mi>
    </munderover>
  );
}

function TargetMonth() {
  return (
    <msup>
      <mi>T</mi>
      <mo>*</mo>
    </msup>
  );
}

/**
 * A piecewise definition: an opening brace against a two-column table of
 * value and condition.
 *
 * The brace stretches. It is a real MathML stretchy fence sized by the
 * layout engine from the height of the `<mtable>` beside it, using the
 * vertical glyph assembly in the MATH table of the self-hosted math font
 * (src/styles/fonts.css). It therefore spans the full block whatever the
 * row count, row height or font size, which the previous approach — scaling
 * the brace's font-size by the number of rows — only approximated, and
 * visibly undershot on the three-row available-power definition.
 */
function Cases({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <mrow>
      <mo fence="true" form="prefix" stretchy="true" symmetric="true">
        {"{"}
      </mo>
      <mtable columnalign="left left" columnspacing="1.4em" rowspacing="0.45em">
        {rows.map((row, i) => (
          <mtr key={i}>
            <mtd>{row[0]}</mtd>
            <mtd>{row[1]}</mtd>
          </mtr>
        ))}
      </mtable>
    </mrow>
  );
}

/* ================================================================== */
/* Local prose-symbol fragments, for equation `where:` keys            */
/* ================================================================== */

/**
 * Small, reused renderings of the symbols that recur across many equations'
 * `where:` keys. Each matches the italic `<Var>` convention
 * already used for symbols in running prose elsewhere on this page, so a
 * symbol looks the same whether it appears in a sentence or in a
 * definition list. Symbols that only ever appear in one equation are
 * written inline at that call site instead of added here.
 */
const SYM_I = <Var>i</Var>;
const SYM_N = <Var>N</Var>;
const SYM_T = <Var>t</Var>;
const SYM_S = <Var>s</Var>;
const SYM_D = <Var>D</Var>;
const SYM_TSTAR = (
  <>
    <Var>T</Var>*
  </>
);
const SYM_H = <Var>H</Var>;
const SYM_LAMBDA = <Var>λ</Var>;
const SYM_ALPHA = <Var>α</Var>;
const SYM_KI = (
  <>
    <Var>K</Var>
    <sub>i</sub>
  </>
);
const SYM_XI = (
  <>
    <Var>x</Var>
    <sub>i</sub>
  </>
);
const SYM_CI = (
  <>
    <Var>c</Var>
    <sub>i</sub>
  </>
);
/** The argument pair "(t, s)" as it reads in prose, e.g. in Yᵢ(t, s). */
const SYM_ARGS_TS = (
  <>
    (<Var>t</Var>, <Var>s</Var>)
  </>
);

/** A subscripted symbol in prose, e.g. Sₛ or qᵢ. */
function SubSym({ base, sub }: { base: string; sub: ReactNode }) {
  return (
    <>
      <Var>{base}</Var>
      <sub>{sub}</sub>
    </>
  );
}

/** A subscripted symbol with a superscripted scenario marker, e.g. pᵢ⁽ˢ⁾. */
function SubSupSym({
  base,
  sub,
  sup,
}: {
  base: string;
  sub: ReactNode;
  sup: ReactNode;
}) {
  return (
    <>
      <Var>{base}</Var>
      <sub>{sub}</sub>
      <sup>{sup}</sup>
    </>
  );
}

/** The nominal stage date τ̄ᵢ₁ or τ̄ᵢ₂, as it reads in prose. */
function TauNominalProse({ stage }: { stage: number }) {
  return <SubSym base={"τ̅"} sub={`i${stage}`} />;
}

/** The realized stage date τᵢ₁⁽ˢ⁾ or τᵢ₂⁽ˢ⁾, as it reads in prose. */
function TauRealizedProse({ stage }: { stage: number }) {
  return <SubSupSym base="τ" sub={`i${stage}`} sup="(s)" />;
}

/** The realized delay δᵢ⁽ˢ⁾, as it reads in prose. */
function DeltaRealizedProse() {
  return <SubSupSym base="δ" sub="i" sup="(s)" />;
}

/* ================================================================== */
/* 1. Why data-center capacity allocation under power uncertainty      */
/*    matters                                                          */
/* ================================================================== */

/**
 * The real-world motivation section. It exists to answer three
 * questions before any mathematics appears: why the underlying business
 * problem is material, why the information available at decision time is
 * necessarily incomplete, and who the resulting framework is written for.
 *
 * The cited industry sources establish that the capacity/grid-delivery
 * decision itself is material. They are never presented as validating this
 * model's specific parameterization -- that distinction is stated once,
 * explicitly, in the closing paragraph, rather than repeated as a
 * disclaimer box.
 */
function IntroductionSection() {
  return (
    <Section id="introduction">
      <p>
        Data-center electricity demand has moved from a background planning
        detail to a first-order capacity problem. Smith et al. (2026), in the{" "}
        <a
          href="https://eta-publications.lbl.gov/publications/united-states-data-center-energy-2025"
          target="_blank"
          rel="noopener noreferrer"
          title="Lawrence Berkeley National Laboratory, United States Data Center Energy Usage Report: 2025 Update"
        >
          Lawrence Berkeley National Laboratory&rsquo;s United States Data
          Center Energy Usage Report: 2025 Update
        </a>
        , project that data centers could reach{" "}
        <strong>11.8% of total U.S. electricity use by 2030</strong>, with a
        modeled scenario range of <strong>9.5&ndash;15.3%</strong>.
      </p>
      <p>
        That demand still has to be delivered through a grid that cannot
        always keep pace. The{" "}
        <a
          href="https://www.iea.org/reports/energy-and-ai"
          target="_blank"
          rel="noopener noreferrer"
          title="International Energy Agency, Energy and AI (2025)"
        >
          International Energy Agency&rsquo;s Energy and AI
        </a>{" "}
        (2025) projects global data-center electricity consumption reaching
        around 945 TWh by 2030, roughly double 2024 levels, and estimates that{" "}
        <a
          href="https://www.iea.org/reports/energy-and-ai/ai-and-energy-security"
          target="_blank"
          rel="noopener noreferrer"
          title="IEA, Energy and AI -- AI and energy security"
        >
          grid-connection constraints could delay around 20% of the
          data-center capacity
        </a>{" "}
        currently planned for construction by then. New transmission lines
        can take four to eight years to build in advanced economies, and wait
        times for critical grid components such as transformers and cables
        have doubled over the past three years.
      </p>
      <p>
        For a developer, this turns a siting question into a portfolio
        question. Required capacity may have to be split across several
        candidate sites, each with its own developable capacity, development
        cost, power-delivery complexity, and timing uncertainty, and power
        itself can arrive in stages rather than all at once. A cheaper site
        can expose the portfolio to more delay; a faster or more diversified
        allocation can cost more. The question that matters is therefore not
        which single site is fastest or cheapest, but how much capacity to
        place at each, given the stated consequence of being late.
      </p>
      <p>
        At an early allocation or site-screening stage, detailed project
        parameters may still be incomplete. The framework is designed for
        that condition. Rather than compressing incomplete qualitative site
        knowledge into an arbitrary weighted risk score, it carries that
        knowledge through an explicit chain: limited qualitative or ordinal
        knowledge is classified into a condition state, each state resolves
        to explicit physical timing parameters and a probability distribution
        over delay, and the quantitative engine evaluates strategies only on
        those physical quantities. An ordinal state is an identifier, not an
        arithmetic quantity:{" "}
        <strong>state 4 does not mean twice state 2</strong>.
      </p>
      <p>
        The framework is written for the people who own this decision in
        practice: data-center developers, capacity planners, site-selection
        teams, power and infrastructure program managers, and the technical
        decision-makers who have to defend an allocation to a leadership team
        or an investment committee. This public implementation, its
        terminology, worked examples, and business framing, is built
        specifically for data-center electrical-capacity planning. The
        underlying mathematical pattern (phased and uncertain delivery
        weighed against development cost) could in principle extend to
        other infrastructure decisions with staged, uncertain delivery; that
        broader applicability is secondary and does not make this a generic
        optimization tool.
      </p>
      <p>
        The evidence above establishes that the underlying capacity and
        grid-delivery decision is material; it does not validate this model&rsquo;s
        specific parameterization. The reference state mappings and delay
        probabilities used throughout this document (<Ref id="inputs" />) are
        a separate, generalized set of values, calibrated by a project
        implementation against its own evidence, not derived from these
        industry reports.
      </p>

      <h3 className="subsection-heading">Industry references</h3>
      <ol className="doc-sources">
        <li>
          Smith et al. (2026).{" "}
          <a
            href="https://eta-publications.lbl.gov/publications/united-states-data-center-energy-2025"
            target="_blank"
            rel="noopener noreferrer"
          >
            United States Data Center Energy Usage Report: 2025 Update
          </a>
          . Lawrence Berkeley National Laboratory.
        </li>
        <li>
          International Energy Agency (2025).{" "}
          <a
            href="https://www.iea.org/reports/energy-and-ai"
            target="_blank"
            rel="noopener noreferrer"
          >
            Energy and AI
          </a>
          .
        </li>
      </ol>
    </Section>
  );
}

/* ================================================================== */
/* 2. What the model does, and what it does not do                     */
/* ================================================================== */

function ScopeSection() {
  return (
    <Section id="scope">
      <p>
        A developer must have a required amount of usable electrical capacity in
        place by a target month, and can develop that capacity across several
        candidate sites. The sites differ: in how much capacity each can carry,
        in relative development cost per MW, in how much power-delivery work the
        connection needs, and in how predictable that delivery timing is. The
        model answers one question. Given those differences, how should the
        requirement be split across the sites?
      </p>
      <p>
        Formally: the required capacity is a fixed quantity, needed in place
        by a stated target month. Each candidate site is described by its own
        developable capacity, relative development cost per MW, power-delivery
        complexity, and schedule uncertainty. The last two are deliberately
        ordinal rather than precise engineering forecasts, for the reasons
        introduced in <Ref id="introduction" /> and detailed in{" "}
        <Ref id="inputs" />. The allocation decision is how much capacity to
        develop at each site; the model reports how that allocation performs
        against the requirement, the target date, and the delay burden that
        accumulates afterward.
      </p>

      <h3 className="subsection-heading">What it does</h3>
      <ul>
        <li>
          Translates ordinal site conditions into explicit timing parameters
          and uncertainty distributions through published mappings, so the
          judgment is auditable rather than embedded in the arithmetic.
        </li>
        <li>
          Evaluates how power actually becomes available at each site across
          the modeled delay outcomes, rather than at a single assumed date.
        </li>
        <li>
          Computes delivered usable capacity over time, and from it the chance
          of meeting the target date, the shortfall at that date, and the
          expected delay burden accumulated from that month through the
          analysis horizon.
        </li>
        <li>
          Optimizes the allocation under the stated objective, compares it
          against interpretable benchmark strategies, and maps how the answer
          moves as the consequence assigned to delayed capacity changes.
        </li>
      </ul>
      <p>
        The framework uses explicit reference mappings as its default
        parameterization. Project implementations calibrate those mappings to
        the available engineering evidence and decision context, alongside the
        corresponding domain validation; the assumptions this rests on are
        stated in <Ref id="scope-assumptions" />.
      </p>
      <p className="fine-print">
        All numerical results are produced by the auditable mathematical engine;
        AI does not generate or alter the quantitative outputs.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 3. The causal mechanism                                             */
/* ================================================================== */

function MechanismSection() {
  return (
    <Section id="mechanism">
      <p>
        The model is a chain, not a score. The site conditions you provide
        resolve into <strong>Physical timing and uncertainty</strong>: a
        nominal delivery schedule for each site together with a distribution
        over how late that schedule may run. Delivery and a candidate capacity
        allocation together produce{" "}
        <strong>Usable capacity over time</strong>. That trajectory determines{" "}
        the <strong>Deadline consequences</strong> (the chance of meeting the
        date, the expected shortfall, and the delay burden), which, priced by
        the delay consequence and set against development cost, give the{" "}
        <strong>Cost and delay tradeoff</strong>. The model searches over
        candidate allocations on this chain and returns the one it selects as
        the <strong>Allocation decision</strong>.
      </p>
      <figure className="doc-figure">
        <MechanismDiagram />
        <figcaption className="figure-caption">
          The diagram traces two of the inputs you provide through the
          mechanism: the site conditions, which resolve into physical timing
          and uncertainty, and the delay consequence, which is weighed against
          cost. They are not the only inputs: site capacity, relative
          development cost, the required capacity, the target month and the
          analysis horizon are supplied too, and are listed in{" "}
          <Ref id="inputs" />. The capacity allocation is the model&rsquo;s
          decision variable: it is searched over, not set by you and not a
          computed result, and the final allocation decision is the candidate
          the model selects. Everything downstream of the inputs is computed.
          The diagram asserts the model&rsquo;s structure and nothing beyond
          it.
        </figcaption>
      </figure>
      <p>
        Each link is defined in the sections that follow, in the order the
        model evaluates them.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 4. Inputs and state mappings                                        */
/* ================================================================== */

function InputsSection({ state }: { state: FetchState<MappingsBundle> }) {
  return (
    <Section id="inputs">
      <p>
        Each candidate site carries four inputs: a maximum developable capacity{" "}
        <Var>K</Var>
        <sub>i</sub> in MW, a relative development cost per MW <Var>c</Var>
        <sub>i</sub>, a power-delivery complexity state <Var>B</Var>
        <sub>i</sub>, and a schedule uncertainty state <Var>U</Var>
        <sub>i</sub>. The system carries the required capacity <Var>D</Var>, the
        target month <Var>T</Var>*, the analysis horizon <Var>H</Var>, and the
        delay consequence <Var>λ</Var>.
      </p>
      <p>
        The two state inputs are where limited project knowledge enters. They
        are deliberately coarse, because a coarse judgment is usually what is
        available. The model's job is to make the step from that judgment to
        physical quantities explicit:
      </p>
      <ol className="translation-chain">
        <li>Limited qualitative or ordinal project knowledge</li>
        <li>State classification</li>
        <li>
          Explicit physical timing parameters and uncertainty distributions
        </li>
        <li>Quantitative evaluation</li>
      </ol>
      <p>
        <strong>
          The state numbers are identifiers, not quantities. State 4 does not
          mean twice state 2.
        </strong>{" "}
        No equation adds, weights, or averages <Var>B</Var>
        <sub>i</sub> or <Var>U</Var>
        <sub>i</sub>. Each state is looked up in a fixed published table that
        resolves it to the physical parameters below, and the engine operates
        only on those parameters: a different classification changes which row
        is read, never the scale of a number.
      </p>
      <p>
        These tables are the complete reference parameterization currently in
        force. Project implementations calibrate them against available project
        evidence where the decision context warrants it.
      </p>

      {state.status !== "ready" ? (
        <Pending state={state} what="state-mapping tables" />
      ) : (
        <>
          <BurdenMappingTable states={state.data.burden.states} />
          <UncertaintyMappingTable states={state.data.uncertainty.states} />
        </>
      )}

      <p>
        The complexity state fixes <em>when</em> power is nominally delivered;
        the uncertainty state fixes <em>how far that may slip, and with what
        probability</em>. The two are configured independently, and capacity
        and cost are independent of both: building those correlations into the
        inputs would manufacture the tradeoff the model exists to study.
      </p>
    </Section>
  );
}

function orderedStates<T>(states: Record<string, T>): [string, T][] {
  return Object.entries(states).sort((a, b) => Number(a[0]) - Number(b[0]));
}

function BurdenMappingTable({
  states,
}: {
  states: Record<string, BurdenStateDefinition>;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption>
          Power-delivery complexity states and the nominal delivery schedule
          each one resolves to. Months are counted from the start of the
          analysis horizon.
        </caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Label</th>
            <th scope="col">What it represents</th>
            <th scope="col" className="num">
              First stage (month)
            </th>
            <th scope="col" className="num">
              Full service (month)
            </th>
          </tr>
        </thead>
        <tbody>
          {orderedStates(states).map(([id, def]) => (
            <tr key={id}>
              <th scope="row">{id}</th>
              <td>{def.label}</td>
              <td>{def.interpretation}</td>
              <td className="num">{formatNumber(def.tau1_bar, 0)}</td>
              <td className="num">{formatNumber(def.tau2_bar, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UncertaintyMappingTable({
  states,
}: {
  states: Record<string, UncertaintyStateDefinition>;
}) {
  return (
    <div className="table-scroll">
      <table className="data-table">
        <caption>
          Schedule uncertainty states and the finite delay distribution each one
          resolves to. Delays are whole months and are never negative: the
          nominal schedule is a planned delivery date, not a statistical mean.
        </caption>
        <thead>
          <tr>
            <th scope="col">State</th>
            <th scope="col">Label</th>
            <th scope="col">What it represents</th>
            <th scope="col" className="num">
              Delay outcomes (months)
            </th>
            <th scope="col" className="num">
              Probabilities
            </th>
          </tr>
        </thead>
        <tbody>
          {orderedStates(states).map(([id, def]) => (
            <tr key={id}>
              <th scope="row">{id}</th>
              <td>{def.label}</td>
              <td>{def.interpretation}</td>
              <td className="num">
                {def.delay_months.map((d) => formatNumber(d, 0)).join(" / ")}
              </td>
              <td className="num">
                {def.probabilities.map((p) => formatNumber(p, 2)).join(" / ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ================================================================== */
/* 5. Phased power delivery                                            */
/* ================================================================== */

function PhasedDeliverySection() {
  return (
    <Section id="phased-delivery">
      <p>
        Power does not arrive at a site all at once. Each site has a nominal
        first-stage month and a nominal full-service month, both read from its
        power-delivery complexity state. At the first stage a fraction{" "}
        <Var>α</Var> of the site's capacity becomes available, the remainder at
        full service; <Var>α</Var> is 0.50 in this model version, so available
        power steps from none, to half capacity, to all of it.
      </p>
      <p>
        Uncertainty moves that schedule in time. A realized delay{" "}
        <Var>δ</Var>
        <sub>i</sub>, drawn from the site's schedule uncertainty state, shifts{" "}
        <strong>both</strong> stage dates by the same amount, preserving the
        internal structure of the delivery schedule.
      </p>
      <Equation
        lead="The realized stage dates for a site in one delay outcome are its nominal stage dates moved later by the same realized delay."
        reading="Tau sub i one, in scenario s, equals nominal tau bar sub i one plus delta sub i in scenario s; and tau sub i two, in scenario s, equals nominal tau bar sub i two plus the same delta sub i in scenario s."
        alt="Realized stage dates equal nominal stage dates plus the same site delay."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site, i = 1, …, N." },
          {
            symbol: SYM_S,
            meaning: "index of one joint delay outcome across all sites (a scenario).",
          },
          {
            symbol: (
              <>
                <TauNominalProse stage={1} />, <TauNominalProse stage={2} />
              </>
            ),
            meaning:
              "site i's nominal first-stage and full-service months, read from its power-delivery complexity state.",
          },
          {
            symbol: <DeltaRealizedProse />,
            meaning: "the realized delay drawn for site i in scenario s, from its schedule uncertainty state.",
          },
          {
            symbol: (
              <>
                <TauRealizedProse stage={1} />, <TauRealizedProse stage={2} />
              </>
            ),
            meaning:
              "site i's actual first-stage and full-service months in scenario s: the quantity this equation defines.",
          },
        ]}
      >
        <TauRealized stage={1} />
        <mo>=</mo>
        <TauNominal stage={1} />
        <mo>+</mo>
        <DeltaRealized />
        <mo separator="true">,</mo>
        <mspace width="1.6em" />
        <TauRealized stage={2} />
        <mo>=</mo>
        <TauNominal stage={2} />
        <mo>+</mo>
        <DeltaRealized />
      </Equation>
      <p>
        Available power is therefore a step function in time, not a single
        date: the primary output of the mapping layer, and the quantity every
        later metric is built on.
      </p>
      <Equation
        lead="Available power at a site is zero before the first stage, a fraction of its capacity between the two stages, and its full capacity from full service onwards."
        reading="A sub i in scenario s, at month t, equals zero when t is before the realized first-stage date; equals alpha times K sub i when t is at or after the realized first-stage date and before the realized full-service date; and equals K sub i when t is at or after the realized full-service date."
        alt="Available site power is a step function: zero, then alpha times capacity, then full capacity."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site." },
          { symbol: SYM_T, meaning: "the month being evaluated, a whole number of months from the start of the horizon." },
          { symbol: SYM_S, meaning: "index of one joint delay outcome (a scenario)." },
          {
            symbol: <SubSupSym base="A" sub="i" sup="(s)" />,
            meaning:
              "available power at site i in scenario s at month t, MW: the quantity this equation defines.",
          },
          { symbol: SYM_KI, meaning: "the site's maximum developable capacity, MW." },
          {
            symbol: SYM_ALPHA,
            meaning: "the tranche fraction: the share of a site's capacity available at the first stage. 0.50 in this model version.",
          },
          {
            symbol: (
              <>
                <TauRealizedProse stage={1} />, <TauRealizedProse stage={2} />
              </>
            ),
            meaning: "the site's realized first-stage and full-service months in scenario s.",
          },
        ]}
      >
        <AvailableAt time={<mi>t</mi>} />
        <mo>=</mo>
        <Cases
          rows={[
            [
              <mn key="v">0</mn>,
              <mrow key="c">
                <mtext>if&#xA0;</mtext>
                <mi>t</mi>
                <mo>&lt;</mo>
                <TauRealized stage={1} />
              </mrow>,
            ],
            [
              <mrow key="v">
                <mi>α</mi>
                <Ki />
              </mrow>,
              <mrow key="c">
                <mtext>if&#xA0;</mtext>
                <TauRealized stage={1} />
                <mo>&#x2264;</mo>
                <mi>t</mi>
                <mo>&lt;</mo>
                <TauRealized stage={2} />
              </mrow>,
            ],
            [
              <Ki key="v" />,
              <mrow key="c">
                <mtext>if&#xA0;</mtext>
                <mi>t</mi>
                <mo>&#x2265;</mo>
                <TauRealized stage={2} />
              </mrow>,
            ],
          ]}
        />
      </Equation>
      <p>
        Available power is not the same thing as capacity the developer has
        chosen to build: an allocation cannot use more than has become
        available at a site, and a site whose power has arrived contributes
        nothing if no capacity was allocated to it. That distinction is made
        precise in <Ref id="delivered-capacity" />.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 6. Timing uncertainty                                               */
/* ================================================================== */

function TimingUncertaintySection() {
  return (
    <Section id="timing-uncertainty">
      <p>
        Schedule uncertainty is a finite, site-specific probability
        distribution over whole-month delays, not a continuous distribution or
        a single pessimistic date. Each uncertainty state resolves to a short
        list of possible delays and the probability of each.
      </p>
      <Equation
        lead="A site's realized delay takes one of a small number of listed values, each with a stated probability, and those probabilities sum to one."
        reading="The probability that delta sub i equals d sub i k is p sub i k, for k running from 1 to q sub i; and the sum over k from 1 to q sub i of p sub i k equals 1."
        alt="Each site's delay follows a finite listed distribution whose probabilities sum to one."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site." },
          {
            symbol: <SubSym base="δ" sub="i" />,
            meaning: "site i's realized delay, in months.",
          },
          {
            symbol: <SubSym base="d" sub="ik" />,
            meaning: "the k-th possible delay value listed for site i.",
          },
          { symbol: <Var>k</Var>, meaning: "index over site i's own list of delay outcomes." },
          {
            symbol: <SubSym base="p" sub="ik" />,
            meaning: "the probability of delay outcome dᵢₖ at site i: the quantity this equation defines.",
          },
          {
            symbol: <SubSym base="q" sub="i" />,
            meaning: "the number of delay outcomes listed for site i.",
          },
        ]}
      >
        <mi>P</mi>
        <Group open="(" close=")">
          <msub>
            <mi>δ</mi>
            <mi>i</mi>
          </msub>
          <mo>=</mo>
          <msub>
            <mi>d</mi>
            <mrow>
              <mi>i</mi>
              <mi>k</mi>
            </mrow>
          </msub>
        </Group>
        <mo>=</mo>
        <msub>
          <mi>p</mi>
          <mrow>
            <mi>i</mi>
            <mi>k</mi>
          </mrow>
        </msub>
        <mo separator="true">,</mo>
        <mspace width="1.6em" />
        <munderover>
          <mo movablelimits="false">&#x2211;</mo>
          <mrow>
            <mi>k</mi>
            <mo>=</mo>
            <mn>1</mn>
          </mrow>
          <msub>
            <mi>q</mi>
            <mi>i</mi>
          </msub>
        </munderover>
        <msub>
          <mi>p</mi>
          <mrow>
            <mi>i</mi>
            <mi>k</mi>
          </mrow>
        </msub>
        <mo>=</mo>
        <mn>1</mn>
      </Equation>
      <p>
        Delays are non-negative: delivery can run late but never early, which
        is why the mapped stage dates are a planned schedule rather than an
        expected date. The number of outcomes <Var>q</Var>
        <sub>i</sub> is read per site from its own resolved distribution.
        Delays are drawn independently across sites, an assumption treated in{" "}
        <Ref id="scope-assumptions" />.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 7. Scenario construction                                            */
/* ================================================================== */

function ScenarioSection() {
  return (
    <Section id="scenarios">
      <p>
        A scenario is one joint outcome: a realized delay at every site at
        once. Because site delays are independent, its probability is the
        product of the per-site outcome probabilities it is made of.
      </p>
      <Equation
        lead="The probability of a joint delay outcome is the product across sites of each site's own outcome probability."
        reading="p sub s equals the product over i from 1 to N of p sub i, superscript s."
        alt="Joint scenario probability is the product of the per-site outcome probabilities."
        definitions={[
          {
            symbol: SYM_S,
            meaning: "a joint scenario: one realized delay outcome at every site at once.",
          },
          { symbol: SYM_I, meaning: "index of a candidate site." },
          { symbol: SYM_N, meaning: "the number of candidate sites." },
          {
            symbol: <SubSupSym base="p" sub="i" sup="(s)" />,
            meaning: "the probability of site i's own delay outcome in scenario s.",
          },
          {
            symbol: <SubSym base="p" sub="s" />,
            meaning: "the joint probability of scenario s: the quantity this equation defines.",
          },
        ]}
      >
        <msub>
          <mi>p</mi>
          <mi>s</mi>
        </msub>
        <mo>=</mo>
        <munderover>
          <mo movablelimits="false">&#x220F;</mo>
          <mrow>
            <mi>i</mi>
            <mo>=</mo>
            <mn>1</mn>
          </mrow>
          <mi>N</mi>
        </munderover>
        <msubsup>
          <mi>p</mi>
          <mi>i</mi>
          <mrow>
            <mo>(</mo>
            <mi>s</mi>
            <mo>)</mo>
          </mrow>
        </msubsup>
      </Equation>
      <p>
        The size of the complete joint space follows directly from how many
        outcomes each site has.
      </p>
      <Equation
        lead="The number of distinct joint delay outcomes is the product across sites of each site's own number of delay outcomes."
        reading="S full equals the product over i from 1 to N of q sub i."
        alt="The complete joint scenario count is the product of the per-site outcome counts."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site." },
          { symbol: SYM_N, meaning: "the number of candidate sites." },
          {
            symbol: <SubSym base="q" sub="i" />,
            meaning: "the number of delay outcomes listed for site i.",
          },
          {
            symbol: <SubSym base="S" sub="full" />,
            meaning:
              "the total number of distinct joint delay outcomes: the quantity this equation defines.",
          },
        ]}
      >
        <msub>
          <mi>S</mi>
          <mtext>full</mtext>
        </msub>
        <mo>=</mo>
        <munderover>
          <mo movablelimits="false">&#x220F;</mo>
          <mrow>
            <mi>i</mi>
            <mo>=</mo>
            <mn>1</mn>
          </mrow>
          <mi>N</mi>
        </munderover>
        <msub>
          <mi>q</mi>
          <mi>i</mi>
        </msub>
      </Equation>
      <p>
        That count decides how the scenario space is handled: while it stays
        tractable the model enumerates every joint outcome and weights it by
        its exact probability, and beyond that it draws seeded samples from the
        same joint distribution. Both paths are described in{" "}
        <Ref id="exact-monte-carlo" />, and every metric below is defined
        identically either way, as an expectation over the scenario set.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 8. Delivered usable capacity                                        */
/* ================================================================== */

function DeliveredCapacitySection() {
  return (
    <Section id="delivered-capacity">
      <p>
        The allocation is the decision. <Var>x</Var>
        <sub>i</sub> is the capacity, in MW, chosen for development at site{" "}
        <Var>i</Var>. Delivered usable capacity at a site is whichever is
        smaller: the capacity allocated there, or the power that has actually
        become available there by that month in that scenario.
      </p>
      <Equation
        lead="Delivered usable capacity at a site is the smaller of the capacity allocated to it and the power available there at that month in that scenario."
        reading="Y sub i at month t in scenario s equals the minimum of x sub i and A sub i at month t in scenario s."
        alt="Site delivered capacity is the minimum of allocated capacity and available power."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site." },
          { symbol: SYM_ARGS_TS, meaning: "the month t and the scenario s being evaluated." },
          {
            symbol: SYM_XI,
            meaning: "the capacity allocated to site i, MW: the decision variable.",
          },
          {
            symbol: <SubSupSym base="A" sub="i" sup="(s)" />,
            meaning: (
              <>
                available power at site i, month t, scenario s, MW (
                <Ref id="phased-delivery" />).
              </>
            ),
          },
          {
            symbol: <SubSym base="Y" sub="i" />,
            meaning:
              "delivered usable capacity at site i, month t, scenario s, MW: the quantity this equation defines.",
          },
        ]}
      >
        <msub>
          <mi>Y</mi>
          <mi>i</mi>
        </msub>
        <AtTS />
        <mo>=</mo>
        <mi>min</mi>
        <Group open="[" close="]">
          <Xi />
          <mo>,</mo>
          <msub>
            <mi>A</mi>
            <mi>i</mi>
          </msub>
          <AtTS />
        </Group>
      </Equation>
      <p>
        The minimum is the whole point, and it binds in both directions:
        allocating more to a site than its power supports wastes the
        allocation, and allocating less leaves that power unused.
      </p>
      <Equation
        lead="Total delivered usable capacity at a month in a scenario is the sum of the delivered capacity at every site."
        reading="Y at month t in scenario s equals the sum over i from 1 to N of Y sub i at month t in scenario s."
        alt="Total delivered capacity is the sum of per-site delivered capacity."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site, summed from 1 to N." },
          { symbol: SYM_N, meaning: "the number of candidate sites." },
          { symbol: SYM_ARGS_TS, meaning: "the month t and the scenario s being evaluated." },
          {
            symbol: <SubSym base="Y" sub="i" />,
            meaning: "delivered usable capacity at site i, month t, scenario s, defined above.",
          },
          {
            symbol: (
              <>
                <Var>Y</Var>
                {SYM_ARGS_TS}
              </>
            ),
            meaning:
              "total delivered usable capacity across all sites at month t, scenario s, MW: the quantity this equation defines.",
          },
        ]}
      >
        <mi>Y</mi>
        <AtTS />
        <mo>=</mo>
        <SumI />
        <msub>
          <mi>Y</mi>
          <mi>i</mi>
        </msub>
        <AtTS />
      </Equation>
      <p>
        This trajectory is the principal system quantity; every decision metric
        in the next section is a reading taken from it.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 9. Deadline performance                                             */
/* ================================================================== */

function DeadlinePerformanceSection() {
  return (
    <Section id="deadline-performance">
      <p>
        Deadline performance is measured three ways, because a deadline can be
        missed in three different senses: whether it is missed at all, by how
        much on the day, and for how long the shortage then persists.
      </p>

      <Subsection id="p-meet" title="Chance of meeting the target date">
        <Equation
          lead="A scenario either meets the requirement by the target month or it does not; this indicator records which."
          reading="M sub s equals 1 when Y at the target month in scenario s is greater than or equal to D, and 0 otherwise."
          alt="An indicator that is one when the requirement is met by the target month."
          definitions={[
            { symbol: SYM_S, meaning: "a joint scenario (one delay outcome at every site at once)." },
            { symbol: SYM_TSTAR, meaning: "the target month by which the required capacity is needed." },
            {
              symbol: (
                <>
                  <Var>Y</Var>({SYM_TSTAR}, {SYM_S})
                </>
              ),
              meaning: "delivered usable capacity at the target month in scenario s.",
            },
            { symbol: SYM_D, meaning: "the required usable capacity, MW." },
            {
              symbol: <SubSym base="M" sub="s" />,
              meaning:
                "indicator equal to 1 when scenario s meets the requirement by the target month, otherwise 0: the quantity this equation defines.",
            },
          ]}
        >
          <msub>
            <mi>M</mi>
            <mi>s</mi>
          </msub>
          <mo>=</mo>
          <Cases
            rows={[
              [
                <mn key="v">1</mn>,
                <mrow key="c">
                  <mtext>if&#xA0;</mtext>
                  <mi>Y</mi>
                  <mo>(</mo>
                  <TargetMonth />
                  <mo>,</mo>
                  <mi>s</mi>
                  <mo>)</mo>
                  <mo>&#x2265;</mo>
                  <mi>D</mi>
                </mrow>,
              ],
              [
                <mn key="v">0</mn>,
                <mrow key="c">
                  <mtext>otherwise</mtext>
                </mrow>,
              ],
            ]}
          />
        </Equation>
        <Equation
          lead="The chance of meeting the target date is the probability-weighted share of scenarios in which the requirement is met by the target month."
          reading="P meet equals the expectation of M sub s."
          alt="The probability of meeting the target is the expectation of the indicator."
          definitions={[
            { symbol: SYM_S, meaning: "index of a scenario, ranging over every modeled joint delay outcome." },
            { symbol: <SubSym base="M" sub="s" />, meaning: "the meet indicator for scenario s, defined above." },
            {
              symbol: <SubSym base="P" sub="meet" />,
              meaning:
                "the probability-weighted share of scenarios that meet the requirement by the target month: the quantity this equation defines.",
            },
          ]}
        >
          <msub>
            <mi>P</mi>
            <mtext>meet</mtext>
          </msub>
          <mo>=</mo>
          <mi>E</mi>
          <Group open="[" close="]">
            <msub>
              <mi>M</mi>
              <mi>s</mi>
            </msub>
          </Group>
        </Equation>
        <p>
          It answers a yes-or-no question and says nothing about severity: a
          plan that misses the date by 1 MW and one that misses it by 400 MW
          score identically here.
        </p>
      </Subsection>

      <Subsection id="shortfall" title="Shortfall at the target date">
        <Equation
          lead="Shortfall is how much required capacity is still missing on the target month itself, and it is never negative: capacity beyond the requirement is not counted as a credit."
          reading="S sub s equals the maximum of zero and D minus Y at the target month in scenario s."
          alt="Shortfall is the unmet requirement at the target month, floored at zero."
          definitions={[
            { symbol: SYM_S, meaning: "index of a scenario." },
            { symbol: SYM_TSTAR, meaning: "the target month." },
            { symbol: SYM_D, meaning: "the required usable capacity, MW." },
            {
              symbol: (
                <>
                  <Var>Y</Var>({SYM_TSTAR}, {SYM_S})
                </>
              ),
              meaning: "delivered usable capacity at the target month in scenario s.",
            },
            {
              symbol: <SubSym base="S" sub="s" />,
              meaning:
                "capacity still missing at the target month in scenario s, floored at zero: the quantity this equation defines.",
            },
          ]}
        >
          <msub>
            <mi>S</mi>
            <mi>s</mi>
          </msub>
          <mo>=</mo>
          <mi>max</mi>
          <Group open="[" close="]">
            <mn>0</mn>
            <mo>,</mo>
            <mi>D</mi>
            <mo>&#x2212;</mo>
            <mi>Y</mi>
            <Group open="(" close=")">
              <TargetMonth />
              <mo>,</mo>
              <mi>s</mi>
            </Group>
          </Group>
        </Equation>
        <Equation
          lead="The expected shortfall averages that missing capacity across scenarios, weighted by how likely each one is."
          reading="The expectation of S equals the sum over scenarios s of p sub s times S sub s."
          alt="Expected shortfall is the probability-weighted average of the per-scenario shortfall."
          definitions={[
            { symbol: SYM_S, meaning: "index of a scenario." },
            { symbol: <SubSym base="p" sub="s" />, meaning: "the joint probability of scenario s." },
            { symbol: <SubSym base="S" sub="s" />, meaning: "the target-date shortfall in scenario s, defined above." },
            {
              symbol: (
                <>
                  <Var>E</Var>[<Var>S</Var>]
                </>
              ),
              meaning:
                "the expected shortfall at the target date, MW: the quantity this equation defines.",
            },
          ]}
        >
          <mi>E</mi>
          <Group open="[" close="]">
            <mi>S</mi>
          </Group>
          <mo>=</mo>
          <munder>
            <mo movablelimits="false">&#x2211;</mo>
            <mi>s</mi>
          </munder>
          <msub>
            <mi>p</mi>
            <mi>s</mi>
          </msub>
          <msub>
            <mi>S</mi>
            <mi>s</mi>
          </msub>
        </Equation>
        <p>
          Shortfall is measured in MW, at the target month itself, and
          carries no information about what happens in the months that
          follow.
        </p>
      </Subsection>

      <Subsection id="delay-burden" title="Expected delay burden">
        <Equation
          lead="At any month from the target month onwards, the capacity still missing is the requirement less what has been delivered, floored at zero."
          reading="Q at month t in scenario s equals the maximum of zero and D minus Y at month t in scenario s."
          alt="Missing capacity at a month is the unmet requirement, floored at zero."
          definitions={[
            { symbol: SYM_ARGS_TS, meaning: "the month t and the scenario s being evaluated." },
            { symbol: SYM_D, meaning: "the required usable capacity, MW." },
            {
              symbol: (
                <>
                  <Var>Y</Var>
                  {SYM_ARGS_TS}
                </>
              ),
              meaning: "delivered usable capacity at month t, scenario s.",
            },
            {
              symbol: (
                <>
                  <Var>Q</Var>
                  {SYM_ARGS_TS}
                </>
              ),
              meaning:
                "capacity still missing at month t in scenario s, floored at zero: the quantity this equation defines.",
            },
          ]}
        >
          <mi>Q</mi>
          <AtTS />
          <mo>=</mo>
          <mi>max</mi>
          <Group open="[" close="]">
            <mn>0</mn>
            <mo>,</mo>
            <mi>D</mi>
            <mo>&#x2212;</mo>
            <mi>Y</mi>
            <AtTS />
          </Group>
        </Equation>
        <Equation
          lead="The delay burden in one scenario accumulates that missing capacity month by month, from the target month through the end of the analysis horizon."
          reading="L sub s equals the sum over months t from the target month to the horizon H of Q at month t in scenario s."
          alt="Scenario delay burden is missing capacity summed over months from the target month to the horizon."
          definitions={[
            { symbol: SYM_S, meaning: "index of a scenario." },
            { symbol: SYM_T, meaning: "the month index, running from the target month through the horizon in the sum." },
            { symbol: SYM_TSTAR, meaning: "the target month: the first month counted in the sum." },
            { symbol: SYM_H, meaning: "the analysis horizon: the last month counted in the sum." },
            {
              symbol: (
                <>
                  <Var>Q</Var>
                  {SYM_ARGS_TS}
                </>
              ),
              meaning: "capacity still missing at month t in scenario s, defined above.",
            },
            {
              symbol: <SubSym base="L" sub="s" />,
              meaning:
                "the delay burden accumulated in scenario s, MW-months: the quantity this equation defines.",
            },
          ]}
        >
          <msub>
            <mi>L</mi>
            <mi>s</mi>
          </msub>
          <mo>=</mo>
          <munderover>
            <mo movablelimits="false">&#x2211;</mo>
            <mrow>
              <mi>t</mi>
              <mo>=</mo>
              <TargetMonth />
            </mrow>
            <mi>H</mi>
          </munderover>
          <mi>Q</mi>
          <AtTS />
        </Equation>
        <Equation
          lead="The expected delay burden averages that accumulated shortage across scenarios, weighted by how likely each one is."
          reading="The expectation of L equals the sum over scenarios s of p sub s times L sub s."
          alt="Expected delay burden is the probability-weighted average of the per-scenario delay burden."
          definitions={[
            { symbol: SYM_S, meaning: "index of a scenario." },
            { symbol: <SubSym base="p" sub="s" />, meaning: "the joint probability of scenario s." },
            { symbol: <SubSym base="L" sub="s" />, meaning: "the scenario delay burden, defined above." },
            {
              symbol: (
                <>
                  <Var>E</Var>[<Var>L</Var>]
                </>
              ),
              meaning:
                "the expected delay burden across scenarios, MW-months: the quantity this equation defines.",
            },
          ]}
        >
          <mi>E</mi>
          <Group open="[" close="]">
            <mi>L</mi>
          </Group>
          <mo>=</mo>
          <munder>
            <mo movablelimits="false">&#x2211;</mo>
            <mi>s</mi>
          </munder>
          <msub>
            <mi>p</mi>
            <mi>s</mi>
          </msub>
          <msub>
            <mi>L</mi>
            <mi>s</mi>
          </msub>
        </Equation>
        <p>
          The delay burden is measured in MW-months. It captures both how much
          capacity is missing and for how long, which is why it, and not
          shortfall, carries timing into the objective.
        </p>
        <p>
          <strong>
            The sum runs from the target month through the analysis horizon,
            inclusive of both.
          </strong>{" "}
          The target month is the first month counted, not the month after it,
          which is why a shortfall on the target date always contributes to the
          delay burden as well. The horizon is the last month counted: capacity
          still missing beyond it adds no further burden to this measure. The
          horizon is therefore part of the question being asked, not a
          formality. Changing it changes the expected delay burden, and with
          it the allocation and the delay-consequence values at which the
          allocation changes. Some mapped delivery outcomes can fall beyond the
          horizon, in which case the capacity they would eventually bring is
          simply outside the window the model scores.
        </p>
        <p>
          Time is evaluated on whole-month points, one month apart. Every stage
          date, delay outcome, target month and horizon is a whole number of
          months, and the sum above is a sum over those points, not an integral
          over continuous time.
        </p>
      </Subsection>

      <Subsection
        id="shortfall-vs-burden"
        title="Why shortfall and delay burden are different"
      >
        <p>
          They answer different questions and can move in opposite directions.
          Shortfall asks how much capacity is missing on the target month;
          delay burden asks how much capacity-time is lost from the target
          month through the analysis horizon. The two deliberately overlap at
          the target month, because they answer different questions about it:
          one is the depth of the shortage on that date, the other is the first
          month of the accumulation. Two plans with an identical shortfall have entirely
          different delay burdens if one recovers in a month and the other in
          two years, and a plan that misses the date narrowly but recovers
          slowly can carry more delay burden than one that misses it widely and
          recovers at once.
        </p>
        <p>
          All three are therefore reported: the chance of meeting the date is a
          risk statement, shortfall is a severity statement at one date, and
          delay burden is a duration-weighted statement about the consequence
          of being late.
        </p>
      </Subsection>
    </Section>
  );
}

/* ================================================================== */
/* 10. Development cost                                                 */
/* ================================================================== */

function DevelopmentCostSection() {
  return (
    <Section id="development-cost">
      <p>
        Development cost is the cost of the capacity chosen, summed across
        sites. It is linear in the allocation.
      </p>
      <Equation
        lead="Development cost is each site's cost per MW multiplied by the capacity allocated there, summed over sites."
        reading="C dev equals the sum over i of c sub i times x sub i."
        alt="Development cost is the sum over sites of cost per MW times allocated capacity."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site, summed over every site." },
          { symbol: SYM_CI, meaning: "the relative development cost per MW at site i." },
          { symbol: SYM_XI, meaning: "the capacity allocated to site i, MW." },
          {
            symbol: <SubSym base="C" sub="dev" />,
            meaning: "total development cost, in relative units: the quantity this equation defines.",
          },
        ]}
      >
        <msub>
          <mi>C</mi>
          <mtext>dev</mtext>
        </msub>
        <mo>=</mo>
        <SumI upper={false} />
        <msub>
          <mi>c</mi>
          <mi>i</mi>
        </msub>
        <Xi />
      </Equation>
      <p>
        <strong>These are relative, normalized cost values, not currency.</strong>{" "}
        A site at 1.15 costs 15 percent more per MW than a site at 1.00; that
        ratio is the entire content of the number. The cost model is
        deliberately plain in this version: no fixed site-opening cost, no
        economies of scale, and no financing effects.
      </p>
      <p>
        The per-site input is labelled <em>relative cost per MW</em> and the
        total <em>relative development cost</em>, and every reported total
        carries relative units rather than a currency symbol. Cost figures can
        land in the same numeric range as the MW figures beside them without
        being comparable to them: one is a normalized index, the other is
        capacity.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 11. Delay consequence                                               */
/* ================================================================== */

function DelayConsequenceSection() {
  return (
    <Section id="delay-consequence">
      <p>
        The delay consequence <Var>λ</Var> is the consequence assigned to one
        MW-month of unmet capacity. It converts missing capacity-time into the
        units of development cost, so the two can be weighed against each other
        at all.
      </p>
      <Equation
        lead="In one scenario, the consequence of delay is the delay consequence multiplied by that scenario's delay burden; in expectation it is the delay consequence multiplied by the expected delay burden."
        reading="C delay in scenario s equals lambda times L sub s; and the expectation of C delay equals lambda times the expectation of L."
        alt="Delay consequence is lambda multiplied by the delay burden, per scenario and in expectation."
        definitions={[
          { symbol: SYM_S, meaning: "index of a scenario." },
          {
            symbol: SYM_LAMBDA,
            meaning: "the delay consequence: the economic weight assigned to one MW-month of unmet capacity, relative-cost units per MW-month.",
          },
          { symbol: <SubSym base="L" sub="s" />, meaning: "the delay burden in scenario s." },
          {
            symbol: (
              <>
                <Var>E</Var>[<Var>L</Var>]
              </>
            ),
            meaning: "the expected delay burden across scenarios.",
          },
          {
            symbol: <SubSym base="C" sub="delay,s" />,
            meaning: "the priced consequence of delay in scenario s.",
          },
          {
            symbol: (
              <>
                <Var>E</Var>[<SubSym base="C" sub="delay" />]
              </>
            ),
            meaning: "the expected priced consequence of delay: both quantities this equation defines.",
          },
        ]}
      >
        <msub>
          <mi>C</mi>
          <mrow>
            <mtext>delay</mtext>
            <mo>,</mo>
            <mi>s</mi>
          </mrow>
        </msub>
        <mo>=</mo>
        <mi>λ</mi>
        <msub>
          <mi>L</mi>
          <mi>s</mi>
        </msub>
        <mo separator="true">,</mo>
        <mspace width="1.6em" />
        <mi>E</mi>
        <Group open="[" close="]">
          <msub>
            <mi>C</mi>
            <mtext>delay</mtext>
          </msub>
        </Group>
        <mo>=</mo>
        <mi>λ</mi>
        <mi>E</mi>
        <Group open="[" close="]">
          <mi>L</mi>
        </Group>
      </Equation>
      <p>
        <strong>
          The delay consequence is a value the user sets, not an empirical
          constant, a market price, or a figure the model supplies.
        </strong>{" "}
        Read it as a position: how much additional relative development cost is
        worth accepting to remove one MW-month of expected unmet capacity. At
        zero it states that delay carries no consequence, reducing the problem
        to pure cost minimization. Because it is a position rather than a
        measurement, the useful question is not which value is correct but how
        far it would have to move before the answer changes, which is what{" "}
        <Ref id="lambda-sensitivity" /> is about.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 12. The objective                                                   */
/* ================================================================== */

function ObjectiveSection() {
  return (
    <Section id="objective">
      <p>
        The objective combines the two things the decision actually trades
        against each other: what the capacity costs to develop, and what its
        expected lateness costs.
      </p>
      <Equation
        lead="The objective is development cost plus the delay consequence multiplied by the expected delay burden."
        reading="J equals C dev plus lambda times the expectation of L."
        alt="The objective J is development cost plus lambda times expected delay burden."
        definitions={[
          {
            symbol: <SubSym base="C" sub="dev" />,
            meaning: (
              <>
                development cost, in relative units (<Ref id="development-cost" />
                ).
              </>
            ),
          },
          {
            symbol: SYM_LAMBDA,
            meaning: "the delay consequence: the economic weight assigned to one MW-month of unmet capacity.",
          },
          {
            symbol: (
              <>
                <Var>E</Var>[<Var>L</Var>]
              </>
            ),
            meaning: "the expected delay burden across scenarios, MW-months.",
          },
          {
            symbol: <Var>J</Var>,
            meaning:
              "the objective the optimization minimizes: the quantity this equation defines.",
          },
        ]}
      >
        <mi>J</mi>
        <mo>=</mo>
        <msub>
          <mi>C</mi>
          <mtext>dev</mtext>
        </msub>
        <mo>+</mo>
        <mi>λ</mi>
        <mi>E</mi>
        <Group open="[" close="]">
          <mi>L</mi>
        </Group>
      </Equation>
      <p>
        <Var>J</Var> is the mathematical tradeoff the optimization minimizes,
        not a rating or a public score, and it is not reported as one: both its
        terms are relative, so it orders allocations under one stated delay
        consequence on one portfolio and means nothing as an absolute figure.
        No further risk penalty, variance term, or robustness weighting is
        added; an additional term would have to earn its place by expressing a
        decision this objective cannot.
      </p>
      <p>
        <strong>
          Development cost and the expected delay burden are the only two
          quantities the optimization acts on.
        </strong>{" "}
        The chance of meeting the target date and the expected shortfall at
        that date are reported because a decision-maker needs them, but they
        are diagnostics of the resulting allocation, not separate optimization
        targets: no term in <Var>J</Var> contains either of them, and the model
        carries no constraint requiring the chance of meeting the date to reach
        any particular level. A plan with a better chance of meeting the date
        is not preferred on that ground unless it also improves <Var>J</Var>.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 13. Benchmark strategies                                            */
/* ================================================================== */

const BENCHMARKS: {
  publicLabel: string;
  canonical: string;
  description: string;
}[] = [
  {
    publicLabel: "Cost first",
    canonical: "cost concentration",
    description:
      "Rank the sites by relative development cost per MW, cheapest first. Take the full capacity of each in turn until the required capacity is covered; the last site taken supplies only the remainder.",
  },
  {
    publicLabel: "Schedule first",
    canonical: "speed / reliability",
    description:
      "Rank the sites by their nominal full-service month, earliest first, breaking ties on the site's expected delay. Fill from that ranking exactly as above. The two keys are compared in order, never combined into a score.",
  },
  {
    publicLabel: "Spread across sites",
    canonical: "diversified",
    description:
      "Give every site the same share of its own capacity: xᵢ = D Kᵢ / Σ Kⱼ. Where the requirement is at or above the portfolio's total capacity, every site is taken in full.",
  },
];

function BenchmarkSection() {
  return (
    <Section id="benchmarks">
      <p>
        Three deliberately unsophisticated allocations serve as reference
        points: they give the optimized result something interpretable to be
        compared against, and show that the ranking between plausible simple
        policies is itself a function of the delay consequence. Each is a fixed
        deterministic rule, stated in full below so it can be reproduced by
        hand; none of them searches, and none of them is an optimizer. Where a
        rule leaves an exact tie, with two sites identical on every key it
        ranks on, the sites are taken in the order they were given, so the same
        inputs always produce the same benchmark allocation.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            The three benchmark strategies, their public labels, and the
            canonical names used in the specification.
          </caption>
          <thead>
            <tr>
              <th scope="col">Public label</th>
              <th scope="col">Canonical strategy</th>
              <th scope="col">What it does</th>
            </tr>
          </thead>
          <tbody>
            {BENCHMARKS.map((b) => (
              <tr key={b.canonical}>
                <th scope="row">{b.publicLabel}</th>
                <td>{b.canonical}</td>
                <td>{b.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        None of the three is universally better: which has the lowest objective
        depends on the portfolio and on the delay consequence, and the ranking
        changes as that consequence changes. On a particular portfolio one of
        them can also be worse than another at every delay consequence. That is
        a finding about that portfolio, not a defect in the benchmark: these
        rules are fixed and interpretable by design, and are not adjusted to
        keep each of them competitive.
      </p>
      <p>
        <strong>
          The three benchmarks are reference points, not the set of allocations
          available.
        </strong>{" "}
        They are three members of a continuous feasible set, and the best
        allocation in that set is usually none of them. The optimization in{" "}
        <Ref id="optimization" /> searches the whole set; the benchmarks are
        only there to make its result legible.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 14. Allocation optimization                                         */
/* ================================================================== */

function OptimizationSection() {
  return (
    <Section id="optimization">
      <p>
        The feasible set is defined by two conditions: no site may be developed
        beyond its own maximum capacity, and the total allocation must at least
        cover the requirement.
      </p>
      <Equation
        lead="Each site's allocation lies between zero and that site's maximum developable capacity, and the allocations together must be at least the required capacity."
        reading="Zero is less than or equal to x sub i, which is less than or equal to K sub i, for every site i; and the sum over i of x sub i is greater than or equal to D."
        alt="Allocations are bounded by site capacity and must together cover the requirement."
        definitions={[
          { symbol: SYM_I, meaning: "index of a candidate site." },
          { symbol: SYM_XI, meaning: "the capacity allocated to site i, MW: the decision variable." },
          { symbol: SYM_KI, meaning: "the maximum developable capacity at site i, MW." },
          { symbol: SYM_D, meaning: "the required usable capacity, MW." },
        ]}
      >
        <mtable columnalign="left" rowspacing="0.5em">
          <mtr>
            <mtd>
              <mrow>
                <mn>0</mn>
                <mo>&#x2264;</mo>
                <Xi />
                <mo>&#x2264;</mo>
                <Ki />
                <mo separator="true">,</mo>
                <mspace width="1em" />
                <mtext>for every site&#xA0;</mtext>
                <mi>i</mi>
              </mrow>
            </mtd>
          </mtr>
          <mtr>
            <mtd>
              <mrow>
                <SumI upper={false} />
                <Xi />
                <mo>&#x2265;</mo>
                <mi>D</mi>
              </mrow>
            </mtd>
          </mtr>
        </mtable>
      </Equation>
      <p>
        Total allocation may exceed the requirement. Deliberate redundancy can
        be worth its cost when the consequence of unmet capacity is high, so
        whether overcapacity helps is left as a result rather than fixed as an
        assumption.
      </p>
      <Equation
        lead="The optimization looks for the allocation that minimizes development cost plus the priced expected delay burden, over that feasible set; both terms are functions of the allocation."
        reading="Minimize over x the quantity: the sum over i of c sub i times x sub i, plus lambda times the expectation of L as a function of x."
        alt="Minimize development cost plus lambda times expected delay burden over the feasible allocations."
        definitions={[
          {
            symbol: <Var>x</Var>,
            meaning: "the allocation vector (x₁, …, x_N) being searched over.",
          },
          { symbol: SYM_I, meaning: "index of a candidate site, summed over every site." },
          { symbol: SYM_CI, meaning: "the relative development cost per MW at site i." },
          { symbol: SYM_XI, meaning: "the capacity allocated to site i, MW." },
          { symbol: SYM_LAMBDA, meaning: "the delay consequence." },
          {
            symbol: (
              <>
                <Var>E</Var>[<Var>L</Var>](<Var>x</Var>)
              </>
            ),
            meaning: "the expected delay burden, as a function of the allocation x.",
          },
        ]}
      >
        <munder>
          <mo movablelimits="false">min</mo>
          <mi>x</mi>
        </munder>
        <Group open="[" close="]">
          <SumI upper={false} />
          <msub>
            <mi>c</mi>
            <mi>i</mi>
          </msub>
          <Xi />
          <mo>+</mo>
          <mi>λ</mi>
          <mi>E</mi>
          <Group open="[" close="]">
            <mi>L</mi>
          </Group>
          <mrow>
            <mo>(</mo>
            <mi>x</mi>
            <mo>)</mo>
          </mrow>
        </Group>
      </Equation>

      <Subsection id="method" title="How the problem is solved">
        <p>
          The two terms behave differently in the allocation. Development cost
          is linear in it. Delivered capacity at a site is the smaller of the
          allocation and the available power, so it is concave and
          piecewise-linear; the capacity still missing is therefore convex and
          piecewise-linear, and so are the delay burden and its expectation.
          For a non-negative delay consequence the objective is a non-negative
          combination of the two, and is convex piecewise-linear in the
          allocation.
        </p>
        <p>
          That structure is what makes the problem tractable exactly rather
          than approximately. Written over the exact scenario set, with
          auxiliary variables standing for delivered capacity at each site,
          month and scenario and for the capacity still missing at each month
          and scenario, the whole problem becomes a{" "}
          <strong>linear program</strong> over the feasible polytope above. The
          resulting linear program is solved numerically with HiGHS. Linear
          programming has no separate local minima to be trapped in, so a
          successfully solved and verified result is a global minimum of the
          stated formulation, subject to the reported numerical tolerances. It
          is not the best point found by a local search, and not the best of a
          sampled or gridded set of candidate allocations.
        </p>
        <p>
          The auxiliary variables carry no meaning of their own and are never
          reported. Every quantity published for the resulting allocation, from
          development cost to the chance of meeting the target date, the
          expected shortfall and the expected delay burden, is produced by
          re-evaluating that allocation through the same definitions above,
          and the two objective values are required to agree within a stated
          numerical bound before any result is reported at all.
        </p>
        <p>
          Solver outputs are floating-point numbers, and are reported as
          numerical solutions rather than exact arithmetic. Where a reported
          value depends on a tolerance, that tolerance is stated with it:{" "}
          <Ref id="co-optimality" /> for uniqueness, and{" "}
          <Ref id="lambda-sensitivity" /> for the located regime boundaries.
        </p>
      </Subsection>

      <Subsection id="forced-allocation" title="When there is no choice to make">
        <p>
          Two structural conditions are exact, and only these two are
          recognized. The first is that the portfolio cannot cover the required
          capacity at all, so there is nothing to optimize over. This is a
          statement about the <em>capacity constraint</em> and says nothing
          about dates: an allocation that satisfies the capacity constraint may
          still fail to deliver that capacity by the target month, which is a
          question of deadline performance (<Ref id="deadline-performance" />)
          rather than of feasibility.
        </p>
        <Equation
          lead="If the total capacity of all candidate sites is below the required capacity, no allocation satisfies the capacity constraint, so the feasible set is empty."
          reading="If the sum over i of K sub i is less than D, then no feasible allocation exists."
          alt="Total site capacity below the requirement means no feasible allocation exists."
          definitions={[
            { symbol: SYM_I, meaning: "index of a candidate site, summed over every site." },
            { symbol: SYM_KI, meaning: "the maximum developable capacity at site i, summed over every site." },
            { symbol: SYM_D, meaning: "the required usable capacity, MW." },
          ]}
        >
          <SumI upper={false} />
          <Ki />
          <mo>&lt;</mo>
          <mi>D</mi>
          <mspace width="1.4em" />
          <mo>&#x27F9;</mo>
          <mspace width="1.4em" />
          <mtext>no feasible allocation</mtext>
        </Equation>
        <p>
          The second is the forced case. If the total capacity of all candidate
          sites is exactly equal to the required capacity, then the only way to
          satisfy the constraints is to use every site in full.
        </p>
        <Equation
          lead="If total site capacity exactly equals the required capacity, the feasible set collapses to a single allocation in which every site is fully used."
          reading="If the sum over i of K sub i equals D, then x sub i equals K sub i for every site i, and that is the only feasible allocation."
          alt="Total site capacity equal to the requirement forces every site to be fully used."
          definitions={[
            { symbol: SYM_I, meaning: "index of a candidate site, summed over every site." },
            { symbol: SYM_KI, meaning: "the maximum developable capacity at site i, summed over every site." },
            { symbol: SYM_D, meaning: "the required usable capacity, MW." },
            { symbol: SYM_XI, meaning: "the capacity allocated to site i, forced equal to Kᵢ in this case." },
          ]}
        >
          <SumI upper={false} />
          <Ki />
          <mo>=</mo>
          <mi>D</mi>
          <mspace width="1.4em" />
          <mo>&#x27F9;</mo>
          <mspace width="1.4em" />
          <Xi />
          <mo>=</mo>
          <Ki />
          <mspace width="0.6em" />
          <mtext>for every&#xA0;</mtext>
          <mi>i</mi>
        </Equation>
        <p>
          There is then no allocation choice left to make. The optimization
          still runs, and the delivery outlook, the chance of meeting the date,
          the shortfall and the delay burden all remain meaningful, but the
          allocation is determined by the arithmetic of the portfolio rather
          than selected among alternatives; presenting it as a recommendation
          would misstate what happened.
        </p>
        <p>
          These are the only two structural conditions the presentation claims.
          When total capacity exceeds the requirement, the model makes no
          statement about how much room the feasible set has or how much any
          site must carry. That would require a diagnostic it does not compute.
        </p>
      </Subsection>
    </Section>
  );
}

/* ================================================================== */
/* 15. Co-optimal and effectively tied results                         */
/* ================================================================== */

function CoOptimalitySection({
  showcase,
  state,
}: {
  showcase: ShowcaseExport | null;
  state: FetchState<PresetExport>;
}) {
  const tiedVertex =
    showcase?.lambda_envelope?.vertices.find(
      (v) => !v.is_unique_within_tolerance,
    ) ?? null;
  const tolerance =
    tiedVertex?.cooptimality_tolerance ??
    showcase?.optimizer?.result.cooptimality_tolerance ??
    null;
  const tiedLambda = finiteLam(tiedVertex);

  return (
    <Section id="co-optimality">
      <p>
        An optimization does not always have one answer. Development cost is
        linear in the allocation and the expected delay burden is convex and
        piecewise-linear in it, so the objective is convex piecewise-linear:
        its minimizing set can contain more than one allocation rather than a
        single point. At particular values of the delay consequence whole
        families of allocations therefore share the same objective value, or
        differ by less than the tolerance the solver can resolve. Those
        allocations are <strong>effectively tied</strong>, and the result
        carries a uniqueness flag to say so: where it reports the result as not
        unique within tolerance, the allocation shown is{" "}
        <strong>one representative</strong> of a tied set, and a different
        equally optimal allocation could have been returned in its place.
      </p>
      {tolerance !== null ? (
        <p>
          Uniqueness is judged against an explicit numerical tolerance rather
          than exact arithmetic. For the example used throughout this
          documentation that tolerance is{" "}
          <ScientificNumber value={tolerance} />.{" "}
          <strong>
            It is a tolerance on the objective value used by the numerical
            co-optimality probe.
          </strong>{" "}
          It is not a tolerance in MW on any allocation, and a result reported
          as unique within it is not a mathematical proof of uniqueness: it
          means no alternative allocation was found whose objective lies within
          that many objective units of the optimum.
        </p>
      ) : null}

      <h3 className="subsection-heading">Reading per-coordinate ranges</h3>
      <p>
        Where a result is not unique, the model also reports the lowest and
        highest capacity each site takes across the tied set. These are{" "}
        <strong>marginal ranges, one coordinate at a time</strong>: each is a
        true statement about that site on its own.
      </p>
      <p>
        <strong>
          They must not be read as a box of jointly feasible allocations.
        </strong>{" "}
        The coordinates are linked by the requirement constraint, so taking
        every site at the top of its range, or every site at the bottom,
        generally produces an allocation that is not feasible at all. The
        ranges say how far one site can move somewhere in the tied set, not
        that the sites move independently.
      </p>
      {tiedLambda !== null ? (
        <p>
          The worked case below is the tie at one specific value of the delay
          consequence, <span className="num">λ ≈ {formatNumber(tiedLambda, 4)}</span>
          , which is a located boundary between two decision regimes (
          <Ref id="lambda-sensitivity" />
          ). A tie at a boundary is expected there and only there: it is the
          value at which the allocations on either side have exactly equal
          objectives. It is not a property of the regimes on either side of it,
          where ordinary solves return a single allocation.
        </p>
      ) : null}
      {tiedVertex ? (
        <CoordinateBoundsTable vertex={tiedVertex} />
      ) : showcase ? null : (
        <Pending state={state} what="worked example" />
      )}
    </Section>
  );
}

function CoordinateBoundsTable({ vertex }: { vertex: EnvelopeVertex }) {
  const ids = Object.keys(vertex.allocation);
  const boundsSum = ids.reduce(
    (sum, id) => sum + (vertex.coordinate_bounds[id]?.[1] ?? 0),
    0,
  );
  const allocSum = ids.reduce((sum, id) => sum + (vertex.allocation[id] ?? 0), 0);
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            A worked case from the example portfolio: one effectively tied
            result, the representative allocation returned, and the marginal
            range reported for each site.
          </caption>
          <thead>
            <tr>
              <th scope="col">Site</th>
              <th scope="col" className="num">
                Representative allocation
              </th>
              <th scope="col" className="num">
                Marginal range
              </th>
            </tr>
          </thead>
          <tbody>
            {ids.map((id) => {
              const bounds = vertex.coordinate_bounds[id];
              return (
                <tr key={id}>
                  <th scope="row">Site {id}</th>
                  <td className="num">{formatMw(vertex.allocation[id] ?? 0)}</td>
                  <td className="num">
                    {bounds
                      ? `${formatMw(bounds[0])} to ${formatMw(bounds[1])}`
                      : "Not applicable"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="fine-print">
        The representative allocation totals {formatMw(allocSum)}. Taking every
        site at the top of its marginal range would total {formatMw(boundsSum)},
        which is a different quantity of capacity and not an allocation the model
        found. That is exactly the reading the ranges do not support: the
        requirement constraint links the coordinates, so a site reaches the top
        of its own range only where others sit lower, and the sites that move
        here move against each other rather than freely.
      </p>
    </>
  );
}

/**
 * A vertex's verification λ as a finite number, or `null` where it is absent
 * or the high-λ limiting marker (serialized as `"inf"`, which is not a solve
 * at any finite delay consequence).
 */
function finiteLam(vertex: EnvelopeVertex | null): number | null {
  if (!vertex || typeof vertex.lam !== "number") return null;
  return Number.isFinite(vertex.lam) ? vertex.lam : null;
}

/** Compact scientific rendering for a small tolerance, e.g. 5.0 x 10 to the -7. */
function ScientificNumber({ value }: { value: number }) {
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / 10 ** exponent;
  return (
    <span className="num">
      {formatNumber(mantissa, 1)} × 10<sup>{exponent}</sup>
    </span>
  );
}

/* ================================================================== */
/* 16. How the answer changes with the delay consequence               */
/* ================================================================== */

function LambdaSensitivitySection({
  showcase,
  state,
}: {
  showcase: ShowcaseExport | null;
  state: FetchState<PresetExport>;
}) {
  return (
    <Section id="lambda-sensitivity">
      <p>
        The delay consequence is set, not measured, so the durable result is
        the map of how the answer changes across values rather than the answer
        at one value. Two such maps exist, built from different sets of
        allocations, and they are not the same thing.
      </p>
      {!showcase ? <Pending state={state} what="worked example" /> : null}
      {showcase ? <DocExamplePortfolio showcase={showcase} /> : null}

      <Subsection id="regimes" title="Regimes and boundaries">
        <p>
          Over the full feasible set the cost-minimizing allocation is
          piecewise constant in the delay consequence: it holds steady over a
          range, switches at a boundary, and holds steady again. Those ranges
          are the decision regimes and the switch points are the boundaries.
        </p>
        <p>
          Where the competing allocations are already known, the delay
          consequence at which two of them are indifferent can be written
          directly, as the break-even expression below does for the three fixed
          benchmarks. Regime boundaries are a harder problem, because the
          competing allocations are not known in advance: they have to be
          discovered by re-solving the optimization. This implementation
          locates and verifies each boundary numerically, and reports it with
          the tolerance within which it was found rather than as an exact
          threshold. The allocations at the regime interiors are exact solver
          results, never interpolated between.
        </p>
        {showcase?.lambda_envelope ? (
          <>
            <LambdaAllocationChart
              envelope={showcase.lambda_envelope}
              siteIds={showcase.scenario.sites.map((s) => s.id)}
            />
            <p className="figure-caption">
              The fixed documentation example portfolio stated above, not a
              scenario from the Decision page. The slider moves a cursor across
              the precomputed regimes and reads out the authoritative allocation
              of whichever regime contains it. It navigates results that already
              exist; it does not recompute the model.
            </p>
            <EnvelopeTables showcase={showcase} />
          </>
        ) : null}
      </Subsection>

      <Subsection
        id="break-even"
        title="Break-even between benchmark strategies"
      >
        <p>
          A separate and simpler question is which of the three fixed
          benchmarks is best. Each has a fixed development cost and a fixed
          expected delay burden, so its objective is a straight line in the
          delay consequence, and two benchmarks are indifferent exactly where
          their lines cross.
        </p>
        <Equation
          lead="Two strategies are equally good at the delay consequence where their difference in development cost is exactly offset by their difference in expected delay burden."
          reading="Lambda star equals C sub B minus C sub A, all divided by the expectation of L sub A minus the expectation of L sub B."
          alt="The break-even delay consequence is the cost difference divided by the expected delay burden difference."
          definitions={[
            {
              symbol: (
                <>
                  <Var>A</Var>, <Var>B</Var>
                </>
              ),
              meaning:
                "two candidate strategies being compared here: generic labels for whichever two allocations are compared, not the power-delivery complexity state Bᵢ and not the “Site A” / “Site B” labels used in worked examples elsewhere on this page.",
            },
            {
              symbol: (
                <>
                  <SubSym base="C" sub="A" />, <SubSym base="C" sub="B" />
                </>
              ),
              meaning: "the development cost of strategy A and of strategy B.",
            },
            {
              symbol: (
                <>
                  <Var>E</Var>[<SubSym base="L" sub="A" />], <Var>E</Var>[
                  <SubSym base="L" sub="B" />]
                </>
              ),
              meaning: "the expected delay burden of strategy A and of strategy B.",
            },
            {
              symbol: (
                <>
                  <Var>λ</Var>*
                </>
              ),
              meaning:
                "the delay consequence at which strategies A and B are equally good: the quantity this equation defines.",
            },
          ]}
        >
          <msup>
            <mi>λ</mi>
            <mo>*</mo>
          </msup>
          <mo>=</mo>
          <mfrac>
            <mrow>
              <msub>
                <mi>C</mi>
                <mi>B</mi>
              </msub>
              <mo>&#x2212;</mo>
              <msub>
                <mi>C</mi>
                <mi>A</mi>
              </msub>
            </mrow>
            <mrow>
              <mi>E</mi>
              <Group open="[" close="]">
                <msub>
                  <mi>L</mi>
                  <mi>A</mi>
                </msub>
              </Group>
              <mo>&#x2212;</mo>
              <mi>E</mi>
              <Group open="[" close="]">
                <msub>
                  <mi>L</mi>
                  <mi>B</mi>
                </msub>
              </Group>
            </mrow>
          </mfrac>
        </Equation>
        {showcase ? (
          <>
            <BreakEvenTables showcase={showcase} />
            <p>
              The same three benchmarks, plus the model's own allocation, plotted
              in the two coordinates the break-even expression is built from.
              Development cost and expected delay burden are exactly the axes;
              the delay consequence is the exchange rate between them.
            </p>
            <TradeoffFigure showcase={showcase} />
          </>
        ) : null}
      </Subsection>

      <Subsection id="boundary-families" title="Why these two sets of numbers differ">
        <p>
          The two subsections above produce two sets of delay-consequence
          values, and they are not the same family. They answer different
          questions:
        </p>
        <ul>
          <li>
            <strong>Benchmark switching values</strong> answer: which of the
            three fixed strategies is best? They are crossings between three
            specific lines.
          </li>
          <li>
            <strong>Regime boundaries</strong> answer: where does the best
            allocation over the full feasible set change? They are switch points
            of a continuous optimization.
          </li>
        </ul>
        <p>
          <strong>
            The two sets are not expected to coincide, and a value from one is
            not a value from the other.
          </strong>{" "}
          A benchmark switching value says nothing about where the optimized
          allocation changes, because that allocation is generally none of the
          three; a regime boundary says nothing about which benchmark a reader
          restricted to those three should pick. Reading one family as the
          other is the most likely misreading of this section, which is why the
          two are never merged into one list.
        </p>
      </Subsection>
    </Section>
  );
}

/**
 * The inputs of the worked example both figures in this section are built
 * from, stated once, at the top of the section.
 *
 * Two figures here plot results for one specific portfolio, and neither is the
 * reader's own scenario. Naming it as a fixed documentation example is not
 * enough on its own: without its inputs a reader cannot tell what is being
 * plotted or reproduce it, and the regime figure in particular is meaningless
 * without knowing the requirement it is allocating against. Every value is
 * read from the committed export, never transcribed.
 */
function DocExamplePortfolio({ showcase }: { showcase: ShowcaseExport }) {
  const { system, sites } = showcase.scenario;
  return (
    <div className="doc-example">
      <p className="doc-example__title">
        The worked example used in this section
      </p>
      <p className="doc-example__body">
        A fixed {sites.length}-site documentation example, not a scenario from
        the Decision page. Required capacity{" "}
        <span className="num">{formatMw(system.required_capacity_mw)}</span> by
        target month <span className="num">{system.target_month}</span>, over a{" "}
        <span className="num">{system.horizon_month}</span>-month horizon.
        Candidate sites:{" "}
        {sites.map((site, i) => (
          <span key={site.id}>
            {i > 0 ? "; " : ""}
            <strong>Site {site.id}</strong> {formatMw(site.capacity_mw)}, cost{" "}
            <span className="num">{formatNumber(site.cost_per_mw, 2)}</span> per
            MW, power-delivery complexity{" "}
            <span className="num">{site.burden_state}</span>, schedule
            uncertainty <span className="num">{site.uncertainty_state}</span>
          </span>
        ))}
        . The ordinal levels resolve through the state mappings in{" "}
        <Ref id="inputs" />.
      </p>
    </div>
  );
}

function EnvelopeTables({ showcase }: { showcase: ShowcaseExport }) {
  const envelope = showcase.lambda_envelope;
  if (!envelope) return null;
  const ids = showcase.scenario.sites.map((s) => s.id);
  const bps = envelope.breakpoints;

  // A vertex verified exactly at a located boundary reports that boundary's
  // tie, which belongs to the boundary and not to either regime beside it.
  // Detected against the boundary's own reported tolerance rather than
  // asserted, so the note appears only where it is actually true.
  const verifiedAtBoundary = (v: EnvelopeVertex): boolean => {
    const lam = finiteLam(v);
    if (lam === null) return false;
    return bps.some((b) => Math.abs(lam - b.lam_estimate) <= b.tolerance);
  };
  const boundaryVerified = envelope.vertices.filter(verifiedAtBoundary);

  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            The exact allocation on each regime, the delay consequence its
            solve was verified at, and what that solve could certify about
            uniqueness there.
          </caption>
          <thead>
            <tr>
              <th scope="col">Regime</th>
              {ids.map((id) => (
                <th scope="col" className="num" key={id}>
                  Site {id}
                </th>
              ))}
              <th scope="col" className="num">
                Verified at <span className="symbol">λ</span>
              </th>
              <th scope="col">Uniqueness at that {""}
                <span className="symbol">λ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {envelope.vertices.map((v, i) => {
              const lam = finiteLam(v);
              return (
                <tr key={i}>
                  <th scope="row">
                    {i + 1}
                    {i === envelope.vertices.length - 1 ? " (terminal)" : ""}
                  </th>
                  {ids.map((id) => (
                    <td className="num" key={id}>
                      {formatMw(v.allocation[id] ?? 0)}
                    </td>
                  ))}
                  <td className="num">
                    {lam === null ? "Not applicable" : formatNumber(lam, 4)}
                    {verifiedAtBoundary(v) ? " (a boundary)" : ""}
                  </td>
                  <td>
                    {v.is_unique_within_tolerance
                      ? "Unique within tolerance"
                      : "Effectively tied"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p>
        <strong>
          The uniqueness column describes the solve at the delay consequence
          beside it, not the whole regime.
        </strong>{" "}
        Each regime&rsquo;s allocation is established by an optimization solved
        at one delay consequence inside or at the edge of that regime, and the
        uniqueness the solve can certify is a property of that value.
        {boundaryVerified.length > 0 ? (
          <>
            {" "}
            In this example {boundaryVerified.length === 1 ? "one regime" : `${boundaryVerified.length} regimes`}{" "}
            {boundaryVerified.length === 1 ? "was" : "were"} verified exactly at
            a located boundary, and{" "}
            {boundaryVerified.length === 1 ? "reports" : "report"} the tie that
            exists there with the neighbouring allocation. A tie at a boundary
            is the definition of that boundary, not a statement that the
            allocation stays tied across the regime.
          </>
        ) : null}
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            The located regime boundaries, each with the numerical tolerance
            within which it was found.
          </caption>
          <thead>
            <tr>
              <th scope="col">Boundary</th>
              <th scope="col" className="num">
                Located near <span className="symbol">λ</span>
              </th>
              <th scope="col" className="num">
                Tolerance
              </th>
              <th scope="col">At the boundary</th>
            </tr>
          </thead>
          <tbody>
            {bps.map((b, i) => (
              <tr key={i}>
                <th scope="row">
                  Regime {i + 1} to {i + 2}
                </th>
                <td className="num">{formatNumber(b.lam_estimate, 4)}</td>
                <td className="num">± {formatNumber(b.tolerance, 4)}</td>
                <td>
                  {b.co_optimal_at_breakpoint
                    ? "Both neighboring allocations are equally good"
                    : "One allocation is preferred"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="fine-print">
        The terminal regime holds for every larger delay consequence: past the
        last boundary the allocation stops changing, because further increases
        cannot buy any more delivery speed from this portfolio. Its allocation
        is separately confirmed against a directly solved limiting program for
        an arbitrarily large delay consequence, which is what establishes that
        no further regime lies beyond it.
      </p>
    </>
  );
}

function BreakEvenTables({ showcase }: { showcase: ShowcaseExport }) {
  const { pairwise_break_even_lambda, global_switching_boundaries } =
    showcase.decision_boundaries;
  return (
    <>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            Pairwise break-even values for the example portfolio: the delay
            consequence at which each pair of benchmark strategies is
            indifferent.
          </caption>
          <thead>
            <tr>
              <th scope="col">Strategy</th>
              <th scope="col">Against</th>
              <th scope="col" className="num">
                Break-even <span className="symbol">λ</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {pairwise_break_even_lambda.map((p) => (
              <tr key={`${p.strategy_a}-${p.strategy_b}`}>
                <th scope="row">{benchmarkLabel(p.strategy_a)}</th>
                <td>{benchmarkLabel(p.strategy_b)}</td>
                <td className="num">
                  {formatNumber(p.break_even_lambda, 4)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        <strong>
          A pairwise crossing is not by itself a point where the preferred
          benchmark changes.
        </strong>{" "}
        It says only that those two strategies are indifferent there; a third
        strategy can already be better than both at that value, in which case
        the crossing lies above the lower envelope and nothing switches. Only
        crossings that lie on the lower envelope of the three lines are
        switching points, and those are the values in the table below. A
        pairwise value can also be undefined, when two strategies have the same
        expected delay burden and their objective lines never cross, or fall
        below zero, outside the range the delay consequence is defined on.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            Which benchmark is best over which range of the delay consequence,
            for the example portfolio.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="num">
                From <span className="symbol">λ</span>
              </th>
              <th scope="col">Best benchmark</th>
            </tr>
          </thead>
          <tbody>
            {global_switching_boundaries.map((g) => {
              const tied = g.co_optimal ?? [g.strategy];
              return (
                <tr key={g.lambda_start}>
                  <th scope="row" className="num">
                    {formatNumber(g.lambda_start, 4)}
                  </th>
                  <td>
                    {tied.map(benchmarkLabel).join(" and ")}
                    {tied.length > 1 ? " (equally good)" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function benchmarkLabel(canonicalId: string): string {
  switch (canonicalId) {
    case "cost_concentration":
      return "Cost first";
    case "speed_reliability":
      return "Schedule first";
    case "diversified":
      return "Spread across sites";
    default:
      return canonicalId;
  }
}

const SHAPES: TradeoffPoint["shape"][] = [
  "triangle",
  "diamond",
  "square",
  "circle",
];

function TradeoffFigure({ showcase }: { showcase: ShowcaseExport }) {
  const points: TradeoffPoint[] = [];
  const push = (
    key: string,
    label: string,
    result: StrategyResult,
    isOptimized: boolean,
  ) => {
    points.push({
      key,
      label,
      shape: SHAPES[points.length % SHAPES.length],
      el: result.expected_delay_burden_mw_months,
      cost: result.development_cost,
      objective: result.objective,
      pMeet: result.p_meet,
      allocation: result.allocation,
      isOptimized,
    });
  };

  push(
    "cost_concentration",
    benchmarkLabel("cost_concentration"),
    showcase.strategies.cost_concentration,
    false,
  );
  push(
    "speed_reliability",
    benchmarkLabel("speed_reliability"),
    showcase.strategies.speed_reliability,
    false,
  );
  push(
    "diversified",
    benchmarkLabel("diversified"),
    showcase.strategies.diversified,
    false,
  );
  if (showcase.optimizer) {
    push("optimized", "Model allocation", showcase.optimizer.evaluated, true);
  }

  return (
    <>
      <CostDelayScatter
        points={points}
        method={
          showcase.scenario_set.method === "exact"
            ? "Exact enumeration"
            : "Monte Carlo"
        }
        nRealizations={showcase.scenario_set.n_realizations}
      />
      <p className="figure-caption">
        A steeper delay consequence tilts the comparison toward the left of the
        plot, a shallower one toward the bottom. The objective{" "}
        <Var>J</Var> is the line of that tilt, not a property of any single
        mark.
        {showcase.optimizer ? (
          <>
            {" "}
            The <strong>Model allocation</strong> mark is the optimum at one
            specific delay consequence,{" "}
            <span className="num">
              λ = {formatNumber(showcase.optimizer.at_lambda, 4)}
            </span>
            . It is not fixed across the plot: the allocation that minimizes{" "}
            <Var>J</Var> changes with λ, as the regimes above set out. The three
            benchmarks are fixed rules and do not move with λ at all.
          </>
        ) : null}
      </p>
    </>
  );
}

/* ================================================================== */
/* 17. Exact evaluation and Monte Carlo                                */
/* ================================================================== */

function ExactMonteCarloSection() {
  return (
    <Section id="exact-monte-carlo">
      <p>
        The joint space of site delays is handled one of two ways, and the
        metrics are defined identically in both.
      </p>
      <p>
        <strong>Exact enumeration</strong> builds every joint delay outcome,
        computes its exact probability as the product of the per-site outcome
        probabilities, verifies that those probabilities sum to one, and
        evaluates every metric as an exact probability-weighted sum. There is
        no sampling error; the result is the model's answer, not an estimate of
        it.
      </p>
      <p>
        <strong>Monte Carlo</strong> draws a fixed number of seeded samples
        from the same joint distribution and evaluates the same metrics as
        sample averages, for joint spaces too large to enumerate. The quantity
        being estimated is exactly the quantity exact enumeration would return.
      </p>
      <p>
        A Monte Carlo result is an estimate, and carries sampling error: it
        would differ, by an amount that shrinks as the number of samples grows,
        if a different set of samples had been drawn. Sampling is seeded, so
        the same inputs and the same seed reproduce the same sample and the
        same numbers exactly. This release reports the method and the number of
        samples drawn alongside every such result;{" "}
        <strong>
          it does not report a separate standard error or confidence interval
          for a Monte Carlo estimate.
        </strong>{" "}
        Where a result is produced by exact enumeration, no such interval
        exists to report: the number is the model&rsquo;s answer, not an
        estimate of it.
      </p>
      <p>
        The two paths are used at different points, and the distinction matters
        for how a result should be read.{" "}
        <strong>
          Evaluating or comparing a given allocation supports both methods;
          allocation optimization in this release runs on an exact scenario
          set.
        </strong>{" "}
        The search runs over allocations while the scenario set is held fixed
        and exactly enumerated, so the objective it minimizes is deterministic
        in the allocation, and no optimized allocation reported here has been
        selected against a sampled approximation of the objective. Optimizing
        over a Monte Carlo sample is a different method with its own
        selection-bias question, and this release does not do it silently or
        otherwise. Every result records which method produced it, with the
        number of joint outcomes evaluated or samples drawn.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 18. Reproducibility                                                 */
/* ================================================================== */

function ReproducibilitySection() {
  return (
    <Section id="reproducibility">
      <ul>
        <li>
          Identical inputs and an identical seed reproduce identical Monte Carlo
          results.
        </li>
        <li>
          Exact enumeration is deterministic: it involves no sampling, so the
          same inputs always give the same answer.
        </li>
        <li>
          Monte Carlo results carry sampling error and are reported as
          estimates, with the number of samples drawn; exact results are not
          estimates and are reported as the model&rsquo;s answer.
        </li>
      </ul>
      <h3 className="subsection-heading">Verification, and what it is not</h3>
      <p>
        The equations and the implementation have been checked against
        hand-verifiable cases, model invariants, and limiting cases where the
        answer can be worked out independently. That is <em>verification</em>:
        evidence that the model computes what it is specified to compute.
      </p>
      <p>
        <strong>
          It is not validation against realized project outcomes.
        </strong>{" "}
        The reference parameterization in <Ref id="inputs" /> is a generalized
        set of values, not a calibration fitted to observed delivery histories,
        and no result here has been tested against what actually happened on a
        real portfolio. Establishing that a parameterization predicts outcomes
        on a specific project is a separate exercise, and it is what a project
        implementation does with its own evidence.
      </p>
      <p>
        All quantitative outputs come from the mathematical engine, and AI does
        not generate or alter them. The application layer formats the
        authoritative values and profiles the engine exports, and may arrange,
        scale, or draw a range from them for display; it does not recompute,
        smooth, or infer a quantitative result.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 19. Complete notation and public labels                             */
/* ================================================================== */

/**
 * The complete model-symbol inventory, unified with the public-label
 * correspondence into one reference table (formerly two tables here that
 * repeated most of the same concepts). Every symbol used
 * anywhere on this page, its public application label where it has one
 * distinct from its canonical term, its unit or type read from the
 * canonical specification (`docs/model-specification.md`) rather than guessed, and
 * its definition. An index or a count is labelled by its type rather than
 * forced into a physical unit it does not carry.
 *
 * A model quantity occupies exactly one row: where it has a public label,
 * that label sits beside its canonical technical term in the same row
 * rather than in a second table. Most rows -- indices, intermediate
 * quantities, internal-computation symbols -- have no separate public
 * label at all, and say so plainly rather than being forced into a false
 * correspondence.
 */
interface NotationRow {
  symbol: ReactNode;
  /** The application's plain public label, only where one exists and is
   * distinct from an internal quantity a visitor never sees named. */
  publicLabel?: string;
  /** Canonical technical term or name, per `docs/model-specification.md`. */
  canonical: string;
  unit: string;
  definition: string;
}

const NOTATION: NotationRow[] = [
  { symbol: SYM_I, canonical: "Site index", unit: "Index", definition: "Index of a candidate site, i = 1, …, N." },
  { symbol: SYM_N, canonical: "Number of sites", unit: "Count", definition: "The number of candidate sites in the portfolio." },
  { symbol: SYM_T, canonical: "Month index", unit: "Months", definition: "The month being evaluated; a whole-month point in time." },
  { symbol: SYM_S, canonical: "Scenario index", unit: "Index", definition: "Index of one joint delay outcome across all sites." },
  {
    symbol: SYM_KI,
    publicLabel: "Site capacity",
    canonical: "Maximum developable capacity",
    unit: "MW",
    definition: "Maximum developable capacity at site i.",
  },
  { symbol: SYM_CI, canonical: "Site development cost", unit: "Relative cost units per MW", definition: "Relative development cost per MW at site i. Normalized, not currency." },
  {
    symbol: <SubSym base="B" sub="i" />,
    publicLabel: "Power-delivery complexity",
    canonical: "Power-delivery burden",
    unit: "Ordinal state identifier (1–4)",
    definition: "Site i's power-delivery complexity state. An identifier, not a quantity: it is looked up in a published table, never used arithmetically.",
  },
  {
    symbol: <SubSym base="U" sub="i" />,
    publicLabel: "Schedule uncertainty",
    canonical: "Schedule-timing uncertainty",
    unit: "Ordinal state identifier (1–4)",
    definition: "Site i's schedule-timing uncertainty state. An identifier, not a quantity.",
  },
  {
    symbol: SYM_D,
    publicLabel: "Required capacity",
    canonical: "Required capacity",
    unit: "MW",
    definition: "The usable capacity that must be in place by the target month.",
  },
  {
    symbol: SYM_TSTAR,
    publicLabel: "Target date",
    canonical: "Target month",
    unit: "Months",
    definition: "The month by which the required capacity is needed.",
  },
  { symbol: SYM_H, canonical: "Analysis horizon", unit: "Months", definition: "The final modeled month; must extend past the target month to score late delivery." },
  {
    symbol: SYM_LAMBDA,
    publicLabel: "Delay consequence",
    canonical: "Delay-value parameter",
    unit: "Relative cost units per MW-month",
    definition: "The economic weight assigned to one MW-month of unmet capacity. Set by the user, not measured.",
  },
  { symbol: SYM_ALPHA, canonical: "Tranche fraction", unit: "Unitless fraction", definition: "The share of a site's capacity available at the first stage. 0.50 in this model version." },
  {
    symbol: (
      <>
        <TauNominalProse stage={1} />, <TauNominalProse stage={2} />
      </>
    ),
    publicLabel: "Delivery stage, first stage, full service",
    canonical: "Tranche (nominal stage dates)",
    unit: "Months",
    definition: "Site i's nominal first-stage and full-service months, read from its Bᵢ state.",
  },
  {
    symbol: <DeltaRealizedProse />,
    canonical: "Realized delay",
    unit: "Months",
    definition: "Site i's realized delay in scenario s, drawn from its Uᵢ state's distribution. Never negative.",
  },
  {
    symbol: (
      <>
        <TauRealizedProse stage={1} />, <TauRealizedProse stage={2} />
      </>
    ),
    canonical: "Realized stage dates",
    unit: "Months",
    definition: "Site i's actual first-stage and full-service months in scenario s: the nominal dates shifted by the realized delay.",
  },
  {
    symbol: <SubSupSym base="A" sub="i" sup="(s)" />,
    canonical: "Available power",
    unit: "MW",
    definition: "Power available at site i, scenario s, month t: a step function of the realized stage dates.",
  },
  {
    symbol: <SubSupSym base="p" sub="i" sup="(s)" />,
    canonical: "Per-site outcome probability",
    unit: "Unitless [0, 1]",
    definition: "Probability of site i's own delay outcome in scenario s.",
  },
  { symbol: <SubSym base="p" sub="s" />, canonical: "Joint scenario probability", unit: "Unitless [0, 1]", definition: "Probability of joint scenario s: the product of the per-site outcome probabilities it is made of." },
  { symbol: <SubSym base="q" sub="i" />, canonical: "Delay-outcome count", unit: "Count", definition: "Number of delay outcomes listed for site i's uncertainty state." },
  { symbol: <SubSym base="S" sub="full" />, canonical: "Complete scenario count", unit: "Count", definition: "Total number of distinct joint delay outcomes across all sites." },
  { symbol: SYM_XI, canonical: "Site allocation", unit: "MW", definition: "Capacity allocated to site i. The model's decision variable." },
  {
    symbol: (
      <>
        <SubSym base="Y" sub="i" />
        {SYM_ARGS_TS}
      </>
    ),
    canonical: "Site delivered capacity",
    unit: "MW",
    definition: "Delivered usable capacity at site i, month t, scenario s: the minimum of allocated capacity and available power.",
  },
  {
    symbol: (
      <>
        <Var>Y</Var>
        {SYM_ARGS_TS}
      </>
    ),
    canonical: "Total delivered capacity",
    unit: "MW",
    definition: "Delivered usable capacity summed across all sites, month t, scenario s.",
  },
  { symbol: <SubSym base="M" sub="s" />, canonical: "Target-date meet indicator", unit: "{0, 1}", definition: "1 when scenario s meets the requirement by the target month, otherwise 0." },
  {
    symbol: <SubSym base="P" sub="meet" />,
    publicLabel: "Chance of meeting the target date",
    canonical: "Probability of meeting the target",
    unit: "Unitless [0, 1]",
    definition: "Probability-weighted share of scenarios that meet the requirement by the target month.",
  },
  { symbol: <SubSym base="S" sub="s" />, canonical: "Target-date shortfall", unit: "MW", definition: "Capacity still missing at the target month in scenario s, floored at zero." },
  {
    symbol: (
      <>
        <Var>E</Var>[<Var>S</Var>]
      </>
    ),
    publicLabel: "Expected shortfall at the target date",
    canonical: "Deadline shortfall",
    unit: "MW",
    definition: "Target-date shortfall, averaged across scenarios by probability.",
  },
  {
    symbol: (
      <>
        <Var>Q</Var>
        {SYM_ARGS_TS}
      </>
    ),
    canonical: "Missing capacity at a month",
    unit: "MW",
    definition: "Capacity still missing at month t, scenario s, floored at zero.",
  },
  { symbol: <SubSym base="L" sub="s" />, canonical: "Scenario delay burden", unit: "MW-months", definition: "Missing capacity accumulated from the target month through the analysis horizon, in scenario s." },
  {
    symbol: (
      <>
        <Var>E</Var>[<Var>L</Var>]
      </>
    ),
    publicLabel: "Expected delay burden",
    canonical: "Expected delay burden",
    unit: "MW-months",
    definition: "Scenario delay burden, averaged across scenarios by probability.",
  },
  {
    symbol: <SubSym base="C" sub="dev" />,
    publicLabel: "Relative development cost",
    canonical: "Development cost",
    unit: "Relative cost units",
    definition: "Total cost of the allocated capacity, summed across sites.",
  },
  { symbol: <SubSym base="C" sub="delay,s" />, canonical: "Scenario delay consequence", unit: "Relative cost units", definition: "Delay consequence multiplied by the scenario's delay burden." },
  {
    symbol: (
      <>
        <Var>E</Var>[<SubSym base="C" sub="delay" />]
      </>
    ),
    canonical: "Expected delay consequence",
    unit: "Relative cost units",
    definition: "Delay consequence multiplied by the expected delay burden.",
  },
  { symbol: <Var>J</Var>, canonical: "Objective", unit: "Relative cost units", definition: "Development cost plus the priced expected delay burden. The quantity the optimization minimizes." },
  {
    symbol: (
      <>
        <Var>λ</Var>*
      </>
    ),
    canonical: "Break-even delay consequence",
    unit: "Relative cost units per MW-month",
    definition: "The delay consequence at which two strategies are equally good.",
  },
  {
    symbol: (
      <>
        <SubSym base="C" sub="A" />, <SubSym base="C" sub="B" />
      </>
    ),
    canonical: "Strategy development costs",
    unit: "Relative cost units",
    definition: "Development cost of strategy A and of strategy B, in the break-even comparison. Generic strategy labels, not power-delivery states or site names.",
  },
  {
    symbol: (
      <>
        <Var>E</Var>[<SubSym base="L" sub="A" />], <Var>E</Var>[
        <SubSym base="L" sub="B" />]
      </>
    ),
    canonical: "Strategy expected delay burdens",
    unit: "MW-months",
    definition: "Expected delay burden of strategy A and of strategy B, in the break-even comparison.",
  },
  // Benchmark strategies: no mathematical symbol, and each occupies one row
  // here rather than in a second table.
  {
    symbol: null,
    publicLabel: "Cost first",
    canonical: "Cost concentration",
    unit: "Benchmark strategy",
    definition: "Benchmark strategy: fill the requirement from cheapest capacity first.",
  },
  {
    symbol: null,
    publicLabel: "Schedule first",
    canonical: "Speed / reliability",
    unit: "Benchmark strategy",
    definition: "Benchmark strategy: prefer earlier and more predictable delivery.",
  },
  {
    symbol: null,
    publicLabel: "Spread across sites",
    canonical: "Diversified",
    unit: "Benchmark strategy",
    definition: "Benchmark strategy: spread the requirement across more sites.",
  },
];

function NotationSection() {
  return (
    <Section id="notation">
      <p>
        The complete notation reference for this document: every mathematical
        symbol used above, its public application label where it has one
        distinct from its canonical term, its unit or type, and its
        definition. Each model quantity occupies exactly one row. It is a
        translation, not a redefinition: where a public label exists, it
        means exactly what its canonical term means. A quantity with no
        separate public label -- an index, a count, an intermediate
        computation -- is marked plainly rather than forced into a false
        correspondence.
      </p>
      <div className="table-scroll">
        <table className="data-table">
          <caption>
            Every symbol, public label, and canonical term used in this
            document, with its unit or type and definition.
          </caption>
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Public label</th>
              <th scope="col">Canonical name / term</th>
              <th scope="col">Unit / type</th>
              <th scope="col">Definition</th>
            </tr>
          </thead>
          <tbody>
            {NOTATION.map((row, i) => (
              <tr key={i}>
                <th scope="row">
                  {row.symbol ?? <span className="fine-print">None</span>}
                </th>
                <td>
                  {row.publicLabel ?? (
                    <span className="fine-print">Not separately labelled</span>
                  )}
                </td>
                <td>{row.canonical}</td>
                <td>{row.unit}</td>
                <td>{row.definition}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Two labels are worth a note. &ldquo;Power-delivery complexity&rdquo;
        renames the canonical power-delivery burden, so the only quantity
        called a burden on a results surface is the expected delay burden,
        which is an output. &ldquo;Schedule first&rdquo; renames the canonical
        speed and reliability benchmark, because reliability has a precise
        and different meaning in power systems and the benchmark concerns
        schedule variance, not system adequacy.
      </p>
    </Section>
  );
}

/* ================================================================== */
/* 20. Model Scope and Assumptions                                     */
/* ================================================================== */

function ScopeAssumptionsSection() {
  return (
    <Section id="scope-assumptions">
      <p>
        The assumptions below are properties of how the model is built. Each
        one is stated because it changes how a result should be read, and each
        is a point a project-specific application would revisit.
      </p>

      <h3 className="subsection-heading">Independent delivery delays</h3>
      <p>
        Site delivery delays are independent in the public reference model:
        there is no shared cause that would slip several sites at once. This
        can increase the apparent diversification benefit relative to
        portfolios with common or correlated delay drivers, so every
        diversification-related result is conditional on it. The model does not
        quantify the direction or size of that difference, and a
        project-specific application should represent those dependencies where
        they are materially relevant.
      </p>

      <h3 className="subsection-heading">Mappings and calibration</h3>
      <p>
        The nominal stage months, delay outcomes, and probabilities in{" "}
        <Ref id="inputs" /> are generalized reference values rather than
        measured utility statistics or site-specific schedules. Results are
        conditional on them: change the mapping values and the regimes and
        boundaries move. The mechanism generalizes; project implementations
        calibrate the numbers to the decision context.
      </p>

      <h3 className="subsection-heading">The analysis horizon truncates the delay burden</h3>
      <p>
        The expected delay burden accumulates unmet capacity from the target
        month through the analysis horizon, inclusive, and stops there. Capacity
        still missing after the horizon contributes nothing further to it, and
        some mapped delivery outcomes can land beyond the horizon entirely, in
        which case the capacity they would eventually bring falls outside the
        window being scored. The horizon is therefore a modeling boundary that
        shapes the answer rather than a neutral end-point: lengthening or
        shortening it changes the expected delay burden of every allocation,
        and with it the optimized allocation and the delay-consequence values
        at which that allocation changes. Choose it long enough that the
        outcomes the decision actually cares about fall inside it, and read
        every reported delay burden as a figure over that window.
      </p>

      <h3 className="subsection-heading">Units and coverage</h3>
      <ul>
        <li>
          Development costs are normalized relative values, not currency. Only
          the ratios between them carry meaning.
        </li>
        <li>
          The delay consequence is a value the user sets, not an empirical
          constant or a market price. No value of it here is a recommendation.
        </li>
        <li>
          The model covers power delivery and capacity allocation. Facility
          construction, procurement, and commissioning readiness are not
          modeled, nor is any interaction between power availability and
          facility readiness.
        </li>
        <li>
          Grid physics, load flow, and utility energization statistics are not
          modeled. Site conditions enter only through the two published state
          mappings.
        </li>
      </ul>

      <h3 className="subsection-heading">Application boundary</h3>
      <p>
        The framework supports structured allocation analysis under limited
        information: framing the problem explicitly, establishing which factors
        actually move the answer, and locating how far an assumption has to
        shift before the decision changes. Project implementations calibrate
        the reference mappings, cost structure, and assumptions to the
        available engineering evidence and the decision context, alongside the
        corresponding engineering, utility, commercial, and legal diligence.
        The model organizes that decision; it does not supply the evidence
        for it.
      </p>
    </Section>
  );
}
