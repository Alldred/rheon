# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Verbosity (RHEON_VERBOSITY) and logging configuration for the testbench.

from __future__ import annotations

import logging
import os

# Valid RHEON_VERBOSITY values (logging level names), case insensitive.
_LEVEL_NAMES = frozenset({"debug", "info", "warning", "error", "critical"})

# Third-party loggers we suppress to WARNING so they don't flood when user sets verbosity=debug.
_SUPPRESSED_LOGGERS = (
    "pykwalify",
    "pykwalify.core",
)


def get_verbosity() -> str:
    """Return RHEON_VERBOSITY from environment as a normalized logging level name (lowercase).
    Invalid or unset yields 'warning'."""
    raw = os.environ.get("RHEON_VERBOSITY", "warning").strip().lower()
    return raw if raw in _LEVEL_NAMES else "warning"


def logging_level_from_verbosity(verbosity: str | None = None) -> int:
    """Return logging module level constant for the given verbosity string (e.g. 'debug' -> logging.DEBUG)."""
    v = (verbosity or get_verbosity()).lower()
    return getattr(logging, v.upper(), logging.WARNING)


def configure_logging_from_env(logger_name: str | None = None) -> None:
    """Set logging level from RHEON_VERBOSITY. Call early (e.g. from test_elf).
    Third-party loggers (e.g. pykwalify, eumos) are set to WARNING so only our debug shows."""
    level = logging_level_from_verbosity()
    scoreboard_level = min(level, logging.INFO)
    # Forastero uses "tb" as the log hierarchy root (tb, tb.scoreboard, ...).
    # Its default parameter file sets tb to INFO, so override that here.
    tb_root = logging.getLogger("tb")
    tb_root.setLevel(level)
    for handler in tb_root.handlers:
        # Keep global verbosity behavior while still allowing scoreboard INFO mismatch tables.
        handler.setLevel(min(level, logging.INFO))
    tb_scoreboard = logging.getLogger("tb.scoreboard")
    tb_scoreboard.setLevel(scoreboard_level)
    for handler in tb_scoreboard.handlers:
        handler.setLevel(scoreboard_level)
    if logger_name:
        logging.getLogger(logger_name).setLevel(level)
    for name in _SUPPRESSED_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
