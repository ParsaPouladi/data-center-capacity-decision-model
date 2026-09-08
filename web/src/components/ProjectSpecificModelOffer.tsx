import { AUTHOR_NAME, CONTACT_HREF } from "./AppShell";

/**
 * The one reusable professional-engagement statement for the scenario
 * builder. It used to exist only inside
 * `LargePortfolioNotice`, framed narrowly as "need a larger portfolio?" and
 * therefore invisible to the majority of visitors who never add a fourth
 * site. The underlying reason a real project needs a custom implementation
 * is rarely just more sites -- it is usually a more complex decision: more
 * constraints, a richer cost or uncertainty structure, project-specific
 * parameterization -- so the offer is framed around complexity in general,
 * with site count as one example among several, and shown regardless of
 * portfolio size.
 *
 * One component, one copy, two placements:
 *  - `standalone` — its own quiet panel between Candidate Sites and Analyze,
 *    for a portfolio the public build still optimizes live (<=3 sites);
 *  - `embedded` — set directly beneath the Analysis Mode explanation inside
 *    the same panel, for a portfolio large enough to use benchmark
 *    comparison (4+ sites).
 *
 * Never rendered twice for one scenario (see `ScenarioWorkbench`), and never
 * claims the current public application already models the extra
 * complexity it describes.
 */
export function ProjectSpecificModelOffer({
  variant,
}: {
  variant: "standalone" | "embedded";
}) {
  return (
    <div className={`offer offer--${variant}`}>
      <p className="offer__eyebrow">Project-specific model</p>
      <p className="offer__ask">
        Need a project-specific model for a larger or more complex decision?
      </p>
      <p className="offer__body">
        More sites, additional constraints, richer cost structures, shared or
        correlated uncertainty, or project-specific parameterization can
        require a model built around the actual decision.
      </p>
      <a className="offer__contact" href={CONTACT_HREF}>
        Contact {AUTHOR_NAME}
        <span className="offer__contact-arrow" aria-hidden="true">
          &#x2192;
        </span>
      </a>
    </div>
  );
}
