/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import type { ReactNode } from "react";
import { buildFailureClusters, formatDuration, statusTone, summaryDefaults } from "../lib/regression";
import type { DensityMode, JobRecord, SessionSnapshot } from "../types";
import { FailureClusterPanel } from "./FailureClusterPanel";
import { OperatorTableLens } from "./OperatorTableLens";

interface LiveWorkbenchProps {
  session: SessionSnapshot | undefined;
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  density: DensityMode;
  parallelismDraft: string;
  onSelectJob: (index: number) => void;
  onFocusSeed: (seed: number) => void;
  onDensityChange: (density: DensityMode) => void;
  onChangeParallelismDraft: (value: string) => void;
  onSetParallelism: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRerunFailed: () => void;
  onOpenAtlas: () => void;
  headerAction?: ReactNode;
}

function MetricCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className={`metric-card${tone ? ` metric-card--${tone}` : ""}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function LiveWorkbench({
  session,
  jobs,
  selectedJobIndex,
  density,
  parallelismDraft,
  onSelectJob,
  onFocusSeed,
  onDensityChange,
  onChangeParallelismDraft,
  onSetParallelism,
  onPause,
  onResume,
  onCancel,
  onRerunFailed,
  onOpenAtlas,
  headerAction,
}: LiveWorkbenchProps) {
  const summary = summaryDefaults(session?.summary);
  const clusters = buildFailureClusters(jobs);
  const runningNow = (session?.running_jobs || []).slice(0, 6);
  const controls = session?.controls;

  return (
    <section className="workbench">
      <section className="panel workbench-card">
        <div className="panel__header panel__header--stack-mobile">
          <div className="panel__title-row">
            {headerAction}
            <div>
            <h2>Run status</h2>
            </div>
          </div>
          <div className="toolbar toolbar--tight">
            <button type="button" className="btn btn--secondary" onClick={onOpenAtlas}>
              Open Cell Atlas Fullscreen
            </button>
            <span className={`status-dot status-dot--${statusTone(session?.status)}`}>
              {session?.status || "idle"}
            </span>
          </div>
        </div>

        <div className="metrics-strip">
          <MetricCard label="Total" value={summary.total} />
          <MetricCard label="Running" value={summary.running} tone="warn" />
          <MetricCard label="Passed" value={summary.passed} tone="good" />
          <MetricCard label="Failed" value={summary.failed} tone="bad" />
          <MetricCard label="Not run" value={summary.not_run} />
          <MetricCard label="Timed out" value={summary.timed_out} tone="muted" />
        </div>

        <div className="control-strip">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onPause}
            disabled={!controls?.can_pause}
          >
            Pause
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onResume}
            disabled={!controls?.can_resume}
          >
            Resume
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onCancel}
            disabled={!controls?.can_cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={onRerunFailed}
            disabled={!controls?.can_rerun_failed || summary.failed === 0}
          >
            Rerun Failed
          </button>
          <div className="inline-field">
            <label htmlFor="parallelismDraft">Parallelism</label>
            <input
              id="parallelismDraft"
              inputMode="numeric"
              value={parallelismDraft}
              onChange={(event) => onChangeParallelismDraft(event.target.value)}
            />
            <button
              type="button"
              className="btn btn--ghost"
              onClick={onSetParallelism}
              disabled={!controls?.can_set_parallelism}
            >
              Apply
            </button>
          </div>
        </div>
      </section>

      <OperatorTableLens
        jobs={jobs}
        selectedJobIndex={selectedJobIndex}
        density={density}
        onSelectJob={onSelectJob}
        onDensityChange={onDensityChange}
      />

      <div className="workbench-summary-grid">
        <section className="panel workbench-card">
          <div className="panel__header">
            <div>
              <h3>Running jobs</h3>
            </div>
          </div>
          {runningNow.length === 0 ? (
            <div className="empty-copy">No jobs are currently running.</div>
          ) : (
            <div className="running-list">
              {runningNow.map((job) => (
                <button
                  type="button"
                  key={job.index}
                  className={`running-card${job.index === selectedJobIndex ? " running-card--selected" : ""}`}
                  onClick={() => onSelectJob(job.index)}
                >
                  <strong>
                    {job.test_name || `job ${job.index}`} / seed {job.seed}
                  </strong>
                  <span>{formatDuration(job.elapsed_seconds)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <FailureClusterPanel clusters={clusters} onFocusSeed={onFocusSeed} />
      </div>
    </section>
  );
}
