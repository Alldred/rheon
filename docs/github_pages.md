<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# GitHub Pages

Rheon docs are set up for MkDocs and GitHub Pages deployment.

## Local Preview

From repo root:

```bash
uv sync --extra docs
uv run mkdocs serve
```

Open `http://127.0.0.1:8000`.

## Build Static Site

```bash
uv run mkdocs build
```

The output is in `site/`.

## GitHub Actions Deployment

Workflow file: `.github/workflows/deploy-docs.yml`

It:

1. builds docs on pushes to `main`,
2. uploads the static site artifact,
3. deploys to GitHub Pages.

## One-time Repository Settings

In GitHub repo settings:

1. Go to `Settings -> Pages`.
2. Set source to `GitHub Actions`.

After that, pushes to `main` deploy docs automatically.

---

Prev: [Known Limitations](known_limitations.md)
