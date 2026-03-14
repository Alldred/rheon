#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Stuart Alldred.

# SPDX-License-Identifier: MIT
# Normalize docs footer links (Prev/Next) based on docs/index.md ordering.

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCS_DIR = REPO_ROOT / "docs"
INDEX_FILE = DOCS_DIR / "index.md"

INDEX_LINK_RE = re.compile(r"^\s*\d+\.\s+\[[^\]]+\]\(([^)]+)\)\s*$")
HEADING_RE = re.compile(r"^\s*#\s+(.+?)\s*$")


def extract_order_from_index() -> list[str]:
    order = ["index.md"]
    for raw_line in INDEX_FILE.read_text(encoding="utf-8").splitlines():
        match = INDEX_LINK_RE.match(raw_line)
        if match:
            target = match.group(1).strip()
            if target.endswith(".md"):
                order.append(target)
    return order


def read_title(path: Path) -> str:
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        match = HEADING_RE.match(raw_line)
        if match:
            return match.group(1).strip()
    return path.stem.replace("_", " ").title()


def strip_existing_footer(text: str) -> str:
    lines = text.rstrip().splitlines()
    if not lines:
        return ""

    sep_idx = None
    for i in range(len(lines) - 1, -1, -1):
        if lines[i].strip() == "---":
            trailer = lines[i + 1 :]
            if trailer and all(
                (not line.strip())
                or line.strip().startswith("Prev:")
                or line.strip().startswith("Next:")
                for line in trailer
            ):
                sep_idx = i
                break

    if sep_idx is None:
        return "\n".join(lines).rstrip()
    return "\n".join(lines[:sep_idx]).rstrip()


def render_footer(
    prev_item: tuple[str, str] | None, next_item: tuple[str, str] | None
) -> str:
    parts = ["---", ""]
    if prev_item is not None:
        parts.append(f"Prev: [{prev_item[0]}]({prev_item[1]})")
    if next_item is not None:
        parts.append(f"Next: [{next_item[0]}]({next_item[1]})")
    return "\n".join(parts)


def main() -> int:
    order = extract_order_from_index()
    titles = {name: read_title(DOCS_DIR / name) for name in order}

    for idx, name in enumerate(order):
        path = DOCS_DIR / name
        current = path.read_text(encoding="utf-8")
        body = strip_existing_footer(current)

        prev_item = None
        next_item = None
        if idx > 0:
            prev_name = order[idx - 1]
            prev_item = (titles[prev_name], prev_name)
        if idx < len(order) - 1:
            next_name = order[idx + 1]
            next_item = (titles[next_name], next_name)

        updated = f"{body}\n\n{render_footer(prev_item, next_item)}\n"
        if updated != current:
            path.write_text(updated, encoding="utf-8")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
