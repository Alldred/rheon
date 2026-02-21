# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Packtype spec: single source of truth for RTL and testbench constants/types.

import packtype
from packtype import Constant


@packtype.package()
class RheonPkg:
    """Constants and types for rheon_core RV64I pipeline (RTL + TB)."""

    # Core dimensions
    XLEN: Constant = 64
    INSTR_WIDTH: Constant = 32
    ADDR_WIDTH: Constant = 64

    # Fetch
    FETCH_LINE_WORDS: Constant = 4  # instructions per line (buffer refill)
    GPR_COUNT: Constant = 32

    # Pipeline (for TB / docs)
    PIPELINE_STAGES: Constant = 4
