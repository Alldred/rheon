/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import type { ReactNode } from "react";
import { formatDateTime, formatDuration, normalizeStatus, statusTone } from "../lib/regression";
import type { DrawerTab, JobRecord, RunDraft, RunRecord, SessionSnapshot } from "../types";
import { NumberStepperInput } from "./NumberStepperInput";

interface BottomDrawerProps {
  open: boolean;
  tab: DrawerTab;
  tabs?: DrawerTab[];
  embedded?: boolean;
  draft: RunDraft;
  availableTestNames?: string[];
  selectedArchiveRun: RunRecord | null;
  archiveSnapshot: SessionSnapshot | undefined;
  archiveJobs: JobRecord[];
  selectedArchiveJobIndex: number | null;
  yamlImport: string;
  yamlExport: string;
  notificationPermission: NotificationPermission | "unsupported";
  onChangeTab: (tab: DrawerTab) => void;
  onChangeField: (field: keyof RunDraft, value: string | boolean) => void;
  onAddTestRow: () => void;
  onRemoveTestRow: (index: number) => void;
  onUpdateTestRow: (index: number, field: "name" | "count", value: string) => void;
  onSelectArchiveJob: (index: number) => void;
  onAttachArchive: () => void;
  onUseArchiveTemplate: () => void;
  onImportYamlChange: (value: string) => void;
  onImportYaml: () => void;
  onExportYaml: () => void;
  onRequestNotifications: () => void;
  headerAction?: ReactNode;
}

function renderNotificationBlock(
  permission: NotificationPermission | "unsupported",
  onRequest: () => void,
) {
  if (permission === "granted") {
    return null;
  }
  if (permission === "unsupported") {
    return (
      <div className="drawer-note">
        Notifications are not available in this runtime.
      </div>
    );
  }
  if (permission === "denied") {
    return (
      <div className="drawer-note">
        Notifications are denied at the browser level. The app will stay quiet.
      </div>
    );
  }
  return (
    <div className="drawer-note drawer-note--action">
      <span>Desktop notifications are available but not yet enabled.</span>
      <button type="button" className="chip-button" onClick={onRequest}>
        Enable
      </button>
    </div>
  );
}

function ArchiveTable({
  jobs,
  selectedArchiveJobIndex,
  onSelectArchiveJob,
}: {
  jobs: JobRecord[];
  selectedArchiveJobIndex: number | null;
  onSelectArchiveJob: (index: number) => void;
}) {
  return (
    <div className="table-wrap table-wrap--dense">
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
          {jobs.length === 0 ? (
            <tr>
              <td colSpan={6} className="table-empty">
                Select a saved run to inspect its job history.
              </td>
            </tr>
          ) : null}
          {jobs.map((job) => (
            <tr
              key={job.index}
              className={job.index === selectedArchiveJobIndex ? "is-selected" : ""}
              onClick={() => onSelectArchiveJob(job.index)}
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
  );
}

export function BottomDrawer({
  open,
  tab,
  tabs = ["advanced", "archive", "yaml"],
  embedded = false,
  draft,
  availableTestNames = [],
  selectedArchiveRun,
  archiveSnapshot: _archiveSnapshot,
  archiveJobs,
  selectedArchiveJobIndex,
  yamlImport,
  yamlExport,
  notificationPermission,
  onChangeTab,
  onChangeField,
  onAddTestRow,
  onRemoveTestRow,
  onUpdateTestRow,
  onSelectArchiveJob,
  onAttachArchive: _onAttachArchive,
  onUseArchiveTemplate: _onUseArchiveTemplate,
  onImportYamlChange,
  onImportYaml,
  onExportYaml,
  onRequestNotifications,
  headerAction,
}: BottomDrawerProps) {
  return (
    <section
      className={`bottom-drawer${open ? " bottom-drawer--open" : ""}${
        embedded ? " bottom-drawer--embedded" : ""
      }`}
    >
      <div className="bottom-drawer__tabs">
        {headerAction}
        {tabs.map((entry) => (
          <button
            type="button"
            key={entry}
            className={entry === tab ? "is-active" : ""}
            onClick={() => onChangeTab(entry)}
          >
            {entry === "yaml" ? "YAML" : entry}
          </button>
        ))}
      </div>

      <div className="bottom-drawer__content">
        {tab === "advanced" ? (
          <div className="drawer-grid">
            <section className="panel drawer-panel">
              <div className="panel__header">
                <div>
                  <span className="eyebrow">Compose</span>
                  <h3>Test matrix</h3>
                </div>
                <button type="button" className="chip-button" onClick={onAddTestRow}>
                  Add row
                </button>
              </div>
              <div className="matrix-editor">
                {draft.tests.map((test, index) => (
                  <div key={index} className="matrix-row">
                    <div className="matrix-row__name">
                      <input
                        aria-label={`Test name ${index + 1}`}
                        list={`setup-test-suggestions-${index}`}
                        value={test.name}
                        onChange={(event) =>
                          onUpdateTestRow(index, "name", event.target.value)
                        }
                      />
                      <datalist id={`setup-test-suggestions-${index}`}>
                        {availableTestNames.map((name) => (
                          <option key={`${name}-${index}`} value={name} />
                        ))}
                      </datalist>
                    </div>
                    <NumberStepperInput
                      aria-label={`Test count ${index + 1}`}
                      value={String(test.count)}
                      onChange={(value) => onUpdateTestRow(index, "count", value)}
                    />
                    <button
                      type="button"
                      className="chip-button"
                      onClick={() => onRemoveTestRow(index)}
                      disabled={draft.tests.length <= 1}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel drawer-panel">
              <div className="panel__header">
                <div>
                  <span className="eyebrow">Run config</span>
                  <h3>Advanced options</h3>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Output directory</span>
                  <input
                    value={draft.output_dir}
                    onChange={(event) => onChangeField("output_dir", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Resume</span>
                  <input
                    value={draft.resume}
                    onChange={(event) => onChangeField("resume", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Verbosity</span>
                  <input
                    value={draft.verbosity}
                    onChange={(event) => onChangeField("verbosity", event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Timeout (s)</span>
                  <NumberStepperInput
                    ariaLabel="Timeout (s)"
                    value={draft.timeout_sec}
                    onChange={(value) => onChangeField("timeout_sec", value)}
                  />
                </label>
                <label className="field">
                  <span>Max failures</span>
                  <NumberStepperInput
                    ariaLabel="Max failures"
                    value={draft.max_failures}
                    onChange={(value) => onChangeField("max_failures", value)}
                  />
                </label>
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.waves}
                    onChange={(event) => onChangeField("waves", event.target.checked)}
                  />
                  <span>Enable waves</span>
                </label>
                <label className="toggle-field">
                  <input
                    type="checkbox"
                    checked={draft.fail_fast}
                    onChange={(event) => onChangeField("fail_fast", event.target.checked)}
                  />
                  <span>Fail fast</span>
                </label>
              </div>
              {renderNotificationBlock(notificationPermission, onRequestNotifications)}
            </section>
          </div>
        ) : null}

        {tab === "archive" ? (
          <section className="panel drawer-panel drawer-panel--stretch">
            <div className="panel__header">
              <div>
                <h3>{selectedArchiveRun?.name || "Archived jobs"}</h3>
              </div>
            </div>
            <ArchiveTable
              jobs={archiveJobs}
              selectedArchiveJobIndex={selectedArchiveJobIndex}
              onSelectArchiveJob={onSelectArchiveJob}
            />
          </section>
        ) : null}

        {tab === "yaml" ? (
          <div className="drawer-grid">
            <section className="panel drawer-panel">
              <div className="panel__header">
                <div>
                  <span className="eyebrow">Import</span>
                  <h3>Regression YAML</h3>
                </div>
                <button type="button" className="chip-button" onClick={onImportYaml}>
                  Import
                </button>
              </div>
              <textarea
                className="drawer-textarea"
                value={yamlImport}
                onChange={(event) => onImportYamlChange(event.target.value)}
                placeholder="Paste rheon_regr YAML here"
              />
            </section>
            <section className="panel drawer-panel">
              <div className="panel__header">
                <div>
                  <span className="eyebrow">Export</span>
                  <h3>Current draft</h3>
                </div>
                <button type="button" className="chip-button" onClick={onExportYaml}>
                  Export
                </button>
              </div>
              <textarea
                className="drawer-textarea"
                readOnly
                value={yamlExport}
                placeholder="Exported YAML appears here"
              />
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
