#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BIN_REGR = REPO_ROOT / "bin" / "rheon_regr"
SCRIPT_REGR = REPO_ROOT / "scripts" / "rheon_regr"
MODULE_PATH = REPO_ROOT / "scripts" / "rheon_cli_common.py"
SPEC = importlib.util.spec_from_file_location("rheon_cli_common", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
COMMON = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COMMON
SPEC.loader.exec_module(COMMON)


def _args(**overrides: object) -> argparse.Namespace:
    base = {
        "file": None,
        "test": [],
        "seed": None,
        "jobs": None,
        "update": None,
        "stages": None,
        "output_dir": None,
        "verbosity": None,
        "waves": None,
        "resume": None,
        "timeout_sec": None,
        "fail_fast": None,
        "max_failures": None,
        "report_json": None,
    }
    base.update(overrides)
    return argparse.Namespace(**base)


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
  update: 5
  stages: [run]
  timeout_sec: 60
  max_failures: 4
  tests:
    - name: from_file
      count: 2
""".strip()
    )

    config = COMMON.build_regression_config(
        _args(
            file=yaml_file,
            test=["from_cli,1"],
            seed=99,
            update=2,
            stages="gen,sim",
            timeout_sec=30,
            fail_fast=True,
            max_failures=2,
            report_json=tmp_path / "report.json",
        )
    )
    assert config.seed == 99
    assert config.jobs == 3
    assert config.update == 2
    assert config.stages == ("gen", "sim")
    assert config.timeout_sec == 30
    assert config.fail_fast is True
    assert config.max_failures == 2
    assert config.report_json == (tmp_path / "report.json")
    assert [item.name for item in config.tests] == ["from_file", "from_cli"]


def test_build_regression_config_requires_tests() -> None:
    with pytest.raises(COMMON.ConfigError):
        COMMON.build_regression_config(_args())


def test_build_regression_config_defaults_update_to_2() -> None:
    config = COMMON.build_regression_config(
        _args(
            test=["simple,1"],
            jobs=2,
        )
    )
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
    with pytest.raises(COMMON.ConfigError):
        COMMON.build_regression_config(_args(file=yaml_file))


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
    with pytest.raises(COMMON.ConfigError, match="schema validation failed"):
        COMMON.build_regression_config(_args(file=yaml_file))


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
    with pytest.raises(COMMON.ConfigError, match="schema validation failed"):
        COMMON.build_regression_config(_args(file=yaml_file))


def test_resume_latest_resolves_to_symlink_target(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    resume_target = tmp_path / "resume_dir"
    resume_target.mkdir()
    latest = tmp_path / "latest"
    latest.symlink_to(resume_target, target_is_directory=True)
    monkeypatch.setattr(COMMON, "latest_shortcut_path", lambda: latest)

    config = COMMON.build_regression_config(
        _args(
            test=["simple,1"],
            resume="latest",
        )
    )
    assert config.resume == resume_target.resolve()
    assert config.output_dir == resume_target.resolve()


def test_resume_latest_missing_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    latest = tmp_path / "latest"
    monkeypatch.setattr(COMMON, "latest_shortcut_path", lambda: latest)
    with pytest.raises(COMMON.ConfigError, match="latest"):
        COMMON.build_regression_config(
            _args(
                test=["simple,1"],
                resume="latest",
            )
        )


def test_help_includes_new_flags_and_latest() -> None:
    completed = subprocess.run(
        [str(BIN_REGR), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0
    help_text = completed.stdout
    assert "--resume" in help_text
    assert "--timeout-sec" in help_text
    assert "--fail-fast" in help_text
    assert "--max-failures" in help_text
    assert "--report-json" in help_text
    assert "--resume latest" in help_text


def test_wrapper_help_matches_bin_help() -> None:
    bin_help = subprocess.run(
        [str(BIN_REGR), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    wrapper_help = subprocess.run(
        [str(SCRIPT_REGR), "--help"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert bin_help.returncode == 0
    assert wrapper_help.returncode == 0
    assert wrapper_help.stdout == bin_help.stdout
