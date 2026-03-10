/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import type {
  ApiResponse,
  RegressionConfigPayload,
  RunRecord,
  RunsResponse,
  SessionSnapshot,
} from "../types";

const apiBaseRaw =
  typeof import.meta !== "undefined"
    ? (
        import.meta as {
          env?: Record<string, string | undefined>;
        }
      ).env?.VITE_API_BASE_URL
    : "";
const API_BASE = String(apiBaseRaw || "").replace(/\/+$/, "");

function apiPath(path: string): string {
  if (!path.startsWith("/")) {
    return path;
  }
  return API_BASE ? `${API_BASE}${path}` : path;
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as T;
  return payload;
}

async function apiJson<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(apiPath(path), {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => ({}));
    const message =
      typeof errorPayload.error === "string"
        ? errorPayload.error
        : `${method} ${path} failed`;
    throw new Error(message);
  }

  return readJson<T>(response);
}

export async function getSessionState(): Promise<SessionSnapshot> {
  const payload = await apiJson<ApiResponse<SessionSnapshot>>("GET", "/api/state");
  return payload.data;
}

export async function getRuns(): Promise<RunRecord[]> {
  const payload = await apiJson<ApiResponse<RunsResponse>>("GET", "/api/runs");
  return payload.data.runs;
}

export async function getRunInfo(outputDir: string): Promise<SessionSnapshot> {
  const payload = await apiJson<ApiResponse<SessionSnapshot>>(
    "GET",
    `/api/run-info?output_dir=${encodeURIComponent(outputDir)}`,
  );
  return payload.data;
}

export async function getJobLog(
  outputDir: string,
  index: number,
): Promise<string> {
  const response = await fetch(
    `${apiPath("/api/job-log")}?output_dir=${encodeURIComponent(outputDir)}&index=${encodeURIComponent(
      String(index),
    )}`,
  );
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(
      typeof payload.error === "string" ? payload.error : "log unavailable",
    );
  }
  return response.text();
}

export async function startRun(
  payload: RegressionConfigPayload,
): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/run",
    payload,
  );
  return response.data;
}

export async function attachRun(output_dir: string): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/attach",
    { output_dir },
  );
  return response.data;
}

export async function pauseRun(): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/pause",
  );
  return response.data;
}

export async function resumeRun(): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/resume",
  );
  return response.data;
}

export async function cancelRun(): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/cancel",
  );
  return response.data;
}

export async function setParallelism(
  parallelism: number,
): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/set-parallelism",
    { parallelism },
  );
  return response.data;
}

export async function rerunFailed(): Promise<SessionSnapshot> {
  const response = await apiJson<ApiResponse<SessionSnapshot>>(
    "POST",
    "/api/rerun-failed",
  );
  return response.data;
}

export async function importYaml(
  yaml: string,
): Promise<RegressionConfigPayload> {
  const response = await apiJson<ApiResponse<RegressionConfigPayload>>(
    "POST",
    "/api/import",
    { yaml },
  );
  return response.data;
}

export async function exportYaml(
  payload: RegressionConfigPayload,
): Promise<string> {
  const response = await apiJson<{ ok: boolean; yaml: string }>(
    "POST",
    "/api/export",
    payload,
  );
  return response.yaml;
}
