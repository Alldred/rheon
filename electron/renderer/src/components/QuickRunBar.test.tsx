/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { QuickRunBar } from "./QuickRunBar";
import type { RunDraft, RunRecord } from "../types";

const draft: RunDraft = {
  templateSource: "",
  seed: "7",
  jobs: "4",
  update: "2",
  stages: "run",
  tests: [{ name: "simple", count: 20 }],
  output_dir: "",
  resume: "",
  verbosity: "",
  timeout_sec: "",
  max_failures: "",
  waves: false,
  fail_fast: false,
};

const runs: RunRecord[] = [
  {
    name: "saved-run",
    output_dir: "/tmp/run-1",
    status: "complete",
    status_reason: "complete",
    summary: {
      total: 20,
      scheduled: 20,
      skipped_resume: 0,
      passed: 19,
      failed: 1,
      not_run: 0,
      timed_out: 0,
      running: 0,
    },
    config: {
      tests: [{ name: "simple", count: 20 }],
      seed: 5,
      jobs: 4,
      update: 2,
      stages: "run",
    },
  },
];

describe("QuickRunBar", () => {
  it("surfaces top-level quick actions on the setup tab", () => {
    const onStartRun = vi.fn();
    const onAttachLatest = vi.fn();

    render(
      <QuickRunBar
        activeTab="run"
        draft={draft}
        runs={runs}
        busy={false}
        banner={null}
        attachLatestState="idle"
        onChangeField={vi.fn()}
        onApplyTemplate={vi.fn()}
        onStartRun={onStartRun}
        onAttachLatest={onAttachLatest}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start Run" }));
    fireEvent.click(screen.getByRole("button", { name: "Attach Latest" }));

    expect(onStartRun).toHaveBeenCalledTimes(1);
    expect(onAttachLatest).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Setup" })).not.toBeInTheDocument();
    expect(screen.getByText(/20 planned/i)).toBeInTheDocument();
  });

  it("removes run actions from archive and monitor tabs", () => {
    render(
      <QuickRunBar
        activeTab="archive"
        draft={draft}
        runs={runs}
        busy={false}
        banner={null}
        attachLatestState="idle"
        onChangeField={vi.fn()}
        onApplyTemplate={vi.fn()}
        onStartRun={vi.fn()}
        onAttachLatest={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Start Run" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attach Latest" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Regression Deck" })).toBeInTheDocument();
  });
});
