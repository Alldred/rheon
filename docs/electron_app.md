<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Electron App

Electron is an optional UI for regression monitoring. CLI status with `rheon_regr`
is also fully supported.

## Build

`build_electron.sh` handles Electron dependencies automatically (`npm ci` when needed).

```bash
./bin/shell --dev
./bin/build_electron.sh
```

On macOS this creates:
`build/rheon_regr_app/Rheon Regr.app`.

## Run

```bash
open build/rheon_regr_app/Rheon\ Regr.app
```

Open a specific regression output directly:

```bash
open build/rheon_regr_app/Rheon\ Regr.app --args --attach runs/regressions/20260306_120000
```

## Install

```bash
./bin/build_electron.sh --install
./bin/build_electron.sh --install /path/to/your/apps
```

---

Prev: [Testing](testing.md)
Next: [Known Limitations](known_limitations.md)
