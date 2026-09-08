/**
 * Presentation-only formatting helpers. Every function here formats a value
 * that already exists in an authoritative export -- none of them compute,
 * derive, or aggregate a new model quantity.
 */

export function formatNumber(value: number, digits = 2): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatInteger(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * p_meet is a probability in [0, 1], shown as a one-decimal percentage.
 * Exact zero renders "0.0%"; a positive value below the 0.1% display
 * resolution renders "<0.1%" so a small nonzero chance is not conflated
 * with the structural exact-zero (zero-chance) state. This is a
 * precision-preserving display convention, not a decision threshold.
 */
export function formatProbability(value: number): string {
  if (value === 0) return "0.0%";
  if (value > 0 && value < 0.001) return "<0.1%";
  return `${(value * 100).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/** Relative development-cost units -- never a currency symbol. */
export function formatRelativeCost(value: number, digits = 2): string {
  return `${formatNumber(value, digits)} rel. units`;
}

export function formatMwMonths(value: number, digits = 1): string {
  return `${formatNumber(value, digits)} MW-months`;
}

export function formatMw(value: number, digits = 0): string {
  return `${formatNumber(value, digits)} MW`;
}

export function formatMethodLabel(method: "exact" | "monte_carlo"): string {
  return method === "exact" ? "Exact enumeration" : "Monte Carlo";
}

export function formatSeconds(value: number): string {
  if (value < 1) return `${formatNumber(value * 1000, 1)} ms`;
  return `${formatNumber(value, 2)} s`;
}

export function formatMemoryMb(value: number): string {
  if (value >= 1024) return `${formatNumber(value / 1024, 2)} GiB`;
  return `${formatNumber(value, 0)} MiB`;
}

/**
 * Trailing-zero-free rendering at `digits` decimal places -- used for values
 * (a delay-consequence λ, a sensitivity threshold) that read awkwardly with
 * a forced trailing zero (e.g. "0.025" rendering as "0.02500").
 */
export function formatTrimmed(value: number, digits = 3): string {
  return String(Number(value.toFixed(digits)));
}

export function titleCaseStrategy(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
