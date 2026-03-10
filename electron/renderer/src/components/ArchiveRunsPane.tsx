/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { formatDateTime, statusTone, summaryDefaults } from "../lib/regression";
import type { RunRecord } from "../types";

interface ArchiveRunsPaneProps {
  runs: RunRecord[];
  selectedArchiveDir: string | null;
  loading: boolean;
  error: string | null;
  onSelectRun: (outputDir: string) => void;
}

function normalizeRunsError(error: string): string {
  const text = String(error || "").trim();
  const normalized = text.toLowerCase();
  if (
    normalized.includes("load failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("networkerror") ||
    normalized === "get /api/runs failed"
  ) {
    return "Cannot reach /api/runs. Start rheon_regr_app and open http://127.0.0.1:8765.";
  }
  return text;
}

export function ArchiveRunsPane({
  runs,
  selectedArchiveDir,
  loading,
  error,
  onSelectRun,
}: ArchiveRunsPaneProps) {
  const errorCopy = error ? normalizeRunsError(error) : null;

  return (
    <section className="panel archive-panel archive-panel--runs">
      <div className="panel__header">
        <div>
          <span className="eyebrow">Archive</span>
          <h2>Recent runs</h2>
        </div>
        <span className="muted-label">{runs.length}</span>
      </div>

      <div className="archive-scroll-region archive-runs-list" role="list">
        {loading && runs.length === 0 ? (
          <div className="empty-copy">Loading archived regressions...</div>
        ) : null}
        {errorCopy && runs.length === 0 ? (
          <div className="empty-copy">{errorCopy}</div>
        ) : null}
        {!loading && !error && runs.length === 0 ? (
          <div className="empty-copy">No saved regressions found yet.</div>
        ) : null}

        {runs.map((run) => {
          const selected = run.output_dir === selectedArchiveDir;
          const summary = summaryDefaults(run.summary);
          return (
            <article
              key={run.output_dir}
              className={`archive-run-card${selected ? " archive-run-card--selected" : ""}`}
              role="listitem"
            >
              <button
                type="button"
                className="archive-run-card__button"
                onClick={() => onSelectRun(run.output_dir)}
              >
                <div className="archive-run-card__title-row">
                  <strong title={run.name}>{run.name}</strong>
                </div>
                <div className="archive-run-card__meta-row">
                  <span className={`status-inline status-inline--${statusTone(run.status)}`}>
                    {run.status}
                  </span>
                  <span>{formatDateTime(run.updated_at || run.created_at)}</span>
                </div>
                <div className="archive-run-card__meta-row">
                  <span>{summary.passed} passed</span>
                  <span>{summary.failed} failed</span>
                  <span>{summary.running} running</span>
                </div>
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
