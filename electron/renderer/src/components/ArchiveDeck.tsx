/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getJobLog } from "../api/client";
import { pathTail } from "../lib/regression";
import type { JobRecord, RunRecord, SessionSnapshot } from "../types";
import { ArchiveJobDetailsPane } from "./ArchiveJobDetailsPane";
import { ArchiveJobsPane } from "./ArchiveJobsPane";
import { ArchiveRunsPane } from "./ArchiveRunsPane";

type ArchiveDepth = "runs" | "jobs" | "job";

interface ArchiveDeckProps {
  runs: RunRecord[];
  runsLoading: boolean;
  runsError: string | null;
  selectedArchiveDir: string | null;
  selectedArchiveRun: RunRecord | null;
  onSelectRun: (outputDir: string) => void;
  archiveSnapshot: SessionSnapshot | undefined;
  archiveSnapshotLoading: boolean;
  archiveSnapshotError: string | null;
  archiveJobs: JobRecord[];
  selectedArchiveJobIndex: number | null;
  onSelectJob: (index: number) => void;
  onAttachRun: (outputDir: string) => void;
  onUseTemplate: (outputDir: string) => void;
}

function readNarrowLayout(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return window.innerWidth < 1100;
}

function compactLabel(value: string | null | undefined): string {
  if (!value) {
    return "No selection";
  }
  return value.length > 28 ? `${value.slice(0, 25)}...` : value;
}

function jobStatusAllowsLog(job: JobRecord | null): boolean {
  if (!job) {
    return false;
  }
  return !["queued", "idle"].includes(String(job.status || "queued").toLowerCase());
}

function paneClass(active: boolean): string {
  return `archive-pane ${active ? "archive-pane--active" : "archive-pane--hidden"}`;
}

export function ArchiveDeck({
  runs,
  runsLoading,
  runsError,
  selectedArchiveDir,
  selectedArchiveRun,
  onSelectRun,
  archiveSnapshot,
  archiveSnapshotLoading,
  archiveSnapshotError,
  archiveJobs,
  selectedArchiveJobIndex,
  onSelectJob,
  onAttachRun,
  onUseTemplate,
}: ArchiveDeckProps) {
  const [depth, setDepth] = useState<ArchiveDepth>("runs");
  const [isNarrow, setIsNarrow] = useState(() => readNarrowLayout());

  const selectedArchiveJob =
    archiveJobs.find((job) => job.index === selectedArchiveJobIndex) || null;

  useEffect(() => {
    const handleResize = () => {
      setIsNarrow(readNarrowLayout());
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (runs.length === 0) {
      return;
    }
    const hasSelection = selectedArchiveDir
      ? runs.some((run) => run.output_dir === selectedArchiveDir)
      : false;
    if (!hasSelection) {
      onSelectRun(runs[0].output_dir);
    }
  }, [runs, selectedArchiveDir, onSelectRun]);

  useEffect(() => {
    if (!selectedArchiveDir && depth !== "runs") {
      setDepth("runs");
      return;
    }
    if (depth === "job" && selectedArchiveJobIndex !== null && !selectedArchiveJob) {
      setDepth("jobs");
    }
  }, [depth, selectedArchiveDir, selectedArchiveJob, selectedArchiveJobIndex]);

  const archiveLogQuery = useQuery({
    queryKey: [
      "archive-job-log",
      selectedArchiveDir || null,
      selectedArchiveJobIndex || null,
      archiveSnapshot?.revision || 0,
      selectedArchiveJob?.updated_at || null,
    ],
    queryFn: () => getJobLog(selectedArchiveDir || "", selectedArchiveJob?.index || 0),
    enabled: Boolean(
      selectedArchiveDir && selectedArchiveJob && jobStatusAllowsLog(selectedArchiveJob),
    ),
    retry: false,
    refetchInterval:
      String(selectedArchiveJob?.status || "").toLowerCase() === "running" ? 3000 : false,
  });

  return (
    <div className={`archive-deck ${isNarrow ? "archive-deck--narrow" : "archive-deck--desktop"}`}>
      {isNarrow && depth !== "runs" ? (
        <nav className="archive-breadcrumb" aria-label="Archive navigation">
          <button
            type="button"
            className="chip-button"
            onClick={() => setDepth("runs")}
          >
            Runs
          </button>
          {depth === "job" ? (
            <button
              type="button"
              className="chip-button"
              onClick={() => setDepth("jobs")}
            >
              Jobs
            </button>
          ) : null}
          <span className="muted-label">
            {depth === "jobs"
              ? compactLabel(selectedArchiveRun?.name || null)
              : compactLabel(selectedArchiveJob?.test_name || null)}
          </span>
        </nav>
      ) : null}

      {!isNarrow && depth !== "runs" ? (
        <button
          type="button"
          className="archive-pane archive-pane--collapsed archive-rail archive-rail--runs"
          aria-label="Show recent runs"
          onClick={() => setDepth("runs")}
          title={selectedArchiveRun?.name || undefined}
        >
          <span className="archive-rail__label">Runs</span>
          <span className="archive-rail__value">
            {compactLabel(selectedArchiveRun?.name || pathTail(selectedArchiveDir))}
          </span>
        </button>
      ) : null}

      {!isNarrow && depth === "job" ? (
        <button
          type="button"
          className="archive-pane archive-pane--collapsed archive-rail archive-rail--jobs"
          aria-label="Show run jobs"
          onClick={() => setDepth("jobs")}
          title={selectedArchiveJob?.test_name || undefined}
        >
          <span className="archive-rail__label">Jobs</span>
          <span className="archive-rail__value">
            {compactLabel(
              selectedArchiveJob
                ? `${selectedArchiveJob.test_name || "job"} #${selectedArchiveJob.index}`
                : null,
            )}
          </span>
        </button>
      ) : null}

      {isNarrow ? (
        <section className="archive-pane archive-pane--active">
          <div className="archive-pane__content">
            {depth === "runs" ? (
              <ArchiveRunsPane
                runs={runs}
                selectedArchiveDir={selectedArchiveDir}
                loading={runsLoading}
                error={runsError}
                onAttachRun={onAttachRun}
                onSelectRun={(outputDir) => {
                  onSelectRun(outputDir);
                  setDepth("jobs");
                }}
              />
            ) : null}
            {depth === "jobs" ? (
              <ArchiveJobsPane
                run={selectedArchiveRun}
                jobs={archiveJobs}
                selectedArchiveJobIndex={selectedArchiveJobIndex}
                loading={archiveSnapshotLoading}
                error={archiveSnapshotError}
                onSelectJob={(index) => {
                  onSelectJob(index);
                  setDepth("job");
                }}
                onAttachRun={onAttachRun}
                onUseTemplate={onUseTemplate}
              />
            ) : null}
            {depth === "job" ? (
              <ArchiveJobDetailsPane
                snapshot={archiveSnapshot}
                job={selectedArchiveJob}
                logText={archiveLogQuery.data || ""}
                logStatus={
                  archiveLogQuery.isLoading
                    ? "loading"
                    : archiveLogQuery.isError
                      ? "error"
                      : archiveLogQuery.isSuccess
                        ? "ready"
                        : "idle"
                }
                logError={archiveLogQuery.error instanceof Error ? archiveLogQuery.error.message : null}
                onReloadLog={() => {
                  void archiveLogQuery.refetch();
                }}
                onCopyLog={() => {
                  const text =
                    archiveLogQuery.status === "success"
                      ? archiveLogQuery.data
                      : archiveLogQuery.error instanceof Error
                        ? archiveLogQuery.error.message
                        : "";
                  if (!text || !navigator.clipboard?.writeText) {
                    return;
                  }
                  void navigator.clipboard.writeText(text);
                }}
              />
            ) : null}
          </div>
        </section>
      ) : (
        <>
          <section className={paneClass(depth === "runs")}>
            <div className="archive-pane__content">
              <ArchiveRunsPane
                runs={runs}
                selectedArchiveDir={selectedArchiveDir}
                loading={runsLoading}
                error={runsError}
                onAttachRun={onAttachRun}
                onSelectRun={(outputDir) => {
                  onSelectRun(outputDir);
                  setDepth("jobs");
                }}
              />
            </div>
          </section>
          <section className={paneClass(depth === "jobs")}>
            <div className="archive-pane__content">
              <ArchiveJobsPane
                run={selectedArchiveRun}
                jobs={archiveJobs}
                selectedArchiveJobIndex={selectedArchiveJobIndex}
                loading={archiveSnapshotLoading}
                error={archiveSnapshotError}
                onSelectJob={(index) => {
                  onSelectJob(index);
                  setDepth("job");
                }}
                onAttachRun={onAttachRun}
                onUseTemplate={onUseTemplate}
              />
            </div>
          </section>
          <section className={paneClass(depth === "job")}>
            <div className="archive-pane__content">
              <ArchiveJobDetailsPane
                snapshot={archiveSnapshot}
                job={selectedArchiveJob}
                logText={archiveLogQuery.data || ""}
                logStatus={
                  archiveLogQuery.isLoading
                    ? "loading"
                    : archiveLogQuery.isError
                      ? "error"
                      : archiveLogQuery.isSuccess
                        ? "ready"
                        : "idle"
                }
                logError={archiveLogQuery.error instanceof Error ? archiveLogQuery.error.message : null}
                onReloadLog={() => {
                  void archiveLogQuery.refetch();
                }}
                onCopyLog={() => {
                  const text =
                    archiveLogQuery.status === "success"
                      ? archiveLogQuery.data
                      : archiveLogQuery.error instanceof Error
                        ? archiveLogQuery.error.message
                        : "";
                  if (!text || !navigator.clipboard?.writeText) {
                    return;
                  }
                  void navigator.clipboard.writeText(text);
                }}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
