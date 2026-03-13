/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { filterJobs, formatDuration, formatDateTime, normalizeStatus, statusTone } from "../lib/regression";
import type { JobRecord } from "../types";

interface OperatorTableLensProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  onSelectJob: (index: number) => void;
}

const FILTERS = ["all", "failed", "running", "passed", "queued"] as const;
const TABLE_MODES = ["jobs", "triage"] as const;

export function OperatorTableLens({
  jobs,
  selectedJobIndex,
  onSelectJob,
}: OperatorTableLensProps) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [mode, setMode] = useState<(typeof TABLE_MODES)[number]>("jobs");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(
    () => filterJobs(jobs, filter, deferredSearch),
    [jobs, filter, deferredSearch],
  );
  const triageRows = useMemo(() => {
    const rows = new Map<
      string,
      {
        mismatch: string;
        count: number;
        tests: Set<string>;
        sampleSeeds: number[];
        lastUpdated: string | null;
        bestJobIndex: number | null;
        bestDuration: number;
      }
    >();
    jobs.forEach((job) => {
      const status = normalizeStatus(job.status);
      if (status === "running") {
        return;
      }
      if (status !== "failed" && status !== "timeout" && status !== "cancelled" && status !== "interrupted") {
        return;
      }
      const mismatchKeys = (job.triage_mismatched_fields || []).length
        ? (job.triage_mismatched_fields || [])
        : [job.status_reason || "unknown"];
      mismatchKeys.forEach((raw) => {
        const mismatch = String(raw || "unknown").trim() || "unknown";
        const existing = rows.get(mismatch) || {
          mismatch,
          count: 0,
          tests: new Set<string>(),
          sampleSeeds: [],
          lastUpdated: null,
          bestJobIndex: null,
          bestDuration: Number.POSITIVE_INFINITY,
        };
        existing.count += 1;
        existing.tests.add(String(job.test_name || "unknown"));
        if (existing.sampleSeeds.length < 3 && !existing.sampleSeeds.includes(job.seed)) {
          existing.sampleSeeds.push(job.seed);
        }
        const durationSeconds = Number(job.duration_seconds);
        if (
          Number.isFinite(durationSeconds) &&
          durationSeconds >= 0 &&
          durationSeconds < existing.bestDuration
        ) {
          existing.bestDuration = durationSeconds;
          existing.bestJobIndex = job.index;
        }
        if (existing.bestJobIndex === null) {
          existing.bestJobIndex = job.index;
        }
        if (!existing.lastUpdated || String(job.updated_at || "") > existing.lastUpdated) {
          existing.lastUpdated = String(job.updated_at || "");
        }
        rows.set(mismatch, existing);
      });
    });
    return [...rows.values()].sort((a, b) => b.count - a.count);
  }, [jobs]);

  return (
    <section className="panel lens-panel">
      <div className="panel__header panel__header--stack-mobile">
        <div>
          <h3>{mode === "jobs" ? "Jobs" : "Triage"}</h3>
        </div>
        <div className="toolbar toolbar--tight">
          <div className="segmented">
            {TABLE_MODES.map((entry) => (
              <button
                type="button"
                key={entry}
                className={entry === mode ? "is-active" : ""}
                onClick={() => setMode(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
          <div className="segmented">
            {FILTERS.map((entry) => (
              <button
                type="button"
                key={entry}
                className={entry === filter ? "is-active" : ""}
                onClick={() => setFilter(entry)}
                disabled={mode !== "jobs"}
              >
                {entry}
              </button>
            ))}
          </div>
          <input
            className="search-input"
            placeholder={mode === "jobs" ? "Search tests, seeds, triage" : "Search mismatches/tests"}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className="table-wrap table-wrap--dense">
        <table className="jobs-table">
          <thead>
            {mode === "jobs" ? (
              <tr>
                <th>Job</th>
                <th>Test</th>
                <th>Seed</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Duration</th>
                <th>Updated</th>
              </tr>
            ) : (
              <tr>
                <th>Mismatch</th>
                <th>Fails</th>
                <th>Tests</th>
                <th>Sample seeds</th>
                <th>Updated</th>
              </tr>
            )}
          </thead>
          <tbody>
            {mode === "jobs" && filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  No jobs match the current filter.
                </td>
              </tr>
            ) : null}
            {mode === "triage" && triageRows.length === 0 ? (
              <tr>
                <td colSpan={5} className="table-empty">
                  No failed triage groups found.
                </td>
              </tr>
            ) : null}
            {mode === "jobs"
              ? filtered.map((job) => {
                  const status = normalizeStatus(job.status);
                  const selected = job.index === selectedJobIndex;
                  return (
                    <tr
                      key={job.index}
                      className={selected ? "is-selected" : ""}
                      onClick={() => onSelectJob(job.index)}
                    >
                      <td>{job.index}</td>
                      <td>{job.test_name || "-"}</td>
                      <td>{job.seed}</td>
                      <td>
                        <span className={`status-dot status-dot--${statusTone(status)}`}>
                          {status}
                        </span>
                      </td>
                      <td className="cell-wrap">{job.status_reason || "-"}</td>
                      <td>{formatDuration(job.duration_seconds)}</td>
                      <td>{formatDateTime(job.updated_at)}</td>
                    </tr>
                  );
                })
              : triageRows
                  .filter((row) => {
                    const query = deferredSearch.trim().toLowerCase();
                    if (!query) {
                      return true;
                    }
                    return (
                      row.mismatch.toLowerCase().includes(query) ||
                      [...row.tests].join(" ").toLowerCase().includes(query) ||
                      row.sampleSeeds.join(" ").includes(query)
                    );
                  })
                  .map((row) => (
                <tr
                  key={row.mismatch}
                  onClick={() => {
                    if (row.bestJobIndex !== null) {
                      onSelectJob(row.bestJobIndex);
                    }
                  }}
                >
                  <td className="cell-wrap">{row.mismatch}</td>
                  <td>{row.count}</td>
                  <td className="cell-wrap">{[...row.tests].slice(0, 3).join(", ")}</td>
                  <td>{row.sampleSeeds.join(", ") || "-"}</td>
                  <td>{formatDateTime(row.lastUpdated)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
