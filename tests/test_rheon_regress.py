#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

# SPDX-License-Identifier: MIT

from __future__ import annotations

import importlib.util
import sys
from concurrent.futures import Future
from io import StringIO
from pathlib import Path

from rich.console import Console

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "rheon_cli_common.py"
SPEC = importlib.util.spec_from_file_location("rheon_cli_common", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
COMMON = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = COMMON
SPEC.loader.exec_module(COMMON)


def _make_runner(failing_indices: set[int]):
    def _runner(*, job, config, output_dir, stop_event):
        run_dir = COMMON.make_run_dir(output_dir, job)
        run_dir.mkdir(parents=True, exist_ok=True)
        log_path = run_dir / "sim.log"
        log_path.write_text(
            f"job={job.index} test={job.test_name} seed={job.seed}\n", encoding="utf-8"
        )
        rc = 1 if job.index in failing_indices else 0
        return COMMON.JobResult(
            job=job,
            run_dir=run_dir,
            log_path=log_path,
            returncode=rc,
            rerun_command="fake",
        )

    return _runner


def _make_console() -> Console:
    return Console(file=StringIO(), force_terminal=False, color_system=None)


def test_run_regression_tracks_status_and_failures(tmp_path: Path) -> None:
    config = COMMON.RegressionConfig(
        tests=[COMMON.TestSpec("simple", 4)],
        seed=7,
        jobs=2,
        update=1,
        stages=("run",),
        output_dir=tmp_path,
        verbosity=None,
        waves=False,
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
    config = COMMON.RegressionConfig(
        tests=[COMMON.TestSpec("simple", 3)],
        seed=13,
        jobs=1,
        update=1,
        stages=("run",),
        output_dir=tmp_path,
        verbosity=None,
        waves=False,
    )

    outcome = COMMON.run_regression(
        config,
        console=_make_console(),
        runner=_make_runner({1}),
    )

    assert outcome.total == 3
    assert outcome.failed == 1
    assert outcome.passed == 2

    # Ensure later jobs still ran after initial failure.
    generated = [item.name for item in sorted(tmp_path.iterdir())]
    assert any(name.startswith("0002_") for name in generated)
    assert any(name.startswith("0003_") for name in generated)


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
    )
    job = COMMON.RegressionJob(index=1, test_name="simple", seed=42)
    rerun = COMMON.build_job_rerun_command(job, config)
    assert rerun.startswith("rheon_run ")
    assert "--run-dir" not in rerun
    assert "--test simple" in rerun
    assert "--seed 42" in rerun


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
