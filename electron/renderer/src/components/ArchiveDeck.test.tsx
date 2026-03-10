/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ArchiveDeck } from "./ArchiveDeck";
import type { JobRecord, RunRecord, SessionSnapshot } from "../types";

vi.mock("../api/client", () => ({
  getJobLog: vi.fn(async () => "default log line"),
}));

import { getJobLog } from "../api/client";

const mockedGetJobLog = vi.mocked(getJobLog);

const summary = {
  total: 2,
  scheduled: 2,
  skipped_resume: 0,
  passed: 1,
  failed: 1,
  not_run: 0,
  timed_out: 0,
  running: 0,
};

const runs: RunRecord[] = [
  {
    name: "20260307_150000",
    output_dir: "/runs/regressions/20260307_150000",
    created_at: "2026-03-07T15:00:00Z",
    updated_at: "2026-03-07T15:05:00Z",
    status: "complete",
    status_reason: "complete",
    summary,
    config: {
      tests: [{ name: "simple", count: 2 }],
      seed: 1,
      jobs: 2,
      update: 2,
      stages: "run",
      output_dir: "/runs/regressions/20260307_150000",
    },
  },
  {
    name: "20260307_140000",
    output_dir: "/runs/regressions/20260307_140000",
    created_at: "2026-03-07T14:00:00Z",
    updated_at: "2026-03-07T14:05:00Z",
    status: "failed",
    status_reason: "failed",
    summary: { ...summary, passed: 0, failed: 2 },
    config: null,
  },
];

const archiveJobs: JobRecord[] = [
  {
    index: 1,
    test_name: "simple",
    seed: 11,
    status: "failed",
    status_reason: "mismatch",
    duration_seconds: 14,
    updated_at: "2026-03-07T15:05:00Z",
    log_path: "/runs/regressions/20260307_150000/jobs/1/sim.log",
    run_dir: "/runs/regressions/20260307_150000/jobs/1",
  },
  {
    index: 2,
    test_name: "simple",
    seed: 12,
    status: "passed",
    status_reason: "passed",
    duration_seconds: 9,
    updated_at: "2026-03-07T15:04:00Z",
    log_path: "/runs/regressions/20260307_150000/jobs/2/sim.log",
    run_dir: "/runs/regressions/20260307_150000/jobs/2",
  },
];

const archiveSnapshot: SessionSnapshot = {
  mode: "attached",
  revision: 7,
  status: "complete",
  status_reason: "complete",
  output_dir: runs[0].output_dir,
  started_at: null,
  created_at: runs[0].created_at,
  updated_at: runs[0].updated_at,
  jobs: archiveJobs,
  running_jobs: [],
  planned_jobs: [],
  summary,
  config: runs[0].config,
  controls: {
    can_pause: false,
    can_resume: false,
    can_cancel: false,
    can_set_parallelism: false,
    can_rerun_failed: false,
  },
  last_error: null,
};

interface RenderOptions {
  selectedArchiveDir?: string | null;
  selectedArchiveRun?: RunRecord | null;
  selectedArchiveJobIndex?: number | null;
  jobs?: JobRecord[];
  runs?: RunRecord[];
  runsLoading?: boolean;
  runsError?: string | null;
  archiveSnapshotLoading?: boolean;
  archiveSnapshotError?: string | null;
  archiveSnapshot?: SessionSnapshot | undefined;
}

function ArchiveDeckHarness({
  options,
  onSelectRun,
  onSelectJob,
  onAttachRun,
  onUseTemplate,
}: {
  options: RenderOptions;
  onSelectRun: (outputDir: string) => void;
  onSelectJob: (index: number) => void;
  onAttachRun: (outputDir: string) => void;
  onUseTemplate: (outputDir: string) => void;
}) {
  const runsData = options.runs ?? runs;
  const [selectedArchiveDir, setSelectedArchiveDir] = useState<string | null>(
    options.selectedArchiveDir === undefined
      ? runsData[0]?.output_dir || null
      : options.selectedArchiveDir,
  );
  const [selectedArchiveJobIndex, setSelectedArchiveJobIndex] = useState<number | null>(
    options.selectedArchiveJobIndex ?? null,
  );

  const selectedArchiveRun =
    runsData.find((run) => run.output_dir === selectedArchiveDir) || options.selectedArchiveRun || null;

  return (
    <ArchiveDeck
      runs={runsData}
      runsLoading={options.runsLoading ?? false}
      runsError={options.runsError ?? null}
      selectedArchiveDir={selectedArchiveDir}
      selectedArchiveRun={selectedArchiveRun}
      onSelectRun={(outputDir) => {
        onSelectRun(outputDir);
        setSelectedArchiveDir(outputDir);
        setSelectedArchiveJobIndex(null);
      }}
      archiveSnapshot={options.archiveSnapshot ?? archiveSnapshot}
      archiveSnapshotLoading={options.archiveSnapshotLoading ?? false}
      archiveSnapshotError={options.archiveSnapshotError ?? null}
      archiveJobs={options.jobs ?? archiveJobs}
      selectedArchiveJobIndex={selectedArchiveJobIndex}
      onSelectJob={(index) => {
        onSelectJob(index);
        setSelectedArchiveJobIndex(index);
      }}
      onAttachRun={onAttachRun}
      onUseTemplate={onUseTemplate}
    />
  );
}

function renderArchiveDeck(options: RenderOptions = {}) {
  const onSelectRun = vi.fn();
  const onSelectJob = vi.fn();
  const onAttachRun = vi.fn();
  const onUseTemplate = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  const result = render(
    <QueryClientProvider client={queryClient}>
      <ArchiveDeckHarness
        options={options}
        onSelectRun={onSelectRun}
        onSelectJob={onSelectJob}
        onAttachRun={onAttachRun}
        onUseTemplate={onUseTemplate}
      />
    </QueryClientProvider>,
  );

  return { ...result, onSelectRun, onSelectJob, onAttachRun, onUseTemplate };
}

function openJobsPane() {
  fireEvent.click(screen.getByRole("button", { name: /20260307_150000/i }));
}

function openJobDetailsPane() {
  openJobsPane();
  const rows = screen.getAllByRole("row");
  fireEvent.click(rows[1]);
}

describe("ArchiveDeck", () => {
  beforeEach(() => {
    mockedGetJobLog.mockReset();
    mockedGetJobLog.mockResolvedValue("default log line");
    Object.defineProperty(window, "innerWidth", {
      value: 1400,
      writable: true,
      configurable: true,
    });
    window.dispatchEvent(new Event("resize"));
  });

  it("renders recent runs as the default full view", () => {
    renderArchiveDeck();

    expect(screen.getByRole("heading", { name: "Recent runs" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show recent runs/i })).not.toBeInTheDocument();
  });

  it("selecting a run transitions to jobs view and shows the runs rail", () => {
    const { onSelectRun } = renderArchiveDeck();

    fireEvent.click(screen.getByRole("button", { name: /20260307_140000/i }));

    expect(onSelectRun).toHaveBeenCalledWith(runs[1].output_dir);
    expect(screen.getByText("Run jobs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show recent runs/i })).toBeInTheDocument();
  });

  it("selecting a job transitions to details view and shows both rails", async () => {
    const { onSelectJob } = renderArchiveDeck();

    openJobDetailsPane();

    expect(onSelectJob).toHaveBeenCalledWith(1);
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "simple / seed 11" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /show recent runs/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show run jobs/i })).toBeInTheDocument();
  });

  it("clicking the runs rail returns to the runs view", () => {
    renderArchiveDeck();

    openJobsPane();
    fireEvent.click(screen.getByRole("button", { name: /show recent runs/i }));

    expect(screen.getByRole("heading", { name: "Recent runs" })).toBeInTheDocument();
  });

  it("clicking the jobs rail returns from details to jobs", async () => {
    renderArchiveDeck();

    openJobDetailsPane();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /show run jobs/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /show run jobs/i }));

    expect(screen.getByText("Run jobs")).toBeInTheDocument();
  });

  it("shows an empty state when there are no runs", () => {
    renderArchiveDeck({
      runs: [],
      selectedArchiveDir: null,
      selectedArchiveRun: null,
      archiveSnapshot: undefined,
      jobs: [],
    });

    expect(screen.getByText("No saved regressions found yet.")).toBeInTheDocument();
  });

  it("shows an empty state when a run has no jobs", () => {
    renderArchiveDeck({ jobs: [] });

    openJobsPane();

    expect(screen.getByText("This run has no jobs to display yet.")).toBeInTheDocument();
  });

  it("renders loading log state in job details", () => {
    mockedGetJobLog.mockImplementationOnce(() => new Promise<string>(() => {}));
    renderArchiveDeck();

    openJobDetailsPane();

    expect(screen.getByText("Loading log...")).toBeInTheDocument();
  });

  it("renders error log state in job details", async () => {
    mockedGetJobLog.mockReset();
    mockedGetJobLog.mockRejectedValueOnce(new Error("log unavailable"));
    renderArchiveDeck();

    openJobDetailsPane();

    await waitFor(() => expect(screen.getByText("log unavailable")).toBeInTheDocument());
  });

  it("renders ready log state in job details", async () => {
    mockedGetJobLog.mockReset();
    mockedGetJobLog.mockResolvedValueOnce("ready line");
    renderArchiveDeck();

    openJobDetailsPane();

    await waitFor(() => expect(screen.getByText("ready line")).toBeInTheDocument());
  });

  it("falls back to the first run when selected run is no longer present", async () => {
    const onSelectRun = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <ArchiveDeck
          runs={runs}
          runsLoading={false}
          runsError={null}
          selectedArchiveDir={runs[1].output_dir}
          selectedArchiveRun={runs[1]}
          onSelectRun={onSelectRun}
          archiveSnapshot={archiveSnapshot}
          archiveSnapshotLoading={false}
          archiveSnapshotError={null}
          archiveJobs={archiveJobs}
          selectedArchiveJobIndex={null}
          onSelectJob={vi.fn()}
          onAttachRun={vi.fn()}
          onUseTemplate={vi.fn()}
        />
      </QueryClientProvider>,
    );

    rerender(
      <QueryClientProvider client={queryClient}>
        <ArchiveDeck
          runs={[runs[0]]}
          runsLoading={false}
          runsError={null}
          selectedArchiveDir={runs[1].output_dir}
          selectedArchiveRun={null}
          onSelectRun={onSelectRun}
          archiveSnapshot={archiveSnapshot}
          archiveSnapshotLoading={false}
          archiveSnapshotError={null}
          archiveJobs={archiveJobs}
          selectedArchiveJobIndex={null}
          onSelectJob={vi.fn()}
          onAttachRun={vi.fn()}
          onUseTemplate={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(onSelectRun).toHaveBeenCalledWith(runs[0].output_dir));
  });

  it("uses stacked drill-down navigation in narrow layout", () => {
    Object.defineProperty(window, "innerWidth", {
      value: 900,
      writable: true,
      configurable: true,
    });

    renderArchiveDeck();
    window.dispatchEvent(new Event("resize"));

    openJobsPane();

    expect(screen.getByRole("button", { name: "Runs" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show recent runs/i })).not.toBeInTheDocument();
    expect(screen.getByText("Run jobs")).toBeInTheDocument();
  });
});
