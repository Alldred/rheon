<!--
  ~ SPDX-License-Identifier: MIT
  ~ Copyright (c) 2026 Stuart Alldred.
  -->

<!--
  SPDX-License-Identifier: MIT
  Copyright (c) 2026 Stuart Alldred.
  -->

# Testing

## Recommended Daily Flow

Start in the project shell:

```bash
./bin/shell --dev
```

Then run:

```bash
pytest -q
```

First end-to-end test:

```bash
rheon_run --test simple --seed 1
```

## Core Simulation

Run with default flow (generate then simulate with Tibbar):

```bash
rheon_run --test simple --seed 1
```

Run simulation only with an explicit ELF:

```bash
rheon_sim --test path/to/program.elf --seed 1 --waves
rheon_sim --test path/to/program.elf --seed 1 --coverage
```

## Useful Flags

- `--seed`: reproducible generation/simulation.
- `--waves`: dump waveforms.
- `--coverage`: export Bucket functional coverage archive (`coverage.bktgz`) in the run directory.

---

Prev: [Getting Started (Full Walkthrough)](getting_started.md)
Next: [Electron App](electron_app.md)
