#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
"""Shared Python helpers for rheon command-line scripts."""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import shlex
import shutil
import socket
import subprocess
import sys
import threading
import time
from concurrent.futures import FIRST_COMPLETED, Future, ThreadPoolExecutor, wait
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterable, Literal, Sequence

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

if TYPE_CHECKING:
    from rich.console import Console

VALID_VERBOSITY = {"debug", "info", "warning", "error", "critical"}
RUN_STAGES = ("run",)
GEN_SIM_STAGES = ("gen", "sim")
STATE_FILE_NAME = "regression_state.json"
LATEST_SHORTCUT = "latest"
REPORT_VERSION = 1
EXIT_TIMEOUT = 124
ANSI_ESCAPE_RE = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
HEX_RE = re.compile(r"0[xX][0-9a-fA-F]+")
MISMATCH_TABLE_ROW_RE = re.compile(
    r"^\s*\|\s*(?P<field>[^|]+?)\s*\|\s*(?P<captured>[^|]+?)\s*\|\s*(?P<expected>[^|]+?)\s*\|\s*(?P<compared>[^|]+?)\s*\|\s*(?P<match>[^|]+?)\s*\|"
)


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
    coverage: bool | None = None
    timeout_sec: int | None = None
    fail_fast: bool | None = None
    max_failures: int | None = None
    resume: str | None = None
    report_json: str | None = None
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

    @field_validator("timeout_sec")
    @classmethod
    def validate_timeout(cls, value: int | None) -> int | None:
        if value is not None and value < 1:
            raise ValueError("must be >= 1")
        return value

    @field_validator("max_failures")
    @classmethod
    def validate_max_failures(cls, value: int | None) -> int | None:
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
    coverage: bool
    resume: Path | None
    timeout_sec: int | None
    fail_fast: bool
    max_failures: int | None
    report_json: Path | None


@dataclass(frozen=True)
class JobResult:
    job: RegressionJob
    run_dir: Path
    log_path: Path
    returncode: int
    rerun_command: str
    status_reason: str = "failed"
    timed_out: bool = False
    duration_seconds: float = 0.0
    triage_summary: str | None = None
    triage_pc: int | None = None
    triage_instr_hex: str | None = None
    triage_instr_asm: str | None = None
    triage_mismatched_fields: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class RegressionOutcome:
    total: int
    scheduled: int
    skipped_resume: int
    passed: int
    failed: int
    not_run: int
    timed_out: int
    interrupted: bool
    fail_fast_triggered: bool
    max_failures_triggered: bool
    duration_seconds: float
    output_dir: Path
    failed_results: list[JobResult]
    executed_results: list[JobResult]


class RegressionRunController:
    """Mutable controls for an in-flight regression run."""

    def __init__(self, *, parallelism: int) -> None:
        self._stop_event = threading.Event()
        self._paused_event = threading.Event()
        self._paused_event.clear()
        self._parallelism = max(int(parallelism), 1)
        self._parallelism_lock = threading.Lock()

    @property
    def stop_event(self) -> threading.Event:
        return self._stop_event

    @property
    def is_paused(self) -> bool:
        return self._paused_event.is_set()

    @property
    def is_cancelled(self) -> bool:
        return self._stop_event.is_set()

    @property
    def parallelism(self) -> int:
        with self._parallelism_lock:
            return self._parallelism

    def set_parallelism(self, jobs: int) -> int:
        value = max(int(jobs), 1)
        with self._parallelism_lock:
            self._parallelism = value
            return self._parallelism

    def pause(self) -> None:
        self._paused_event.set()

    def resume(self) -> None:
        self._paused_event.clear()

    def cancel(self) -> None:
        self._stop_event.set()


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def scripts_dir() -> Path:
    return Path(__file__).resolve().parent


def commands_dir() -> Path:
    bin_dir = repo_root() / "bin"
    if (bin_dir / "rheon_run").exists():
        return bin_dir
    return scripts_dir()


def _command_entrypoint(name: str) -> list[str]:
    command_path = commands_dir() / name
    try:
        first_line = command_path.read_text(encoding="utf-8").splitlines()[0]
    except (OSError, IndexError, UnicodeDecodeError):
        first_line = ""
    if first_line.startswith("#!") and "python" in first_line.lower():
        return [sys.executable, str(command_path)]
    return [str(command_path)]


def _augment_runtime_env(env: dict[str, str] | None = None) -> dict[str, str]:
    runtime_env = os.environ.copy()
    if env is not None:
        runtime_env.update(env)

    current_python_bin = Path(sys.executable).resolve().parent
    extra_entries = [str(current_python_bin)]

    repo_python_bin = repo_root() / ".venv" / "bin"
    if repo_python_bin.exists():
        extra_entries.append(str(repo_python_bin.resolve()))

    command_root = commands_dir()
    if command_root.exists():
        extra_entries.append(str(command_root.resolve()))

    existing_entries = [
        entry for entry in runtime_env.get("PATH", "").split(os.pathsep) if entry
    ]
    deduped_entries: list[str] = []
    for entry in [*extra_entries, *existing_entries]:
        if entry and entry not in deduped_entries:
            deduped_entries.append(entry)
    runtime_env["PATH"] = os.pathsep.join(deduped_entries)
    return runtime_env


def regressions_root() -> Path:
    return repo_root() / "runs" / "regressions"


def latest_shortcut_path() -> Path:
    return regressions_root() / LATEST_SHORTCUT


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


def _load_yaml_text(raw_text: str) -> RegressionFileModel:
    try:
        loaded = yaml.safe_load(raw_text)
    except yaml.YAMLError as exc:
        raise ConfigError("Unable to parse regression YAML text") from exc

    if loaded is None:
        return RegressionFileModel()
    if not isinstance(loaded, dict):
        raise ConfigError("Regression YAML must contain a mapping")
    try:
        return RegressionFileModel.model_validate(loaded)
    except ValidationError as exc:
        raise ConfigError(
            f"Regression YAML schema validation failed: {_format_validation_error(exc)}"
        ) from exc


def regression_file_payload(
    config: RegressionConfig,
    *,
    tests: list[TestSpec] | None = None,
) -> dict[str, Any]:
    selected_tests = tests if tests is not None else config.tests
    return {
        "version": REPORT_VERSION,
        "regression": {
            "seed": config.seed,
            "jobs": config.jobs,
            "update": config.update,
            "stages": list(config.stages),
            "output_dir": str(config.output_dir) if config.output_dir else None,
            "verbosity": config.verbosity,
            "waves": config.waves,
            "coverage": config.coverage,
            "timeout_sec": config.timeout_sec,
            "fail_fast": config.fail_fast,
            "max_failures": config.max_failures,
            "resume": str(config.resume) if config.resume else None,
            "report_json": str(config.report_json) if config.report_json else None,
            "tests": [
                {"name": item.name, "count": item.count} for item in selected_tests
            ],
        },
    }


def regression_yaml_text(
    config: RegressionConfig, *, tests: list[TestSpec] | None = None
) -> str:
    return "---\n" + yaml.safe_dump(
        regression_file_payload(config, tests=tests),
        default_flow_style=False,
    )


def _coerce_int(value: Any, *, field: str, min_value: int | None = None) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ConfigError(f"{field} must be an integer") from exc
    if min_value is not None and parsed < min_value:
        raise ConfigError(f"{field} must be >= {min_value}")
    return parsed


def _resolve_resume_path(raw_value: str) -> Path:
    value = raw_value.strip()
    if not value:
        raise ConfigError("--resume value cannot be empty")

    if value.lower() == "latest":
        latest = latest_shortcut_path()
        if not latest.exists() and not latest.is_symlink():
            raise ConfigError(f"Resume target 'latest' not found at {latest}")
        if latest.is_symlink():
            resolved = latest.resolve()
        elif latest.is_file():
            try:
                text = latest.read_text(encoding="utf-8").strip()
            except OSError as exc:
                raise ConfigError(
                    f"Unable to read resume target file {latest}"
                ) from exc
            if not text:
                raise ConfigError(f"Resume target file {latest} is empty")
            resolved = Path(text).expanduser().resolve()
        else:
            raise ConfigError(
                f"Resume target '{latest}' must be a symlink or a file containing a directory path"
            )
        if not resolved.exists() or not resolved.is_dir():
            raise ConfigError(
                f"Resume target resolved from 'latest' is invalid: {resolved}"
            )
        return resolved

    resolved = Path(value).expanduser().resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise ConfigError(f"Resume directory not found: {resolved}")
    return resolved


def build_regression_config(args: argparse.Namespace) -> RegressionConfig:
    file_model = RegressionFileModel()
    regression_model = file_model.regression

    file_arg = getattr(args, "file", None)
    if file_arg is not None:
        file_model = _load_yaml(Path(file_arg))
        regression_model = file_model.regression

    tests_from_file = [
        TestSpec(name=item.name, count=item.count) for item in regression_model.tests
    ]
    tests_from_cli = [
        parse_test_spec(item) for item in (getattr(args, "test", None) or [])
    ]
    tests = [*tests_from_file, *tests_from_cli]
    if not tests:
        raise ConfigError(
            "No tests specified. Use --test NAME,COUNT and/or --file with regression.tests"
        )

    seed = _coerce_int(
        1 if regression_model.seed is None else regression_model.seed, field="seed"
    )
    seed_arg = getattr(args, "seed", None)
    if seed_arg is not None:
        seed = _coerce_int(seed_arg, field="--seed")

    jobs = _coerce_int(
        default_parallel_jobs()
        if regression_model.jobs is None
        else regression_model.jobs,
        field="jobs",
        min_value=1,
    )
    jobs_arg = getattr(args, "jobs", None)
    if jobs_arg is not None:
        jobs = _coerce_int(jobs_arg, field="--jobs", min_value=1)

    update = _coerce_int(
        2 if regression_model.update is None else regression_model.update,
        field="update",
        min_value=1,
    )
    update_arg = getattr(args, "update", None)
    if update_arg is not None:
        update = _coerce_int(update_arg, field="--update", min_value=1)

    stages_raw: Any = (
        regression_model.stages
        if regression_model.stages is not None
        else list(RUN_STAGES)
    )
    stages = parse_stages(stages_raw)
    stages_arg = getattr(args, "stages", None)
    if stages_arg is not None:
        stages = parse_stages(stages_arg)

    output_dir = (
        Path(regression_model.output_dir) if regression_model.output_dir else None
    )
    output_dir_arg = getattr(args, "output_dir", None)
    if output_dir_arg is not None:
        output_dir = Path(output_dir_arg)

    verbosity = validate_verbosity(regression_model.verbosity)
    verbosity_arg = getattr(args, "verbosity", None)
    if verbosity_arg is not None:
        verbosity = validate_verbosity(verbosity_arg)

    waves = (
        bool(regression_model.waves) if regression_model.waves is not None else False
    )
    waves_arg = getattr(args, "waves", None)
    if waves_arg is not None:
        waves = bool(waves_arg)
    coverage = (
        bool(regression_model.coverage)
        if regression_model.coverage is not None
        else False
    )
    coverage_arg = getattr(args, "coverage", None)
    if coverage_arg is not None:
        coverage = bool(coverage_arg)

    timeout_sec = regression_model.timeout_sec
    timeout_arg = getattr(args, "timeout_sec", None)
    if timeout_arg is not None:
        timeout_sec = _coerce_int(timeout_arg, field="--timeout-sec", min_value=1)

    fail_fast = (
        bool(regression_model.fail_fast)
        if regression_model.fail_fast is not None
        else False
    )
    fail_fast_arg = getattr(args, "fail_fast", None)
    if fail_fast_arg is not None:
        fail_fast = bool(fail_fast_arg)

    max_failures = regression_model.max_failures
    max_failures_arg = getattr(args, "max_failures", None)
    if max_failures_arg is not None:
        max_failures = _coerce_int(
            max_failures_arg, field="--max-failures", min_value=1
        )

    resume_dir = (
        _resolve_resume_path(regression_model.resume)
        if regression_model.resume
        else None
    )
    resume_arg = getattr(args, "resume", None)
    if resume_arg is not None:
        resume_dir = _resolve_resume_path(str(resume_arg))

    if resume_dir is not None:
        if output_dir is not None and output_dir.resolve() != resume_dir.resolve():
            raise ConfigError("--output-dir cannot differ from --resume target")
        output_dir = resume_dir

    report_json = (
        Path(regression_model.report_json).expanduser()
        if regression_model.report_json
        else None
    )
    report_json_arg = getattr(args, "report_json", None)
    if report_json_arg is not None:
        report_json = Path(report_json_arg).expanduser()

    return RegressionConfig(
        tests=tests,
        seed=seed,
        jobs=jobs,
        update=update,
        stages=stages,
        output_dir=output_dir,
        verbosity=verbosity,
        waves=waves,
        coverage=coverage,
        resume=resume_dir,
        timeout_sec=timeout_sec,
        fail_fast=fail_fast,
        max_failures=max_failures,
        report_json=report_json,
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


def _now_iso() -> str:
    return (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(
        json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    tmp_path.replace(path)


def _update_latest_shortcut(target_dir: Path) -> None:
    latest = latest_shortcut_path()
    latest.parent.mkdir(parents=True, exist_ok=True)

    if latest.exists() or latest.is_symlink():
        if latest.is_dir() and not latest.is_symlink():
            raise ConfigError(
                f"Cannot update latest shortcut: existing directory at {latest}"
            )
        latest.unlink()

    try:
        latest.symlink_to(target_dir.resolve())
    except OSError:
        latest.write_text(str(target_dir.resolve()) + "\n", encoding="utf-8")


def _initial_state() -> dict[str, Any]:
    return {
        "version": 1,
        "revision": 0,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
        "meta": {
            "revision": 0,
            "status": "initialized",
            "status_reason": None,
            "parallelism": 0,
            "jobs_requested": 0,
            "total": 0,
            "scheduled": 0,
            "skipped_resume": 0,
            "passed": 0,
            "failed": 0,
            "not_run": 0,
            "timed_out": 0,
            "running_jobs": [],
            "output_dir": None,
            "is_paused": False,
            "is_cancelled": False,
            "elapsed_seconds": 0.0,
            "fail_fast_triggered": False,
            "max_failures_triggered": False,
        },
        "jobs": {},
    }


def _load_state(state_path: Path) -> dict[str, Any]:
    if not state_path.exists():
        return _initial_state()
    try:
        loaded = json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"Unable to read state file {state_path}") from exc
    if not isinstance(loaded, dict):
        raise ConfigError(f"State file {state_path} is invalid")
    loaded.setdefault("version", 1)
    loaded.setdefault("revision", 0)
    loaded.setdefault("created_at", _now_iso())
    loaded.setdefault("updated_at", _now_iso())
    loaded.setdefault("meta", {})
    if not isinstance(loaded["meta"], dict):
        loaded["meta"] = {}
    initial_meta = _initial_state()["meta"]
    for key, value in initial_meta.items():
        loaded["meta"].setdefault(key, value)
    loaded["meta"]["revision"] = int(loaded.get("revision", 0) or 0)
    loaded.setdefault("jobs", {})
    if not isinstance(loaded["jobs"], dict):
        raise ConfigError(f"State file {state_path} has invalid jobs map")
    return loaded


def _save_state(state_path: Path, state: dict[str, Any]) -> None:
    revision = int(state.get("revision", 0) or 0) + 1
    state["revision"] = revision
    meta = state.setdefault("meta", {})
    if isinstance(meta, dict):
        meta["revision"] = revision
    state["updated_at"] = _now_iso()
    _atomic_write_json(state_path, state)


def _job_key(job: RegressionJob) -> str:
    return f"{job.index}:{job.test_name}:{job.seed}"


def _job_fingerprint(job: RegressionJob, config: RegressionConfig) -> dict[str, Any]:
    return {
        "test_name": job.test_name,
        "seed": job.seed,
        "stages": list(config.stages),
        "verbosity": config.verbosity,
        "waves": config.waves,
        "coverage": config.coverage,
        "timeout_sec": config.timeout_sec,
    }


def build_job_rerun_command(job: RegressionJob, config: RegressionConfig) -> str:
    rerun_parts = ["rheon_run", "--test", job.test_name, "--seed", str(job.seed)]
    if config.verbosity:
        rerun_parts.extend(["--verbosity", config.verbosity])
    if config.waves:
        rerun_parts.append("--waves")
    if config.coverage:
        rerun_parts.append("--coverage")
    return " ".join(shlex.quote(part) for part in rerun_parts)


def _spawn_and_wait(
    command: Sequence[str],
    *,
    cwd: Path,
    log_handle: Any,
    stop_event: threading.Event,
    timeout_sec: int | None,
    env: dict[str, str] | None = None,
) -> tuple[int, bool, float]:
    runtime_env = _augment_runtime_env(env)
    process = subprocess.Popen(
        list(command),
        cwd=cwd,
        env=runtime_env,
        stdout=log_handle,
        stderr=subprocess.STDOUT,
        text=True,
    )
    start = time.monotonic()

    while True:
        rc = process.poll()
        elapsed = time.monotonic() - start
        if rc is not None:
            return rc, False, elapsed

        if stop_event.is_set():
            process.terminate()
            try:
                rc = process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                rc = process.wait(timeout=5)
            return rc, False, elapsed

        if timeout_sec is not None and elapsed > float(timeout_sec):
            cmd = " ".join(shlex.quote(part) for part in command)
            log_handle.write(f"TIMEOUT after {timeout_sec}s: {cmd}\n")
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            return EXIT_TIMEOUT, True, elapsed

        time.sleep(0.1)


def _strip_ansi(text: str) -> str:
    return ANSI_ESCAPE_RE.sub("", text)


def _extract_hex(value: str) -> int | None:
    match = HEX_RE.search(value)
    if match is None:
        return None
    try:
        return int(match.group(0), 16)
    except ValueError:
        return None


def _disasm(instr: int, pc: int | None) -> str | None:
    try:
        root = str(repo_root())
        if root not in sys.path:
            sys.path.insert(0, root)
        from tb.disasm import disasm_insn

        return disasm_insn(instr, pc or 0)
    except Exception:
        return None


def _extract_triage_from_log(
    log_path: Path,
) -> tuple[str | None, int | None, str | None, str | None, list[str]]:
    if not log_path.exists():
        return None, None, None, None, []

    try:
        lines = [
            _strip_ansi(line.rstrip("\n"))
            for line in log_path.read_text(
                encoding="utf-8", errors="replace"
            ).splitlines()
        ]
    except OSError:
        return None, None, None, None, []

    mismatch_idx: int | None = None
    for idx, line in enumerate(lines):
        if "Mismatch on channel" in line:
            mismatch_idx = idx
            break
    if mismatch_idx is None:
        return None, None, None, None, []

    pc_val: int | None = None
    instr_val: int | None = None
    instr_asm_from_log: str | None = None
    mismatched_fields: list[str] = []
    saw_header = False
    saw_data_rows = False

    for line in lines[mismatch_idx:]:
        row_match = MISMATCH_TABLE_ROW_RE.match(line)
        if row_match is not None:
            field_name = row_match.group("field").strip()
            captured = row_match.group("captured").strip()
            expected = row_match.group("expected").strip()
            match_flag = row_match.group("match").strip()

            if field_name.lower() == "field":
                saw_header = True
                continue
            if not saw_header:
                continue
            if not field_name:
                continue

            saw_data_rows = True
            field_key = field_name.lower()
            if field_key == "pc":
                pc_val = _extract_hex(captured) or _extract_hex(expected)
            elif field_key == "instr":
                instr_val = _extract_hex(captured) or _extract_hex(expected)
            elif field_key in {"instr_asm", "asm"}:
                candidate = (
                    captured if captured and captured.lower() != "none" else expected
                )
                if candidate and candidate.lower() != "none":
                    instr_asm_from_log = candidate

            if "!!!" in match_flag:
                mismatched_fields.append(field_name)
            continue

        if saw_header:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith("+") and stripped.endswith("+"):
                continue
            if saw_data_rows:
                break

    instr_hex: str | None = None
    instr_asm: str | None = None
    if instr_val is not None:
        instr_hex = f"0x{instr_val:08x}"
        instr_asm = instr_asm_from_log or _disasm(instr_val, pc_val)
    elif instr_asm_from_log:
        instr_asm = instr_asm_from_log

    summary_parts: list[str] = []
    if pc_val is not None:
        summary_parts.append(f"pc=0x{pc_val:08x}")
    if instr_hex is not None:
        summary_parts.append(f"instr={instr_hex}")
    if instr_asm:
        summary_parts.append(f"asm='{instr_asm}'")
    if mismatched_fields:
        summary_parts.append("mismatches=" + ",".join(mismatched_fields[:6]))

    summary = (
        " ".join(summary_parts) if summary_parts else "mismatch detected (see sim.log)"
    )
    return summary, pc_val, instr_hex, instr_asm, mismatched_fields


def _enrich_failed_result(result: JobResult) -> JobResult:
    if result.returncode == 0:
        return result
    summary, pc_val, instr_hex, instr_asm, mismatched_fields = _extract_triage_from_log(
        result.log_path
    )
    if summary and result.status_reason == "failed":
        reason = "mismatch"
    else:
        reason = result.status_reason
    return replace(
        result,
        status_reason=reason,
        triage_summary=summary,
        triage_pc=pc_val,
        triage_instr_hex=instr_hex,
        triage_instr_asm=instr_asm,
        triage_mismatched_fields=mismatched_fields,
    )


def _record_job_state(
    state: dict[str, Any], config: RegressionConfig, result: JobResult
) -> None:
    key = _job_key(result.job)
    state["jobs"][key] = {
        "index": result.job.index,
        "test_name": result.job.test_name,
        "seed": result.job.seed,
        "fingerprint": _job_fingerprint(result.job, config),
        "status": "passed" if result.returncode == 0 else "failed",
        "status_reason": result.status_reason,
        "returncode": result.returncode,
        "timed_out": result.timed_out,
        "duration_seconds": result.duration_seconds,
        "run_dir": str(result.run_dir),
        "log_path": str(result.log_path),
        "rerun_command": result.rerun_command,
        "triage_summary": result.triage_summary,
        "triage_pc": result.triage_pc,
        "triage_instr_hex": result.triage_instr_hex,
        "triage_instr_asm": result.triage_instr_asm,
        "triage_mismatched_fields": result.triage_mismatched_fields,
        "updated_at": _now_iso(),
    }


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

    rerun_text = build_job_rerun_command(job, config)

    with log_path.open("w", encoding="utf-8") as log_handle:
        log_handle.write(
            f"job_index={job.index} test={job.test_name} seed={job.seed}\n"
        )

        if config.stages == RUN_STAGES:
            cmd = [
                *_command_entrypoint("rheon_run"),
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
            if config.coverage:
                cmd.append("--coverage")
            rc, timed_out, elapsed = _spawn_and_wait(
                cmd,
                cwd=repo_root(),
                log_handle=log_handle,
                stop_event=stop_event,
                timeout_sec=config.timeout_sec,
            )
            reason = "timeout" if timed_out else ("passed" if rc == 0 else "failed")
            return JobResult(
                job=job,
                run_dir=run_dir,
                log_path=log_path,
                returncode=rc,
                rerun_command=rerun_text,
                status_reason=reason,
                timed_out=timed_out,
                duration_seconds=elapsed,
            )

        total_elapsed = 0.0
        gen_cmd = [
            *_command_entrypoint("rheon_gen"),
            "--test",
            job.test_name,
            "--seed",
            str(job.seed),
            "--run-dir",
            str(run_dir),
        ]
        rc, timed_out, elapsed = _spawn_and_wait(
            gen_cmd,
            cwd=repo_root(),
            log_handle=log_handle,
            stop_event=stop_event,
            timeout_sec=config.timeout_sec,
        )
        total_elapsed += elapsed
        if rc != 0:
            reason = "timeout" if timed_out else "failed"
            return JobResult(
                job=job,
                run_dir=run_dir,
                log_path=log_path,
                returncode=rc,
                rerun_command=rerun_text,
                status_reason=reason,
                timed_out=timed_out,
                duration_seconds=total_elapsed,
            )

        sim_elf = run_dir / "test.elf"
        if not sim_elf.exists():
            log_handle.write(f"ERROR: Expected ELF missing: {sim_elf}\n")
            return JobResult(
                job=job,
                run_dir=run_dir,
                log_path=log_path,
                returncode=1,
                rerun_command=rerun_text,
                status_reason="failed",
                timed_out=False,
                duration_seconds=total_elapsed,
            )

        sim_cmd = [
            *_command_entrypoint("rheon_sim"),
            "--test",
            str(sim_elf),
            "--seed",
            str(job.seed),
        ]
        if config.verbosity:
            sim_cmd.extend(["--verbosity", config.verbosity])
        if config.waves:
            sim_cmd.append("--waves")
        if config.coverage:
            sim_cmd.append("--coverage")

        rc, timed_out, elapsed = _spawn_and_wait(
            sim_cmd,
            cwd=repo_root(),
            log_handle=log_handle,
            stop_event=stop_event,
            timeout_sec=config.timeout_sec,
        )
        total_elapsed += elapsed
        reason = "timeout" if timed_out else ("passed" if rc == 0 else "failed")
        return JobResult(
            job=job,
            run_dir=run_dir,
            log_path=log_path,
            returncode=rc,
            rerun_command=rerun_text,
            status_reason=reason,
            timed_out=timed_out,
            duration_seconds=total_elapsed,
        )


def _status_dashboard(
    *,
    total: int,
    pending: int,
    running: int,
    passed: int,
    failed: int,
    skipped_resume: int,
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
            metric_card("SKIPPED", str(skipped_resume), "yellow", "bold yellow"),
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
            str(job.index), job.test_name, str(job.seed), format_elapsed(job_elapsed)
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
    failure_table.add_column("TRIAGE", overflow="fold")
    for result in recent_failures[-6:]:
        failure_table.add_row(
            str(result.job.index),
            result.job.test_name,
            str(result.job.seed),
            result.triage_summary or result.status_reason,
        )
    if not recent_failures:
        failure_table.add_row("-", "none", "-", "-")
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


def _running_job_payload_entries(
    active_futures: dict[Future[JobResult], RegressionJob],
    started_at: dict[Future[JobResult], float],
    started_at_iso: dict[Future[JobResult], str],
    now: float,
) -> list[dict[str, Any]]:
    rows = []
    for future, job in active_futures.items():
        started = started_at.get(future, now)
        elapsed = max(now - started, 0.0)
        rows.append(
            {
                "index": job.index,
                "test_name": job.test_name,
                "seed": job.seed,
                "elapsed_seconds": elapsed,
                "started_at": started_at_iso.get(future),
            }
        )
    rows.sort(key=lambda item: (-float(item["elapsed_seconds"]), int(item["index"])))
    return rows


def _write_report(
    config: RegressionConfig,
    outcome: RegressionOutcome,
    skipped_jobs: list[RegressionJob],
) -> None:
    if config.report_json is None:
        return

    report_path = (
        config.report_json.resolve()
        if config.report_json.is_absolute()
        else (Path.cwd() / config.report_json).resolve()
    )
    if outcome.interrupted:
        stop_reason = "interrupted"
    elif outcome.fail_fast_triggered:
        stop_reason = "fail_fast"
    elif outcome.max_failures_triggered:
        stop_reason = "max_failures"
    else:
        stop_reason = "complete"
    report_data = {
        "version": REPORT_VERSION,
        "generated_at": _now_iso(),
        "host": socket.gethostname(),
        "cwd": str(Path.cwd()),
        "output_dir": str(outcome.output_dir),
        "config": {
            "seed": config.seed,
            "jobs": config.jobs,
            "update": config.update,
            "stages": list(config.stages),
            "verbosity": config.verbosity,
            "waves": config.waves,
            "coverage": config.coverage,
            "timeout_sec": config.timeout_sec,
            "fail_fast": config.fail_fast,
            "max_failures": config.max_failures,
            "resume": str(config.resume) if config.resume else None,
        },
        "summary": {
            "total": outcome.total,
            "scheduled": outcome.scheduled,
            "skipped_resume": outcome.skipped_resume,
            "passed": outcome.passed,
            "failed": outcome.failed,
            "not_run": outcome.not_run,
            "timed_out": outcome.timed_out,
            "interrupted": outcome.interrupted,
            "fail_fast_triggered": outcome.fail_fast_triggered,
            "max_failures_triggered": outcome.max_failures_triggered,
            "stop_reason": stop_reason,
            "duration_seconds": outcome.duration_seconds,
        },
        "jobs": [
            {
                "index": result.job.index,
                "test_name": result.job.test_name,
                "seed": result.job.seed,
                "status": "passed" if result.returncode == 0 else "failed",
                "status_reason": result.status_reason,
                "returncode": result.returncode,
                "timed_out": result.timed_out,
                "duration_seconds": result.duration_seconds,
                "run_dir": str(result.run_dir),
                "log_path": str(result.log_path),
                "rerun_command": result.rerun_command,
                "triage": {
                    "summary": result.triage_summary,
                    "pc": result.triage_pc,
                    "instr_hex": result.triage_instr_hex,
                    "instr_asm": result.triage_instr_asm,
                    "mismatched_fields": result.triage_mismatched_fields,
                },
            }
            for result in outcome.executed_results
        ],
        "skipped_resume_jobs": [
            {"index": job.index, "test_name": job.test_name, "seed": job.seed}
            for job in skipped_jobs
        ],
    }
    _atomic_write_json(report_path, report_data)


def run_regression(
    config: RegressionConfig,
    *,
    console: Console | None = None,
    runner: Callable[..., JobResult] | None = None,
    control: RegressionRunController | None = None,
    status_callback: Callable[[dict[str, Any]], None] | None = None,
    jobs_override: list[RegressionJob] | None = None,
    monotonic: Callable[[], float] = time.monotonic,
) -> RegressionOutcome:
    from rich.console import Console
    from rich.live import Live

    jobs = jobs_override or expand_regression_jobs(config.tests, config.seed)
    if config.resume is not None:
        output_dir = config.resume.resolve()
    elif config.output_dir is not None:
        output_dir = config.output_dir.resolve()
    else:
        output_dir = make_default_regression_output(repo_root())
    output_dir.mkdir(parents=True, exist_ok=True)

    if console is None:
        console = Console(stderr=True)

    try:
        _update_latest_shortcut(output_dir)
    except ConfigError as exc:
        console.print(f"[yellow]Warning:[/yellow] {exc}")

    state_path = output_dir / STATE_FILE_NAME
    effective_control = control or RegressionRunController(parallelism=config.jobs)

    state = (
        _load_state(state_path)
        if config.resume is not None and jobs_override is None
        else _initial_state()
    )

    jobs_to_run: list[RegressionJob] = []
    skipped_jobs: list[RegressionJob] = []
    if jobs_override is None:
        for job in jobs:
            key = _job_key(job)
            fingerprint = _job_fingerprint(job, config)
            record = state.get("jobs", {}).get(key)
            if (
                record
                and isinstance(record, dict)
                and record.get("status") == "passed"
                and record.get("fingerprint") == fingerprint
            ):
                skipped_jobs.append(job)
                continue
            jobs_to_run.append(job)
    else:
        jobs_to_run = list(jobs)

    job_runner = runner or _run_job_default

    total = len(jobs)
    scheduled = len(jobs_to_run)
    skipped_resume = len(skipped_jobs)
    pending = scheduled
    running = 0
    passed = skipped_resume
    failed = 0
    timed_out = 0
    interrupted = False
    stop_launching = False
    fail_fast_triggered = False
    max_failures_triggered = False

    failed_results: list[JobResult] = []
    recent_failures: list[JobResult] = []
    executed_results: list[JobResult] = []

    stop_event = effective_control.stop_event
    start = monotonic()
    next_update = start + config.update
    status_reason = "running"
    interrupted = False

    active_futures: dict[Future[JobResult], RegressionJob] = {}
    active_started_at: dict[Future[JobResult], float] = {}
    active_started_at_iso: dict[Future[JobResult], str] = {}
    cursor = 0

    def emit_status_payload(
        *, force: bool = False, status: str = "running"
    ) -> dict[str, Any]:
        running_payload = _running_job_payload_entries(
            active_futures,
            active_started_at,
            active_started_at_iso,
            monotonic(),
        )
        return {
            "status": status,
            "status_reason": status_reason,
            "total": total,
            "scheduled": scheduled,
            "skipped_resume": skipped_resume,
            "passed": passed,
            "failed": failed,
            "not_run": pending,
            "timed_out": timed_out,
            "interrupted": interrupted,
            "fail_fast_triggered": fail_fast_triggered,
            "max_failures_triggered": max_failures_triggered,
            "running": running,
            "running_jobs": running_payload,
            "jobs": [
                {
                    "index": result.job.index,
                    "test_name": result.job.test_name,
                    "seed": result.job.seed,
                    "status": "passed" if result.returncode == 0 else "failed",
                    "status_reason": result.status_reason,
                    "duration_seconds": result.duration_seconds,
                    "triage_summary": result.triage_summary,
                    "triage_pc": result.triage_pc,
                    "triage_instr_hex": result.triage_instr_hex,
                    "triage_instr_asm": result.triage_instr_asm,
                    "triage_mismatched_fields": result.triage_mismatched_fields,
                    "log_path": str(result.log_path),
                    "run_dir": str(result.run_dir),
                    "rerun_command": result.rerun_command,
                }
                for result in executed_results
            ],
            "output_dir": str(output_dir),
            "parallelism": effective_control.parallelism,
            "force": force,
            "evented_at": _now_iso(),
            "elapsed_seconds": max(monotonic() - start, 0.0),
            "is_paused": effective_control.is_paused,
            "is_cancelled": effective_control.is_cancelled,
        }

    def emit_status(*, force: bool = False, status: str = "running") -> None:
        if status_callback is not None:
            status_callback(emit_status_payload(force=force, status=status))

    def update_state_snapshot(status: str) -> None:
        payload = emit_status_payload(force=False, status=status)
        running_jobs = [
            {
                "index": item["index"],
                "test_name": item["test_name"],
                "seed": item["seed"],
                "elapsed_seconds": item["elapsed_seconds"],
                "started_at": item.get("started_at"),
            }
            for item in payload["running_jobs"]
        ]
        state["meta"].update(
            {
                "revision": state.get("revision", 0),
                "status": status,
                "status_reason": status_reason,
                "jobs_requested": config.jobs,
                "total": total,
                "scheduled": scheduled,
                "skipped_resume": skipped_resume,
                "passed": passed,
                "failed": failed,
                "not_run": payload["not_run"],
                "timed_out": timed_out,
                "output_dir": str(output_dir),
                "seed": config.seed,
                "tests": [
                    {"name": test.name, "count": test.count} for test in config.tests
                ],
                "stages": list(config.stages),
                "verbosity": config.verbosity,
                "waves": config.waves,
                "coverage": config.coverage,
                "timeout_sec": config.timeout_sec,
                "fail_fast": config.fail_fast,
                "max_failures": config.max_failures,
                "interrupt_requested": effective_control.is_cancelled,
                "paused_requested": effective_control.is_paused,
                "parallelism": effective_control.parallelism,
                "running_jobs": running_jobs,
                "fail_fast_triggered": fail_fast_triggered,
                "max_failures_triggered": max_failures_triggered,
                "interrupted": interrupted,
                "elapsed_seconds": payload["elapsed_seconds"],
                "updated_at": _now_iso(),
            }
        )
        _save_state(state_path, state)

    def submit_one(executor: ThreadPoolExecutor) -> bool:
        nonlocal cursor, pending, running
        if (
            stop_launching
            or effective_control.is_cancelled
            or effective_control.is_paused
        ):
            return False
        if running >= effective_control.parallelism:
            return False
        if cursor >= scheduled:
            return False
        job = jobs_to_run[cursor]
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
        active_started_at_iso[future] = _now_iso()
        return True

    def consume_completed(done: set[Future[JobResult]]) -> bool:
        nonlocal running, passed, failed, timed_out
        had_failure = False
        for future in done:
            job = active_futures.get(future)
            running -= 1
            active_futures.pop(future, None)
            active_started_at.pop(future, None)
            active_started_at_iso.pop(future, None)
            try:
                result = future.result()
            except Exception:
                had_failure = True
                failed += 1
                if job is None:
                    continue
                fallback_run_dir = make_run_dir(output_dir, job)
                result = JobResult(
                    job=job,
                    run_dir=fallback_run_dir,
                    log_path=fallback_run_dir / "sim.log",
                    returncode=1,
                    rerun_command=build_job_rerun_command(job, config),
                    status_reason="runner_error",
                    timed_out=False,
                    duration_seconds=0.0,
                )
            if result.returncode == 0:
                passed += 1
            else:
                had_failure = True
                failed += 1
                if result.timed_out:
                    timed_out += 1
                result = _enrich_failed_result(result)
                failed_results.append(result)
                recent_failures.append(result)
                if len(recent_failures) > 24:
                    del recent_failures[:-24]
            executed_results.append(result)
            _record_job_state(state, config, result)
            _save_state(state_path, state)
        return had_failure

    def refresh_status(live: Any, now: float, *, force: bool = False) -> None:
        nonlocal next_update
        if force or now >= next_update:
            state_status = (
                "paused"
                if effective_control.is_paused
                else ("cancelled" if interrupted else "running")
            )
            live.update(
                _status_dashboard(
                    total=total,
                    pending=pending,
                    running=running,
                    passed=passed,
                    failed=failed,
                    skipped_resume=skipped_resume,
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
            emit_status(force=True)
            update_state_snapshot(state_status)
        else:
            emit_status(force=force, status=payload_status())
            update_state_snapshot(
                "paused"
                if effective_control.is_paused
                else ("cancelled" if interrupted else "running")
            )

    def payload_status() -> str:
        if effective_control.is_cancelled:
            return "cancelled"
        if interrupted:
            return "interrupted"
        if fail_fast_triggered:
            return "fail_fast"
        if max_failures_triggered:
            return "max_failures"
        if effective_control.is_paused:
            return "paused"
        return "running"

    def top_up_slots(executor: ThreadPoolExecutor) -> None:
        while (
            not stop_launching
            and not effective_control.is_cancelled
            and not effective_control.is_paused
            and running < effective_control.parallelism
            and submit_one(executor)
        ):
            pass

    state["meta"].update(
        {
            "status_reason": status_reason,
            "status": "running",
        }
    )
    update_state_snapshot(payload_status())
    emit_status(force=True, status="running")

    with ThreadPoolExecutor(max_workers=config.jobs) as executor:
        top_up_slots(executor)

        with Live(
            _status_dashboard(
                total=total,
                pending=pending,
                running=running,
                passed=passed,
                failed=failed,
                skipped_resume=skipped_resume,
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
                while active_futures or pending > 0:
                    if effective_control.is_cancelled:
                        stop_launching = True
                        stop_event.set()

                    top_up_slots(executor)

                    if effective_control.is_paused:
                        if active_futures:
                            done, _ = wait(
                                active_futures,
                                timeout=0.2,
                                return_when=FIRST_COMPLETED,
                            )
                            if done:
                                had_failure = consume_completed(done)
                                if config.fail_fast and failed > 0:
                                    stop_launching = True
                                    fail_fast_triggered = True
                                if (
                                    config.max_failures is not None
                                    and failed >= config.max_failures
                                ):
                                    stop_launching = True
                                    max_failures_triggered = True
                                refresh_status(live, monotonic(), force=had_failure)
                            else:
                                refresh_status(live, monotonic(), force=False)
                        else:
                            refresh_status(live, monotonic(), force=False)
                            time.sleep(0.2)
                        continue

                    now = monotonic()
                    timeout = max(next_update - now, 0)
                    done, _ = wait(
                        active_futures, timeout=timeout, return_when=FIRST_COMPLETED
                    )

                    had_failure = False
                    if done:
                        had_failure = consume_completed(done)
                        if config.fail_fast and failed > 0:
                            stop_launching = True
                            fail_fast_triggered = True
                        if (
                            config.max_failures is not None
                            and failed >= config.max_failures
                        ):
                            stop_launching = True
                            max_failures_triggered = True

                    refresh_status(live, monotonic(), force=had_failure)

                    if not active_futures and stop_launching:
                        break

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
    final_status_reason = "complete"
    if effective_control.is_cancelled and not interrupted:
        final_status_reason = "cancelled"
    elif interrupted:
        final_status_reason = "interrupted"

    if fail_fast_triggered:
        final_status_reason = "fail_fast"
    if max_failures_triggered:
        final_status_reason = "max_failures"

    status_reason = final_status_reason
    final_state_status = (
        "cancelled"
        if final_status_reason == "cancelled"
        else "interrupted"
        if final_status_reason == "interrupted"
        else "complete"
    )
    update_state_snapshot(final_state_status)
    emit_status(force=True, status=final_state_status)
    state["meta"]["status_reason"] = final_status_reason
    _save_state(state_path, state)

    outcome = RegressionOutcome(
        total=total,
        scheduled=scheduled,
        skipped_resume=skipped_resume,
        passed=passed,
        failed=failed,
        not_run=pending,
        timed_out=timed_out,
        interrupted=interrupted or final_status_reason in {"cancelled", "interrupted"},
        fail_fast_triggered=fail_fast_triggered,
        max_failures_triggered=max_failures_triggered,
        duration_seconds=duration,
        output_dir=output_dir,
        failed_results=failed_results,
        executed_results=executed_results,
    )

    _write_report(config, outcome, skipped_jobs)
    return outcome


def run_checked(
    command: Sequence[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
) -> None:
    runtime_env = _augment_runtime_env(env)
    try:
        subprocess.run(list(command), cwd=cwd, env=runtime_env, check=True)
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
    coverage: bool,
) -> int:
    root = repo_root()
    elf = elf_path.resolve()
    if not elf.exists():
        raise ConfigError(f"ELF not found: {elf}")

    validated_verbosity = validate_verbosity(verbosity)

    run_dir = elf.parent
    cocotb_results = run_dir / "results.xml"
    waves_file = run_dir / "dump.vcd"
    coverage_archive = run_dir / "coverage.bktgz"

    env = _augment_runtime_env()
    env["COCOTB_RESULTS_FILE"] = str(cocotb_results)
    if validated_verbosity:
        env["RHEON_VERBOSITY"] = validated_verbosity
    if coverage:
        env["RHEON_BUCKET_COVERAGE"] = "1"
        env["RHEON_BUCKET_ARCHIVE"] = str(coverage_archive)

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
    if coverage:
        rerun += " --coverage"

    print(f"Rerun: {rerun}", file=sys.stderr)
    if validated_verbosity:
        print(f"Verbosity: {validated_verbosity}", file=sys.stderr)
    if waves:
        print(f"Waves: enabled (WAVES=1), target: {waves_file}", file=sys.stderr)
    if coverage:
        print(f"Coverage: enabled, archive target: {coverage_archive}", file=sys.stderr)

    if shutil.which("cocotb-config", path=env.get("PATH")) is None:
        raise ConfigError(
            "cocotb-config was not found on PATH. Run `uv sync` in the Rheon repo "
            "or launch the app from a synced checkout so the project .venv is available."
        )

    result = subprocess.run(make_args, cwd=root, env=env, check=False)

    if waves:
        if waves_file.exists():
            print(f"Waves: {waves_file}", file=sys.stderr)
        else:
            print(
                f"Waves requested but file not found yet: {waves_file}", file=sys.stderr
            )
    if coverage:
        if coverage_archive.exists():
            print(f"Coverage archive: {coverage_archive}", file=sys.stderr)
        else:
            print(
                f"Coverage requested but archive not found yet: {coverage_archive}",
                file=sys.stderr,
            )

    return result.returncode
