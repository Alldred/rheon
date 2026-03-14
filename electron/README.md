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

## Build the app

From the repo root:

```bash
./bin/build_electron.sh
```

On macOS this creates:

- portable bundle under `build/rheon_regr_app/`
- app bundle: `build/rheon_regr_app/Rheon Regr.app`

Rebuild after running `uv sync` or if the repo moves.
