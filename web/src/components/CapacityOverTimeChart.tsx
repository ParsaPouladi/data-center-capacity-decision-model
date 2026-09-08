import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatMw } from "../lib/format";
import {
  AXIS_STROKE,
  AXIS_TICK_PX,
  AXIS_TITLE_INK,
  AXIS_TITLE_PX,
  GRID_DASH,
  GRID_STROKE,
  MARKER_LABEL_PX,
  MONTH_AXIS_TITLE,
  NARROW_MARKER_PX,
  REQUIRED_INK,
  REQUIRED_STROKE,
  RULE_DASH,
  SERIES_STROKE,
  TARGET_INK,
  TARGET_STROKE,
  TICK_INK,
  monthTicks,
  requiredCapacityLabel,
  requiredCapacityLabelShort,
  targetMonthLabel,
  targetMonthLabelShort,
} from "../lib/chartGrammar";

/**
 * Whether the viewport is narrow enough that the two marker labels collide.
 *
 * A media query rather than a measurement of the plot: the plot is drawn by a
 * responsive container whose width is not known to this component before the
 * first paint, and the annotation placement has to be decided with the labels,
 * not after them. Falls back to "not narrow" where `matchMedia` is absent, so
 * server-free static rendering and older environments keep the desktop
 * placement rather than a degraded one.
 */
function useNarrowPlot(): boolean {
  const query = `(max-width: ${NARROW_MARKER_PX - 1}px)`;
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function")
      return;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return narrow;
}

/**
 * V1 — the delivery outlook for the one allocation that is authoritative for
 * the current result. Every point is a value the engine already exported in
 * `delivered_capacity_trajectory`; this component only reshapes
 * `(times[i], trajectory[i])` pairs into chart rows and draws them. It
 * computes no model quantity and interpolates nothing.
 *
 * The allocation selector is gone — the page passes the authoritative
 * allocation (the optimizer's evaluated result, or the engine-selected best
 * strategy in comparison mode), never a browser-chosen one. The month axis,
 * required-capacity rule and target-date marker come from the shared
 * `chartGrammar` so this figure and the Site delivery strip read as one
 * system. The tooltip is supplementary only: the required capacity, the
 * target month, and the expected capacity on the target date are all
 * readable as text without hovering.
 */
export function CapacityOverTimeChart({
  times,
  trajectory,
  requiredCapacity,
  targetMonth,
  seriesLabel,
}: {
  times: number[];
  trajectory: number[];
  requiredCapacity: number;
  targetMonth: number;
  seriesLabel: string;
}) {
  const narrow = useNarrowPlot();
  const data = times.map((month, i) => ({
    month,
    capacity: trajectory[i],
  }));
  const horizon = times[times.length - 1] ?? 0;

  // A direct lookup of an already-exported value at an already-exported
  // grid point -- not an interpolation and not a derived quantity. When the
  // target month is not itself a grid point the line is simply omitted.
  const targetIndex = times.indexOf(targetMonth);
  const capacityAtTarget = targetIndex >= 0 ? trajectory[targetIndex] : null;

  return (
    <figure
      className="chart-figure"
      aria-label={
        `Line chart of expected usable capacity over time for the ` +
        `${seriesLabel}. Horizontal axis: month, 0 to ${horizon}. Vertical ` +
        `axis: expected usable capacity in megawatts. A horizontal dashed ` +
        `rule marks the required capacity of ${formatMw(requiredCapacity)}; ` +
        `a vertical dashed marker marks target month ${targetMonth}.` +
        (capacityAtTarget === null
          ? ""
          : ` Expected usable capacity on the target date is ${formatMw(
              capacityAtTarget,
            )}.`)
      }
      role="group"
    >
      <p className="chart-figure__series-note">
        <span className="chart-figure__series-swatch" aria-hidden="true" />
        Expected usable capacity, {seriesLabel}
      </p>
      <div className="chart-figure__plot">
        <ResponsiveContainer width="100%" height={330}>
          <LineChart data={data} margin={{ top: 20, right: 24, bottom: 30, left: 4 }}>
            <CartesianGrid stroke={GRID_STROKE} strokeDasharray={GRID_DASH} />
            <XAxis
              dataKey="month"
              type="number"
              domain={[0, "dataMax"]}
              ticks={monthTicks(horizon)}
              tick={{ fill: TICK_INK, fontSize: AXIS_TICK_PX }}
              stroke={AXIS_STROKE}
              label={{
                value: MONTH_AXIS_TITLE,
                position: "insideBottom",
                offset: -16,
                fill: AXIS_TITLE_INK,
                fontSize: AXIS_TITLE_PX,
              }}
            />
            <YAxis
              tick={{ fill: TICK_INK, fontSize: AXIS_TICK_PX }}
              stroke={AXIS_STROKE}
              tickFormatter={(v: number) => v.toLocaleString("en-US")}
              width={56}
              label={{
                value: "Expected usable capacity (MW)",
                angle: -90,
                position: "insideLeft",
                style: { textAnchor: "middle" },
                fill: AXIS_TITLE_INK,
                fontSize: AXIS_TITLE_PX,
              }}
            />
            <Tooltip
              formatter={(value) => [formatMw(Number(value)), "Expected usable capacity"]}
              labelFormatter={(label) => `Month ${String(label)}`}
              contentStyle={{
                background: "var(--surface-panel)",
                border: "1px solid var(--rule-strong)",
                borderRadius: 6,
                fontSize: 12,
              }}
            />
            <ReferenceLine
              y={requiredCapacity}
              stroke={REQUIRED_STROKE}
              strokeDasharray={RULE_DASH}
              label={{
                value: narrow
                  ? requiredCapacityLabelShort(formatMw(requiredCapacity))
                  : requiredCapacityLabel(formatMw(requiredCapacity)),
                position: "insideBottomRight",
                fill: REQUIRED_INK,
                fontSize: MARKER_LABEL_PX,
              }}
            />
            <ReferenceLine
              x={targetMonth}
              stroke={TARGET_STROKE}
              strokeDasharray={RULE_DASH}
              // Narrow plots move this annotation to the foot of its own rule.
              // The required-capacity rule sits high in these portfolios, so
              // both labels otherwise land in the same strip near the top of
              // the plot and overprint each other.
              label={{
                value: narrow
                  ? targetMonthLabelShort(targetMonth)
                  : targetMonthLabel(targetMonth),
                position: narrow ? "insideBottomLeft" : "insideTopLeft",
                fill: TARGET_INK,
                fontSize: MARKER_LABEL_PX,
              }}
            />
            <Line
              type="linear"
              dataKey="capacity"
              name="Expected usable capacity"
              stroke={SERIES_STROKE}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="chart-figure__readout">
        Required capacity <strong>{formatMw(requiredCapacity)}</strong> ·
        Target month <strong>{targetMonth}</strong>
        {capacityAtTarget === null ? null : (
          <>
            {" "}
            · Expected usable capacity on the target date{" "}
            <strong>{formatMw(capacityAtTarget)}</strong>
          </>
        )}
      </figcaption>
    </figure>
  );
}
