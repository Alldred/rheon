<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Electron App

Rheon is documented for the Electron app workflow.

## Build

`build_electron.sh` handles Electron dependencies automatically (`npm ci` when needed).

```bash
./bin/shell --dev
./bin/build_electron.sh
```

On macOS this creates:
`build/rheon_regr_app/Rheon Regr.app`.

---

Prev: [Testing](testing.md)
Next: [Known Limitations](known_limitations.md)
