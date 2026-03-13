/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import type { ReactNode } from "react";
import { formatDateTime, pathTail, statusTone, summaryDefaults } from "../lib/regression";
import type { RunRecord, SessionSnapshot } from "../types";

interface SessionRailProps {
  session: SessionSnapshot | undefined;
  runs: RunRecord[];
  selectedArchiveDir: string | null;
  onInspectRun: (outputDir: string) => void;
  onAttachRun: (outputDir: string) => void;
  onUseTemplate: (outputDir: string) => void;
}

function CountStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="count-stat">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function CurrentRunPanel({ session }: { session: SessionSnapshot | undefined }) {
  const summary = summaryDefaults(session?.summary);
  const activeStatus = session?.status || "idle";

  return (
    <section className="panel rail-card current-run-panel">
      <div className="panel__header">
        <div>
          <span className="eyebrow">Session</span>
          <h2>Current run</h2>
        </div>
        <span className={`status-dot status-dot--${statusTone(activeStatus)}`}>
          {activeStatus}
        </span>
      </div>

      <div className="path-block">{pathTail(session?.output_dir)}</div>

      <div className="stats-grid">
        <CountStat label="Total" value={summary.total} />
        <CountStat label="Running" value={summary.running} />
        <CountStat label="Passed" value={summary.passed} />
        <CountStat label="Failed" value={summary.failed} />
      </div>

      <dl className="meta-list">
        <div>
          <dt>Mode</dt>
          <dd>{session?.mode || "idle"}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatDateTime(session?.updated_at)}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{session?.status_reason || "Waiting for work."}</dd>
        </div>
      </dl>
    </section>
  );
}

export function RecentRunsPanel({
  runs,
  selectedArchiveDir,
  onInspectRun,
  onAttachRun,
  onUseTemplate,
  showActions = true,
  detailMode = "none",
  headerAction,
}: {
  runs: RunRecord[];
  selectedArchiveDir: string | null;
  onInspectRun: (outputDir: string) => void;
  onAttachRun: (outputDir: string) => void;
  onUseTemplate: (outputDir: string) => void;
  showActions?: boolean;
  detailMode?: "none" | "inline" | "split";
  headerAction?: ReactNode;
}) {
  const selectedRun =
    runs.find((run) => run.output_dir === selectedArchiveDir) || null;
  const selectedSummary = summaryDefaults(selectedRun?.summary);

  const renderSelectedDetails = (mode: "inline" | "split") =>
    selectedRun ? (
      <aside className="recent-run-detail">
        {mode === "split" ? (
          <div className="recent-run-detail__header">
            <strong title={selectedRun.name}>{selectedRun.name}</strong>
            <span className={`status-dot status-dot--${statusTone(selectedRun.status)}`}>
              {selectedRun.status}
            </span>
          </div>
        ) : null}

        <div className="recent-run__actions">
          <button
            type="button"
            className="chip-button"
            onClick={() => onUseTemplate(selectedRun.output_dir)}
            disabled={!selectedRun.config}
          >
            Use as template
          </button>
          <button
            type="button"
            className="chip-button"
            onClick={() => onAttachRun(selectedRun.output_dir)}
          >
            Attach
          </button>
        </div>

        <div className="meta-list meta-list--tight">
          <div>
            <dt>Output</dt>
            <dd title={selectedRun.output_dir}>{pathTail(selectedRun.output_dir)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDateTime(selectedRun.updated_at || selectedRun.created_at)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{selectedRun.status}</dd>
          </div>
        </div>

        {mode === "split" ? (
          <div className="stats-grid stats-grid--compact">
            <CountStat label="Total" value={selectedSummary.total} />
            <CountStat label="Passed" value={selectedSummary.passed} />
            <CountStat label="Failed" value={selectedSummary.failed} />
            <CountStat label="Running" value={selectedSummary.running} />
          </div>
        ) : null}
      </aside>
    ) : null;

  return (
    <section className="panel rail-card rail-card--stretch recent-runs-panel">
      <div className="panel__header">
        <div className="panel__title-row">
          {headerAction}
          <div>
          <span className="eyebrow">Archive</span>
          <h2>Recent runs</h2>
          </div>
        </div>
        <span className="muted-label">{runs.length}</span>
      </div>

      <div className={`recent-runs-shell recent-runs-shell--${detailMode}`}>
        <div className="recent-runs" role="list">
          {runs.length === 0 ? (
            <div className="empty-copy">No saved regressions found yet.</div>
          ) : null}
          {runs.map((run) => {
            const selected = run.output_dir === selectedArchiveDir;
            const runSummary = summaryDefaults(run.summary);
            return (
              <article
                key={run.output_dir}
                className={`recent-run${selected ? " recent-run--selected" : ""}`}
                role="listitem"
              >
                <button
                  type="button"
                  className="recent-run__body"
                  onClick={() => onInspectRun(run.output_dir)}
                >
                  <div className="recent-run__title-row">
                    <strong title={run.name}>{run.name}</strong>
                  </div>
                  <div className="recent-run__meta">
                    <div className="recent-run__meta-row">
                      <span className={`status-inline status-inline--${statusTone(run.status)}`}>
                        {run.status}
                      </span>
                      <span>{formatDateTime(run.updated_at || run.created_at)}</span>
                    </div>
                    <div className="recent-run__meta-row">
                      <span>{runSummary.passed} passed</span>
                      <span>{runSummary.failed} failed</span>
                    </div>
                  </div>
                </button>
                {detailMode === "inline" && selected ? (
                  <div className="recent-run__expanded">{renderSelectedDetails("inline")}</div>
                ) : null}
                {showActions ? (
                  <div className="recent-run__actions">
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => onAttachRun(run.output_dir)}
                    >
                      Attach
                    </button>
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => onUseTemplate(run.output_dir)}
                    >
                      Template
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>

        {detailMode === "split" ? renderSelectedDetails("split") : null}
      </div>
    </section>
  );
}

export function SessionRail({
  session,
  runs,
  selectedArchiveDir,
  onInspectRun,
  onAttachRun,
  onUseTemplate,
}: SessionRailProps) {
  return (
    <aside className="session-rail">
      <CurrentRunPanel session={session} />

      <RecentRunsPanel
        runs={runs}
        selectedArchiveDir={selectedArchiveDir}
        onInspectRun={onInspectRun}
        onAttachRun={onAttachRun}
        onUseTemplate={onUseTemplate}
      />
    </aside>
  );
}
