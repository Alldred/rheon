# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.
# Regenerate rheon_pkg.sv from Packtype spec.
# From repo root: make -C rheon_core pkg
# From rheon_core: make pkg (requires uv at repo root)

pkg:
	cd .. && uv run python -m packtype rheon_core/spec/rheon_pkg_spec.py code package sv rheon_core

.PHONY: pkg
