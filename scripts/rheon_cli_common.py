#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
"""Shared Python helpers for rheon command-line scripts."""

from __future__ import annotations

import argparse
import os
import random
import shlex
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, Literal, Sequence

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

if TYPE_CHECKING:
    from rich.console import Console

VALID_VERBOSITY = {"debug", "info", "warning", "error", "critical"}
RUN_STAGES = ("run",)
GEN_SIM_STAGES = ("gen", "sim")


class ConfigError(ValueError):
    """Raised when CLI or YAML regression config is invalid."""


class RegressionFileTestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: str
    count: int

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        name = value.strip()
        if not name:
            raise ValueError("must not be empty")
        return name

    @field_validator("count")
    @classmethod
    def validate_count(cls, value: int) -> int:
        if value < 1:
            raise ValueError("must be >= 1")
        return value


class RegressionFileConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    seed: int | None = None
    jobs: int | None = None
    update: int | None = None
    stages: list[str] | str | None = None
    output_dir: str | None = None
    verbosity: str | None = None
    waves: bool | None = None
    tests: list[RegressionFileTestModel] = Field(default_factory=list)

    @field_validator("jobs")
    @classmethod
    def validate_jobs(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("must be >= 1")
        return value

    @field_validator("update")
    @classmethod
    def validate_update(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("must be >= 1")
        return value

    @field_validator("stages")
    @classmethod
    def validate_stages(cls, value: list[str] | str | None) -> list[str] | str | None:
        if value is not None:
            parse_stages(value)
        return value

    @field_validator("verbosity")
    @classmethod
    def validate_file_verbosity(cls, value: str | None) -> str | None:
        return validate_verbosity(value)


class RegressionFileModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    version: Literal[1] = 1
    regression: RegressionFileConfigModel = Field(
        default_factory=RegressionFileConfigModel
    )


@dataclass(frozen=True)
class TestSpec:
    name: str
    count: int


@dataclass(frozen=True)
class RegressionJob:
    index: int
    test_name: str
    seed: int


@dataclass(frozen=True)
class RegressionConfig:
    tests: list[TestSpec]
    seed: int
    jobs: int
    update: int
    stages: tuple[str, ...]
    output_dir: Path | None
    verbosity: str | None
    waves: bool


@dataclass(frozen=True)
class JobResult:
    job: RegressionJob
    run_dir: Path
    log_path: Path
    returncode: int
    rerun_command: str


@dataclass(frozen=True)
class RegressionOutcome:
    total: int
    passed: int
    failed: int
    interrupted: bool
    duration_seconds: float
    output_dir: Path
    failed_results: list[JobResult]


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def scripts_dir() -> Path:
    return Path(__file__).resolve().parent


def commands_dir() -> Path:
    bin_dir = repo_root() / "bin"
    if (bin_dir / "rheon_run").exists():
        return bin_dir
    return scripts_dir()


def default_parallel_jobs(
    cpu_count_func: Callable[[], int | None] = os.cpu_count,
) -> int:
    cpu_count = cpu_count_func() or 1
    return max(cpu_count - 1, 1)


def format_elapsed(seconds: float) -> str:
    whole = max(int(seconds), 0)
    hours, rem = divmod(whole, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def validate_verbosity(value: str | None) -> str | None:
    if value is None:
        return None
    level = value.strip().lower()
    if level not in VALID_VERBOSITY:
        valid = ", ".join(sorted(VALID_VERBOSITY))
        raise ConfigError(f"Invalid verbosity '{value}'. Use one of: {valid}")
    return level


def parse_test_spec(spec: str) -> TestSpec:
    if "," not in spec:
        raise ConfigError(f"Invalid --test '{spec}'. Expected NAME,COUNT")
    raw_name, raw_count = spec.split(",", 1)
    name = raw_name.strip()
    count_text = raw_count.strip()
    if not name:
        raise ConfigError(f"Invalid --test '{spec}'. Test name cannot be empty")
    try:
        count = int(count_text)
    except ValueError as exc:
        raise ConfigError(f"Invalid --test '{spec}'. COUNT must be an integer") from exc
    if count < 1:
        raise ConfigError(f"Invalid --test '{spec}'. COUNT must be >= 1")
    return TestSpec(name=name, count=count)


def parse_stages(value: str | Iterable[str]) -> tuple[str, ...]:
    if isinstance(value, str):
        tokens = [token.strip().lower() for token in value.split(",") if token.strip()]
    else:
        tokens = [str(token).strip().lower() for token in value if str(token).strip()]

    if tuple(tokens) == RUN_STAGES:
        return RUN_STAGES
    if tuple(tokens) == GEN_SIM_STAGES:
        return GEN_SIM_STAGES
    raise ConfigError("Stages must be exactly 'run' or 'gen,sim'")


def _format_validation_error(exc: ValidationError) -> str:
    errors: list[str] = []
    for err in exc.errors():
        loc = ".".join(str(part) for part in err.get("loc", []))
        msg = err.get("msg", "invalid value")
        errors.append(f"{loc}: {msg}" if loc else msg)
    return "; ".join(errors)


def _load_yaml(path: Path) -> RegressionFileModel:
    try:
        loaded = yaml.safe_load(path.read_text())
    except OSError as exc:
        raise ConfigError(f"Unable to read YAML file: {path}") from exc
    except yaml.YAMLError as exc:
        raise ConfigError(f"Unable to parse YAML file: {path}") from exc

    if loaded is None:
        return RegressionFileModel()
    if not isinstance(loaded, dict):
        raise ConfigError("Regression YAML top-level value must be a mapping")
    try:
        return RegressionFileModel.model_validate(loaded)
    except ValidationError as exc:
        raise ConfigError(
            f"Regression YAML schema validation failed: {_format_validation_error(exc)}"
        ) from exc


def _coerce_int(value: Any, *, field: str, min_value: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{field} must be an integer") from exc
    if min_value is not None and parsed < min_value:
        raise ConfigError(f"{field} must be >= {min_value}")
    return parsed


def build_regression_config(args: argparse.Namespace) -> RegressionConfig:
    file_model = RegressionFileModel()
    regression_model = file_model.regression

    if args.file is not None:
        file_model = _load_yaml(Path(args.file))
        regression_model = file_model.regression

    tests_from_file = [
        TestSpec(name=item.name, count=item.count) for item in regression_model.tests
    ]
    tests_from_cli = [parse_test_spec(item) for item in (args.test or [])]
    tests = [*tests_from_file, *tests_from_cli]
    if not tests:
        raise ConfigError(
            "No tests specified. Use --test NAME,COUNT and/or --file with regression.tests"
        )

    seed = _coerce_int(
        1 if regression_model.seed is None else regression_model.seed, field="seed"
    )
    if args.seed is not None:
        seed = _coerce_int(args.seed, field="--seed")

    jobs = _coerce_int(
        default_parallel_jobs()
        if regression_model.jobs is None
        else regression_model.jobs,
        field="jobs",
        min_value=1,
    )
    if args.jobs is not None:
        jobs = _coerce_int(args.jobs, field="--jobs", min_value=1)

    update = _coerce_int(
        2 if regression_model.update is None else regression_model.update,
        field="update",
        min_value=1,
    )
    if args.update is not None:
        update = _coerce_int(args.update, field="--update", min_value=1)

    stages_raw: Any = (
        regression_model.stages
        if regression_model.stages is not None
        else list(RUN_STAGES)
    )
    stages = parse_stages(stages_raw)
    if args.stages is not None:
        stages = parse_stages(args.stages)

    output_dir = (
        Path(regression_model.output_dir) if regression_model.output_dir else None
    )
    if args.output_dir is not None:
        output_dir = Path(args.output_dir)

    verbosity = validate_verbosity(regression_model.verbosity)
    if args.verbosity is not None:
        verbosity = validate_verbosity(args.verbosity)

    waves = (
        bool(regression_model.waves) if regression_model.waves is not None else False
    )
    if args.waves is not None:
        waves = bool(args.waves)

    return RegressionConfig(
        tests=tests,
        seed=seed,
        jobs=jobs,
        update=update,
        stages=stages,
        output_dir=output_dir,
        verbosity=verbosity,
        waves=waves,
    )


def deterministic_job_seeds(seed: int, count: int) -> list[int]:
    rng = random.Random(seed)
    return [rng.randint(1, 2_147_483_647) for _ in range(count)]


def expand_regression_jobs(
    tests: list[TestSpec], regression_seed: int
) -> list[RegressionJob]:
    total = sum(item.count for item in tests)
    seeds = deterministic_job_seeds(regression_seed, total)

    jobs: list[RegressionJob] = []
    index = 1
    seed_index = 0
    for test in tests:
        for _ in range(test.count):
            jobs.append(
                RegressionJob(index=index, test_name=test.name, seed=seeds[seed_index])
            )
            index += 1
            seed_index += 1
    return jobs


def make_default_regression_output(root: Path | None = None) -> Path:
    base = root if root is not None else repo_root()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return base / "runs" / "regressions" / timestamp


def make_run_dir(base_output_dir: Path, job: RegressionJob) -> Path:
    safe_test_name = "".join(
        ch if ch.isalnum() or ch in {"-", "_", "."} else "_" for ch in job.test_name
    )
    safe_test_name = safe_test_name.strip("_") or "test"
    return base_output_dir / f"{job.index:04d}_{safe_test_name}_seed{job.seed}"


def build_job_rerun_command(job: RegressionJob, config: RegressionConfig) -> str:
    rerun_parts = [
        "rheon_run",
        "--test",
        job.test_name,
        "--seed",
        str(job.seed),
    ]
    if config.verbosity:
        rerun_parts.extend(["--verbosity", config.verbosity])
    if config.waves:
        rerun_parts.append("--waves")
    return " ".join(shlex.quote(part) for part in rerun_parts)


def _spawn_and_wait(
    command: Sequence[str],
    *,
    cwd: Path,
    log_handle: Any,
    stop_event: threading.Event,
    env: dict[str, str] | None = None,
) -> int:
    process = subprocess.Popen(
        list(command),
        cwd=cwd,
        env=env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )

    while True:
        rc = process.poll()
        if rc is not None:
            return rc
        if stop_event.is_set():
            process.terminate()
            try:
                return process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                return process.wait(timeout=5)
        time.sleep(0.1)


def _run_job_default(
    *,
    job: RegressionJob,
    config: RegressionConfig,
    output_dir: Path,
    stop_event: threading.Event,
) -> JobResult:
    run_dir = make_run_dir(output_dir, job)
    run_dir.mkdir(parents=True, exist_ok=True)
    log_path = run_dir / "sim.log"

    command_root = commands_dir()
    rerun_text = build_job_rerun_command(job, config)

    with log_path.open("w", encoding="utf-8") as log_handle:
        log_handle.write(
            f"job_index={job.index} test={job.test_name} seed={job.seed}\n"
        )

        if config.stages == RUN_STAGES:
            cmd = [
                str(command_root / "rheon_run"),
                "--test",
                job.test_name,
                "--seed",
                str(job.seed),
                "--run-dir",
                str(run_dir),
            ]
            if config.verbosity:
                cmd.extend(["--verbosity", config.verbosity])
            if config.waves:
                cmd.append("--waves")
            rc = _spawn_and_wait(
                cmd, cwd=repo_root(), log_handle=log_handle, stop_event=stop_event
            )
            return JobResult(
                job=job,
                run_dir=run_dir,
                log_path=log_path,
                returncode=rc,
                rerun_command=rerun_text,
            )

        gen_cmd = [
            str(command_root / "rheon_gen"),
            "--test",
            job.test_name,
            "--seed",
            str(job.seed),
            "--run-dir",
            str(run_dir),
        ]
        rc = _spawn_and_wait(
            gen_cmd, cwd=repo_root(), log_handle=log_handle, stop_event=stop_event
        )
        sim_elf = run_dir / "test.elf"
        sim_cmd = [
            str(command_root / "rheon_sim"),
            "--test",
            str(sim_elf),
            "--seed",
            str(job.seed),
        ]
        if config.verbosity:
            sim_cmd.extend(["--verbosity", config.verbosity])
        if config.waves:
            sim_cmd.append("--waves")
        if rc != 0:
            return JobResult(
                job=job,
                run_dir=run_dir,
                log_path=log_path,
                returncode=rc,
                rerun_command=rerun_text,
            )

        elf = sim_elf
        if not elf.exists():
            log_handle.write(f"ERROR: Expected ELF missing: {elf}\n")
            return JobResult(
                job=job,
                run_dir=run_dir,
                log_path=log_path,
                returncode=1,
                rerun_command=rerun_text,
            )

        rc = _spawn_and_wait(
            sim_cmd, cwd=repo_root(), log_handle=log_handle, stop_event=stop_event
        )
        return JobResult(
            job=job,
            run_dir=run_dir,
            log_path=log_path,
            returncode=rc,
            rerun_command=rerun_text,
        )


def _status_dashboard(
    *,
    total: int,
    pending: int,
    running: int,
    passed: int,
    failed: int,
    elapsed: str,
    update_seconds: int,
    running_jobs: list[tuple[RegressionJob, float]],
    recent_failures: list[JobResult],
) -> Any:
    from rich import box
    from rich.align import Align
    from rich.columns import Columns
    from rich.console import Group
    from rich.panel import Panel
    from rich.progress_bar import ProgressBar
    from rich.table import Table
    from rich.text import Text

    done = passed + failed
    completion = (done / total) if total else 1.0

    def metric_card(
        label: str, value: str, border_style: str, value_style: str
    ) -> Panel:
        body = Text(justify="center")
        body.append(f"{value}\n", style=value_style)
        body.append(label, style=f"bold {border_style}")
        return Panel(
            Align.center(body),
            box=box.ROUNDED,
            border_style=border_style,
            padding=(0, 1),
        )

    cards = Columns(
        [
            metric_card("PENDING", str(pending), "cyan", "bold cyan"),
            metric_card("RUNNING", str(running), "blue", "bold blue"),
            metric_card("PASSED", str(passed), "green", "bold green"),
            metric_card("FAILED", str(failed), "red", "bold red"),
            metric_card("ELAPSED", elapsed, "magenta", "bold magenta"),
        ],
        equal=True,
        expand=True,
    )

    progress = ProgressBar(
        total=max(total, 1),
        completed=min(done, total),
        pulse=False,
        style="grey35",
        complete_style="green",
        finished_style="green",
    )
    progress_meta = Table.grid(expand=True)
    progress_meta.add_column(justify="left")
    progress_meta.add_column(justify="center")
    progress_meta.add_column(justify="right")
    progress_meta.add_row(
        f"Completed: {done}/{total}",
        f"{completion * 100:5.1f}%",
        f"Refresh: {update_seconds}s",
    )
    progress_panel = Panel(
        Group(progress, progress_meta),
        title="Progress",
        border_style="cyan",
        box=box.ROUNDED,
    )

    running_table = Table(box=box.SIMPLE_HEAD, expand=True, show_header=True)
    running_table.add_column("JOB", justify="right", style="bold")
    running_table.add_column("TEST", overflow="fold")
    running_table.add_column("SEED", justify="right")
    running_table.add_column("ELAPSED", justify="right", style="cyan")
    for job, job_elapsed in running_jobs[:10]:
        running_table.add_row(
            str(job.index),
            job.test_name,
            str(job.seed),
            format_elapsed(job_elapsed),
        )
    if not running_jobs:
        running_table.add_row("-", "idle", "-", "-")
    running_panel = Panel(
        running_table,
        title=f"Running Jobs ({len(running_jobs)})",
        border_style="blue",
        box=box.ROUNDED,
    )

    failure_table = Table(box=box.SIMPLE_HEAD, expand=True, show_header=True)
    failure_table.add_column("JOB", justify="right", style="bold")
    failure_table.add_column("TEST", overflow="fold")
    failure_table.add_column("SEED", justify="right")
    for result in recent_failures[-6:]:
        failure_table.add_row(
            str(result.job.index),
            result.job.test_name,
            str(result.job.seed),
        )
    if not recent_failures:
        failure_table.add_row("-", "none", "-")
    failure_panel = Panel(
        failure_table,
        title=f"Recent Failures ({failed})",
        border_style="red",
        box=box.ROUNDED,
    )

    return Group(cards, progress_panel, running_panel, failure_panel)


def _running_job_entries(
    active_futures: dict[Future[JobResult], RegressionJob],
    started_at: dict[Future[JobResult], float],
    now: float,
) -> list[tuple[RegressionJob, float]]:
    rows: list[tuple[RegressionJob, float]] = []
    for future, job in active_futures.items():
        started = started_at.get(future, now)
        elapsed = max(now - started, 0.0)
        rows.append((job, elapsed))
    rows.sort(key=lambda item: (-item[1], item[0].index))
    return rows


def run_regression(
    config: RegressionConfig,
    *,
    console: Console | None = None,
    runner: Callable[..., JobResult] | None = None,
    monotonic: Callable[[], float] = time.monotonic,
) -> RegressionOutcome:
    from rich.console import Console
    from rich.live import Live

    jobs = expand_regression_jobs(config.tests, config.seed)
    output_dir = (
        Path(config.output_dir).resolve()
        if config.output_dir is not None
        else make_default_regression_output(repo_root())
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    if console is None:
        console = Console(stderr=True)
    job_runner = runner or _run_job_default

    total = len(jobs)
    pending = total
    running = 0
    passed = 0
    failed = 0
    interrupted = False
    failed_results: list[JobResult] = []
    recent_failures: list[JobResult] = []

    stop_event = threading.Event()
    start = monotonic()
    next_update = start + config.update

    active_futures: dict[Future[JobResult], RegressionJob] = {}
    active_started_at: dict[Future[JobResult], float] = {}
    cursor = 0

    def submit_one(executor: ThreadPoolExecutor) -> bool:
        nonlocal cursor, pending, running
        if cursor >= total:
            return False
        job = jobs[cursor]
        cursor += 1
        pending -= 1
        running += 1
        future = executor.submit(
            job_runner,
            job=job,
            config=config,
            output_dir=output_dir,
            stop_event=stop_event,
        )
        active_futures[future] = job
        active_started_at[future] = monotonic()
        return True

    def consume_completed(done: set[Future[JobResult]]) -> bool:
        nonlocal running, passed, failed
        had_failure = False
        for future in done:
            job = active_futures.get(future)
            running -= 1
            active_futures.pop(future, None)
            active_started_at.pop(future, None)
            try:
                result = future.result()
            except Exception:
                failed += 1
                had_failure = True
                if job is not None:
                    fallback_run_dir = make_run_dir(output_dir, job)
                    fallback_result = JobResult(
                        job=job,
                        run_dir=fallback_run_dir,
                        log_path=fallback_run_dir / "sim.log",
                        returncode=1,
                        rerun_command=build_job_rerun_command(job, config),
                    )
                    failed_results.append(fallback_result)
                    recent_failures.append(fallback_result)
                    if len(recent_failures) > 24:
                        del recent_failures[:-24]
                continue
            if result.returncode == 0:
                passed += 1
            else:
                failed += 1
                had_failure = True
                failed_results.append(result)
                recent_failures.append(result)
                if len(recent_failures) > 24:
                    del recent_failures[:-24]
        return had_failure

    def refresh_status(live: Any, now: float, *, force: bool = False) -> None:
        nonlocal next_update
        if force or now >= next_update:
            live.update(
                _status_dashboard(
                    total=total,
                    pending=pending,
                    running=running,
                    passed=passed,
                    failed=failed,
                    elapsed=format_elapsed(now - start),
                    update_seconds=config.update,
                    running_jobs=_running_job_entries(
                        active_futures, active_started_at, now
                    ),
                    recent_failures=recent_failures,
                ),
                refresh=True,
            )
            next_update = now + config.update

    with ThreadPoolExecutor(max_workers=config.jobs) as executor:
        while running < config.jobs and submit_one(executor):
            pass

        with Live(
            _status_dashboard(
                total=total,
                pending=pending,
                running=running,
                passed=passed,
                failed=failed,
                elapsed=format_elapsed(0),
                update_seconds=config.update,
                running_jobs=_running_job_entries(
                    active_futures, active_started_at, start
                ),
                recent_failures=recent_failures,
            ),
            console=console,
            refresh_per_second=8,
        ) as live:
            try:
                while active_futures:
                    now = monotonic()
                    timeout = max(next_update - now, 0)
                    done, _ = wait(
                        active_futures,
                        timeout=timeout,
                        return_when=FIRST_COMPLETED,
                    )

                    had_failure = False
                    if done:
                        had_failure = consume_completed(done)
                        while running < config.jobs and submit_one(executor):
                            pass

                    refresh_status(live, monotonic(), force=had_failure)

            except KeyboardInterrupt:
                interrupted = True
                stop_event.set()
                while active_futures:
                    done, _ = wait(
                        active_futures, timeout=0.2, return_when=FIRST_COMPLETED
                    )
                    if done:
                        consume_completed(done)
                refresh_status(live, monotonic(), force=True)

            refresh_status(live, monotonic(), force=True)

    duration = monotonic() - start
    return RegressionOutcome(
        total=total,
        passed=passed,
        failed=failed,
        interrupted=interrupted,
        duration_seconds=duration,
        output_dir=output_dir,
        failed_results=failed_results,
    )


def run_checked(
    command: Sequence[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> None:
    try:
        subprocess.run(list(command), cwd=cwd, env=env, check=True)
    except subprocess.CalledProcessError as exc:
        cmd = " ".join(shlex.quote(part) for part in command)
        raise ConfigError(f"Command failed ({exc.returncode}): {cmd}") from exc


def generate_test(
    *,
    test: str,
    seed: str,
    run_dir: Path | None = None,
    tibbar_cmd: str | None = None,
) -> Path:
    root = repo_root()
    runs_base = root / "runs"
    selected_dir = run_dir
    if selected_dir is None:
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        selected_dir = runs_base / f"{test}_seed{seed}_{timestamp}"
    selected_dir.mkdir(parents=True, exist_ok=True)

    asm = selected_dir / "test.S"
    elf = selected_dir / "test.elf"
    model_log = selected_dir / "instructions_modelled.yaml"

    cmd = tibbar_cmd or os.environ.get("TIBBAR_CMD", "uv run tibbar")
    tibbar_parts = shlex.split(cmd)
    if not tibbar_parts:
        raise ConfigError("TIBBAR_CMD is empty")

    print(f"Run directory: {selected_dir}", file=sys.stderr)
    run_checked(
        [
            *tibbar_parts,
            "--generator",
            test,
            "--output",
            str(asm),
            "--seed",
            str(seed),
            "--debug-yaml",
            str(model_log),
        ],
        cwd=root,
    )

    run_checked(
        [str(root / "scripts" / "asm2elf.sh"), str(asm), "--link", "-o", str(elf)],
        cwd=root,
    )
    print(f"Instructions modelled: {model_log}", file=sys.stderr)
    print(f"ELF: {elf}", file=sys.stderr)
    print(
        f"Rerun: {commands_dir() / 'rheon_gen'} --test {test} --seed {seed}",
        file=sys.stderr,
    )
    return elf


def run_simulation(
    *,
    elf_path: Path,
    seed: str | None,
    verbosity: str | None,
    waves: bool,
) -> int:
    root = repo_root()
    elf = elf_path.resolve()
    if not elf.exists():
        raise ConfigError(f"ELF not found: {elf}")

    validated_verbosity = validate_verbosity(verbosity)

    run_dir = elf.parent
    cocotb_results = run_dir / "results.xml"
    waves_file = run_dir / "dump.vcd"

    env = os.environ.copy()
    env["COCOTB_RESULTS_FILE"] = str(cocotb_results)
    if validated_verbosity:
        env["RHEON_VERBOSITY"] = validated_verbosity

    make_args = ["make", "run", f"ELF={elf}"]
    if seed is not None:
        make_args.append(f"RANDOM_SEED={seed}")
    if validated_verbosity:
        make_args.append(f"RHEON_VERBOSITY={validated_verbosity}")
    if waves:
        make_args.extend(["WAVES=1", f"WAVES_FILE={waves_file}"])

    rerun = f"{commands_dir() / 'rheon_sim'} --test {elf}"
    if seed is not None:
        rerun += f" --seed {seed}"
    if validated_verbosity:
        rerun += f" --verbosity {validated_verbosity}"
    if waves:
        rerun += " --waves"

    print(f"Rerun: {rerun}", file=sys.stderr)
    if validated_verbosity:
        print(f"Verbosity: {validated_verbosity}", file=sys.stderr)
    if waves:
        print(f"Waves: enabled (WAVES=1), target: {waves_file}", file=sys.stderr)

    result = subprocess.run(make_args, cwd=root, env=env, check=False)

    if waves:
        if waves_file.exists():
            print(f"Waves: {waves_file}", file=sys.stderr)
        else:
            print(
                f"Waves requested but file not found yet: {waves_file}", file=sys.stderr
            )

    return result.returncode
