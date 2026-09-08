/**
 * Deterministic structural decision notes.
 *
 * Fixed sentence sets, one per classified case. Every sentence is grounded
 * only in: the classified structural case, explicit engine result fields, and
 * user-entered scenario values. No generated prose, no speculative reasoning,
 * and no reverse-engineering of optimizer causality — the app describes the
 * result, it does not explain why the optimizer selected specific sites.
 *
 * The note is CONDITIONAL. An ordinary optimized result (case A, chance of
 * meeting the date above zero) produces no note at all: restating the
 * allocation the bars already show, in prose, adds no decision information.
 * A note exists only where the structure of the result is not visible from
 * the numbers — a forced allocation, an effectively tied result, a run with
 * the schedule switched off, comparison mode, or a result no modeled outcome
 * delivers on time.
 *
 * `BANNED_CONSTRUCTIONS` / `findBannedConstructions` provide the
 * unit-testable assertion the gate runs over the generated output.
 *
 * Each line is returned as an ordered list of SEGMENTS rather than one string.
 * A structural note exists precisely because it carries a decisive conclusion
 * the numbers do not show — that there is no allocation choice at all, or that
 * no modeled outcome reaches the requirement on time — and that conclusion is
 * marked `emphasis` so the page can render it in `<strong>` rather than
 * leaving the reader to find it inside a paragraph of secondary text. Exactly
 * the conclusion is marked, never a whole line and never every line: emphasis
 * that covers everything communicates nothing. `decisionNoteText` recombines a
 * line into the plain sentence it reads as, which is what the banned-
 * construction gate and the text assertions operate on.
 */
import type { ShowcaseExport } from "../types/showcase";
import { formatMw } from "./format";
import type { ResultClassification } from "./resultCase";

/**
 * Public strategy labels. Keyed by engine strategy id. Exported so
 * `synthesis.ts` (the decision synthesis) names the same three
 * strategies with the same words, rather than keeping a second copy of this
 * map that could drift from this one.
 */
export const STRATEGY_LABEL: Record<string, string> = {
  cost_concentration: "Cost first",
  speed_reliability: "Schedule first",
  diversified: "Spread across sites",
};

/**
 * Heading over the allocation bars, by structural case. Never "Recommended"
 * for the forced, cost-only, or comparison cases: in the forced case there is
 * no choice to recommend (case B), the cost-only run is explicitly not a
 * recommendation (case D), and comparison mode reports the best of a fixed
 * benchmark set rather than an optimized allocation (case F).
 */
export function allocationHeading(c: ResultClassification): string {
  switch (c.base) {
    case "B":
      return "Required allocation";
    case "D":
      return "Lowest-cost allocation (delay consequence set to 0)";
    case "F":
      return "Best of the compared strategies";
    default:
      return "Recommended allocation";
  }
}

/** A short, trailing-zero-free rendering of an entered delay-consequence value. */
function formatConsequence(x: number): string {
  return String(Number(x.toFixed(4)));
}

/**
 * The plain-English conclusion, in one sentence, before any criterion or
 * method wording: where the capacity actually goes, and under which kind of
 * result the visitor is reading it.
 *
 * Same discipline as the structural note. Every clause comes from the
 * classified case and the authoritative allocation the page is already
 * rendering; nothing is inferred about why particular sites were selected, and
 * nothing restates a sentence the structural note or the criterion line
 * carries immediately below. Returns null when there is no authoritative
 * allocation to describe.
 */
export function decisionLeadFor(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): string | null {
  const authoritative = showcase.optimizer
    ? showcase.optimizer.evaluated
    : classification.bestStrategy;
  if (!authoritative) return null;

  const funded: string[] = [];
  const unfunded: string[] = [];
  for (const site of showcase.scenario.sites) {
    const mw = authoritative.allocation[site.id] ?? 0;
    if (mw > 0) funded.push(`Site ${site.id} ${formatMw(mw)}`);
    else unfunded.push(`Site ${site.id}`);
  }
  if (funded.length === 0) return null;

  const where = joinList(funded);
  const none =
    unfunded.length === 0
      ? ""
      : ` ${joinList(unfunded)} take${unfunded.length === 1 ? "s" : ""} none.`;

  if (classification.base === "B") {
    return `Every candidate site is developed in full: ${where}.${none}`;
  }
  if (classification.base === "F") {
    const labels = classification.bestCoOptimalKeys.map(
      (k) => STRATEGY_LABEL[k] ?? k,
    );
    const which =
      labels.length > 1
        ? `${joinList(labels)} are tied as the best of the strategies compared`
        : labels.length === 1
          ? `${labels[0]} is the best of the strategies compared`
          : "The best of the strategies compared";
    return `${which}, and it puts capacity on ${where}.${none}`;
  }
  return `Capacity goes to ${where}.${none}`;
}

/**
 * Why a plan that leads on a visible diagnostic can still not be the
 * recommended allocation.
 *
 * The comparison table shows four columns, and only two of them are terms in
 * what the model minimizes. Without this the table invites the reading that
 * the model ignored a better answer; with it the reader can see that the
 * chance of meeting the date and the expected shortfall are consequences being
 * reported, not objectives being pursued. Stated in words on purpose: the
 * combined objective value is not added to the table
 * (the model specification defines it; the Decision page does not report it).
 */
export const OBJECTIVE_VERSUS_DIAGNOSTICS =
  "The model minimizes one quantity: relative development cost plus the " +
  "delay consequence applied to the expected delay burden. The chance of " +
  "meeting the target date and the expected shortfall are reported because " +
  "the decision needs them, but neither is a term in that criterion, so a " +
  "strategy can lead on one of those columns and still not be the allocation " +
  "the model returns.";

/**
 * Joins a list of strings in plain English ("A", "A and B", "A, B, and C").
 * Exported so `synthesis.ts` shares this exact joining convention rather
 * than reimplementing it for the scaled, many-site case.
 */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

/**
 * The definition of the criterion the model minimizes over feasible
 * allocations, in public terms, at the scenario's own delay-consequence value.
 *
 * This is a DEFINITION, not a causal account: it states what "recommended"
 * means, and never why particular sites were selected. It exists only for the
 * two optimized cases where a criterion actually chose among alternatives —
 * an ordinary optimized result (A) and an effectively tied optimized result
 * (C). It is deliberately absent for:
 *   - case B, where the allocation is forced by feasibility and nothing was
 *     selected at all;
 *   - case D, where the delay consequence is 0 and the existing cost-only
 *     note already states the criterion in force;
 *   - case F, where the model compares three named strategies rather than
 *     optimizing, and the existing comparison note already says so.
 */
export function selectionCriterionFor(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): string | null {
  if (classification.base !== "A" && classification.base !== "C") return null;
  const consequence = formatConsequence(
    showcase.scenario.system.lambda_mw_month,
  );
  const closing =
    classification.base === "C"
      ? "the allocation shown is one of those with the lowest combined cost and delay total."
      : "the allocation shown has the lowest combined cost and delay total.";
  return (
    `Feasible allocations are compared on one criterion: relative ` +
    `development cost plus the delay consequence applied to the expected ` +
    `delay burden. At this scenario's delay consequence of ${consequence}, ` +
    closing
  );
}

/** One run of note text, and whether it is the line's decisive conclusion. */
export interface DecisionNoteSegment {
  text: string;
  /** Rendered in `<strong>`. At most one or two short runs per line. */
  emphasis?: boolean;
}

/** One complete sentence (or pair of sentences), as ordered segments. */
export type DecisionNoteLine = DecisionNoteSegment[];

/**
 * The bar-legend sentence for a tied/co-optimal optimizer result: what the
 * marked span across the allocation bars means. Split out from
 * `decisionNoteFor`'s case-C block because it explains how to read a
 * VISUAL on screen -- a fact the "Why this decision" synthesis
 * (`lib/synthesis.ts`) does not and should not restate in prose. The "several
 * allocations tie" conclusion itself is folded into that synthesis instead,
 * so the Decision page renders this legend alone for case C, not the whole
 * `decisionNoteFor` note.
 */
export function coOptimalSpanLegend(): DecisionNoteLine {
  return [
    {
      text:
        "The marked span on each bar is how far that site's share moves " +
        "across the tied set, one site at a time; where a site does not " +
        "move, the span collapses to a single mark. It is not a box of " +
        "jointly feasible allocations.",
    },
  ];
}

/** The plain sentence a line reads as, with no emphasis markup. */
export function decisionNoteText(line: DecisionNoteLine): string {
  return line.map((seg) => seg.text).join("");
}

/**
 * The structural decision note for a result, or `null` when the result needs
 * none. Each returned line is a complete sentence, in reading order, split
 * into segments so the decisive conclusion can be emphasized on the page.
 */
export function decisionNoteFor(
  showcase: ShowcaseExport,
  classification: ResultClassification,
): DecisionNoteLine[] | null {
  const lines: DecisionNoteLine[] = [];
  const { system } = showcase.scenario;

  switch (classification.base) {
    case "A":
      // An ordinary optimized result explains itself through the allocation
      // and the four Key Results. Nothing structural to add.
      break;
    case "B": {
      lines.push([
        {
          text:
            `Every site is fully allocated: all developable capacity is ` +
            `required to reach the ` +
            `${formatMw(system.required_capacity_mw)} requirement, `,
        },
        {
          text: "so there is no allocation choice in this scenario.",
          emphasis: true,
        },
      ]);
      // The delivery-timing point is the substance of the forced case, but
      // the sentence says only what `p_meet` establishes: p_meet < 1 means at
      // least one modeled delay outcome misses the full requirement by the
      // target date. When p_meet is 0 the zero-chance line below states it
      // more precisely, so this clause is suppressed; when p_meet is 1 it is
      // omitted.
      const opt = showcase.optimizer;
      const someLate = !!opt && opt.evaluated.p_meet < 1;
      if (someLate && !classification.zeroChance) {
        lines.push([
          {
            text:
              "Delivery timing, not allocation, is the only lever left in " +
              "this scenario: some modeled delay outcomes miss the full " +
              "requirement at the target date.",
          },
        ]);
      }
      break;
    }
    case "C":
      lines.push([
        {
          text:
            "Several allocations perform identically here, and the one " +
            "shown is one of them.",
          emphasis: true,
        },
        // Shared with the standalone bar-legend rendering (the synthesis layer) --
        // see `coOptimalSpanLegend()`. Prefixed with a space here only
        // because it continues the previous segment's sentence on this line.
        { text: ` ${coOptimalSpanLegend()[0].text}` },
      ]);
      break;
    case "D":
      lines.push([
        { text: "The delay consequence is set to 0, so " },
        {
          text:
            "this run minimizes development cost only and does not weigh " +
            "the schedule at all.",
          emphasis: true,
        },
        {
          text:
            " The chance of meeting the date and the expected shortfall show " +
            "what that setting costs in delivery terms.",
        },
      ]);
      break;
    case "F": {
      const n = showcase.scenario.sites.length;
      const coLabels = classification.bestCoOptimalKeys.map(
        (k) => STRATEGY_LABEL[k] ?? k,
      );
      const consequence = formatConsequence(system.lambda_mw_month);
      lines.push([
        {
          text:
            `With ${n} candidate sites the model compares three named ` +
            `strategies under your scenario and reports the best of them, `,
        },
        {
          text: "rather than optimizing across every possible allocation.",
          emphasis: true,
        },
      ]);
      if (coLabels.length > 1) {
        lines.push([
          {
            text:
              `At a delay consequence of ${consequence}, ` +
              `${joinList(coLabels)} are tied for the lowest combined cost ` +
              `and delay total.`,
          },
        ]);
      } else if (coLabels.length === 1) {
        lines.push([
          {
            text:
              `At a delay consequence of ${consequence}, ${coLabels[0]} has ` +
              `the lowest combined cost and delay total of the three.`,
          },
        ]);
      }
      break;
    }
  }

  if (classification.zeroChance) {
    lines.push([
      {
        text:
          `No modeled delivery outcome reaches the full requirement by ` +
          `month ${system.target_month}.`,
        emphasis: true,
      },
      {
        text:
          " The expected shortfall above is what remains missing on that " +
          "date.",
      },
    ]);
  }

  return lines.length > 0 ? lines : null;
}

/* ------------------------------------------------------------------ */
/* Banned-construction assertion                                       */
/* ------------------------------------------------------------------ */

/**
 * Verbs and causal connectives that must never appear in a generated public
 * note. The optimizer's selection is never attributed to a cause the app
 * cannot structurally establish, and the feasibility-forced case never makes
 * a per-site "must carry at least" statement. Single words are matched on
 * word boundaries; multi-word phrases are matched literally. Both are
 * case-insensitive.
 */
export const BANNED_CONSTRUCTIONS: readonly string[] = [
  "chose",
  "preferred",
  "favored",
  "favoured",
  "decided",
  "judged",
  "recommends because",
  "which is why",
  "so the model",
  "so the model placed",
  "because of this",
  "the optimizer therefore",
  "optimizer therefore",
  "the model chose",
  "the model preferred",
  "the optimizer favored",
  "the model decided",
  "the optimizer judged",
  "must carry at least",
];

const BANNED_PATTERNS: readonly RegExp[] = BANNED_CONSTRUCTIONS.map((phrase) => {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(phrase.includes(" ") ? escaped : `\\b${escaped}\\b`, "i");
});

/** Every banned construction present in `text`. */
export function findBannedConstructions(text: string): string[] {
  return BANNED_CONSTRUCTIONS.filter((_, i) => BANNED_PATTERNS[i].test(text));
}

/**
 * Throws if any generated line contains a banned construction. Intended for
 * the gate over real `decisionNoteFor()` output, not as a blanket ban on the
 * words appearing in comments or test descriptions. Accepts either the plain
 * sentences or the segmented lines the generator returns — the check is over
 * what the reader reads, so segmentation must not change its outcome.
 */
export function assertNoBannedConstructions(
  lines: readonly (string | DecisionNoteLine)[],
): void {
  const hits = lines
    .map((line) => (typeof line === "string" ? line : decisionNoteText(line)))
    .flatMap((p) => findBannedConstructions(p).map((f) => `"${f}" in: ${p}`));
  if (hits.length > 0) {
    throw new Error(
      `Generated decision note contains banned construction(s):\n${hits.join("\n")}`,
    );
  }
}
