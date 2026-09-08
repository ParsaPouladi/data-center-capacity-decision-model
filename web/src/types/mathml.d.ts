/**
 * The MathML Core subset used by the hand-authored display equations
 * `@types/react` 19.x still declares no MathML
 * intrinsic elements, so the small set this application actually writes is
 * declared here rather than pulling in a dependency for it.
 *
 * React DOM already creates these tags in the MathML namespace; this file
 * only teaches TypeScript about them.
 */
import type { AriaAttributes, CSSProperties, DOMAttributes } from "react";

interface MathMLCommonProps extends AriaAttributes, DOMAttributes<Element> {
  key?: string | number;
  id?: string;
  className?: string;
  style?: CSSProperties;
  /** Presentational MathML sits beside a visually-hidden text reading. */
  "aria-hidden"?: boolean | "true" | "false";
  mathvariant?: "normal";
}

interface MathProps extends MathMLCommonProps {
  display?: "block" | "inline";
  /** Fallback text channel on the <math> element itself. */
  alttext?: string;
}

interface MoProps extends MathMLCommonProps {
  stretchy?: "true" | "false";
  fence?: "true" | "false";
  separator?: "true" | "false";
  form?: "prefix" | "infix" | "postfix";
  movablelimits?: "true" | "false";
  /** Stretch the fence symmetrically about the math axis (piecewise braces). */
  symmetric?: "true" | "false";
  minsize?: string;
  maxsize?: string;
  lspace?: string;
  rspace?: string;
}

interface MspaceProps extends MathMLCommonProps {
  width?: string;
  height?: string;
}

interface MtableProps extends MathMLCommonProps {
  columnalign?: string;
  rowspacing?: string;
  columnspacing?: string;
}

interface MtdProps extends MathMLCommonProps {
  columnalign?: string;
}

/** <mover>/<munder>: `accent` tucks the mark against the base at mark size. */
interface MunderoverProps extends MathMLCommonProps {
  accent?: "true" | "false";
  accentunder?: "true" | "false";
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      math: MathProps;
      mrow: MathMLCommonProps;
      mi: MathMLCommonProps;
      mn: MathMLCommonProps;
      mo: MoProps;
      mtext: MathMLCommonProps;
      mspace: MspaceProps;
      msub: MathMLCommonProps;
      msup: MathMLCommonProps;
      msubsup: MathMLCommonProps;
      mover: MunderoverProps;
      munder: MunderoverProps;
      munderover: MunderoverProps;
      mfrac: MathMLCommonProps;
      mstyle: MathMLCommonProps;
      mpadded: MathMLCommonProps;
      mtable: MtableProps;
      mtr: MathMLCommonProps;
      mtd: MtdProps;
    }
  }
}
