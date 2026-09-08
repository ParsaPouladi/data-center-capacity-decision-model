import { formatMw, formatProbability } from "../lib/format";
import { siteColor } from "../lib/siteColor";
import { SiteLabel } from "./SiteLabel";
import {
  AXIS_STROKE,
  MONTH_AXIS_TITLE,
  RULE_DASH,
  TARGET_STROKE,
  monthTicks,
  targetMonthLabel,
} from "../lib/chartGrammar";
import type { SiteConfig, SitePowerProfile } from "../types/showcase";

/**
 * V2 — the Site delivery strip: one row per site, allocation on the left and
 * delivery timing on the right, sharing a single Month axis and the target-
 * date marker grammar of V1.
 *
 * Every drawn value is authoritative and already exported. The bars read
 * `allocation[site]` against `site.capacity_mw`; the steps are the engine's
 * own `profile_mw` arrays from `service.build_site_power_profiles`, replotted
 * and never recomputed. The step curves are each site's power-availability
 * schedule at its full developable capacity K — the timing question — while
 * the bar carries how much of that K was allocated. Nothing here derives a
 * new model quantity, and the ordinal burden / uncertainty state ids are not
 * used at all, arithmetically or otherwise.
 *
 * Above `SITE_STRIP_EXPLICIT_MAX` rows the explicit per-outcome lines stop
 * being legible, so a row instead shows its most likely exported outcome plus
 * a quiet envelope between the earliest and latest of the same exported
 * outcome profiles. That envelope is a pointwise minimum and maximum over
 * curves the engine already produced — not a new probabilistic quantity.
 */

/** Above this many sites, per-outcome step lines stop being readable. */
export const SITE_STRIP_EXPLICIT_MAX = 6;

const SW = 460;
const SH = 72;
const PAD = { top: 11, right: 10, bottom: 6, left: 10 };

type Scale = (v: number) => number;

/** viewBox x -> percent across the stretched plot area, so the HTML month
 *  axis lines up exactly with the rows' `preserveAspectRatio="none"` SVG. */
const pct = (x: number): number => (x / SW) * 100;

/** Step corner points: horizontal to the next time, then vertical to its value. */
function stepPoints(
  times: number[],
  values: number[],
  sx: Scale,
  sy: Scale,
): [number, number][] {
  const pts: [number, number][] = [[sx(times[0]), sy(values[0])]];
  for (let i = 1; i < times.length; i += 1) {
    pts.push([sx(times[i]), sy(values[i - 1])]);
    pts.push([sx(times[i]), sy(values[i])]);
  }
  return pts;
}

const toPath = (pts: [number, number][]): string =>
  pts.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ");

/** 0 -> 0.35, 1 -> 1.0: the least likely outcome stays visible but quiet. */
const opacityFor = (probability: number): number =>
  0.35 + 0.65 * Math.min(Math.max(probability, 0), 1);

function pointwise(
  profiles: number[][],
  pick: (a: number, b: number) => number,
): number[] {
  return profiles[0].map((_, i) =>
    profiles.reduce((acc, p) => pick(acc, p[i]), profiles[0][i]),
  );
}

function mostLikely(profile: SitePowerProfile) {
  return profile.outcomes.reduce((best, o) =>
    o.probability > best.probability ? o : best,
  );
}

function StripRow({
  profile,
  site,
  allocated,
  maxCapacity,
  horizon,
  targetMonth,
  explicit,
}: {
  profile: SitePowerProfile;
  site: SiteConfig | undefined;
  allocated: number;
  maxCapacity: number;
  horizon: number;
  targetMonth: number;
  explicit: boolean;
}) {
  const k = site?.capacity_mw ?? profile.capacity_mw;
  const headroom = Math.max(k - allocated, 0);
  const color = siteColor(profile.site_id) ?? "var(--data-1)";

  const sx: Scale = (t) =>
    PAD.left + (t / horizon) * (SW - PAD.left - PAD.right);
  const sy: Scale = (v) =>
    SH - PAD.bottom - (v / maxCapacity) * (SH - PAD.top - PAD.bottom);

  const likely = mostLikely(profile);
  const tau2s = profile.outcomes.map((o) => o.tau2);
  const earliestFull = Math.min(...tau2s);
  const latestFull = Math.max(...tau2s);

  const outcomeSentence = profile.outcomes
    .map(
      (o) =>
        `${o.delay_months} month delay at probability ${formatProbability(
          o.probability,
        )} reaches full power in month ${o.tau2}`,
    )
    .join("; ");

  return (
    <li className="site-strip__row">
      <div className="site-strip__alloc">
        <p className="site-strip__site">
          <SiteLabel id={profile.site_id} />
        </p>
        <div className="site-strip__track-wrap">
          <div
            className="site-strip__track"
            style={{ width: `${(k / maxCapacity) * 100}%` }}
          >
            <div
              className="site-strip__fill"
              style={{
                width: `${k > 0 ? (allocated / k) * 100 : 0}%`,
                background: color,
              }}
            />
          </div>
        </div>
        <p className="site-strip__values num">
          <strong>{formatMw(allocated)}</strong> allocated
          <span className="site-strip__dim">
            {" "}
            · {formatMw(headroom)} unused · K = {formatMw(k)}
          </span>
        </p>
      </div>

      <div className="site-strip__timing">
        <svg
          viewBox={`0 0 ${SW} ${SH}`}
          width="100%"
          height={SH}
          preserveAspectRatio="none"
          role="img"
          aria-label={
            `Delivery timing for site ${profile.site_id}. Full developable ` +
            `capacity ${formatMw(k)}, first tranche ${formatMw(
              profile.alpha * k,
            )}. Modeled outcomes: ${outcomeSentence}. Target month ` +
            `${targetMonth}.`
          }
        >
          <line
            x1={PAD.left}
            x2={SW - PAD.right}
            y1={sy(0)}
            y2={sy(0)}
            stroke={AXIS_STROKE}
            strokeWidth={1}
          />
          <line
            x1={sx(targetMonth)}
            x2={sx(targetMonth)}
            y1={0}
            y2={SH}
            stroke={TARGET_STROKE}
            strokeDasharray={RULE_DASH}
            strokeWidth={1}
          />
          {explicit ? (
            profile.outcomes.map((o, i) => (
              <path
                key={i}
                d={toPath(stepPoints(profile.times, o.profile_mw, sx, sy))}
                fill="none"
                stroke={color}
                strokeOpacity={opacityFor(o.probability)}
                strokeWidth={1 + 1.4 * o.probability}
                vectorEffect="non-scaling-stroke"
              />
            ))
          ) : (
            <>
              <path
                d={`${toPath(
                  stepPoints(
                    profile.times,
                    pointwise(
                      profile.outcomes.map((o) => o.profile_mw),
                      Math.max,
                    ),
                    sx,
                    sy,
                  ),
                )} ${toPath(
                  stepPoints(
                    profile.times,
                    pointwise(
                      profile.outcomes.map((o) => o.profile_mw),
                      Math.min,
                    ),
                    sx,
                    sy,
                  ).reverse(),
                ).replace(/^M/, "L")} Z`}
                fill={color}
                fillOpacity={0.14}
                stroke="none"
              />
              <path
                d={toPath(stepPoints(profile.times, likely.profile_mw, sx, sy))}
                fill="none"
                stroke={color}
                strokeWidth={1.8}
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>
        {explicit ? (
          <ul className="site-strip__outcomes">
            {profile.outcomes.map((o, i) => (
              <li key={i}>
                <span
                  className="site-strip__swatch"
                  style={{ background: color, opacity: opacityFor(o.probability) }}
                  aria-hidden="true"
                />
                +{o.delay_months} mo delay · {formatProbability(o.probability)} ·
                full power month {o.tau2}
              </li>
            ))}
          </ul>
        ) : (
          <p className="site-strip__outcomes site-strip__outcomes--summary">
            Most likely: +{likely.delay_months} mo delay ·{" "}
            {formatProbability(likely.probability)} · full power month{" "}
            {likely.tau2}. Across the modeled outcomes full power lands between
            month {earliestFull} and month {latestFull}.
          </p>
        )}
      </div>
    </li>
  );
}

export function SiteDeliveryStrip({
  sites,
  allocation,
  profiles,
  targetMonth,
}: {
  sites: SiteConfig[];
  allocation: Record<string, number>;
  profiles: SitePowerProfile[];
  targetMonth: number;
}) {
  if (profiles.length === 0) return null;

  const byId = new Map(sites.map((s) => [s.id, s]));
  const maxCapacity = Math.max(
    ...profiles.map((p) => byId.get(p.site_id)?.capacity_mw ?? p.capacity_mw),
  );
  const horizon = Math.max(
    ...profiles.map((p) => p.times[p.times.length - 1] ?? 0),
  );
  const explicit = profiles.length <= SITE_STRIP_EXPLICIT_MAX;

  const sx: Scale = (t) =>
    PAD.left + (t / horizon) * (SW - PAD.left - PAD.right);

  return (
    <div className="site-strip">
      <p className="site-strip__scale-note">
        Bars and steps share one megawatt scale: full height and full width ={" "}
        {formatMw(maxCapacity)}, the largest developable capacity K in this
        portfolio. The steps are each site’s power-availability schedule at its
        own full K, so they answer <em>when</em>, while the bar answers{" "}
        <em>how much was allocated</em>.
        {explicit
          ? " Heavier lines are more likely delay outcomes; every outcome is listed in full beside its row."
          : " The solid line is each site’s most likely delay outcome; the shaded band spans the earliest and latest of the same modeled outcomes."}
      </p>
      <ul className="site-strip__rows">
        {profiles.map((p) => (
          <StripRow
            key={p.site_id}
            profile={p}
            site={byId.get(p.site_id)}
            allocated={allocation[p.site_id] ?? 0}
            maxCapacity={maxCapacity}
            horizon={horizon}
            targetMonth={targetMonth}
            explicit={explicit}
          />
        ))}
      </ul>
      <div className="site-strip__axis">
        <div className="site-strip__axis-spacer" aria-hidden="true" />
        <div
          className="site-strip__axis-track"
          role="img"
          aria-label={
            `Shared month axis from 0 to ${horizon}. ` +
            `${targetMonthLabel(targetMonth)}.`
          }
        >
          {monthTicks(horizon).map((t) => (
            <span
              key={t}
              className="site-strip__tick"
              style={{ left: `${pct(sx(t))}%` }}
            >
              {t}
            </span>
          ))}
          <span
            className="site-strip__target-mark"
            style={{ left: `${pct(sx(targetMonth))}%` }}
            aria-hidden="true"
          >
            ▲
          </span>
        </div>
      </div>
      <div className="site-strip__axis">
        <div className="site-strip__axis-spacer" aria-hidden="true" />
        <p className="site-strip__axis-legend">
          <span>
            <span aria-hidden="true">▲</span> {targetMonthLabel(targetMonth)}
          </span>
          <span>{MONTH_AXIS_TITLE}</span>
        </p>
      </div>
    </div>
  );
}
