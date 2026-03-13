/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDateTime, formatDuration, normalizeStatus, pathTail, statusTone } from "../lib/regression";
import type { InspectorSource, JobRecord, SessionSnapshot } from "../types";

interface JobInspectorProps {
  source: InspectorSource;
  snapshot: SessionSnapshot | undefined;
  job: JobRecord | null;
  logText: string;
  logStatus: "idle" | "loading" | "error" | "ready";
  logError: string | null;
  onReloadLog: () => void;
  onCopyLog: () => void;
  logMaximized?: boolean;
  onToggleLogMaximized?: () => void;
  headerAction?: ReactNode;
  layoutMode?: "default" | "wide";
}

function DetailCard({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  const rendered = value === undefined || value === null || value === "" ? "-" : value;
  return (
    <div className="detail-card detail-card--kv">
      <span className="detail-card__label">{label}:</span>
      <strong>{rendered}</strong>
    </div>
  );
}

export function JobInspector({
  source,
  snapshot,
  job,
  logText,
  logStatus,
  logError,
  onReloadLog,
  onCopyLog,
  logMaximized,
  onToggleLogMaximized,
  headerAction,
  layoutMode = "default",
}: JobInspectorProps) {
  const [search, setSearch] = useState("");
  const [detailsCollapsed, setDetailsCollapsed] = useState(source === "archive");
  const deferredSearch = useDeferredValue(search);
  const [showMatchesOnly, setShowMatchesOnly] = useState(false);
  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [localLogMaximized, setLocalLogMaximized] = useState(false);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const lineRefs = useRef(new Map<number, HTMLDivElement>());

  const artifacts = useMemo(() => {
    const runDir = job?.run_dir || "";
    const logPath = job?.log_path || "";
    if (logPath && runDir && logPath.startsWith(runDir)) {
      return [logPath];
    }
    return [...new Set([runDir, logPath].filter(Boolean))];
  }, [job?.log_path, job?.run_dir]);

  const artifactLabels = useMemo(
    () =>
      artifacts.map((artifact) => {
        const parts = artifact.split("/").filter(Boolean);
        const label = parts.length <= 2 ? artifact : parts.slice(-2).join("/");
        return { full: artifact, label };
      }),
    [artifacts],
  );
  const status = normalizeStatus(job?.status);
  const detailItems = [
    { label: "Job", value: job?.index },
    {
      label: "Duration",
      value:
        job && job.duration_seconds !== undefined
          ? formatDuration(job.duration_seconds)
          : null,
    },
    { label: "Updated", value: job?.updated_at ? formatDateTime(job.updated_at) : null },
    { label: "Status", value: status || null },
    { label: "Instruction", value: job?.triage_instr_asm || null },
    {
      label: "Program counter",
      value: job?.triage_pc === undefined || job?.triage_pc === null ? null : job.triage_pc,
    },
  ].filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  const logBody =
    logStatus === "loading"
      ? "Loading log..."
      : logStatus === "error"
        ? logError || "Log unavailable."
        : logText || "Select a completed or running job to view its log.";
  const lines = useMemo(() => logBody.split(/\r?\n/), [logBody]);
  const needle = deferredSearch.trim().toLowerCase();
  const matchLines = useMemo(() => {
    if (!needle) {
      return [];
    }
    return lines
      .map((line, index) => (line.toLowerCase().includes(needle) ? index : -1))
      .filter((index) => index >= 0);
  }, [needle, lines]);
  const visibleLines = useMemo(() => {
    if (!showMatchesOnly || !needle) {
      return lines.map((line, index) => ({ line, index }));
    }
    return matchLines.map((index) => ({ line: lines[index] || "", index }));
  }, [lines, matchLines, needle, showMatchesOnly]);

  useEffect(() => {
    if (!needle) {
      setShowMatchesOnly(false);
      return;
    }
    if (selectedLine !== null && matchLines.includes(selectedLine)) {
      return;
    }
    if (matchLines.length > 0) {
      setSelectedLine(matchLines[0]);
    }
  }, [matchLines, needle, selectedLine]);

  useEffect(() => {
    if (selectedLine === null) {
      return;
    }
    const node = lineRefs.current.get(selectedLine);
    if (node) {
      node.scrollIntoView({ block: "center" });
    }
  }, [selectedLine, visibleLines]);

  const jumpToMatch = (direction: 1 | -1) => {
    if (matchLines.length === 0) {
      return;
    }
    const sorted = direction > 0 ? matchLines : [...matchLines].reverse();
    const current = selectedLine ?? (direction > 0 ? -1 : Number.MAX_SAFE_INTEGER);
    const next =
      sorted.find((lineNumber) => (direction > 0 ? lineNumber > current : lineNumber < current)) ??
      sorted[0];
    setSelectedLine(next);
  };

  const isLogMaximized = logMaximized ?? localLogMaximized;
  const toggleLogMaximized = () => {
    if (onToggleLogMaximized) {
      onToggleLogMaximized();
    } else {
      setLocalLogMaximized((current) => !current);
    }
  };

  return (
    <aside
      className={`inspector${layoutMode === "wide" ? " inspector--wide" : ""}${
        isLogMaximized ? " inspector--log-max" : ""
      }`}
    >
      {!isLogMaximized ? (
        <section
          className={`panel inspector-card${
            source === "archive" && detailsCollapsed ? " inspector-card--details-collapsed" : ""
          }`}
        >
          <div className="panel__header">
            <div className="panel__title-row">
              {headerAction}
              <div>
                <h2>{job ? `${job.test_name || "job"} / seed ${job.seed}` : "Selected job"}</h2>
              </div>
            </div>
            <div className="toolbar toolbar--tight">
              {source === "archive" ? (
                <button
                  type="button"
                  className="chip-button"
                  onClick={() => setDetailsCollapsed((current) => !current)}
                >
                  {detailsCollapsed ? "Show details" : "Hide details"}
                </button>
              ) : null}
              <span className={`status-dot status-dot--${statusTone(status)}`}>{status}</span>
            </div>
          </div>

          {!detailsCollapsed ? (
            <>
              {job ? (
                <div className="detail-grid">
                  {detailItems.map((item) => (
                    <DetailCard key={item.label} label={item.label} value={item.value} />
                  ))}
                </div>
              ) : (
                <div className="empty-state-card">
                  Pick a job from the monitor or archive table to see its details and log.
                </div>
              )}

              {job?.triage_summary ? (
                <div className="panel__subsection">
                  <span className="subheading">Triage summary</span>
                  <p className="inspector-copy">{job.triage_summary}</p>
                </div>
              ) : null}

              {(job?.triage_mismatched_fields || []).length > 0 ? (
                <div className="panel__subsection">
                  <span className="subheading">Mismatch fields</span>
                  <div className="pill-row">
                    {job?.triage_mismatched_fields?.map((entry) => (
                      <span key={entry} className="pill pill--failure">
                        {entry}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}

              {artifactLabels.length > 0 ? (
                <div className="panel__subsection">
                  <span className="subheading">Artifacts</span>
                  <div className="artifact-list">
                    {artifactLabels.map((artifact) => (
                      <code key={artifact.full} className="artifact-path" title={artifact.full}>
                        {artifact.label}
                      </code>
                    ))}
                  </div>
                </div>
              ) : null}

              {source === "active" ? (
                <div className="panel__subsection">
                  <span className="subheading">Session</span>
                  <div className="meta-list meta-list--tight">
                    <div>
                      <dt>Output</dt>
                      <dd title={snapshot?.output_dir || undefined}>{pathTail(snapshot?.output_dir)}</dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatDateTime(snapshot?.updated_at)}</dd>
                    </div>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      <section className="panel inspector-card inspector-card--stretch">
        <div className="panel__header panel__header--stack-mobile log-panel__header">
          <div className="panel__title-row">
            <button
              type="button"
              className={`icon-button${isLogMaximized ? " is-active" : ""}`}
              aria-label={isLogMaximized ? "Restore panel" : "Maximize log"}
              title={isLogMaximized ? "Restore panel" : "Maximize log"}
              onClick={toggleLogMaximized}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                {isLogMaximized ? (
                  <path
                    d="M5 2H2v3M11 2h3v3M2 11v3h3M14 11v3h-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : (
                  <path
                    d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </button>
            <h3>Log</h3>
          </div>
          <div className="toolbar toolbar--tight log-panel__controls">
            <input
              className="search-input log-panel__search"
              placeholder="Find in log"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="chip-button"
              onClick={() => jumpToMatch(-1)}
              disabled={matchLines.length === 0}
            >
              Prev
            </button>
            <button
              type="button"
              className="chip-button"
              onClick={() => jumpToMatch(1)}
              disabled={matchLines.length === 0}
            >
              Next
            </button>
            <button
              type="button"
              className={`chip-button${showMatchesOnly ? " is-active" : ""}`}
              onClick={() => setShowMatchesOnly((current) => !current)}
              disabled={matchLines.length === 0}
            >
              Filter
            </button>
            {needle ? <span className="muted-label">{matchLines.length} matches</span> : null}
            <button type="button" className="btn btn--ghost" onClick={onReloadLog}>
              Reload Log
            </button>
            <button type="button" className="btn btn--secondary" onClick={onCopyLog}>
              Copy Log
            </button>
          </div>
        </div>

        <div ref={viewerRef} className="log-viewer" role="log" aria-live="polite">
          {visibleLines.length === 0 ? (
            <div className="empty-copy">No log lines match the current search.</div>
          ) : (
            visibleLines.map(({ line, index }) => {
              const isSelected = selectedLine === index;
              const isMatch = needle ? line.toLowerCase().includes(needle) : false;
              return (
                <div
                  key={`${index}-${line}`}
                  ref={(node) => {
                    if (node) {
                      lineRefs.current.set(index, node);
                    } else {
                      lineRefs.current.delete(index);
                    }
                  }}
                  className={`log-line${isSelected ? " log-line--selected" : ""}${
                    isMatch ? " log-line--match" : ""
                  }`}
                  onClick={() => setSelectedLine(index)}
                >
                  <span className="log-line__number">{index + 1}</span>
                  <span className="log-line__text">{line || " "}</span>
                </div>
              );
            })
          )}
        </div>
      </section>
    </aside>
  );
}
