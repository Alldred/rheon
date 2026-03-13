/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

interface NumberStepperInputProps {
  ariaLabel: string;
  value: string | number;
  onChange: (value: string) => void;
  min?: number;
  className?: string;
}

function normalizeNonNegative(value: string | number, min: number): number {
  const parsed = Number.parseInt(String(value ?? "0"), 10);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.max(min, parsed);
}

export function NumberStepperInput({
  ariaLabel,
  value,
  onChange,
  min = 0,
  className = "",
}: NumberStepperInputProps) {
  const safeValue = normalizeNonNegative(value, min);

  const setValue = (next: number) => {
    onChange(String(Math.max(min, next)));
  };

  return (
    <div className={`number-stepper ${className}`.trim()}>
      <input
        aria-label={ariaLabel}
        inputMode="numeric"
        value={String(safeValue)}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (!raw) {
            setValue(min);
            return;
          }
          setValue(Number.parseInt(raw, 10));
        }}
      />
      <div className="number-stepper__controls">
        <button
          type="button"
          className="number-stepper__btn"
          aria-label={`Increase ${ariaLabel}`}
          title="Increase"
          onClick={() => setValue(safeValue + 1)}
        >
          ▲
        </button>
        <button
          type="button"
          className="number-stepper__btn"
          aria-label={`Decrease ${ariaLabel}`}
          title="Decrease"
          onClick={() => setValue(safeValue - 1)}
          disabled={safeValue <= min}
        >
          ▼
        </button>
      </div>
    </div>
  );
}
