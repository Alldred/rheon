<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Rheon Electron App

Electron desktop shell for the Rheon regression app.

It launches the existing Python regression server from the current Rheon checkout,
waits for it to become ready, and loads the UI in a native desktop window.

## Prerequisites

- Node.js and npm
- `uv sync` run in the repo root so the Rheon Python dependencies are available

## Development

```bash
cd electron
npm install
npm start
```

To open directly on an existing regression output directory:

```bash
npm start -- --attach ../runs/regressions/20260306_203035
```

## Build

The packaged app is a launcher for the current Rheon checkout, similar to the
existing macOS shell app. Build it from the repo you want it to target.

```bash
./build.sh
```

That writes `source_root.txt` during packaging so the app knows which checkout
to launch against. If the repo moves, rebuild the app.
