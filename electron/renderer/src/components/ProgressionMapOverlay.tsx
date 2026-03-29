/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  failureClusterKeysForJob,
  normalizeStatus,
  statusTone,
} from "../lib/regression";
import type { JobRecord, Summary } from "../types";

interface ProgressionMapOverlayProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  summary: Summary;
  sessionStatus: string;
  onSelectJob: (index: number | null) => void;
  onClose: () => void;
}

interface HoverState {
  x: number;
  y: number;
  job: JobRecord;
  status: CanonicalStatus;
  clusterKey: string;
}

type CanonicalStatus = "pending" | "running" | "passed" | "failed";
type RowMode = "index" | "failure";

interface JobSample {
  tick: number;
  status: CanonicalStatus;
}

interface GpuPoint {
  x: number;
  y: number;
  status: CanonicalStatus;
  selected: 0 | 1;
}

const MAX_TICKS = 240;
const MAX_POINTS = 420_000;

function canonicalStatus(status: string | null | undefined): CanonicalStatus {
  const normalized = normalizeStatus(status);
  if (normalized === "running") {
    return "running";
  }
  if (normalized === "passed" || normalized === "complete") {
    return "passed";
  }
  if (
    normalized === "failed" ||
    normalized === "timeout" ||
    normalized === "cancelled" ||
    normalized === "interrupted"
  ) {
    return "failed";
  }
  return "pending";
}

function clusterKey(job: JobRecord): string {
  const keys = failureClusterKeysForJob(job);
  const first = keys[0] || "";
  const [, mismatch] = first.split("|");
  const text = String(mismatch || job.status_reason || "unknown").trim();
  return text || "unknown";
}

function statusCode(status: CanonicalStatus): number {
  if (status === "running") {
    return 1;
  }
  if (status === "passed") {
    return 2;
  }
  if (status === "failed") {
    return 3;
  }
  return 0;
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) {
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compileShader(
    gl,
    gl.VERTEX_SHADER,
    `#version 300 es
      precision mediump float;
      in vec2 a_pos;
      in float a_status;
      in float a_selected;
      uniform float u_point_size;
      out float v_status;
      out float v_selected;
      void main() {
        vec2 clip = vec2(a_pos.x * 2.0 - 1.0, 1.0 - a_pos.y * 2.0);
        gl_Position = vec4(clip, 0.0, 1.0);
        gl_PointSize = u_point_size + a_selected * 1.6;
        v_status = a_status;
        v_selected = a_selected;
      }
    `,
  );
  if (!vertex) {
    return null;
  }
  const fragment = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    `#version 300 es
      precision mediump float;
      in float v_status;
      in float v_selected;
      uniform float u_time;
      out vec4 outColor;

      vec3 colorFor(float statusCode) {
        if (statusCode < 0.5) {
          return vec3(0.53, 0.64, 0.74);
        }
        if (statusCode < 1.5) {
          return vec3(0.95, 0.77, 0.42);
        }
        if (statusCode < 2.5) {
          return vec3(0.35, 0.84, 0.68);
        }
        return vec3(1.00, 0.50, 0.45);
      }

      void main() {
        vec2 centered = gl_PointCoord - vec2(0.5);
        float radius = length(centered);
        if (radius > 0.52) {
          discard;
        }
        vec3 base = colorFor(v_status);
        float pulse = (v_status > 0.5 && v_status < 1.5)
          ? (0.88 + 0.12 * sin(u_time * 0.007))
          : 1.0;
        float alpha = smoothstep(0.52, 0.02, radius) * pulse;
        vec3 color = base;
        if (v_selected > 0.5) {
          color = mix(color, vec3(0.98, 0.98, 0.99), 0.42);
          alpha = max(alpha, 0.92);
        }
        outColor = vec4(color, alpha);
      }
    `,
  );
  if (!fragment) {
    gl.deleteShader(vertex);
    return null;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export function ProgressionMapOverlay({
  jobs,
  selectedJobIndex,
  summary,
  sessionStatus,
  onSelectJob,
  onClose,
}: ProgressionMapOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [rowMode, setRowMode] = useState<RowMode>("index");
  const [historyRevision, setHistoryRevision] = useState(0);
  const historyRef = useRef<Map<number, JobSample[]>>(new Map());
  const tickRef = useRef(0);
  const pointsRef = useRef<GpuPoint[]>([]);
  const rowCountRef = useRef(0);
  const visibleTickCountRef = useRef(1);
  const shaderFallbackRef = useRef(false);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const nextTick = tickRef.current + 1;
    tickRef.current = nextTick;
    visibleTickCountRef.current = Math.max(1, Math.min(MAX_TICKS, nextTick));
    jobs.forEach((job) => {
      const existing = historyRef.current.get(job.index) || [];
      const status = canonicalStatus(job.status);
      existing.push({ tick: nextTick, status });
      while (existing.length > MAX_TICKS) {
        existing.shift();
      }
      historyRef.current.set(job.index, existing);
    });
    const knownIndexes = new Set(jobs.map((job) => job.index));
    historyRef.current.forEach((_value, index) => {
      if (!knownIndexes.has(index)) {
        historyRef.current.delete(index);
      }
    });
    setHistoryRevision(nextTick);
  }, [jobs]);

  const rows = useMemo(() => {
    const entries = [...jobs].sort((left, right) => left.index - right.index);
    if (rowMode === "index") {
      return entries;
    }
    return entries.sort((left, right) => {
      const leftFailed = canonicalStatus(left.status) === "failed";
      const rightFailed = canonicalStatus(right.status) === "failed";
      if (leftFailed && rightFailed) {
        const leftKey = clusterKey(left);
        const rightKey = clusterKey(right);
        if (leftKey === rightKey) {
          return left.index - right.index;
        }
        return leftKey.localeCompare(rightKey);
      }
      if (leftFailed) {
        return -1;
      }
      if (rightFailed) {
        return 1;
      }
      return left.index - right.index;
    });
  }, [jobs, rowMode]);

  const rowIndexMap = useMemo(() => {
    const next = new Map<number, number>();
    rows.forEach((job, row) => {
      next.set(job.index, row);
    });
    return next;
  }, [rows]);

  const points = useMemo(() => {
    const totalRows = Math.max(rows.length, 1);
    const startTick = Math.max(0, tickRef.current - MAX_TICKS);
    const span = Math.max(1, tickRef.current - startTick);
    const next: GpuPoint[] = [];

    rows.forEach((job) => {
      const row = rowIndexMap.get(job.index);
      if (row === undefined) {
        return;
      }
      const samples = historyRef.current.get(job.index) || [];
      if (samples.length === 0) {
        return;
      }
      samples.forEach((sample) => {
        if (sample.tick < startTick) {
          return;
        }
        next.push({
          x: (sample.tick - startTick) / span,
          y: (row + 0.5) / totalRows,
          status: sample.status,
          selected: job.index === selectedJobIndex ? 1 : 0,
        });
      });
    });
    if (next.length > MAX_POINTS) {
      return next.slice(next.length - MAX_POINTS);
    }
    return next;
  }, [historyRevision, rowIndexMap, rows, selectedJobIndex]);

  useEffect(() => {
    pointsRef.current = points;
  }, [points]);

  useEffect(() => {
    rowCountRef.current = Math.max(1, rows.length);
  }, [rows.length]);

  useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [onClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }
    requestAnimationFrame(() => {
      overlay.requestFullscreen?.().catch(() => {
        // Continue in normal overlay mode if fullscreen fails.
      });
    });
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (document.fullscreenElement === null) {
        onClose();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const gl = canvas.getContext("webgl2", { antialias: false, alpha: true });
    if (!gl) {
      shaderFallbackRef.current = true;
      return undefined;
    }
    shaderFallbackRef.current = false;
    const program = createProgram(gl);
    if (!program) {
      shaderFallbackRef.current = true;
      return undefined;
    }

    const posLoc = gl.getAttribLocation(program, "a_pos");
    const statusLoc = gl.getAttribLocation(program, "a_status");
    const selectedLoc = gl.getAttribLocation(program, "a_selected");
    const pointSizeLoc = gl.getUniformLocation(program, "u_point_size");
    const timeLoc = gl.getUniformLocation(program, "u_time");
    if (
      posLoc < 0 ||
      statusLoc < 0 ||
      selectedLoc < 0 ||
      !pointSizeLoc ||
      !timeLoc
    ) {
      gl.deleteProgram(program);
      shaderFallbackRef.current = true;
      return undefined;
    }

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) {
      if (vao) {
        gl.deleteVertexArray(vao);
      }
      if (buffer) {
        gl.deleteBuffer(buffer);
      }
      gl.deleteProgram(program);
      shaderFallbackRef.current = true;
      return undefined;
    }

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      const height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      gl.viewport(0, 0, width, height);
    };
    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);

    const drawFallback = (context: CanvasRenderingContext2D) => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      const ratio = window.devicePixelRatio || 1;
      context.save();
      context.scale(ratio, ratio);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      context.fillStyle = "rgba(6, 19, 34, 0.95)";
      context.fillRect(0, 0, width, height);
      pointsRef.current.forEach((point) => {
        context.fillStyle =
          point.status === "pending"
            ? "rgba(136, 164, 188, 0.7)"
            : point.status === "running"
              ? "rgba(241, 197, 107, 0.9)"
              : point.status === "passed"
                ? "rgba(88, 216, 174, 0.9)"
                : "rgba(255, 127, 114, 0.9)";
        context.beginPath();
        context.arc(point.x * width, point.y * height, 2.4, 0, Math.PI * 2);
        context.fill();
      });
      context.restore();
    };

    const render = (time: number) => {
      resize();
      if (shaderFallbackRef.current) {
        const context = canvas.getContext("2d");
        if (context) {
          drawFallback(context);
        }
        frameRef.current = window.requestAnimationFrame(render);
        return;
      }

      const activePoints = pointsRef.current;
      const ratio = window.devicePixelRatio || 1;
      const cssWidth = canvas.width / ratio;
      const cssHeight = canvas.height / ratio;
      const rowCell = cssHeight / rowCountRef.current;
      const colCell = cssWidth / Math.max(1, visibleTickCountRef.current);
      const adaptiveCell = Math.min(rowCell, colCell);
      const pointSize = Math.max(2.2, Math.min(18, adaptiveCell * 0.88));

      const data = new Float32Array(activePoints.length * 4);
      for (let index = 0; index < activePoints.length; index += 1) {
        const point = activePoints[index];
        const offset = index * 4;
        data[offset] = point.x;
        data[offset + 1] = point.y;
        data[offset + 2] = statusCode(point.status);
        data[offset + 3] = point.selected;
      }

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);

      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(statusLoc);
      gl.vertexAttribPointer(statusLoc, 1, gl.FLOAT, false, 16, 8);
      gl.enableVertexAttribArray(selectedLoc);
      gl.vertexAttribPointer(selectedLoc, 1, gl.FLOAT, false, 16, 12);

      gl.uniform1f(pointSizeLoc, pointSize);
      gl.uniform1f(timeLoc, time);

      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0.03, 0.08, 0.14, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.POINTS, 0, activePoints.length);

      frameRef.current = window.requestAnimationFrame(render);
    };

    frameRef.current = window.requestAnimationFrame(render);
    return () => {
      observer.disconnect();
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    };
  }, []);

  const handleHover = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || rows.length === 0) {
      setHover(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const row = Math.floor((y / rect.height) * rows.length);
    const boundedRow = Math.min(rows.length - 1, Math.max(0, row));
    const job = rows[boundedRow];
    if (!job) {
      setHover(null);
      return;
    }
    const status = canonicalStatus(job.status);
    setHover({
      x: event.clientX - rect.left,
      y,
      job,
      status,
      clusterKey: status === "failed" ? clusterKey(job) : "-",
    });
  };

  const handleSelect = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || rows.length === 0) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    const row = Math.floor((y / rect.height) * rows.length);
    const boundedRow = Math.min(rows.length - 1, Math.max(0, row));
    const job = rows[boundedRow];
    if (job) {
      onSelectJob(job.index);
    }
  };

  const pending = summary.not_run;
  const failedGroups = new Set(
    jobs.filter((job) => canonicalStatus(job.status) === "failed").map((job) => clusterKey(job)),
  ).size;

  return (
    <section ref={overlayRef} className="atlas-overlay progression-overlay" aria-label="Progression map">
      <button
        type="button"
        className="atlas-overlay__close is-visible"
        aria-label="Close progression map"
        onClick={onClose}
      >
        ×
      </button>
      <div className="atlas-overlay__mode progression-overlay__mode">Progression map</div>
      <div className="progression-overlay__chrome">
        <div className="progression-overlay__stats">
          <span className="progression-stat">
            <strong>{summary.total}</strong>
            <small>total</small>
          </span>
          <span className="progression-stat">
            <strong>{pending}</strong>
            <small>pending</small>
          </span>
          <span className="progression-stat">
            <strong>{summary.running}</strong>
            <small>running</small>
          </span>
          <span className="progression-stat">
            <strong>{summary.passed}</strong>
            <small>passed</small>
          </span>
          <span className="progression-stat">
            <strong>{summary.failed}</strong>
            <small>failed</small>
          </span>
          <span className="progression-stat">
            <strong>{failedGroups}</strong>
            <small>groups</small>
          </span>
          <span className={`progression-stat progression-stat--status status-dot status-dot--${statusTone(sessionStatus)}`}>
            {sessionStatus}
          </span>
        </div>
        <div className="toolbar toolbar--tight">
          <div className="segmented">
            <button
              type="button"
              className={rowMode === "index" ? "is-active" : ""}
              onClick={() => setRowMode("index")}
            >
              Order: Index
            </button>
            <button
              type="button"
              className={rowMode === "failure" ? "is-active" : ""}
              onClick={() => setRowMode("failure")}
            >
              Order: Failure
            </button>
          </div>
        </div>
      </div>

      <div className="atlas-overlay__canvas-shell progression-overlay__canvas-shell">
        <canvas
          ref={canvasRef}
          className="atlas-overlay__canvas progression-overlay__canvas"
          onPointerMove={handleHover}
          onPointerLeave={() => setHover(null)}
          onPointerDown={handleSelect}
        />
        <div className="progression-overlay__axis progression-overlay__axis--x">
          <span>Older</span>
          <span>Newest</span>
        </div>
        <div className="progression-overlay__axis progression-overlay__axis--y">
          <span>Tests ({rows.length})</span>
        </div>
        {hover ? (
          <div className="atlas-overlay__tooltip" style={{ left: hover.x + 18, top: hover.y + 16 }}>
            <strong>{hover.job.test_name || `job ${hover.job.index}`}</strong>
            <span>job {hover.job.index} · seed {hover.job.seed}</span>
            <span>status: {hover.status}</span>
            {hover.status === "failed" ? <span>group: {hover.clusterKey}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="atlas-overlay__legend">
        <span className="legend-chip legend-chip--queued">pending</span>
        <span className="legend-chip legend-chip--running">running</span>
        <span className="legend-chip legend-chip--passed">passed</span>
        <span className="legend-chip legend-chip--failed">failed</span>
      </div>
    </section>
  );
}
