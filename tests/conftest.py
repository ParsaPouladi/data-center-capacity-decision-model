from pathlib import Path

import pytest

from trackc.model.scenario_engine import ScenarioSet, enumerate_exact
from trackc.model.schemas import (
    BurdenStateConfig,
    ModelDefaults,
    Scenario,
    UncertaintyStateConfig,
    load_burden_states,
    load_model_defaults,
    load_scenario,
    load_uncertainty_states,
)

REPO_ROOT = Path(__file__).resolve().parents[1]
CONFIGS_DIR = REPO_ROOT / "configs"


@pytest.fixture
def configs_dir() -> Path:
    return CONFIGS_DIR


@pytest.fixture
def burden_states_path(configs_dir: Path) -> Path:
    return configs_dir / "burden_states.yaml"


@pytest.fixture
def uncertainty_states_path(configs_dir: Path) -> Path:
    return configs_dir / "uncertainty_states.yaml"


@pytest.fixture
def model_defaults_path(configs_dir: Path) -> Path:
    return configs_dir / "model_defaults.yaml"


@pytest.fixture
def baseline_scenario_path(configs_dir: Path) -> Path:
    return configs_dir / "baseline_scenario.yaml"


# --- loaded model objects (shared across test modules that need the actual
# baseline Scenario/config objects, not just their paths) -------------------


@pytest.fixture
def baseline(baseline_scenario_path: Path) -> Scenario:
    return load_scenario(baseline_scenario_path)


@pytest.fixture
def burden(burden_states_path: Path) -> BurdenStateConfig:
    return load_burden_states(burden_states_path)


@pytest.fixture
def uncertainty(uncertainty_states_path: Path) -> UncertaintyStateConfig:
    return load_uncertainty_states(uncertainty_states_path)


@pytest.fixture
def model_defaults(model_defaults_path: Path) -> ModelDefaults:
    return load_model_defaults(model_defaults_path)


@pytest.fixture
def exact_set(baseline: Scenario, uncertainty: UncertaintyStateConfig) -> ScenarioSet:
    return enumerate_exact(baseline, uncertainty)
