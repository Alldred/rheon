/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import type { BannerState, RunDraft, RunRecord } from "../types";
import { NumberStepperInput } from "./NumberStepperInput";

type DeckTab = "run" | "monitor" | "archive";

interface QuickRunBarProps {
  activeTab: DeckTab;
  draft: RunDraft;
  runs: RunRecord[];
  busy: boolean;
  banner: BannerState | null;
  attachLatestState: "idle" | "pending" | "done";
  onChangeField: (field: keyof RunDraft, value: string | boolean) => void;
  onApplyTemplate: (outputDir: string) => void;
  onStartRun: () => void;
  onAttachLatest: () => void;
}

function testsSummary(draft: RunDraft): string {
  const planned = draft.tests.reduce((total, test) => total + Number(test.count || 0), 0);
  const names = draft.tests
    .filter((test) => test.name.trim())
    .slice(0, 3)
    .map((test) => `${test.name.trim()} x${test.count}`);
  const suffix = draft.tests.length > 3 ? ` +${draft.tests.length - 3} more` : "";
  return `${planned} planned • ${names.join(", ") || "No tests"}${suffix}`;
}

export function QuickRunBar({
  activeTab,
  draft,
  runs,
  busy,
  banner,
  attachLatestState,
  onChangeField,
  onApplyTemplate,
  onStartRun,
  onAttachLatest,
}: QuickRunBarProps) {
  const isRunTab = activeTab === "run";
  const isPassiveTab = activeTab === "monitor" || activeTab === "archive";

  return (
    <header
      className={`quick-run${isRunTab ? "" : " quick-run--compact"}${
        isPassiveTab ? " quick-run--passive" : ""
      }`}
    >
      <div className="quick-run__brand">
        <div className="quick-run__eyebrow">Rheon Regression Deck</div>
        <h1>Regression Deck</h1>
        {isRunTab ? <p>Start a run quickly or reopen the latest saved output.</p> : null}
      </div>

      {isRunTab ? (
        <div className="quick-run__controls">
          <label className="field field--compact">
            <span>Template</span>
            <select
              aria-label="Template"
              value={draft.templateSource}
              onChange={(event) => onApplyTemplate(event.target.value)}
            >
              <option value="">Blank draft</option>
              {runs
                .filter((run) => run.config)
                .slice(0, 8)
                .map((run) => (
                  <option key={run.output_dir} value={run.output_dir}>
                    {run.name}
                  </option>
                ))}
            </select>
          </label>

          <label className="field field--compact">
            <span>Seed</span>
            <NumberStepperInput
              aria-label="Seed"
              value={draft.seed}
              onChange={(value) => onChangeField("seed", value)}
            />
          </label>

          <label className="field field--compact">
            <span>Jobs</span>
            <NumberStepperInput
              aria-label="Parallel jobs"
              value={draft.jobs}
              onChange={(value) => onChangeField("jobs", value)}
            />
          </label>

          <label className="field field--compact">
            <span>Refresh</span>
            <NumberStepperInput
              aria-label="Dashboard refresh"
              value={draft.update}
              onChange={(value) => onChangeField("update", value)}
            />
          </label>

          <label className="field field--compact">
            <span>Stages</span>
            <input
              aria-label="Stages"
              value={draft.stages}
              onChange={(event) => onChangeField("stages", event.target.value)}
            />
          </label>
        </div>
      ) : null}

      {isRunTab ? (
        <div className="quick-run__actions">
          <div className="quick-run__summary" role="status" aria-live="polite">
            <span className="quick-run__summary-label">Matrix</span>
            <span className="summary-pill">{testsSummary(draft)}</span>
          </div>

          <button
            type="button"
            className="btn btn--primary"
            onClick={onStartRun}
            disabled={busy}
          >
            Start Run
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={onAttachLatest}
            disabled={busy}
          >
            {attachLatestState === "pending" ? "Attaching..." : "Attach Latest"}
          </button>
        </div>
      ) : null}

      {banner ? (
        <div className={`banner banner--${banner.tone}`} role="status">
          {banner.message}
        </div>
      ) : null}
    </header>
  );
}
