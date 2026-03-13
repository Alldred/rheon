#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
"""Browser UI for running and monitoring regressions."""

from __future__ import annotations

import argparse
import io
import json
import threading
import time
from dataclasses import dataclass, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from rheon_cli_common import (
    ConfigError,
    RegressionConfig,
    RegressionJob,
    RegressionRunController,
    TestSpec,
    _coerce_int,
    _load_yaml_text,
    _resolve_resume_path,
    default_parallel_jobs,
    expand_regression_jobs,
    make_default_regression_output,
    parse_stages,
    regression_file_payload,
    regression_yaml_text,
    repo_root,
    run_regression,
    validate_verbosity,
)
from rich.console import Console

SCRIPT_ROOT = Path(__file__).resolve().parent
APP_ASSETS = SCRIPT_ROOT / "rheon_regr_app_assets"
STATE_FILE = "regression_state.json"


@dataclass
class AppSession:
    run_id: str
    mode: str
    output_dir: Path
    state_path: Path
    config: RegressionConfig | None = None
    controller: RegressionRunController | None = None
    thread: threading.Thread | None = None
    planned_jobs_cache: list[dict[str, Any]] | None = None
    last_error: str | None = None
    started_at: float = 0.0


session_lock = threading.Lock()
current_session: AppSession | None = None


def _try_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _int_or_default(value: Any, default: int) -> int:
    parsed = _try_int(value)
    return parsed if parsed is not None else default


def _coerce_str(value: Any, field: str) -> str:
    if value is None:
        raise ValueError(f"{field} is required")
    text = str(value).strip()
    if not text:
        raise ValueError(f"{field} cannot be empty")
    return text


def _coerce_optional_str(value: Any) -> str | None:
    if value is None:
        return None
    return str(value).strip() or None


def _coerce_optional_path(value: Any, *, field: str) -> Path | None:
    raw = _coerce_optional_str(value)
    if raw is None:
        return None
    try:
        path = Path(raw).expanduser().resolve()
    except OSError as exc:
        raise ConfigError(f"{field} must be a valid path") from exc
    return path


def _coerce_optional_int(
    value: Any, *, field: str, min_value: int | None = None
) -> int | None:
    if value is None:
        return None
    return _coerce_int(value, field=field, min_value=min_value)


def _coerce_optional_bool(value: Any) -> bool | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{value!r} is not a valid boolean")


def _parse_tests_payload(tests_value: Any) -> list[TestSpec]:
    if not isinstance(tests_value, list):
        raise ValueError("'tests' must be a list of {name,count} entries")
    tests: list[TestSpec] = []
    for item in tests_value:
        if not isinstance(item, dict):
            raise ValueError("each tests entry must be a mapping")
        name = _coerce_str(item.get("name"), "tests[].name")
        count = _coerce_int(item.get("count"), field="tests[].count", min_value=1)
        tests.append(TestSpec(name=name, count=count))
    if not tests:
        raise ValueError("at least one test is required")
    return tests


def build_config_from_payload(
    payload: dict[str, Any],
) -> tuple[RegressionConfig, dict[str, Any]]:
    tests = _parse_tests_payload(payload.get("tests"))
    seed = _coerce_int(payload.get("seed"), field="seed", min_value=1)
    jobs = _coerce_optional_int(payload.get("jobs"), field="jobs", min_value=1)
    if jobs is None:
        jobs = default_parallel_jobs()
    update = _coerce_optional_int(payload.get("update"), field="update", min_value=1)
    if update is None:
        update = 2
    stages_raw = payload.get("stages", "run")
    stages = parse_stages(stages_raw)
    verbosity = validate_verbosity(payload.get("verbosity"))
    waves = bool(payload.get("waves"))
    timeout_sec = _coerce_optional_int(
        payload.get("timeout_sec"), field="timeout_sec", min_value=1
    )
    fail_fast = _coerce_optional_bool(payload.get("fail_fast"))
    max_failures = _coerce_optional_int(
        payload.get("max_failures"), field="max_failures", min_value=1
    )
    resume_raw = payload.get("resume")
    output_dir = _coerce_optional_path(payload.get("output_dir"), field="output_dir")
    report_json = _coerce_optional_path(payload.get("report_json"), field="report_json")

    resume = (
        _resolve_resume_path(_coerce_str(resume_raw, "resume"))
        if resume_raw is not None
        else None
    )

    if resume is not None and output_dir is not None and resume != output_dir:
        raise ValueError("--output-dir must match --resume target")

    config = RegressionConfig(
        tests=tests,
        seed=seed,
        jobs=jobs,
        update=update,
        stages=tuple(stages),
        output_dir=output_dir,
        verbosity=verbosity,
        waves=waves,
        resume=resume,
        timeout_sec=timeout_sec,
        fail_fast=bool(fail_fast),
        max_failures=max_failures,
        report_json=report_json,
    )
    return config, regression_file_payload(config)


def build_config_from_yaml(raw_yaml: str) -> RegressionConfig:
    model = _load_yaml_text(raw_yaml)
    regression = model.regression
    tests = [TestSpec(name=item.name, count=item.count) for item in regression.tests]
    if not tests:
        raise ValueError("No tests found in YAML regression file")

    return RegressionConfig(
        tests=tests,
        seed=regression.seed if regression.seed is not None else 1,
        jobs=regression.jobs
        if regression.jobs is not None
        else default_parallel_jobs(),
        update=regression.update if regression.update is not None else 2,
        stages=parse_stages(
            regression.stages if regression.stages is not None else "run"
        ),
        output_dir=Path(regression.output_dir) if regression.output_dir else None,
        verbosity=regression.verbosity,
        waves=bool(regression.waves) if regression.waves is not None else False,
        resume=_resolve_resume_path(regression.resume) if regression.resume else None,
        timeout_sec=regression.timeout_sec,
        fail_fast=bool(regression.fail_fast)
        if regression.fail_fast is not None
        else False,
        max_failures=regression.max_failures,
        report_json=Path(regression.report_json) if regression.report_json else None,
    )


def _collect_jobs_from_state(state: dict[str, Any]) -> list[dict[str, Any]]:
    raw_jobs = state.get("jobs", {})
    if isinstance(raw_jobs, dict):
        job_items = raw_jobs.values()
    elif isinstance(raw_jobs, list):
        job_items = raw_jobs
    else:
        job_items = []

    jobs = []
    for item in job_items:
        if not isinstance(item, dict):
            continue
        try:
            index = int(item.get("index"))
        except (TypeError, ValueError):
            continue
        try:
            seed = int(item.get("seed"))
        except (TypeError, ValueError):
            continue
        jobs.append(
            {
                "index": index,
                "test_name": item.get("test_name"),
                "seed": seed,
                "status": item.get("status", "not_run"),
                "status_reason": item.get("status_reason"),
                "returncode": item.get("returncode"),
                "timed_out": item.get("timed_out", False),
                "duration_seconds": item.get("duration_seconds", 0.0),
                "run_dir": item.get("run_dir"),
                "log_path": item.get("log_path"),
                "triage_summary": item.get("triage_summary"),
                "triage_pc": item.get("triage_pc"),
                "triage_instr_hex": item.get("triage_instr_hex"),
                "triage_instr_asm": item.get("triage_instr_asm"),
                "triage_mismatched_fields": item.get("triage_mismatched_fields", []),
                "updated_at": item.get("updated_at"),
            }
        )
    jobs.sort(key=lambda item: int(item["index"]))
    return jobs


def _config_from_meta(meta: dict[str, Any], output_dir: Path) -> dict[str, Any] | None:
    tests_payload = []
    for item in meta.get("tests", []):
        if not isinstance(item, dict):
            continue
        name = _coerce_optional_str(item.get("name"))
        count = _try_int(item.get("count"))
        if name is None or count is None or count < 1:
            continue
        tests_payload.append({"name": name, "count": count})

    seed = _try_int(meta.get("seed"))
    jobs = _try_int(meta.get("jobs_requested"))
    timeout_sec = _try_int(meta.get("timeout_sec"))
    max_failures = _try_int(meta.get("max_failures"))
    verbosity = _coerce_optional_str(meta.get("verbosity"))
    stages = meta.get("stages")
    if isinstance(stages, str):
        stages_payload: str | list[str] = stages
    elif isinstance(stages, list):
        stages_payload = [str(item) for item in stages if str(item).strip()]
    else:
        stages_payload = ["run"]

    has_explicit_config = any(
        [
            bool(tests_payload),
            seed is not None,
            jobs is not None,
            verbosity is not None,
            "stages" in meta,
            "waves" in meta,
            timeout_sec is not None,
            "fail_fast" in meta,
            max_failures is not None,
        ]
    )
    if not has_explicit_config:
        return None

    payload = {
        "tests": tests_payload,
        "seed": seed,
        "jobs": jobs,
        "stages": stages_payload,
        "output_dir": str(output_dir),
        "verbosity": verbosity,
        "waves": bool(meta.get("waves", False)),
        "timeout_sec": timeout_sec,
        "fail_fast": bool(meta.get("fail_fast", False)),
        "max_failures": max_failures,
    }
    compact = {
        key: value for key, value in payload.items() if value not in (None, [], "")
    }
    return compact or None


def _summary_from_jobs(jobs: list[dict[str, Any]]) -> dict[str, Any]:
    running_jobs = []
    passed = 0
    failed = 0
    not_run = 0
    timed_out = 0
    latest_update = None

    for item in jobs:
        status = str(item.get("status", "not_run"))
        if status == "passed":
            passed += 1
        elif status == "failed":
            failed += 1
            if bool(item.get("timed_out")) or item.get("status_reason") == "timeout":
                timed_out += 1
        elif status == "running":
            running_jobs.append(
                {
                    "index": item["index"],
                    "test_name": item.get("test_name"),
                    "seed": item["seed"],
                    "elapsed_seconds": item.get("duration_seconds", 0.0),
                }
            )
        else:
            not_run += 1

        updated_at = item.get("updated_at")
        if isinstance(updated_at, str) and updated_at:
            latest_update = (
                max(latest_update, updated_at) if latest_update else updated_at
            )

    total = len(jobs)
    if total == 0:
        status = "idle"
        status_reason = "idle"
    elif running_jobs:
        status = "running"
        status_reason = "running"
    elif not_run > 0:
        status = "interrupted"
        status_reason = "interrupted"
    else:
        status = "complete"
        status_reason = "complete"

    return {
        "status": status,
        "status_reason": status_reason,
        "running_jobs": running_jobs,
        "summary": {
            "total": total,
            "scheduled": total,
            "skipped_resume": 0,
            "passed": passed,
            "failed": failed,
            "not_run": not_run,
            "timed_out": timed_out,
            "running": len(running_jobs),
        },
        "updated_at": latest_update,
    }


def _snapshot_from_state(
    output_dir: Path, state_data: dict[str, Any]
) -> dict[str, Any]:
    meta = (
        state_data.get("meta", {}) if isinstance(state_data.get("meta"), dict) else {}
    )
    jobs = _collect_jobs_from_state(state_data)
    fallback = _summary_from_jobs(jobs)

    running_jobs = meta.get("running_jobs")
    if not isinstance(running_jobs, list):
        running_jobs = fallback["running_jobs"]

    return {
        "revision": _int_or_default(
            state_data.get("revision"), _int_or_default(meta.get("revision"), 0)
        ),
        "output_dir": str(output_dir),
        "created_at": state_data.get("created_at"),
        "updated_at": meta.get("updated_at")
        or state_data.get("updated_at")
        or fallback["updated_at"],
        "status": meta.get("status") or fallback["status"],
        "status_reason": meta.get("status_reason") or fallback["status_reason"],
        "running_jobs": running_jobs,
        "summary": {
            "total": _int_or_default(meta.get("total"), fallback["summary"]["total"]),
            "scheduled": _int_or_default(
                meta.get("scheduled"), fallback["summary"]["scheduled"]
            ),
            "skipped_resume": _int_or_default(
                meta.get("skipped_resume"), fallback["summary"]["skipped_resume"]
            ),
            "passed": _int_or_default(
                meta.get("passed"), fallback["summary"]["passed"]
            ),
            "failed": _int_or_default(
                meta.get("failed"), fallback["summary"]["failed"]
            ),
            "not_run": _int_or_default(
                meta.get("not_run"), fallback["summary"]["not_run"]
            ),
            "timed_out": _int_or_default(
                meta.get("timed_out"), fallback["summary"]["timed_out"]
            ),
            "running": _int_or_default(
                meta.get("running"), fallback["summary"]["running"]
            ),
        },
        "config": _config_from_meta(meta, output_dir),
        "jobs": jobs,
    }


def _regressions_root() -> Path:
    return repo_root() / "runs" / "regressions"


def _resolve_output_dir_reference(value: str) -> Path:
    raw = value.strip()
    if raw == "latest":
        return _resolve_resume_path(raw)
    return Path(raw).expanduser().resolve()


def _state_data_for_output_dir(output_dir: Path) -> dict[str, Any]:
    state_data = _safe_read_state(output_dir / STATE_FILE)
    if not isinstance(state_data, dict):
        raise FileNotFoundError("output_dir does not contain regression state")
    return state_data


def _job_log_text(output_dir: Path, index: int) -> str:
    state_data = _state_data_for_output_dir(output_dir)
    raw_jobs = state_data.get("jobs", {})
    if isinstance(raw_jobs, dict):
        job_items = raw_jobs.values()
    elif isinstance(raw_jobs, list):
        job_items = raw_jobs
    else:
        job_items = []

    matching = []
    for item in job_items:
        if not isinstance(item, dict):
            continue
        item_index = _try_int(item.get("index"))
        if item_index == index:
            matching.append(item)
    if not matching:
        raise KeyError(f"no job with index {index}")

    log_path = matching[0].get("log_path")
    if not isinstance(log_path, str):
        raise FileNotFoundError("log not available")
    try:
        return Path(log_path).read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        raise FileNotFoundError("log not readable") from exc


def _list_regression_runs(limit: int | None = None) -> list[dict[str, Any]]:
    root = _regressions_root()
    if not root.is_dir():
        return []

    try:
        candidates = list(root.iterdir())
    except OSError:
        return []

    runs = []
    for item in candidates:
        if item.name == "latest" or not item.is_dir():
            continue
        state_path = item / STATE_FILE
        try:
            state_data = _safe_read_state(state_path)
            if not isinstance(state_data, dict):
                continue
            snapshot = _snapshot_from_state(item, state_data)
            runs.append(
                {
                    "name": item.name,
                    "output_dir": snapshot["output_dir"],
                    "created_at": snapshot["created_at"],
                    "updated_at": snapshot["updated_at"],
                    "status": snapshot["status"],
                    "status_reason": snapshot["status_reason"],
                    "summary": snapshot["summary"],
                    "config": snapshot["config"],
                }
            )
        except Exception:  # pragma: no cover - defensive path
            continue

    runs.sort(
        key=lambda item: ((item.get("updated_at") or ""), item["name"]),
        reverse=True,
    )
    return runs[:limit] if limit is not None else runs


def _collect_test_suite_names() -> list[str]:
    try:
        from tibbar import get_suite_names
    except Exception:
        return []
    names = get_suite_names()
    if not isinstance(names, (list, tuple)):
        return []
    suites = [str(name).strip() for name in names]
    return sorted({name for name in suites if name})


def _planned_jobs_payload(config: RegressionConfig | None) -> list[dict[str, Any]]:
    if config is None:
        return []
    return [
        {
            "index": job.index,
            "test_name": job.test_name,
            "seed": job.seed,
        }
        for job in expand_regression_jobs(config.tests, config.seed)
    ]


def _safe_read_state(state_path: Path) -> dict[str, Any] | None:
    if not state_path.exists():
        return None
    try:
        return json.loads(state_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _session_state() -> dict[str, Any]:
    with session_lock:
        if current_session is None:
            return {
                "mode": "idle",
                "revision": 0,
                "status": "idle",
                "status_reason": "idle",
                "jobs": [],
                "running_jobs": [],
            }
        session = current_session

    state_data = _safe_read_state(session.state_path) or {
        "meta": {},
        "jobs": {},
    }
    snapshot = _snapshot_from_state(session.output_dir, state_data)
    meta = (
        state_data.get("meta", {}) if isinstance(state_data.get("meta"), dict) else {}
    )
    jobs = snapshot["jobs"]

    cfg_payload = (
        regression_file_payload(session.config)["regression"]
        if session.config is not None
        else snapshot["config"]
    )
    planned_jobs_config = session.config
    if planned_jobs_config is None and cfg_payload is not None:
        try:
            planned_jobs_config, _ = build_config_from_payload(cfg_payload)
        except (ConfigError, ValueError, OSError):
            planned_jobs_config = None

    if session.mode == "active" and session.controller is not None:
        is_paused = session.controller.is_paused
        is_cancelled = session.controller.is_cancelled
    else:
        is_paused = bool(meta.get("is_paused", False))
        is_cancelled = bool(meta.get("is_cancelled", False))

    thread_running = session.thread is not None and session.thread.is_alive()
    controls = {
        "can_pause": session.mode == "active" and thread_running,
        "can_resume": session.mode == "active" and thread_running,
        "can_cancel": session.mode == "active" and thread_running,
        "can_set_parallelism": session.mode == "active" and thread_running,
        "can_rerun_failed": session.mode == "active"
        and len([item for item in jobs if item.get("status") == "failed"]) > 0,
        "is_paused": is_paused,
        "is_cancelled": is_cancelled,
    }

    planned_jobs = session.planned_jobs_cache
    if planned_jobs is None:
        planned_jobs = _planned_jobs_payload(planned_jobs_config)
        with session_lock:
            if current_session is session:
                session.planned_jobs_cache = planned_jobs

    return {
        "mode": session.mode,
        "revision": snapshot.get("revision", 0),
        "status": snapshot["status"],
        "status_reason": snapshot["status_reason"],
        "output_dir": str(session.output_dir),
        "started_at": session.started_at,
        "created_at": snapshot["created_at"],
        "updated_at": snapshot["updated_at"],
        "jobs": jobs,
        "running_jobs": snapshot["running_jobs"],
        "summary": snapshot["summary"],
        "config": cfg_payload,
        "planned_jobs": planned_jobs,
        "controls": controls,
        "last_error": session.last_error,
    }


def _extract_failed_jobs(state: dict[str, Any]) -> list[tuple[str, int, int]]:
    raw_jobs = state.get("jobs", {})
    if isinstance(raw_jobs, dict):
        job_items = raw_jobs.values()
    elif isinstance(raw_jobs, list):
        job_items = raw_jobs
    else:
        job_items = []

    failed_jobs: list[tuple[str, int, int]] = []
    for item in job_items:
        if not isinstance(item, dict):
            continue
        if item.get("status") != "failed":
            continue
        try:
            index = int(item.get("index"))
            seed = int(item.get("seed"))
        except (TypeError, ValueError):
            continue
        test_name = item.get("test_name")
        if isinstance(test_name, str) and test_name:
            failed_jobs.append((test_name, seed, index))
    failed_jobs.sort(key=lambda value: value[2])
    return failed_jobs


def _start_run(
    config: RegressionConfig,
    *,
    jobs_override: list[RegressionJob] | None = None,
) -> None:
    global current_session
    with session_lock:
        active = current_session
        if (
            active is not None
            and active.thread is not None
            and active.thread.is_alive()
        ):
            raise RuntimeError("A regression run is already active")

    output_dir = (
        config.output_dir
        if config.output_dir is not None
        else make_default_regression_output()
    )
    output_dir = output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    state_path = output_dir / STATE_FILE
    control = RegressionRunController(parallelism=config.jobs)
    run_id = f"run-{int(time.time())}"
    session = AppSession(
        run_id=run_id,
        mode="active",
        output_dir=output_dir,
        state_path=state_path,
        config=config,
        controller=control,
        started_at=time.time(),
    )
    run_session = replace(session, config=config, controller=control)

    def runner_thread() -> None:
        session_console = Console(
            file=io.StringIO(),
            force_terminal=False,
            color_system=None,
        )
        try:
            run_regression(
                config,
                console=session_console,
                control=control,
                jobs_override=jobs_override,
            )
            with session_lock:
                run_session.last_error = None
        except Exception as exc:  # pragma: no cover - defensive path
            with session_lock:
                run_session.last_error = str(exc)

    thread = threading.Thread(target=runner_thread, name=run_id, daemon=True)
    run_session.thread = thread
    thread.start()
    with session_lock:
        current_session = run_session


def _require_active_session() -> AppSession:
    with session_lock:
        if current_session is None or current_session.mode != "active":
            raise RuntimeError("No active regression run")
        return current_session


def _load_json_body(body: bytes) -> dict[str, Any]:
    if not body:
        return {}
    try:
        payload = json.loads(body.decode("utf-8"))
        if isinstance(payload, dict):
            return payload
        raise ValueError("request body must be an object")
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("malformed JSON payload") from exc


def _write_json(self: BaseHTTPRequestHandler, status: int, payload: Any) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.send_header("Cache-Control", "no-store")
    self.end_headers()
    self.wfile.write(body)


def _write_text(
    self: BaseHTTPRequestHandler,
    status: int,
    text: str,
    content_type: str = "text/plain",
) -> None:
    body = text.encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", f"{content_type}; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)


def _write_error(self: BaseHTTPRequestHandler, status: int, message: str) -> None:
    _write_json(self, status, {"error": message})


def _content_type_for_path(path: Path) -> str:
    suffix = path.suffix.lower()
    return {
        ".html": "text/html",
        ".js": "application/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".png": "image/png",
        ".svg": "image/svg+xml",
    }.get(suffix, "application/octet-stream")


class _RequestHandler(BaseHTTPRequestHandler):
    server_version = "rheon-regression-app/0.1"

    def log_message(self, format: str, *args: object) -> None:
        return

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/"):
            self._handle_api_get(parsed)
            return
        self._handle_static_get(parsed.path)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            self._write_404()
            return
        self._handle_api_post(parsed.path, parsed)

    def _write_404(self) -> None:
        _write_text(self, 404, "not found", content_type="text/plain")

    def _handle_static_get(self, path: str) -> None:
        if path in {"", "/"}:
            candidate = APP_ASSETS / "index.html"
        else:
            if path.startswith("/"):
                path = path[1:]
            candidate = APP_ASSETS / path
        try:
            candidate = candidate.resolve()
            if not str(candidate).startswith(str(APP_ASSETS.resolve())):
                self._write_404()
                return
            data = candidate.read_bytes()
        except OSError:
            self._write_404()
            return

        self.send_response(200)
        self.send_header(
            "Content-Type", f"{_content_type_for_path(candidate)}; charset=utf-8"
        )
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _handle_api_get(self, parsed) -> None:
        if parsed.path == "/api/state":
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if parsed.path == "/api/runs":
            query = parse_qs(parsed.query)
            limit = None
            if "limit" in query:
                try:
                    limit = _coerce_int(query["limit"][0], field="limit", min_value=1)
                except (ConfigError, ValueError, TypeError) as exc:
                    _write_error(self, 400, str(exc))
                    return
            _write_json(
                self, 200, {"ok": True, "data": {"runs": _list_regression_runs(limit)}}
            )
            return

        if parsed.path == "/api/run-info":
            query = parse_qs(parsed.query)
            if "output_dir" not in query:
                _write_error(self, 400, "output_dir is required")
                return
            try:
                output_dir = _resolve_output_dir_reference(query["output_dir"][0])
            except (ConfigError, OSError, ValueError) as exc:
                _write_error(self, 400, str(exc))
                return
            state_data = _safe_read_state(output_dir / STATE_FILE)
            if not isinstance(state_data, dict):
                _write_error(self, 404, "output_dir does not contain regression state")
                return
            _write_json(
                self,
                200,
                {"ok": True, "data": _snapshot_from_state(output_dir, state_data)},
            )
            return

        if parsed.path == "/api/test-suites":
            _write_json(
                self,
                200,
                {"ok": True, "data": {"test_suites": _collect_test_suite_names()}},
            )
            return

        if parsed.path == "/api/job-log":
            query = parse_qs(parsed.query)
            if "index" not in query:
                _write_error(self, 400, "index is required")
                return

            try:
                index = int(query["index"][0])
            except (TypeError, ValueError):
                _write_error(self, 400, "index must be an integer")
                return

            try:
                if "output_dir" in query:
                    output_dir = _resolve_output_dir_reference(query["output_dir"][0])
                else:
                    state = _session_state()
                    if state.get("output_dir") is None:
                        _write_error(self, 409, "no active run")
                        return
                    output_dir = Path(str(state["output_dir"])).resolve()

                text = _job_log_text(output_dir, index)
                _write_text(self, 200, text, content_type="text/plain")
            except KeyError as exc:
                _write_error(self, 404, str(exc))
            except FileNotFoundError as exc:
                _write_error(self, 404, str(exc))
            except (ConfigError, OSError, ValueError) as exc:
                _write_error(self, 400, str(exc))
            return

        self._write_404()

    def _handle_api_post(self, path: str, parsed) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0") or 0))
        try:
            payload = _load_json_body(body)
        except ValueError as exc:
            _write_error(self, 400, str(exc))
            return

        if path == "/api/attach":
            output_dir = _coerce_optional_str(payload.get("output_dir"))
            if output_dir is None:
                _write_error(self, 400, "output_dir is required")
                return
            try:
                output_path = _resolve_output_dir_reference(output_dir)
            except (ConfigError, OSError, ValueError) as exc:
                _write_error(self, 400, str(exc))
                return
            state_path = (output_path / STATE_FILE).resolve()
            if not output_path.exists() or not output_path.is_dir():
                _write_error(self, 404, "output_dir does not exist")
                return
            if not state_path.exists():
                _write_error(self, 404, "output_dir does not contain regression state")
                return
            with session_lock:
                global current_session
                current_session = AppSession(
                    run_id=f"attach-{int(time.time())}",
                    mode="attached",
                    output_dir=output_path.resolve(),
                    state_path=state_path,
                    last_error=None,
                    started_at=time.time(),
                )
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/run":
            try:
                config, _ = build_config_from_payload(payload)
            except (ConfigError, ValueError, OSError) as exc:
                _write_error(self, 400, str(exc))
                return
            try:
                _start_run(config)
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/pause":
            try:
                session = _require_active_session()
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            if session.controller is not None:
                session.controller.pause()
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/resume":
            try:
                session = _require_active_session()
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            if session.controller is not None:
                session.controller.resume()
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/cancel":
            try:
                session = _require_active_session()
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            if session.controller is not None:
                session.controller.cancel()
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/set-parallelism":
            try:
                session = _require_active_session()
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            try:
                parallelism = _coerce_int(
                    payload.get("parallelism"), field="parallelism", min_value=1
                )
            except (ConfigError, ValueError, TypeError) as exc:
                _write_error(self, 400, str(exc))
                return
            if session.controller is None:
                _write_error(self, 409, "run not controlled")
                return
            session.controller.set_parallelism(parallelism)
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/rerun-failed":
            try:
                session = _require_active_session()
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            if session.config is None:
                _write_error(self, 409, "no config available")
                return
            state_data = _safe_read_state(session.state_path)
            if not isinstance(state_data, dict):
                _write_error(self, 409, "run state unavailable")
                return
            failed_jobs = _extract_failed_jobs(state_data)
            if not failed_jobs:
                _write_error(self, 409, "no failed jobs to rerun")
                return
            rerun_jobs = []
            for test_name, seed, index in failed_jobs:
                rerun_jobs.append(
                    RegressionJob(index=index, test_name=test_name, seed=seed)
                )
            rerun_config = replace(
                session.config,
                output_dir=None,
                resume=None,
            )
            try:
                _start_run(rerun_config, jobs_override=rerun_jobs)
            except RuntimeError as exc:
                _write_error(self, 409, str(exc))
                return
            _write_json(self, 200, {"ok": True, "data": _session_state()})
            return

        if path == "/api/import":
            yaml_text = payload.get("yaml")
            if not isinstance(yaml_text, str):
                _write_error(self, 400, "yaml field is required")
                return
            try:
                config = build_config_from_yaml(yaml_text)
            except (ConfigError, ValueError, OSError) as exc:
                _write_error(self, 400, str(exc))
                return
            _write_json(
                self,
                200,
                {"ok": True, "data": regression_file_payload(config)["regression"]},
            )
            return

        if path == "/api/export":
            try:
                config, _ = build_config_from_payload(payload)
            except (ConfigError, ValueError, OSError) as exc:
                _write_error(self, 400, str(exc))
                return
            _write_json(self, 200, {"ok": True, "yaml": regression_yaml_text(config)})
            return

        self._write_404()


def _make_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Start the rheon regression app.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument(
        "--attach", default=None, help="Attach to existing regression output dir"
    )
    return parser


def build_run_server(*, host: str, port: int, attach: str | None = None) -> None:
    if attach is not None:
        output_path = Path(attach).expanduser().resolve()
        state_path = output_path / STATE_FILE
        if not output_path.is_dir() or not state_path.exists():
            raise RuntimeError("attach target does not contain regression_state.json")
        with session_lock:
            global current_session
            current_session = AppSession(
                run_id=f"attach-{int(time.time())}",
                mode="attached",
                output_dir=output_path,
                state_path=state_path,
                started_at=time.time(),
            )

    server = ThreadingHTTPServer((host, port), _RequestHandler)
    print(f"rheon_regr_app running at http://{host}:{port}")
    server.serve_forever()


def main(argv: list[str] | None = None) -> int:
    args = _make_parser().parse_args(argv)
    try:
        build_run_server(host=args.host, port=args.port, attach=args.attach)
    except OSError as exc:
        print(f"Could not start server: {exc}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
