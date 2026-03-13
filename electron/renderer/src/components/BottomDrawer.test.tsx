/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { BottomDrawer } from "./BottomDrawer";
import type { RunDraft } from "../types";

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

describe("BottomDrawer", () => {
  it("shows notification enablement only when permission is default", () => {
    const onRequestNotifications = vi.fn();
    render(
      <BottomDrawer
        open
        tab="advanced"
        draft={draft}
        selectedArchiveRun={null}
        archiveSnapshot={undefined}
        archiveJobs={[]}
        selectedArchiveJobIndex={null}
        yamlImport=""
        yamlExport=""
        notificationPermission="default"
        onChangeTab={vi.fn()}
        onChangeField={vi.fn()}
        onAddTestRow={vi.fn()}
        onRemoveTestRow={vi.fn()}
        onUpdateTestRow={vi.fn()}
        onSelectArchiveJob={vi.fn()}
        onAttachArchive={vi.fn()}
        onUseArchiveTemplate={vi.fn()}
        onImportYamlChange={vi.fn()}
        onImportYaml={vi.fn()}
        onExportYaml={vi.fn()}
        onRequestNotifications={onRequestNotifications}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Enable" }));
    expect(onRequestNotifications).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/available but not yet enabled/i)).toBeInTheDocument();
  });

  it("hides notification prompt when permission is granted", () => {
    render(
      <BottomDrawer
        open
        tab="advanced"
        draft={draft}
        selectedArchiveRun={null}
        archiveSnapshot={undefined}
        archiveJobs={[]}
        selectedArchiveJobIndex={null}
        yamlImport=""
        yamlExport=""
        notificationPermission="granted"
        onChangeTab={vi.fn()}
        onChangeField={vi.fn()}
        onAddTestRow={vi.fn()}
        onRemoveTestRow={vi.fn()}
        onUpdateTestRow={vi.fn()}
        onSelectArchiveJob={vi.fn()}
        onAttachArchive={vi.fn()}
        onUseArchiveTemplate={vi.fn()}
        onImportYamlChange={vi.fn()}
        onImportYaml={vi.fn()}
        onExportYaml={vi.fn()}
        onRequestNotifications={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/available but not yet enabled/i),
    ).not.toBeInTheDocument();
  });

  it("renders suggested test names for name autocomplete", () => {
    const { container } = render(
      <BottomDrawer
        open
        tab="advanced"
        draft={draft}
        availableTestNames={["simple", "ldst", "hazard"]}
        selectedArchiveRun={null}
        archiveSnapshot={undefined}
        archiveJobs={[]}
        selectedArchiveJobIndex={null}
        yamlImport=""
        yamlExport=""
        notificationPermission="granted"
        onChangeTab={vi.fn()}
        onChangeField={vi.fn()}
        onAddTestRow={vi.fn()}
        onRemoveTestRow={vi.fn()}
        onUpdateTestRow={vi.fn()}
        onSelectArchiveJob={vi.fn()}
        onAttachArchive={vi.fn()}
        onUseArchiveTemplate={vi.fn()}
        onImportYamlChange={vi.fn()}
        onImportYaml={vi.fn()}
        onExportYaml={vi.fn()}
        onRequestNotifications={vi.fn()}
      />,
    );

    const options = container.querySelectorAll("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveAttribute("value", "simple");
    expect(options[1]).toHaveAttribute("value", "ldst");
    expect(options[2]).toHaveAttribute("value", "hazard");
  });
});
