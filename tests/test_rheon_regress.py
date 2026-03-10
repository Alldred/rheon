#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

import importlib.util
import json
import os
import sys
import threading
import time
from concurrent.futures import Future
from io import StringIO
from pathlib import Path

import pytest
from rich.console import Console

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "rheon_cli_common.py"
SPEC = importlib.util.spec_from_file_location("rheon_cli_common", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
COMMON = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COMMON
SPEC.loader.exec_module(COMMON)


@pytest.fixture(autouse=True)
def _disable_latest_shortcut_update(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(COMMON, "_update_latest_shortcut", lambda _target: None)


def _make_runner(
    failing_indices: set[int] | None = None,
    timeout_indices: set[int] | None = None,
    *,
    write_mismatch: bool = False,
    sleep_sec: float = 0.0,
):
    failing = failing_indices or set()
    timeouts = timeout_indices or set()

    def _runner(*, job, config, output_dir, stop_event):
        run_dir = COMMON.make_run_dir(output_dir, job)
        run_dir.mkdir(parents=True, exist_ok=True)
        log_path = run_dir / "sim.log"
        if sleep_sec > 0:
            time.sleep(sleep_sec)

        if job.index in timeouts:
            rc = COMMON.EXIT_TIMEOUT
            reason = "timeout"
            timed_out = True
            if write_mismatch:
                log_path.write_text(_mismatch_log_text(ansi=True), encoding="utf-8")
            else:
                log_path.write_text("TIMEOUT\n", encoding="utf-8")
        elif job.index in failing:
            rc = 1
            reason = "failed"
            timed_out = False
            if write_mismatch:
                log_path.write_text(_mismatch_log_text(ansi=True), encoding="utf-8")
            else:
                log_path.write_text(
                    f"job={job.index} test={job.test_name} seed={job.seed}\n",
                    encoding="utf-8",
                )
        else:
            rc = 0
            reason = "passed"
            timed_out = False
            log_path.write_text(
                f"job={job.index} test={job.test_name} seed={job.seed}\n",
                encoding="utf-8",
            )

        return COMMON.JobResult(
            job=job,
            run_dir=run_dir,
            log_path=log_path,
            returncode=rc,
            rerun_command="rheon_run --test simple --seed 1",
            status_reason=reason,
            timed_out=timed_out,
            duration_seconds=sleep_sec,
        )

    return _runner


def _mismatch_log_text(*, ansi: bool) -> str:
    prefix = "\x1b[31m" if ansi else ""
    suffix = "\x1b[0m" if ansi else ""
    return (
        f"{prefix}Mismatch on channel pipe_mon{suffix}\n"
        "+-------------+------------+--------------------+-------------+----------+\n"
        "| Field | Captured | Expected | Compared | Match |\n"
        "+=============+============+====================+=============+==========+\n"
        "| timestamp | 332.0 ns | 332.0 ns | no | |\n"
        "+-------------+------------+--------------------+-------------+----------+\n"
        "| ===== | ======== | ======== | ======== | ===== |\n"
        "| pc | 0x80000102 | 0x80000100 | yes | !!! |\n"
        "+-------------+------------+--------------------+-------------+----------+\n"
        "| instr | 0X02C0006F | 0x00000013 | yes | !!! |\n"
        "+-------------+------------+--------------------+-------------+----------+\n"
        "| instr_asm | jal x0, 88 | jal x0, 88 | no | |\n"
        "+-------------+------------+--------------------+-------------+----------+\n"
        "| next_pc | 0x80000106 | 0x80000104 | != | !!! |\n"
        "+-------------+------------+--------------------+-------------+----------+\n"
        "\n"
    )


def _make_console() -> Console:
    return Console(file=StringIO(), force_terminal=False, color_system=None)


def _config(tmp_path: Path, **overrides: object) -> COMMON.RegressionConfig:
    base: dict[str, object] = {
        "tests": [COMMON.TestSpec("simple", 1)],
        "seed": 7,
        "jobs": 1,
        "update": 1,
        "stages": ("run",),
        "output_dir": tmp_path,
        "verbosity": None,
        "waves": False,
        "resume": None,
        "timeout_sec": None,
        "fail_fast": False,
        "max_failures": None,
        "report_json": None,
    }
    base.update(overrides)
    return COMMON.RegressionConfig(**base)


def test_run_regression_tracks_status_and_failures(tmp_path: Path) -> None:
    config = _config(
        tmp_path,
        tests=[COMMON.TestSpec("simple", 4)],
        jobs=2,
    )
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner({2, 4}),
    )

    assert outcome.total == 4
    assert outcome.passed == 2
    assert outcome.failed == 2
    assert not outcome.interrupted
    assert len(outcome.failed_results) == 2
    assert all(result.rerun_command for result in outcome.failed_results)

    job_dirs = sorted(path for path in tmp_path.iterdir() if path.is_dir())
    assert len(job_dirs) == 4
    for run_dir in job_dirs:
        assert (run_dir / "sim.log").exists()


def test_run_regression_continues_after_failures(tmp_path: Path) -> None:
    config = _config(
        tmp_path,
        tests=[COMMON.TestSpec("simple", 3)],
    )
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner({1}),
    )

    assert outcome.total == 3
    assert outcome.failed == 1
    assert outcome.passed == 2
    generated = [item.name for item in sorted(tmp_path.iterdir())]
    assert any(name.startswith("0002_") for name in generated)
    assert any(name.startswith("0003_") for name in generated)


def test_fail_fast_stops_scheduling_new_jobs(tmp_path: Path) -> None:
    config = _config(
        tmp_path,
        tests=[COMMON.TestSpec("simple", 4)],
        fail_fast=True,
    )
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner({1}),
    )
    assert outcome.failed == 1
    assert outcome.passed == 0
    assert outcome.not_run == 3
    assert outcome.fail_fast_triggered is True
    assert len(outcome.executed_results) == 1


def test_max_failures_stops_scheduling_new_jobs(tmp_path: Path) -> None:
    config = _config(
        tmp_path,
        tests=[COMMON.TestSpec("simple", 5)],
        max_failures=2,
    )
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner({1, 2, 4}),
    )
    assert outcome.failed == 2
    assert outcome.not_run == 3
    assert outcome.max_failures_triggered is True
    assert len(outcome.executed_results) == 2


def test_timeout_marks_failed_and_reason(tmp_path: Path) -> None:
    config = _config(tmp_path, tests=[COMMON.TestSpec("simple", 2)])
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner(timeout_indices={1}),
    )
    assert outcome.failed == 1
    assert outcome.timed_out == 1
    assert outcome.failed_results[0].status_reason == "timeout"


def test_resume_skips_only_matching_pass_jobs(tmp_path: Path) -> None:
    output_dir = tmp_path / "resume_run"
    output_dir.mkdir(parents=True)
    config = _config(
        output_dir,
        tests=[COMMON.TestSpec("simple", 3)],
        output_dir=output_dir,
        resume=output_dir,
    )
    jobs = COMMON.expand_regression_jobs(config.tests, config.seed)
    job1, job2, job3 = jobs

    matching_fp = COMMON._job_fingerprint(job1, config)  # noqa: SLF001
    state_data = {
        "version": 1,
        "jobs": {
            COMMON._job_key(job1): {  # noqa: SLF001
                "status": "passed",
                "fingerprint": matching_fp,
            },
            COMMON._job_key(job2): {  # noqa: SLF001
                "status": "failed",
                "fingerprint": COMMON._job_fingerprint(job2, config),  # noqa: SLF001
            },
            COMMON._job_key(job3): {  # noqa: SLF001
                "status": "passed",
                "fingerprint": {
                    **COMMON._job_fingerprint(job3, config),  # noqa: SLF001
                    "timeout_sec": 999,
                },
            },
        },
    }
    (output_dir / COMMON.STATE_FILE_NAME).write_text(
        json.dumps(state_data, indent=2), encoding="utf-8"
    )

    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner(),
    )
    assert outcome.total == 3
    assert outcome.skipped_resume == 1
    assert outcome.scheduled == 2
    assert outcome.failed == 0
    assert outcome.passed == 3
    assert {item.job.index for item in outcome.executed_results} == {2, 3}


def test_extract_triage_from_ansi_log(tmp_path: Path) -> None:
    log_path = tmp_path / "sim.log"
    log_path.write_text(_mismatch_log_text(ansi=True), encoding="utf-8")
    summary, pc, instr_hex, instr_asm, mismatched = COMMON._extract_triage_from_log(
        log_path
    )  # noqa: SLF001
    assert summary is not None
    assert "pc=0x80000102" in summary
    assert "instr=0x02c0006f" in summary
    assert "mismatches=" in summary
    assert pc == 0x80000102
    assert instr_hex == "0x02c0006f"
    assert instr_asm == "jal x0, 88"
    assert "asm='jal x0, 88'" in summary
    assert "next_pc" in mismatched


def test_regression_file_payload_round_trip() -> None:
    config = COMMON.RegressionConfig(
        tests=[COMMON.TestSpec("simple", 2), COMMON.TestSpec("alt", 1)],
        seed=7,
        jobs=4,
        update=5,
        stages=("run",),
        output_dir=Path("/tmp/test_output"),
        verbosity="debug",
        waves=True,
        resume=None,
        timeout_sec=90,
        fail_fast=True,
        max_failures=2,
        report_json=Path("/tmp/report.json"),
    )
    payload = COMMON.regression_file_payload(
        config, tests=[COMMON.TestSpec("simple", 1)]
    )
    assert payload["version"] == 1
    assert payload["regression"]["seed"] == 7
    assert payload["regression"]["jobs"] == 4
    assert payload["regression"]["tests"] == [{"name": "simple", "count": 1}]
    assert payload["regression"]["output_dir"] == "/tmp/test_output"

    yaml_text = COMMON.regression_yaml_text(
        config, tests=[COMMON.TestSpec("simple", 1)]
    )
    loaded = COMMON._load_yaml_text(yaml_text)
    assert loaded.regression.seed == 7
    assert loaded.regression.jobs == 4
    assert loaded.version == 1
    assert [item.name for item in loaded.regression.tests] == ["simple"]


def test_run_regression_writes_state_metadata(tmp_path: Path) -> None:
    callbacks: list[dict[str, object]] = []

    def _callback(payload: dict[str, object]) -> None:
        callbacks.append(payload)

    config = _config(tmp_path, tests=[COMMON.TestSpec("simple", 2)], jobs=1, update=1)
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner(),
        status_callback=_callback,
    )

    assert outcome.total == 2
    assert outcome.passed == 2
    assert callbacks
    assert callbacks[-1]["status"] == "complete"
    assert callbacks[-1]["status_reason"] == "complete"

    state = COMMON._load_state(tmp_path / COMMON.STATE_FILE_NAME)
    meta = state.get("meta", {})
    assert meta.get("status") == "complete"
    assert meta.get("status_reason") == "complete"
    assert meta.get("total") == 2
    assert meta.get("passed") == 2
    assert meta.get("failed") == 0
    assert isinstance(meta.get("elapsed_seconds"), float)
    assert isinstance(state.get("revision"), int)
    assert state["revision"] >= 1
    assert meta.get("revision") == state.get("revision")
    assert all("updated_at" in job for job in state.get("jobs", {}).values())


def test_run_regression_status_payload_includes_running_job_started_at(
    tmp_path: Path,
) -> None:
    callbacks: list[dict[str, object]] = []

    def _callback(payload: dict[str, object]) -> None:
        callbacks.append(payload)

    config = _config(tmp_path, tests=[COMMON.TestSpec("simple", 1)], jobs=1, update=1)
    COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner(sleep_sec=1.1),
        status_callback=_callback,
    )

    running_payloads = [payload for payload in callbacks if payload.get("running_jobs")]
    assert running_payloads
    running_job = running_payloads[0]["running_jobs"][0]
    assert running_job["started_at"]


def test_report_json_includes_instruction_aware_triage(tmp_path: Path) -> None:
    report_path = tmp_path / "report.json"
    config = _config(
        tmp_path,
        tests=[COMMON.TestSpec("simple", 1)],
        report_json=report_path,
    )
    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner({1}, write_mismatch=True),
    )
    assert outcome.failed == 1
    assert report_path.exists()

    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["summary"]["failed"] == 1
    assert report["summary"]["stop_reason"] == "complete"
    assert len(report["jobs"]) == 1
    triage = report["jobs"][0]["triage"]
    assert triage["pc"] == 0x80000102
    assert triage["instr_hex"] == "0x02c0006f"
    assert triage["instr_asm"]
    assert "next_pc" in triage["mismatched_fields"]


def test_expand_regression_jobs_uses_deterministic_seed_order() -> None:
    tests = [COMMON.TestSpec("a", 2), COMMON.TestSpec("b", 1)]
    first = COMMON.expand_regression_jobs(tests, regression_seed=99)
    second = COMMON.expand_regression_jobs(tests, regression_seed=99)
    assert [(job.index, job.test_name, job.seed) for job in first] == [
        (job.index, job.test_name, job.seed) for job in second
    ]


def test_build_job_rerun_command_excludes_run_dir() -> None:
    config = COMMON.RegressionConfig(
        tests=[COMMON.TestSpec("simple", 1)],
        seed=1,
        jobs=1,
        update=1,
        stages=("run",),
        output_dir=None,
        verbosity="info",
        waves=True,
        resume=None,
        timeout_sec=None,
        fail_fast=False,
        max_failures=None,
        report_json=None,
    )
    job = COMMON.RegressionJob(index=1, test_name="simple", seed=42)
    rerun = COMMON.build_job_rerun_command(job, config)
    assert rerun.startswith("rheon_run ")
    assert "--run-dir" not in rerun
    assert "--test simple" in rerun
    assert "--seed 42" in rerun


def test_run_job_default_uses_current_python_for_python_entrypoints(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    command_root = tmp_path / "bin"
    command_root.mkdir()
    entrypoint = command_root / "rheon_run"
    entrypoint.write_text(
        "#!/usr/bin/env python3\nprint('stub')\n",
        encoding="utf-8",
    )

    captured: dict[str, object] = {}

    def _fake_spawn(command, **kwargs):
        captured["command"] = list(command)
        return 0, False, 0.01

    monkeypatch.setattr(COMMON, "commands_dir", lambda: command_root)
    monkeypatch.setattr(COMMON, "_spawn_and_wait", _fake_spawn)

    output_dir = tmp_path / "out"
    config = _config(output_dir, stages=("run",))
    result = COMMON._run_job_default(  # noqa: SLF001
        job=COMMON.RegressionJob(index=1, test_name="simple", seed=42),
        config=config,
        output_dir=output_dir,
        stop_event=threading.Event(),
    )

    assert result.returncode == 0
    assert captured["command"] == [
        sys.executable,
        str(entrypoint),
        "--test",
        "simple",
        "--seed",
        "42",
        "--run-dir",
        str(result.run_dir),
    ]


def test_run_checked_prepends_runtime_bins_to_path(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_python = tmp_path / "venv" / "bin" / "python"
    fake_python.parent.mkdir(parents=True)
    fake_python.write_text("", encoding="utf-8")

    command_root = tmp_path / "commands"
    command_root.mkdir()

    captured: dict[str, object] = {}

    def _fake_run(command, *, cwd, env, check):
        captured["command"] = list(command)
        captured["cwd"] = cwd
        captured["env"] = dict(env)
        captured["check"] = check
        return None

    monkeypatch.setattr(COMMON.sys, "executable", str(fake_python))
    monkeypatch.setattr(COMMON, "commands_dir", lambda: command_root)
    monkeypatch.setattr(COMMON.subprocess, "run", _fake_run)

    COMMON.run_checked(["echo", "hello"], cwd=tmp_path, env={"PATH": "/usr/bin"})

    path_entries = captured["env"]["PATH"].split(os.pathsep)
    assert path_entries[0] == str(fake_python.parent)
    assert str(command_root) in path_entries
    assert "/usr/bin" in path_entries


def test_run_simulation_raises_clear_error_when_cocotb_config_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    elf_path = tmp_path / "test.elf"
    elf_path.write_text("stub", encoding="utf-8")

    monkeypatch.setattr(COMMON.shutil, "which", lambda _name, path=None: None)

    with pytest.raises(COMMON.ConfigError, match="cocotb-config"):
        COMMON.run_simulation(
            elf_path=elf_path,
            seed="42",
            verbosity=None,
            waves=False,
        )


def test_running_job_entries_sorted_by_longest_elapsed() -> None:
    f1: Future = Future()
    f2: Future = Future()
    f3: Future = Future()
    jobs = {
        f1: COMMON.RegressionJob(index=1, test_name="a", seed=1),
        f2: COMMON.RegressionJob(index=2, test_name="b", seed=2),
        f3: COMMON.RegressionJob(index=3, test_name="c", seed=3),
    }
    started_at = {
        f1: 90.0,  # elapsed 10
        f2: 80.0,  # elapsed 20
        f3: 95.0,  # elapsed 5
    }
    entries = COMMON._running_job_entries(jobs, started_at, now=100.0)  # noqa: SLF001
    assert [job.index for job, _elapsed in entries] == [2, 1, 3]
