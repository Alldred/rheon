#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

from __future__ import annotations

import importlib.util
import sys
from importlib.machinery import SourceFileLoader
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[1]
BIN_APP = REPO_ROOT / "bin" / "rheon_regr_app"

BIN_LOADER = SourceFileLoader("rheon_regr_app_cli", str(BIN_APP))
BIN_SPEC = importlib.util.spec_from_loader(BIN_LOADER.name, BIN_LOADER)
assert BIN_SPEC is not None and BIN_SPEC.loader is not None
APP_CLI = importlib.util.module_from_spec(BIN_SPEC)
sys.modules[BIN_SPEC.name] = APP_CLI
BIN_SPEC.loader.exec_module(APP_CLI)


def test_build_runtime_commands_prefers_repo_venv(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script_path = tmp_path / "bin" / "rheon_regr_app"
    repo_python = tmp_path / ".venv" / "bin" / "python"
    script_path.parent.mkdir(parents=True)
    repo_python.parent.mkdir(parents=True)
    script_path.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
    repo_python.write_text("", encoding="utf-8")

    monkeypatch.setattr(APP_CLI, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(APP_CLI, "SCRIPT_PATH", script_path)
    monkeypatch.setattr(APP_CLI.sys, "executable", "/usr/bin/python3")
    monkeypatch.setattr(
        APP_CLI.shutil,
        "which",
        lambda value: "/usr/local/bin/uv" if value == "uv" else None,
    )
    monkeypatch.delenv(APP_CLI.BOOTSTRAP_ENV, raising=False)

    commands = APP_CLI._build_runtime_commands(["--port", "9999"])  # noqa: SLF001

    assert commands[0].argv == [str(repo_python), str(script_path), "--port", "9999"]
    assert commands[0].cwd is None
    assert commands[1].argv == [
        "/usr/local/bin/uv",
        "run",
        "bin/rheon_regr_app",
        "--port",
        "9999",
    ]
    assert commands[1].cwd == tmp_path


def test_build_runtime_commands_skips_repo_venv_when_already_active(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    script_path = tmp_path / "bin" / "rheon_regr_app"
    repo_python = tmp_path / ".venv" / "bin" / "python"
    script_path.parent.mkdir(parents=True)
    repo_python.parent.mkdir(parents=True)
    script_path.write_text("#!/usr/bin/env python3\n", encoding="utf-8")
    repo_python.write_text("", encoding="utf-8")

    monkeypatch.setattr(APP_CLI, "ROOT_DIR", tmp_path)
    monkeypatch.setattr(APP_CLI, "SCRIPT_PATH", script_path)
    monkeypatch.setattr(APP_CLI.sys, "executable", str(repo_python))
    monkeypatch.setattr(APP_CLI.shutil, "which", lambda value: None)
    monkeypatch.delenv(APP_CLI.BOOTSTRAP_ENV, raising=False)

    commands = APP_CLI._build_runtime_commands(["--host", "127.0.0.1"])  # noqa: SLF001

    assert commands == []


def test_build_runtime_commands_honours_bootstrap_guard(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(APP_CLI.BOOTSTRAP_ENV, "1")
    assert APP_CLI._build_runtime_commands([]) == []  # noqa: SLF001


def test_reexec_with_supported_runtime_sets_guard_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    def fake_execvpe(file: str, argv: list[str], env: dict[str, str]) -> None:
        captured["file"] = file
        captured["argv"] = argv
        captured["env"] = env
        raise SystemExit(0)

    command = APP_CLI.RuntimeCommand(["/tmp/fake-python", "/tmp/fake-script"])  # noqa: SLF001
    monkeypatch.setattr(APP_CLI, "_build_runtime_commands", lambda argv: [command])
    monkeypatch.setattr(APP_CLI.os, "execvpe", fake_execvpe)

    with pytest.raises(SystemExit):
        APP_CLI._reexec_with_supported_runtime(["--port", "9000"])  # noqa: SLF001

    assert captured["file"] == "/tmp/fake-python"
    assert captured["argv"] == ["/tmp/fake-python", "/tmp/fake-script"]
    assert isinstance(captured["env"], dict)
    assert captured["env"][APP_CLI.BOOTSTRAP_ENV] == "1"
