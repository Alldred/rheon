#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

import argparse
import importlib.util
import subprocess
import sys
from importlib.machinery import SourceFileLoader
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

BIN_LOADER = SourceFileLoader("rheon_regr_cli", str(BIN_REGR))
BIN_SPEC = importlib.util.spec_from_loader(BIN_LOADER.name, BIN_LOADER)
assert BIN_SPEC is not None and BIN_SPEC.loader is not None
REGR_CLI = importlib.util.module_from_spec(BIN_SPEC)
sys.modules[BIN_SPEC.name] = REGR_CLI
BIN_SPEC.loader.exec_module(REGR_CLI)


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


def test_resume_latest_directory_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    latest = tmp_path / "latest"
    latest.mkdir()
    monkeypatch.setattr(COMMON, "latest_shortcut_path", lambda: latest)
    with pytest.raises(COMMON.ConfigError, match="must be a symlink or a file"):
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
    assert "--app-url" in help_text
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


def test_asm_mnemonic_uses_opcode_only() -> None:
    assert REGR_CLI._asm_mnemonic("slli x0, x1, 0x3") == "slli"  # noqa: SLF001
    assert REGR_CLI._asm_mnemonic("  JAL x0, 88 ") == "jal"  # noqa: SLF001
    assert REGR_CLI._asm_mnemonic(None) == "unknown"  # noqa: SLF001


def test_app_status_url_encodes_output_dir() -> None:
    output = Path("/tmp/run with spaces")
    assert (
        REGR_CLI._app_status_url("http://127.0.0.1:8765", output)
        == "http://127.0.0.1:8765/?attach=%2Ftmp%2Frun%20with%20spaces"
    )


def test_build_app_hint_returns_status_and_launch() -> None:
    output = Path("/tmp/run with spaces")
    status_url, launch_cmd = REGR_CLI._build_app_hint("http://0.0.0.0:9000", output)
    assert status_url == "http://0.0.0.0:9000/?attach=%2Ftmp%2Frun%20with%20spaces"
    assert "rheon_regr_app --host 0.0.0.0 --port 9000" in launch_cmd


def test_build_failure_triage_rows_counts_and_fastest() -> None:
    def _result(
        *,
        index: int,
        asm: str,
        mismatches: list[str],
        duration: float,
        rerun: str,
    ) -> COMMON.JobResult:
        job = COMMON.RegressionJob(index=index, test_name="simple", seed=100 + index)
        return COMMON.JobResult(
            job=job,
            run_dir=Path(f"/tmp/run{index}"),
            log_path=Path(f"/tmp/run{index}/sim.log"),
            returncode=1,
            rerun_command=rerun,
            status_reason="mismatch",
            timed_out=False,
            duration_seconds=duration,
            triage_instr_asm=asm,
            triage_mismatched_fields=mismatches,
        )

    rows = REGR_CLI.build_failure_triage_rows(  # noqa: SLF001
        [
            _result(
                index=1,
                asm="slli x0, x1, 0x3",
                mismatches=["rd_val"],
                duration=8.0,
                rerun="rheon_run --test simple --seed 101",
            ),
            _result(
                index=2,
                asm="slli x2, x3, 0x1",
                mismatches=["rd_val"],
                duration=3.0,
                rerun="rheon_run --test simple --seed 102",
            ),
            _result(
                index=3,
                asm="addi x1, x0, 1",
                mismatches=["next_pc", "rd_val"],
                duration=5.0,
                rerun="rheon_run --test simple --seed 103",
            ),
        ]
    )

    assert rows[0].mnemonic == "slli"
    assert rows[0].mismatch == "rd_val"
    assert rows[0].count == 2
    assert rows[0].fastest_result.rerun_command == "rheon_run --test simple --seed 102"

    addi_next_pc = next(
        row for row in rows if row.mnemonic == "addi" and row.mismatch == "next_pc"
    )
    assert addi_next_pc.count == 1
