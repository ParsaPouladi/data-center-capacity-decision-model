import type { ReactNode } from "react";

/**
 * One symbol/meaning pair in a display equation's local `where:` key
 * (a permanent local-definition rule). `symbol` is the notation as it
 * appears in the equation (typically a `<Var>` plus a subscript/superscript,
 * matching the prose convention elsewhere on this page); `meaning` is a
 * short plain-language definition, locally sufficient to read that one
 * equation without hunting through earlier sections.
 */
export interface EquationDefinition {
  symbol: ReactNode;
  meaning: ReactNode;
}

/**
 * The one display-equation primitive for Technical Documentation
 * (the hand-authored native-MathML primitive with a local-definition rule).
 *
 * Hand-authored native MathML. No KaTeX, no MathJax, no npm package, no CDN,
 * no build step. Every display equation on the page goes through this
 * component, so all five parts of the approved accessible/legibility
 * contract are present by construction:
 *
 *   1. the visible MathML expression (`children`);
 *   2. a plain-language sentence stating what it measures, rendered
 *      immediately BEFORE the expression (`lead`);
 *   3. a visually-hidden text reading adjacent to the <math> element
 *      (`reading`), which is what assistive technology announces;
 *   4. a concise text representation on the element itself (`alttext`);
 *   5. a compact, non-empty `where:` key naming every symbol required to
 *      read THIS equation, rendered directly beneath it (`definitions`).
 *
 * `definitions` is required and typed as a non-empty tuple, so a call site
 * that omits it, or supplies an empty array, fails to compile -- the
 * permanent prevention this component exists to provide, rather than a
 * convention future edits could silently drop.
 *
 * Announcement is single, not double: the <math> element is marked
 * `aria-hidden`, so the adjacent hidden reading is the announced version and
 * MathML carries the visual rendering only. `alttext` remains as an
 * additional fallback channel. The `where:` key is ordinary visible content,
 * outside the hidden reading, so it is announced once, in place, like any
 * other paragraph -- never folded into `reading`, where it would double up
 * the equation's own announcement. Which of the two equation channels is
 * finally announced is confirmed by the screen-reader pass in final QA; the
 * visual result is the same either way.
 *
 * Mathematics is never set in monospace: MathML uses the browser's math font,
 * which gives italic variables and publication spacing on its own.
 */
export function Equation({
  lead,
  reading,
  alt,
  note,
  definitions,
  children,
}: {
  /** Plain-language statement of what the equation measures. */
  lead: string;
  /** Full spoken reading, announced in place of the MathML. */
  reading: string;
  /** Concise representation for the `alttext` channel; defaults to `reading`. */
  alt?: string;
  /** Optional short clarification under the equation (units, index range). */
  note?: ReactNode;
  /**
   * Local `where:` key: every symbol needed to read this equation, in the
   * order most useful to the reader. Non-empty by type.
   */
  definitions: readonly [EquationDefinition, ...EquationDefinition[]];
  /** The MathML expression, without its enclosing <math><mrow>. */
  children: ReactNode;
}) {
  return (
    <div className="equation">
      <p className="equation__lead">{lead}</p>
      <div className="equation__display">
        <math display="block" aria-hidden="true" alttext={alt ?? reading}>
          <mrow>{children}</mrow>
        </math>
        <span className="visually-hidden equation__reading">{reading}</span>
      </div>
      <div className="equation__where">
        <p className="equation__where-label">Where</p>
        <dl>
          {definitions.map((d, i) => (
            <div className="equation__where-row" key={i}>
              <dt>{d.symbol}</dt>
              <dd>{d.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
      {note ? <p className="equation__note">{note}</p> : null}
    </div>
  );
}

/**
 * A single-letter variable inside running prose. Italic, in the prose font --
 * never a monospace code span.
 */
export function Var({ children }: { children: ReactNode }) {
  return <span className="var">{children}</span>;
}
