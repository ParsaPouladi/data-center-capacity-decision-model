/**
 * The small shared time-axis grammar for the Decision-page figures.
 *
 * Deliberately not a chart framework: this is only the handful of constants
 * and label strings that keep V1 (`CapacityOverTimeChart`, Recharts) and V2
 * (`SiteDeliveryStrip`, inline SVG) reading as one system — same month axis,
 * same target-date marker, same required-capacity rule, same tick
 * typography. Nothing here computes a model quantity; `monthTicks` only
 * picks tick positions on an axis.
 *
 * It is NOT applied to `LambdaAllocationChart`, whose horizontal variable is
 * λ (a delay-consequence value), not time.
 */

/** Background grid: quiet, dotted-dash. */
export const GRID_DASH = "2 4";
/** Semantic reference rules (required capacity, target date). */
export const RULE_DASH = "6 4";

export const AXIS_TICK_PX = 11;
export const AXIS_TITLE_PX = 11;
export const MARKER_LABEL_PX = 11;

export const GRID_STROKE = "var(--chart-gridline)";
export const AXIS_STROKE = "var(--chart-axis)";
export const TICK_INK = "var(--chart-label)";
export const AXIS_TITLE_INK = "var(--ink-secondary)";

/** The required-capacity rule D — the one attention-coloured mark. */
export const REQUIRED_STROKE = "var(--attention-ink)";
export const REQUIRED_INK = "var(--attention-ink)";

/** The target-date marker T* — a neutral accent, never an alarm colour. */
export const TARGET_STROKE = "var(--ink-secondary)";
export const TARGET_INK = "var(--ink-secondary)";

/** The primary delivered-capacity series. */
export const SERIES_STROKE = "var(--chart-series-primary)";

/** Axis titles, shared so both figures name the same variable identically. */
export const MONTH_AXIS_TITLE = "Month";

/** The label carried by the target-date marker in every figure. */
export function targetMonthLabel(targetMonth: number): string {
  return `Target month ${targetMonth}`;
}

/** The label carried by the required-capacity rule wherever it applies. */
export function requiredCapacityLabel(formattedCapacity: string): string {
  return `Required capacity ${formattedCapacity}`;
}

/**
 * Below this plot width the two full marker labels are wider than the space
 * between the rules they annotate and collide with each other. Measured, not
 * guessed: the collision starts under 640 CSS px of viewport.
 */
export const NARROW_MARKER_PX = 640;

/** Compact marker labels for narrow plots. Same quantities, fewer words —
 * the figure's own readout carries the full wording underneath. */
export function targetMonthLabelShort(targetMonth: number): string {
  return `Target ${targetMonth}`;
}

export function requiredCapacityLabelShort(formattedCapacity: string): string {
  return `Required ${formattedCapacity}`;
}

/**
 * Evenly spaced whole-month tick positions across `[0, horizon]`, ending on
 * the horizon. Axis furniture only.
 */
export function monthTicks(horizon: number, count = 7): number[] {
  if (!Number.isFinite(horizon) || horizon <= 0) return [0];
  const n = Math.max(2, Math.round(count));
  const step = horizon / (n - 1);
  const ticks: number[] = [];
  for (let i = 0; i < n; i += 1) ticks.push(Math.round(i * step));
  return [...new Set(ticks)];
}
