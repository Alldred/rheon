#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "rheon_regr_app.py"
SCRIPT_ROOT = REPO_ROOT / "scripts"
if str(SCRIPT_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPT_ROOT))

SPEC = importlib.util.spec_from_file_location("rheon_regr_app", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
APP = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = APP
SPEC.loader.exec_module(APP)


def test_build_config_from_payload_defaults_and_paths() -> None:
    payload = {
        "tests": [{"name": "simple", "count": 2}],
        "seed": "3",
        "stages": "gen,sim",
        "output_dir": "./tmp-output",
        "waves": True,
        "timeout_sec": "42",
        "fail_fast": False,
    }
    config, payload_out = APP.build_config_from_payload(payload)
    assert config.seed == 3
    assert config.stages == ("gen", "sim")
    assert config.waves is True
    assert config.max_failures is None
    assert config.update == 2
    assert config.jobs == APP.default_parallel_jobs()
    assert config.output_dir == Path("./tmp-output").expanduser().resolve()
    assert payload_out["regression"]["output_dir"] == str(config.output_dir)


def test_build_config_from_payload_validates_jobs_and_update() -> None:
    with pytest.raises((APP.ConfigError, ValueError)):
        APP.build_config_from_payload(
            {
                "tests": [{"name": "simple", "count": 1}],
                "seed": 1,
                "jobs": 0,
            }
        )

    with pytest.raises((APP.ConfigError, ValueError)):
        APP.build_config_from_payload(
            {
                "tests": [{"name": "simple", "count": 1}],
                "seed": 1,
                "update": 0,
            }
        )


def test_build_config_from_payload_rejects_mismatched_output_dir_and_resume(
    tmp_path: Path,
) -> None:
    output = tmp_path / "out"
    resume = tmp_path / "other"
    output.mkdir()
    resume.mkdir()
    with pytest.raises(ValueError, match="must match --resume target"):
        APP.build_config_from_payload(
            {
                "tests": [{"name": "simple", "count": 1}],
                "seed": 1,
                "output_dir": str(output),
                "resume": str(resume),
            }
        )


def test_build_config_from_yaml_round_trip() -> None:
    yaml_text = """\
version: 1
regression:
  seed: 11
  jobs: 2
  update: 3
  stages: [run]
  tests:
    - name: simple
      count: 4
"""
    config = APP.build_config_from_yaml(yaml_text)
    assert config.seed == 11
    assert config.jobs == 2
    assert config.update == 3
    assert config.stages == ("run",)
    assert [(test.name, test.count) for test in config.tests] == [("simple", 4)]

    payload = APP.regression_yaml_text(config)
    assert "version: 1" in payload
