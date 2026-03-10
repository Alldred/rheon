/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { filterJobs, formatDuration, formatDateTime, normalizeStatus, statusTone } from "../lib/regression";
import type { DensityMode, JobRecord } from "../types";

interface OperatorTableLensProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  density: DensityMode;
  onSelectJob: (index: number) => void;
  onDensityChange: (density: DensityMode) => void;
}

const FILTERS = ["all", "failed", "running", "passed", "queued"] as const;

export function OperatorTableLens({
  jobs,
  selectedJobIndex,
  density,
  onSelectJob,
  onDensityChange,
}: OperatorTableLensProps) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(
    () => filterJobs(jobs, filter, deferredSearch),
    [jobs, filter, deferredSearch],
  );

  return (
    <section className="panel lens-panel">
      <div className="panel__header panel__header--stack-mobile">
        <div>
          <h3>Jobs</h3>
        </div>
        <div className="toolbar toolbar--tight">
          <div className="segmented">
            {FILTERS.map((entry) => (
              <button
                type="button"
                key={entry}
                className={entry === filter ? "is-active" : ""}
                onClick={() => setFilter(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
          <div className="segmented">
            {(["dense", "balanced"] as DensityMode[]).map((entry) => (
              <button
                type="button"
                key={entry}
                className={entry === density ? "is-active" : ""}
                onClick={() => onDensityChange(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
          <input
            className="search-input"
            placeholder="Search tests, seeds, triage"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <div className={`table-wrap table-wrap--${density}`}>
        <table className="jobs-table">
          <thead>
            <tr>
              <th>Job</th>
              <th>Test</th>
              <th>Seed</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Duration</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  No jobs match the current filter.
                </td>
              </tr>
            ) : null}
            {filtered.map((job) => {
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
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
