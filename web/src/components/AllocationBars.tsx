import { siteColor } from "../lib/siteColor";
import { formatMw } from "../lib/format";
import { SiteLabel } from "./SiteLabel";
import type { CoordinateBounds, SiteConfig } from "../types/showcase";

/**
 * Horizontal allocation bars: allocated MW per site (x_i) drawn against the
 * site's maximum developable capacity K_i, with unused headroom shown as a
 * quiet hatched remainder. All bars share one MW scale (the largest K_i in
 * the portfolio) so cross-site magnitudes are comparable. Pure presentation
 * of already-authoritative values -- no derived quantity.
 */
export function AllocationBars({
  sites,
  allocation,
  coordinateBounds,
}: {
  sites: SiteConfig[];
  allocation: Record<string, number>;
  coordinateBounds?: CoordinateBounds | null;
}) {
  const maxCapacity = Math.max(...sites.map((s) => s.capacity_mw));

  return (
    <div className="alloc-bars">
      <p className="alloc-bars__scale-note">
        Bars share one scale: full width ={" "}
        {formatMw(maxCapacity)} (largest site capacity K in this portfolio).
      </p>
      <ul className="alloc-bars__list">
        {sites.map((site) => {
          const x = allocation[site.id] ?? 0;
          const k = site.capacity_mw;
          const trackPct = (k / maxCapacity) * 100;
          const fillPct = k > 0 ? (x / k) * 100 : 0;
          const color = siteColor(site.id) ?? "var(--border-strong)";
          const bounds = coordinateBounds?.[site.id];
          const headroom = Math.max(k - x, 0);

          return (
            <li key={site.id} className="alloc-bars__row">
              <div className="alloc-bars__label">
                <SiteLabel id={site.id} />
              </div>
              <div className="alloc-bars__track-wrap">
                <div
                  className="alloc-bars__track"
                  style={{ width: `${trackPct}%` }}
                >
                  <div
                    className="alloc-bars__fill"
                    style={{ width: `${fillPct}%`, background: color }}
                  />
                  {bounds ? (
                    <span
                      className="alloc-bars__bound"
                      style={{
                        left: `${(bounds[0] / k) * 100}%`,
                        right: `${100 - (bounds[1] / k) * 100}%`,
                      }}
                      title={`Co-optimal range ${formatMw(bounds[0])} – ${formatMw(
                        bounds[1],
                      )}`}
                    />
                  ) : null}
                </div>
              </div>
              <div className="alloc-bars__values num">
                <span className="alloc-bars__x">{formatMw(x)}</span>
                <span className="alloc-bars__of"> allocated · </span>
                <span className="alloc-bars__headroom-val">
                  {formatMw(headroom)} unused
                </span>
                <span className="alloc-bars__cap"> · K = {formatMw(k)}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
