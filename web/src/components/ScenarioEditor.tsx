import {
  addSite,
  enteredCapacity,
  MAX_UI_SITES,
  removeSite,
  type PortfolioFeasibilityGap,
  type ScenarioDraft,
  type SiteDraft,
} from "../lib/scenarioDraft";
import type { InputDomain } from "../data/api";
import { formatMw } from "../lib/format";
import type { MappingsBundle } from "../types/showcase";

/**
 * The scenario-builder worksheet: one block for the requirement (required
 * capacity, target date, delay consequence) and one for the candidate sites
 * (capacity, relative cost, power-delivery complexity, schedule
 * uncertainty), with add / remove within the {@link MAX_UI_SITES}-site cap.
 *
 * It is a controlled form only — every field maps to an existing engine
 * schema field, and it computes nothing about the model. `validateDraft`
 * (input-level checks) and the authoritative API do that. Numeric bounds
 * come from the live `/api/p1/config` `input_domain` contract when
 * available, with canonical-schema fallbacks (no invented UX limits).
 *
 * The state meanings shown under each select are the plain-language public
 * wording of the frozen `mappings.json` (v1-baseline). Parity with the
 * mapping data (tranche months for complexity, worst-case delay for
 * uncertainty) was checked on 2026-08-31; if `mappings.json` changes, these
 * lines must be re-checked against it, not left to drift.
 */

/** Power-delivery complexity — public meaning per ordinal level (1..4). */
const COMPLEXITY_MEANING: Record<number, string> = {
  1: "Limited additional infrastructure. Power from month 18, full month 24.",
  2: "Local and substation upgrades. Power from month 24, full month 30.",
  3: "Major dedicated infrastructure. Power from month 30, full month 42.",
  4: "Upstream system dependency. Power from month 42, full month 54.",
};

/** Schedule uncertainty — public meaning per ordinal level (1..4). */
const UNCERTAINTY_MEANING: Record<number, string> = {
  1: "Usually on time. Up to 6 months late in the worst modeled case.",
  2: "Meaningful slip risk. Up to 12 months late in the worst modeled case.",
  3: "Large timing uncertainty. Up to 18 months late in the worst modeled case.",
  4: "Wide range. Up to 24 months late in the worst modeled case.",
};

const NUMERIC_PLACEHOLDER = "Enter value";

interface StateOption {
  value: number;
  label: string;
}

function stateOptions(
  table: MappingsBundle["burden"] | MappingsBundle["uncertainty"] | undefined,
): StateOption[] {
  if (table) {
    return Object.entries(table.states).map(([k, v]) => ({
      value: Number(k),
      label: v.label,
    }));
  }
  return [1, 2, 3, 4].map((n) => ({ value: n, label: `Level ${n}` }));
}

export function ScenarioEditor({
  draft,
  onChange,
  mappings,
  errors,
  showErrors,
  feasibility,
  domain,
}: {
  draft: ScenarioDraft;
  onChange: (next: ScenarioDraft) => void;
  mappings: MappingsBundle | null;
  errors: string[];
  /** Suppress the input-error list until the visitor has actually edited
   * the builder — a fresh, untouched worksheet is not "wrong". */
  showErrors: boolean;
  feasibility?: PortfolioFeasibilityGap;
  domain?: InputDomain | null;
}) {
  const setSystem = (patch: Partial<ScenarioDraft["system"]>) =>
    onChange({ ...draft, system: { ...draft.system, ...patch } });

  const setSite = (index: number, patch: Partial<SiteDraft>) =>
    onChange({
      ...draft,
      sites: draft.sites.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    });

  const complexityOptions = stateOptions(mappings?.burden);
  const uncertaintyOptions = stateOptions(mappings?.uncertainty);

  const capacity = enteredCapacity(draft);
  const lambdaText = draft.system.lambda_mw_month.trim();
  const lambdaValue = Number(lambdaText);
  const lambdaHasValue = lambdaText !== "" && Number.isFinite(lambdaValue);
  const horizonMonth = Number(draft.system.horizon_month);
  const targetMax =
    Number.isFinite(horizonMonth) && horizonMonth > 1
      ? horizonMonth - 1
      : undefined;
  // λ has an authoritative lower bound of 0 and NO authoritative upper bound;
  // the slider range is a convenience only (confirmed via input_domain).
  const lambdaSliderMax =
    domain && domain.lambda_mw_month.max !== null
      ? domain.lambda_mw_month.max
      : 0.25;
  /**
   * The numeric field is the model-authoritative control; the slider is a
   * quick-set convenience over the range most scenarios sit in.
   *
   * It is therefore rendered only while the entered value is actually inside
   * that range. Pinning the thumb at the convenience maximum for a larger
   * value misrepresents the value, and any keyboard or pointer nudge from a
   * pinned thumb writes the convenience maximum back into the model input —
   * silently replacing a valid λ the visitor chose. A value above the range
   * is valid, is used exactly as typed, and simply has no quick-set position.
   */
  const lambdaInSliderRange =
    lambdaHasValue && lambdaValue >= 0 && lambdaValue <= lambdaSliderMax;

  return (
    <div className="editor">
      <fieldset className="editor__group">
        <legend className="subsection-heading">The requirement</legend>
        <p className="editor__group-lede">
          What the portfolio has to deliver, and by when.
        </p>

        {/* Three primary controls on one alignment line, their helper copy on
            a second. The grid rows are shared, so a control with more
            material below it (the delay-consequence slider) cannot leave the
            other two columns ragged. */}
        <div className="req-grid">
          <div className="req-grid__control">
            <label className="field__label" htmlFor="required-capacity">
              Required capacity (MW)
            </label>
            <input
              id="required-capacity"
              className="field__input num"
              type="number"
              inputMode="decimal"
              min={0}
              step={10}
              placeholder={NUMERIC_PLACEHOLDER}
              value={draft.system.required_capacity_mw}
              onChange={(e) =>
                setSystem({ required_capacity_mw: e.target.value })
              }
            />
          </div>

          <div className="req-grid__control">
            <label className="field__label" htmlFor="target-date">
              Target date (month)
            </label>
            <input
              id="target-date"
              className="field__input num"
              type="number"
              inputMode="numeric"
              min={1}
              max={targetMax}
              step={1}
              placeholder={NUMERIC_PLACEHOLDER}
              value={draft.system.target_month}
              onChange={(e) => setSystem({ target_month: e.target.value })}
            />
          </div>

          <div className="req-grid__control">
            <label className="field__label" htmlFor="delay-consequence">
              Delay consequence
            </label>
            <div className="req-grid__lambda">
              <input
                id="delay-consequence"
                className="field__input num"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.005}
                placeholder={NUMERIC_PLACEHOLDER}
                value={draft.system.lambda_mw_month}
                onChange={(e) => setSystem({ lambda_mw_month: e.target.value })}
              />
              {lambdaInSliderRange ? (
                <input
                  className="field__lambda-slider"
                  type="range"
                  min={0}
                  max={lambdaSliderMax}
                  step={0.005}
                  value={lambdaValue}
                  onChange={(e) =>
                    setSystem({ lambda_mw_month: e.target.value })
                  }
                  aria-label="Delay consequence quick-set"
                />
              ) : null}
            </div>
            {lambdaHasValue && !lambdaInSliderRange && lambdaValue >= 0 ? (
              <p className="field__hint field__hint--lambda">
                Above the quick-set range of 0&ndash;{lambdaSliderMax}. Your
                entered value is used exactly as typed.
              </p>
            ) : null}
          </div>

          <p className="req-grid__note">
            Usable capacity the portfolio has to deliver.
          </p>
          {/* Model horizon and target domain are two different things: the
              model runs to the terminal month, and the date being asked about
              has to fall inside that run. Stating them as one sentence stops
              "modeled through 72" and "target at most 71" reading as a
              contradiction. The rule itself is unchanged. */}
          <p className="req-grid__note">
            The month it is needed by. Model horizon: month{" "}
            {draft.system.horizon_month}; the target date must be earlier.
          </p>
          {/* The one negative clause kept here: a reader who takes this
              number for a market price misreads every result that follows. */}
          <p className="req-grid__note">
            Relative cost units per MW-month of unmet capacity, and a position
            you set, not a market price. Higher values make late capacity weigh
            more heavily against development cost.
          </p>
        </div>
      </fieldset>

      <fieldset className="editor__group">
        <legend className="subsection-heading">Candidate sites</legend>
        <p className="editor__group-lede">
          The sites capacity can be built on. Each one delivers power on its
          own phased schedule.
        </p>

        <div className="sites">
          <div className="sites__head" aria-hidden="true">
            <span>Site</span>
            <span>Capacity (MW)</span>
            <span>Relative cost per MW</span>
            <span>Power-delivery complexity</span>
            <span>Schedule uncertainty</span>
            <span />
          </div>

          {draft.sites.map((site, i) => {
            const rowName = `Site ${site.id.trim() || i + 1}`;
            return (
              <div
                className="sites__row"
                key={i}
                role="group"
                aria-label={rowName}
              >
                <div className="sites__cell">
                  <label
                    className="sites__cell-label"
                    htmlFor={`site-${i}-id`}
                  >
                    Site
                  </label>
                  <input
                    id={`site-${i}-id`}
                    className="field__input field__input--id"
                    type="text"
                    value={site.id}
                    onChange={(e) => setSite(i, { id: e.target.value })}
                  />
                </div>

                <div className="sites__cell">
                  <label
                    className="sites__cell-label"
                    htmlFor={`site-${i}-capacity`}
                  >
                    Capacity (MW)
                  </label>
                  <input
                    id={`site-${i}-capacity`}
                    className="field__input field__input--narrow num"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={10}
                    placeholder={NUMERIC_PLACEHOLDER}
                    value={site.capacity_mw}
                    onChange={(e) =>
                      setSite(i, { capacity_mw: e.target.value })
                    }
                  />
                </div>

                <div className="sites__cell">
                  <label
                    className="sites__cell-label"
                    htmlFor={`site-${i}-cost`}
                  >
                    Relative cost per MW
                  </label>
                  <input
                    id={`site-${i}-cost`}
                    className="field__input field__input--narrow num"
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step={0.05}
                    placeholder={NUMERIC_PLACEHOLDER}
                    value={site.cost_per_mw}
                    onChange={(e) =>
                      setSite(i, { cost_per_mw: e.target.value })
                    }
                  />
                </div>

                <div className="sites__cell sites__cell--select">
                  <label
                    className="sites__cell-label"
                    htmlFor={`site-${i}-complexity`}
                  >
                    Power-delivery complexity
                  </label>
                  <select
                    id={`site-${i}-complexity`}
                    className="field__input"
                    value={site.burden_state || ""}
                    onChange={(e) =>
                      setSite(i, { burden_state: Number(e.target.value) })
                    }
                  >
                    <option value="" disabled>
                      Select a level
                    </option>
                    {complexityOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {site.burden_state ? (
                    <p className="state-meaning">
                      {COMPLEXITY_MEANING[site.burden_state] ??
                        "Meaning unavailable for this level."}
                    </p>
                  ) : null}
                </div>

                <div className="sites__cell sites__cell--select">
                  <label
                    className="sites__cell-label"
                    htmlFor={`site-${i}-uncertainty`}
                  >
                    Schedule uncertainty
                  </label>
                  <select
                    id={`site-${i}-uncertainty`}
                    className="field__input"
                    value={site.uncertainty_state || ""}
                    onChange={(e) =>
                      setSite(i, { uncertainty_state: Number(e.target.value) })
                    }
                  >
                    <option value="" disabled>
                      Select a level
                    </option>
                    {uncertaintyOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {site.uncertainty_state ? (
                    <p className="state-meaning">
                      {UNCERTAINTY_MEANING[site.uncertainty_state] ??
                        "Meaning unavailable for this level."}
                    </p>
                  ) : null}
                </div>

                <div className="sites__cell sites__cell--action">
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => onChange(removeSite(draft, i))}
                    disabled={draft.sites.length <= 1}
                    aria-label={`Remove ${rowName}`}
                  >
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="sites__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => onChange(addSite(draft))}
            disabled={draft.sites.length >= MAX_UI_SITES}
          >
            Add site
          </button>
          <span className="field__hint">
            {capacity.filled === 0
              ? `${draft.sites.length} of ${MAX_UI_SITES} sites.`
              : capacity.filled === capacity.total
                ? `Total site capacity ${formatMw(capacity.sum)} across ${capacity.total} site${capacity.total === 1 ? "" : "s"}.`
                : `Capacity entered so far: ${formatMw(capacity.sum)} across ${capacity.filled} of ${capacity.total} sites.`}
          </span>
        </div>

        <p className="sites__legend">
          Relative cost per MW is an index, not currency. A site at 1.15 costs
          15% more per MW than a site at 1.00.
        </p>

        {feasibility ? (
          <div className="editor__note capacity-gap" role="status">
            {/* The number first, at a glance, then the same fact in words
                a reader should not have to parse a full sentence to see
                how far short the portfolio is. */}
            <div className="capacity-gap__chip">
              <span className="capacity-gap__chip-label">Capacity gap</span>
              <span className="capacity-gap__chip-value">
                {formatMw(feasibility.gapMw)}
              </span>
            </div>
            <p className="capacity-gap__text">
              Total site capacity is{" "}
              {formatMw(feasibility.totalDevelopableMw)} against a{" "}
              {formatMw(feasibility.requiredCapacityMw)} requirement. Add at
              least {formatMw(feasibility.gapMw)} of developable capacity or
              reduce the requirement before analysis can run. Your entries
              are unchanged.
            </p>
          </div>
        ) : null}

        <p className="fine-print">
          Power-delivery complexity and schedule uncertainty are ordinal levels
          with a fixed published meaning, shown under each control once
          selected. They are identifiers resolved through the state mappings,
          never combined arithmetically.
        </p>
      </fieldset>

      {showErrors && errors.length > 0 ? (
        <div className="callout callout--warn" role="alert">
          <strong>A few inputs still need attention:</strong>
          <ul className="editor__errors">
            {errors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
