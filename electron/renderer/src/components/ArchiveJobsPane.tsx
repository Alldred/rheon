/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import {
  formatDateTime,
  formatDuration,
  normalizeStatus,
  pathTail,
  statusTone,
  summaryDefaults,
} from "../lib/regression";
import type { JobRecord, RunRecord } from "../types";

interface ArchiveJobsPaneProps {
  run: RunRecord | null;
  jobs: JobRecord[];
  selectedArchiveJobIndex: number | null;
  loading: boolean;
  error: string | null;
  onSelectJob: (index: number) => void;
  onAttachRun: (outputDir: string) => void;
  onUseTemplate: (outputDir: string) => void;
}

export function ArchiveJobsPane({
  run,
  jobs,
  selectedArchiveJobIndex,
  loading,
  error,
  onSelectJob,
  onAttachRun,
  onUseTemplate,
}: ArchiveJobsPaneProps) {
  const summary = summaryDefaults(run?.summary);

  if (!run) {
    return (
      <section className="panel archive-panel archive-panel--jobs">
        <div className="panel__header">
          <div>
            <span className="eyebrow">Archive</span>
            <h2>Run jobs</h2>
          </div>
        </div>
        <div className="empty-copy">Select a run from the archive list to inspect jobs.</div>
      </section>
    );
  }

  return (
    <section className="panel archive-panel archive-panel--jobs">
      <div className="panel__header panel__header--stack-mobile">
        <div>
          <span className="eyebrow">Run jobs</span>
          <h2 title={run.name}>{run.name}</h2>
        </div>
        <div className="toolbar toolbar--tight">
          <button
            type="button"
            className="chip-button"
            onClick={() => onUseTemplate(run.output_dir)}
            disabled={!run.config}
          >
            Use as template
          </button>
          <button
            type="button"
            className="chip-button"
            onClick={() => onAttachRun(run.output_dir)}
          >
            Attach
          </button>
        </div>
      </div>

      <div className="meta-list meta-list--tight archive-panel__meta">
        <div>
          <dt>Output</dt>
          <dd title={run.output_dir}>{pathTail(run.output_dir)}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDateTime(run.updated_at || run.created_at)}</dd>
        </div>
        <div>
          <dt>Status</dt>
          <dd>
            <span className={`status-dot status-dot--${statusTone(run.status)}`}>{run.status}</span>
          </dd>
        </div>
      </div>

      <div className="stats-grid stats-grid--compact archive-panel__stats">
        <div className="count-stat">
          <strong>{summary.total}</strong>
          <span>Total</span>
        </div>
        <div className="count-stat">
          <strong>{summary.passed}</strong>
          <span>Passed</span>
        </div>
        <div className="count-stat">
          <strong>{summary.failed}</strong>
          <span>Failed</span>
        </div>
        <div className="count-stat">
          <strong>{summary.running}</strong>
          <span>Running</span>
        </div>
      </div>

      <div className="table-wrap table-wrap--dense archive-scroll-region">
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Test</th>
              <th>Seed</th>
              <th>Status</th>
              <th>Duration</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="table-empty">
                  Loading archived jobs...
                </td>
              </tr>
            ) : null}
            {error ? (
              <tr>
                <td colSpan={6} className="table-empty">
                  {error}
                </td>
              </tr>
            ) : null}
            {!loading && !error && jobs.length === 0 ? (
              <tr>
                <td colSpan={6} className="table-empty">
                  This run has no jobs to display yet.
                </td>
              </tr>
            ) : null}
            {jobs.map((job) => (
              <tr
                key={job.index}
                className={job.index === selectedArchiveJobIndex ? "is-selected" : ""}
                onClick={() => onSelectJob(job.index)}
              >
                <td>{job.index}</td>
                <td>{job.test_name || "-"}</td>
                <td>{job.seed}</td>
                <td>
                  <span className={`status-dot status-dot--${statusTone(job.status)}`}>
                    {normalizeStatus(job.status)}
                  </span>
                </td>
                <td>{formatDuration(job.duration_seconds)}</td>
                <td>{formatDateTime(job.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
