#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

import importlib.util
import json
import sys
import types
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
    assert config.inject_fail_message_groups is None
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


def test_snapshot_from_state_falls_back_when_meta_is_missing(tmp_path: Path) -> None:
    output_dir = tmp_path / "20260307_120000"
    output_dir.mkdir()
    state = {
        "revision": 7,
        "created_at": "2026-03-07T12:00:00+00:00",
        "updated_at": "2026-03-07T12:03:00+00:00",
        "jobs": {
            "simple-1": {
                "index": 1,
                "test_name": "simple",
                "seed": 1,
                "status": "passed",
                "status_reason": "passed",
                "duration_seconds": 1.2,
                "updated_at": "2026-03-07T12:01:00+00:00",
            },
            "simple-2": {
                "index": 2,
                "test_name": "simple",
                "seed": 2,
                "status": "failed",
                "status_reason": "timeout",
                "timed_out": True,
                "duration_seconds": 3.4,
                "updated_at": "2026-03-07T12:03:00+00:00",
            },
        },
    }

    snapshot = APP._snapshot_from_state(output_dir, state)  # noqa: SLF001

    assert snapshot["status"] == "complete"
    assert snapshot["status_reason"] == "complete"
    assert snapshot["revision"] == 7
    assert snapshot["summary"]["total"] == 2
    assert snapshot["summary"]["passed"] == 1
    assert snapshot["summary"]["failed"] == 1
    assert snapshot["summary"]["timed_out"] == 1
    assert snapshot["updated_at"] == "2026-03-07T12:03:00+00:00"
    assert snapshot["config"] is None
    assert snapshot["jobs"][0]["updated_at"] == "2026-03-07T12:01:00+00:00"


def test_session_state_uses_meta_config_for_attached_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    output_dir = tmp_path / "20260307_130000"
    output_dir.mkdir()
    state_path = output_dir / APP.STATE_FILE
    state_path.write_text(
        json.dumps(
            {
                "created_at": "2026-03-07T13:00:00+00:00",
                "updated_at": "2026-03-07T13:01:00+00:00",
                "revision": 3,
                "meta": {
                    "revision": 3,
                    "status": "complete",
                    "status_reason": "complete",
                    "total": 4,
                    "scheduled": 4,
                    "skipped_resume": 0,
                    "passed": 4,
                    "failed": 0,
                    "not_run": 0,
                    "timed_out": 0,
                    "running": 0,
                    "tests": [{"name": "simple", "count": 4}],
                    "seed": 42,
                    "jobs_requested": 2,
                    "stages": ["run"],
                    "waves": True,
                    "timeout_sec": 30,
                    "fail_fast": False,
                    "max_failures": 1,
                },
                "jobs": {},
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(
        APP,
        "current_session",
        APP.AppSession(
            run_id="attach-1",
            mode="attached",
            output_dir=output_dir,
            state_path=state_path,
            started_at=0.0,
        ),
    )

    session_state = APP._session_state()  # noqa: SLF001

    assert session_state["revision"] == 3
    assert session_state["config"]["seed"] == 42
    assert session_state["config"]["jobs"] == 2
    assert session_state["config"]["waves"] is True
    assert session_state["config"]["tests"] == [{"name": "simple", "count": 4}]
    assert session_state["summary"]["passed"] == 4
    assert len(session_state["planned_jobs"]) == 4
    assert session_state["planned_jobs"][0]["test_name"] == "simple"


def test_snapshot_from_state_preserves_running_job_started_at(tmp_path: Path) -> None:
    output_dir = tmp_path / "20260307_133000"
    output_dir.mkdir()
    snapshot = APP._snapshot_from_state(  # noqa: SLF001
        output_dir,
        {
            "revision": 11,
            "created_at": "2026-03-07T13:30:00+00:00",
            "meta": {
                "revision": 11,
                "status": "running",
                "status_reason": "running",
                "running_jobs": [
                    {
                        "index": 2,
                        "test_name": "simple",
                        "seed": 77,
                        "elapsed_seconds": 5.5,
                        "started_at": "2026-03-07T13:30:05+00:00",
                    }
                ],
            },
            "jobs": {},
        },
    )

    assert snapshot["revision"] == 11
    assert snapshot["running_jobs"][0]["started_at"] == "2026-03-07T13:30:05+00:00"


def test_list_regression_runs_returns_recent_snapshots(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    runs_root = tmp_path / "runs" / "regressions"
    first = runs_root / "20260307_140000"
    second = runs_root / "20260307_150000"
    first.mkdir(parents=True)
    second.mkdir(parents=True)

    (first / APP.STATE_FILE).write_text(
        json.dumps(
            {
                "updated_at": "2026-03-07T14:01:00+00:00",
                "meta": {
                    "status": "complete",
                    "status_reason": "complete",
                    "total": 1,
                    "passed": 1,
                    "failed": 0,
                    "not_run": 0,
                    "timed_out": 0,
                    "running": 0,
                },
                "jobs": {},
            }
        ),
        encoding="utf-8",
    )
    (second / APP.STATE_FILE).write_text(
        json.dumps(
            {
                "updated_at": "2026-03-07T15:01:00+00:00",
                "jobs": {
                    "simple-1": {
                        "index": 1,
                        "test_name": "simple",
                        "seed": 7,
                        "status": "failed",
                        "status_reason": "failed",
                    }
                },
            }
        ),
        encoding="utf-8",
    )

    monkeypatch.setattr(APP, "repo_root", lambda: tmp_path)

    runs = APP._list_regression_runs()  # noqa: SLF001

    assert [item["name"] for item in runs] == ["20260307_150000", "20260307_140000"]
    assert runs[0]["summary"]["failed"] == 1
    assert runs[1]["summary"]["passed"] == 1


def test_job_log_text_reads_log_from_specific_output_dir(tmp_path: Path) -> None:
    output_dir = tmp_path / "20260307_160000"
    output_dir.mkdir()
    log_path = output_dir / "job.log"
    log_path.write_text("hello from sim\n", encoding="utf-8")
    (output_dir / APP.STATE_FILE).write_text(
        json.dumps(
            {
                "jobs": {
                    "simple-1": {
                        "index": 1,
                        "test_name": "simple",
                        "seed": 99,
                        "log_path": str(log_path),
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    assert APP._job_log_text(output_dir, 1) == "hello from sim\n"  # noqa: SLF001

    with pytest.raises(KeyError):
        APP._job_log_text(output_dir, 2)  # noqa: SLF001


def test_collect_test_suite_names_reads_from_tibbar_module(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_tibbar = types.ModuleType("tibbar")
    fake_tibbar.__path__ = []  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "tibbar", fake_tibbar)
    monkeypatch.setitem(
        fake_tibbar.__dict__,
        "get_suite_names",
        lambda: ("simple", "ldst", "simple", "  "),
    )
    assert APP._collect_test_suite_names() == ["ldst", "simple"]  # noqa: SLF001
