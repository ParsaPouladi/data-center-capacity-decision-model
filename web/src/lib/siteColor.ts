/**
 * Categorical site-identity color, restricted to the three-site baseline
 * fixture (site ids "A" / "B" / "C"). Larger synthetic portfolios (N=6/N=10,
 * site ids "S000".."S00N") use neutral badges instead -- a validated
 * three-slot categorical palette does not extend to ten identities without
 * folding into "Other"), and
 * has no decision-relevant use for per-site color at that scale.
 */
const BASELINE_SITE_COLOR: Record<string, string> = {
  A: "var(--site-a)",
  B: "var(--site-b)",
  C: "var(--site-c)",
};

export function siteColor(siteId: string): string | null {
  return BASELINE_SITE_COLOR[siteId] ?? null;
}
