<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Known Limitations

## Experimental Status

Rheon is currently functional primarily as a Tibbar test vehicle.

## Core/RTL Caveats

- The RTL was developed quickly (vibe-coded), not hardened.
- Expect behavioral gaps outside the tested flows.
- Compatibility with broader RISC-V software stacks is not guaranteed.

## Test Coverage Caveats

- Existing tests strongly reflect current tool flow goals.
- Passing regressions does not imply production-grade CPU correctness.

## Practical Guidance

- Prefer `simple` and known-good generators first.
- Treat failures as expected during exploration.
- Expand tests incrementally before claiming broader support.

---

Prev: [Electron App](electron_app.md)
Next: [GitHub Pages](github_pages.md)
