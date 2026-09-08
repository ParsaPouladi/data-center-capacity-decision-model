"""Typed schemas and validation for site inputs, system inputs, allocations,
and state-mapping configuration.

This module implements the input & configuration layer (see the model
specification). It does not
compute anything about power delivery or strategy outcomes -- see
`trackc.model.mappings` and `trackc.model.power_profile` for that.

Design note (forward-compatibility): a `Site`'s fields describe only the
power-delivery side of a site. Nothing here assumes power delivery is the
only source of schedule uncertainty -- callers pass explicit
`Site`/`SystemInputs` objects rather than relying on any global state, so a
later higher-level model could construct these objects however it likes
without touching this module.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field, field_validator, model_validator

BurdenState = Literal[1, 2, 3, 4]
UncertaintyState = Literal[1, 2, 3, 4]

_PROB_SUM_TOLERANCE = 1e-9


# ---------------------------------------------------------------------------
# Site-level and system-level inputs (model spec)
# ---------------------------------------------------------------------------


class Site(BaseModel):
    """A single candidate site's independently configurable characteristics
    (model spec). K, c, B, U are never derived from one another.
    """

    id: str = Field(min_length=1)
    capacity_mw: float = Field(gt=0, description="K_i: maximum developable capacity (MW)")
    cost_per_mw: float = Field(ge=0, description="c_i: development cost per MW")
    burden_state: BurdenState = Field(description="B_i in {1,2,3,4}")
    uncertainty_state: UncertaintyState = Field(description="U_i in {1,2,3,4}")


class SystemInputs(BaseModel):
    """System-level requirements (model spec)."""

    required_capacity_mw: float = Field(gt=0, description="D: required usable capacity (MW)")
    target_month: int = Field(gt=0, description="T*: month by which D is required")
    horizon_month: int = Field(gt=0, description="H: final modeled month")
    lambda_mw_month: float = Field(
        ge=0, description="lambda: economic consequence per MW-month of unmet capacity"
    )

    @model_validator(mode="after")
    def _horizon_extends_past_target(self) -> SystemInputs:
        if self.horizon_month <= self.target_month:
            raise ValueError(
                f"horizon_month ({self.horizon_month}) must be strictly greater than "
                f"target_month ({self.target_month}); H must extend beyond T* to "
                "quantify late delivery (spec section 8)."
            )
        return self


class Scenario(BaseModel):
    """A complete, loadable scenario: system requirements plus N sites."""

    system: SystemInputs
    sites: list[Site] = Field(min_length=1)

    @field_validator("sites")
    @classmethod
    def _unique_site_ids(cls, sites: list[Site]) -> list[Site]:
        ids = [s.id for s in sites]
        if len(ids) != len(set(ids)):
            duplicates = sorted({i for i in ids if ids.count(i) > 1})
            raise ValueError(f"duplicate site id(s): {duplicates}")
        return sites


# ---------------------------------------------------------------------------
# Allocation (model spec)
# ---------------------------------------------------------------------------


class Allocation(BaseModel):
    """A candidate allocation x = (x_1, ..., x_N), keyed by site id.

    Structural validity here is limited to 0 <= x_i (schema-local). The
    upper bound x_i <= K_i requires knowledge of site capacities and is
    checked by `validate_allocation_against_sites` below (a model
    validation invariant). Feasibility relative to D (system- vs strategy-
    level insufficiency) belongs to the evaluator, not here -- this
    layer has no notion of delivered capacity yet.
    """

    by_site: dict[str, float] = Field(default_factory=dict)

    @field_validator("by_site")
    @classmethod
    def _non_negative(cls, by_site: dict[str, float]) -> dict[str, float]:
        negative = {k: v for k, v in by_site.items() if v < 0}
        if negative:
            raise ValueError(f"allocation values must be non-negative, got: {negative}")
        return by_site


def validate_allocation_against_sites(allocation: Allocation, sites: list[Site]) -> None:
    """Validate x_i <= K_i for every site, and that every allocated site id
    is known (a model validation invariant).

    Sites with no entry in `allocation.by_site` are treated as x_i = 0.
    """
    capacities = {s.id: s.capacity_mw for s in sites}
    unknown = set(allocation.by_site) - set(capacities)
    if unknown:
        raise ValueError(f"allocation references unknown site id(s): {sorted(unknown)}")

    violations = {
        site_id: (x, capacities[site_id])
        for site_id, x in allocation.by_site.items()
        if x > capacities[site_id]
    }
    if violations:
        detail = ", ".join(f"{k}: x={v[0]} > K={v[1]}" for k, v in violations.items())
        raise ValueError(f"allocation exceeds site capacity for: {detail}")


# ---------------------------------------------------------------------------
# State-mapping configuration (model spec)
# ---------------------------------------------------------------------------


class BurdenStateDefinition(BaseModel):
    label: str
    interpretation: str
    tau1_bar: float = Field(gt=0, description="nominal first-tranche month")
    tau2_bar: float = Field(gt=0, description="nominal full-power month")

    @model_validator(mode="after")
    def _tranche_ordering(self) -> BurdenStateDefinition:
        if self.tau2_bar <= self.tau1_bar:
            raise ValueError(
                f"tau2_bar ({self.tau2_bar}) must be strictly greater than "
                f"tau1_bar ({self.tau1_bar}); tranche 2 must not precede tranche 1 "
                "(spec section 39 invariant #5)."
            )
        return self


class BurdenStateConfig(BaseModel):
    """B_i -> (tau1_bar, tau2_bar) mapping (model spec)."""

    mapping_version: str
    states: dict[BurdenState, BurdenStateDefinition]

    @field_validator("states")
    @classmethod
    def _all_states_present(
        cls, states: dict[int, BurdenStateDefinition]
    ) -> dict[int, BurdenStateDefinition]:
        missing = {1, 2, 3, 4} - set(states)
        if missing:
            raise ValueError(f"burden_states config missing state(s): {sorted(missing)}")
        return states


class UncertaintyStateDefinition(BaseModel):
    label: str
    interpretation: str
    delay_months: list[float] = Field(min_length=1)
    probabilities: list[float] = Field(min_length=1)

    @model_validator(mode="after")
    def _validate_distribution(self) -> UncertaintyStateDefinition:
        if len(self.delay_months) != len(self.probabilities):
            raise ValueError(
                f"delay_months (len={len(self.delay_months)}) and probabilities "
                f"(len={len(self.probabilities)}) must have equal length."
            )
        if any(d < 0 for d in self.delay_months):
            raise ValueError(
                f"delay_months must be non-negative in v1 (no early delivery): "
                f"{self.delay_months}"
            )
        if any(p < 0 for p in self.probabilities):
            raise ValueError(f"probabilities must be non-negative: {self.probabilities}")
        total = sum(self.probabilities)
        if abs(total - 1.0) > _PROB_SUM_TOLERANCE:
            raise ValueError(
                f"probabilities must sum to 1 (spec section 39 invariant #4), "
                f"got sum={total} for {self.probabilities}"
            )
        return self


class UncertaintyStateConfig(BaseModel):
    """U_i -> delay distribution F_i mapping (model spec)."""

    mapping_version: str
    states: dict[UncertaintyState, UncertaintyStateDefinition]

    @field_validator("states")
    @classmethod
    def _all_states_present(
        cls, states: dict[int, UncertaintyStateDefinition]
    ) -> dict[int, UncertaintyStateDefinition]:
        missing = {1, 2, 3, 4} - set(states)
        if missing:
            raise ValueError(f"uncertainty_states config missing state(s): {sorted(missing)}")
        return states


class ModelDefaults(BaseModel):
    """Model-wide defaults.

    `alpha` is the tranche fraction. The scenario-engine defaults
    (`max_exact_scenarios`, `mc_samples`, `random_seed`) -- the
    exact-vs-Monte-Carlo switching threshold, Monte Carlo sample count,
    and the fixed sampling seed. See the model specification.
    """

    alpha: float = Field(gt=0, lt=1, description="tranche fraction (model spec)")
    max_exact_scenarios: int = Field(
        gt=0,
        description=(
            "exact enumeration is used while S_full = prod_i q_i <= this value; "
            "above it the scenario engine switches to Monte Carlo (model spec)"
        ),
    )
    mc_samples: int = Field(
        gt=0, description="Monte Carlo sample count M when sampling is used (model spec)"
    )
    random_seed: int = Field(
        ge=0, description="fixed seed for reproducible Monte Carlo sampling (model spec)"
    )


# ---------------------------------------------------------------------------
# YAML loaders
# ---------------------------------------------------------------------------


def _read_yaml(path: str | Path) -> dict:
    path = Path(path)
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if not isinstance(data, dict):
        raise ValueError(f"expected a YAML mapping at top level of {path}, got {type(data)}")
    return data


def load_burden_states(path: str | Path) -> BurdenStateConfig:
    return BurdenStateConfig.model_validate(_read_yaml(path))


def load_uncertainty_states(path: str | Path) -> UncertaintyStateConfig:
    return UncertaintyStateConfig.model_validate(_read_yaml(path))


def load_model_defaults(path: str | Path) -> ModelDefaults:
    return ModelDefaults.model_validate(_read_yaml(path))


def load_scenario(path: str | Path) -> Scenario:
    data = _read_yaml(path)
    return Scenario.model_validate(data)
