import { ProjectSpecificModelOffer } from "./ProjectSpecificModelOffer";

/**
 * The analysis-mode notice for portfolios beyond the public build's live
 * optimization size.
 *
 * This is a mode change, not a failure. The mathematical engine is N-general
 * — nothing in the model caps the number of sites — and the bound this notice
 * describes is a public-deployment scope choice about what a shared,
 * unauthenticated service runs on demand. So the notice never apologizes,
 * never calls the framework incapable, and never presents three sites as a
 * mathematical limit. It says what the application does next, and what a
 * larger or more complex portfolio actually needs (`ProjectSpecificModelOffer`,
 * embedded directly below the explanation as one connected surface, not a
 * detached card).
 *
 * It is driven by the builder's own site count, so it appears the moment the
 * fourth site is added rather than after the visitor has already pressed
 * Analyze and been surprised.
 */
export function LargePortfolioNotice({
  siteCount,
  optimizerMaxSites,
}: {
  siteCount: number;
  optimizerMaxSites: number;
}) {
  return (
    <aside className="mode-notice" aria-labelledby="mode-notice-heading">
      <p className="mode-notice__eyebrow">Analysis mode</p>
      <h3 id="mode-notice-heading" className="mode-notice__heading">
        Benchmark strategy comparison
      </h3>
      <p className="mode-notice__body">
        With {siteCount} candidate sites this application evaluates the
        defined benchmark portfolio strategies (
        <strong className="mode-notice__strategy">Cost first</strong>,{" "}
        <strong className="mode-notice__strategy">Spread across sites</strong>{" "}
        and{" "}
        <strong className="mode-notice__strategy">Schedule first</strong>) under
        your scenario and reports the best among those compared strategies.
        Full allocation optimization runs here for portfolios of up to{" "}
        {optimizerMaxSites} sites.{" "}
        <a href="/technical-documentation.html#benchmarks">
          How these strategies are defined
        </a>
        .
      </p>
      <ProjectSpecificModelOffer variant="embedded" />
    </aside>
  );
}
