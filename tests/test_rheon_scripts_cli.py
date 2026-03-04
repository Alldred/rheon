#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

# SPDX-License-Identifier: MIT

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import pytest

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "rheon_cli_common.py"
SPEC = importlib.util.spec_from_file_location("rheon_cli_common", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
COMMON = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COMMON
SPEC.loader.exec_module(COMMON)


def test_parse_test_spec_valid() -> None:
    spec = COMMON.parse_test_spec("simple,10")
    assert spec.name == "simple"
    assert spec.count == 10


@pytest.mark.parametrize(
    "value",
    ["simple", "simple,0", "simple,-1", ",3", "simple,abc"],
)
def test_parse_test_spec_invalid(value: str) -> None:
    with pytest.raises(COMMON.ConfigError):
        COMMON.parse_test_spec(value)


def test_default_parallel_jobs_uses_cpu_minus_one() -> None:
    assert COMMON.default_parallel_jobs(lambda: 8) == 7
    assert COMMON.default_parallel_jobs(lambda: 1) == 1
    assert COMMON.default_parallel_jobs(lambda: None) == 1


def test_deterministic_job_seeds_stable() -> None:
    first = COMMON.deterministic_job_seeds(1234, 6)
    second = COMMON.deterministic_job_seeds(1234, 6)
    assert first == second
    assert len(first) == 6


def test_build_regression_config_merges_yaml_and_cli(tmp_path: Path) -> None:
    yaml_file = tmp_path / "regression.yaml"
    yaml_file.write_text(
        """
version: 1
regression:
  seed: 22
  jobs: 3
  update: 15
  stages: [run]
  tests:
    - name: from_file
      count: 2
""".strip()
    )

    args = argparse.Namespace(
        file=yaml_file,
        test=["from_cli,1"],
        seed=99,
        jobs=None,
        update=10,
        stages="gen,sim",
        output_dir=None,
        verbosity=None,
        waves=None,
    )

    config = COMMON.build_regression_config(args)
    assert config.seed == 99
    assert config.jobs == 3
    assert config.update == 10
    assert config.stages == ("gen", "sim")
    assert [item.name for item in config.tests] == ["from_file", "from_cli"]


def test_build_regression_config_requires_tests() -> None:
    args = argparse.Namespace(
        file=None,
        test=[],
        seed=None,
        jobs=None,
        update=None,
        stages=None,
        output_dir=None,
        verbosity=None,
        waves=None,
    )
    with pytest.raises(COMMON.ConfigError):
        COMMON.build_regression_config(args)


def test_build_regression_config_defaults_update_to_2() -> None:
    args = argparse.Namespace(
        file=None,
        test=["simple,1"],
        seed=None,
        jobs=2,
        update=None,
        stages=None,
        output_dir=None,
        verbosity=None,
        waves=None,
    )
    config = COMMON.build_regression_config(args)
    assert config.seed == 1
    assert config.update == 2


def test_build_regression_config_validates_update(tmp_path: Path) -> None:
    yaml_file = tmp_path / "regression.yaml"
    yaml_file.write_text(
        """
version: 1
regression:
  tests:
    - name: simple
      count: 1
  update: 0
""".strip()
    )

    args = argparse.Namespace(
        file=yaml_file,
        test=[],
        seed=None,
        jobs=None,
        update=None,
        stages=None,
        output_dir=None,
        verbosity=None,
        waves=None,
    )

    with pytest.raises(COMMON.ConfigError):
        COMMON.build_regression_config(args)


def test_build_regression_config_rejects_unknown_yaml_fields(tmp_path: Path) -> None:
    yaml_file = tmp_path / "regression.yaml"
    yaml_file.write_text(
        """
version: 1
regression:
  tests:
    - name: simple
      count: 1
  unknown_field: 123
""".strip()
    )

    args = argparse.Namespace(
        file=yaml_file,
        test=[],
        seed=None,
        jobs=None,
        update=None,
        stages=None,
        output_dir=None,
        verbosity=None,
        waves=None,
    )

    with pytest.raises(COMMON.ConfigError, match="schema validation failed"):
        COMMON.build_regression_config(args)


def test_build_regression_config_rejects_invalid_test_count_type(
    tmp_path: Path,
) -> None:
    yaml_file = tmp_path / "regression.yaml"
    yaml_file.write_text(
        """
version: 1
regression:
  tests:
    - name: simple
      count: "2"
""".strip()
    )

    args = argparse.Namespace(
        file=yaml_file,
        test=[],
        seed=None,
        jobs=None,
        update=None,
        stages=None,
        output_dir=None,
        verbosity=None,
        waves=None,
    )

    with pytest.raises(COMMON.ConfigError, match="schema validation failed"):
        COMMON.build_regression_config(args)
