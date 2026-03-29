/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

export type MonitorLens = "table" | "bloom";
export type DrawerTab = "advanced" | "archive" | "yaml";
export type DensityMode = "dense" | "balanced";
export type InspectorSource = "active" | "archive";

export interface Summary {
  total: number;
  scheduled: number;
  skipped_resume: number;
  passed: number;
  failed: number;
  not_run: number;
  timed_out: number;
  running: number;
}

export interface TestMatrixRow {
  name: string;
  count: number;
}

export interface RegressionConfigPayload {
  tests: TestMatrixRow[];
  seed: number;
  jobs: number;
  update: number;
  stages: string | string[];
  output_dir?: string | null;
  verbosity?: string | null;
  waves?: boolean;
  timeout_sec?: number | null;
  fail_fast?: boolean;
  max_failures?: number | null;
  inject_fail_every?: number | null;
  inject_fail_message_groups?: number | null;
  resume?: string | null;
}

export interface PlannedJob {
  index: number;
  test_name: string;
  seed: number;
}

export interface JobRecord {
  index: number;
  test_name?: string | null;
  seed: number;
  status?: string | null;
  status_reason?: string | null;
  returncode?: number | null;
  timed_out?: boolean;
  duration_seconds?: number;
  run_dir?: string | null;
  log_path?: string | null;
  triage_summary?: string | null;
  triage_pc?: number | null;
  triage_instr_hex?: string | null;
  triage_instr_asm?: string | null;
  triage_mismatched_fields?: string[];
  updated_at?: string | null;
}

export interface RunningJobRecord {
  index: number;
  test_name?: string | null;
  seed: number;
  elapsed_seconds: number;
  started_at?: string | null;
}

export interface SessionControls {
  can_pause: boolean;
  can_resume: boolean;
  can_cancel: boolean;
  can_set_parallelism: boolean;
  can_rerun_failed: boolean;
  is_paused?: boolean;
  is_cancelled?: boolean;
}

export interface SessionSnapshot {
  mode: string;
  revision: number;
  status: string;
  status_reason: string;
  output_dir?: string | null;
  started_at?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  jobs: JobRecord[];
  running_jobs: RunningJobRecord[];
  planned_jobs: PlannedJob[];
  summary: Summary;
  config?: RegressionConfigPayload | null;
  controls?: SessionControls;
  last_error?: string | null;
}

export interface RunRecord {
  name: string;
  output_dir: string;
  created_at?: string | null;
  updated_at?: string | null;
  status: string;
  status_reason: string;
  summary: Summary;
  config?: RegressionConfigPayload | null;
}

export interface ApiResponse<T> {
  ok: boolean;
  data: T;
}

export interface TestSuiteResponse {
  test_suites: string[];
}

export interface RunsResponse {
  runs: RunRecord[];
}

export interface BloomNode {
  id: number;
  label: string;
  testName: string;
  seed: number;
  status: string;
  x: number;
  stemBaseY: number;
  tipY: number;
  stemLength: number;
  blossomRadius: number;
  phaseProgress: number;
  detailLevel: "lush" | "compact" | "minimal";
}

export interface FailureCluster {
  key: string;
  label: string;
  mismatch: string;
  count: number;
  samples: number[];
}

export interface BannerState {
  tone: "info" | "success" | "warn" | "error";
  message: string;
}

export interface RunDraft {
  templateSource: string;
  seed: string;
  jobs: string;
  update: string;
  stages: string;
  tests: TestMatrixRow[];
  output_dir: string;
  resume: string;
  verbosity: string;
  timeout_sec: string;
  max_failures: string;
  inject_fail_every: string;
  inject_fail_message_groups: string;
  waves: boolean;
  fail_fast: boolean;
}
