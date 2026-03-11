/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildFailureClusters,
  failureClusterKeysForJob,
  normalizeStatus,
  statusTone,
} from "../lib/regression";
import type { JobRecord, Summary } from "../types";

interface CellAtlasOverlayProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  summary: Summary;
  sessionStatus: string;
  onSelectJob: (index: number) => void;
  onClose: () => void;
}

interface DriftNode {
  id: number;
  label: string;
  testName: string;
  seed: number;
  status: string;
  clusterKey: string | null;
  phase: number;
  speed: number;
  orbitX: number;
  orbitY: number;
  wobble: number;
  baseRadius: number;
  focus: number;
  centerX: number;
  centerY: number;
  x: number;
  y: number;
}

interface HoverState {
  x: number;
  y: number;
  node: DriftNode;
}

interface Star {
  x: number;
  y: number;
  size: number;
  twinkle: number;
}

interface StatusPalette {
  coreRgb: string;
  haloRgb: string;
  text: string;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function paletteForStatus(status: string): StatusPalette {
  switch (normalizeStatus(status)) {
    case "running":
      return {
        coreRgb: "255, 221, 128",
        haloRgb: "255, 186, 76",
        text: "#fff7dc",
      };
    case "passed":
    case "complete":
      return {
        coreRgb: "129, 245, 204",
        haloRgb: "86, 221, 176",
        text: "#eafff6",
      };
    case "failed":
    case "timeout":
    case "cancelled":
    case "interrupted":
      return {
        coreRgb: "255, 148, 129",
        haloRgb: "255, 112, 93",
        text: "#fff1ed",
      };
    case "queued":
    default:
      return {
        coreRgb: "162, 196, 226",
        haloRgb: "120, 166, 205",
        text: "#edf7ff",
      };
  }
}

function buildStars(count: number): Star[] {
  const stars: Star[] = [];
  let seed = 0xdecafbad;
  for (let index = 0; index < count; index += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const x = (seed & 0xffff) / 0xffff;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const y = (seed & 0xffff) / 0xffff;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const twinkle = ((seed & 0xffff) / 0xffff) * Math.PI * 2;
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const size = 0.4 + ((seed & 0xffff) / 0xffff) * 1.6;
    stars.push({ x, y, size, twinkle });
  }
  return stars;
}

function buildDriftNodes(
  jobs: JobRecord[],
  failureClusters: ReturnType<typeof buildFailureClusters>,
  width: number,
  height: number,
  previous: Map<number, DriftNode>,
): Map<number, DriftNode> {
  const marginX = width * 0.08;
  const marginY = height * 0.1;
  const spreadWidth = width - marginX * 2;
  const spreadHeight = height - marginY * 2;

  const clusterAnchors = new Map<string, { x: number; y: number }>();
  const golden = 2.399963229728653;
  const maxClusterRadius = Math.min(width, height) * 0.28;
  failureClusters.forEach((cluster, index) => {
    const angle = index * golden;
    const radius = Math.min(maxClusterRadius, 70 + Math.sqrt(index + 1) * 70);
    const centerX = width * 0.62 + Math.cos(angle) * radius;
    const centerY = height * 0.52 + Math.sin(angle) * radius * 0.86;
    clusterAnchors.set(cluster.key, {
      x: Math.min(width - marginX, Math.max(marginX, centerX)),
      y: Math.min(height - marginY, Math.max(marginY, centerY)),
    });
  });

  const next = new Map<number, DriftNode>();

  jobs.forEach((job, ordinal) => {
    const key = `${job.test_name || "job"}-${job.index}-${job.seed}`;
    const hash = hashString(key);
    const status = normalizeStatus(job.status);
    const baseX = marginX + (((hash >>> 3) & 0xffff) / 0xffff) * spreadWidth;
    const baseY = marginY + (((hash >>> 19) & 0xffff) / 0xffff) * spreadHeight;

    let centerX = baseX;
    let centerY = baseY;
    let focus = 0.38;
    let motion = 0.8;
    let orbitX = 10 + (((hash >>> 8) & 0xff) / 0xff) * 64;
    let orbitY = 8 + (((hash >>> 24) & 0xff) / 0xff) * 52;
    let wobble = 4 + (((hash >>> 4) & 0xff) / 0xff) * 10;
    let baseRadius = 8 + (((hash >>> 12) & 0xff) / 0xff) * 14;
    let clusterKey: string | null = null;

    if (
      status === "failed" ||
      status === "timeout" ||
      status === "cancelled" ||
      status === "interrupted"
    ) {
      const clusterKeys = failureClusterKeysForJob(job);
      clusterKey = clusterKeys.find((entry) => clusterAnchors.has(entry)) ?? clusterKeys[0] ?? null;
      const anchor = clusterAnchors.get(clusterKey);
      const jitterX = (((hash >>> 10) & 0xffff) / 0xffff - 0.5) * 84;
      const jitterY = (((hash >>> 26) & 0xffff) / 0xffff - 0.5) * 74;
      if (anchor) {
        centerX = anchor.x + jitterX;
        centerY = anchor.y + jitterY;
      }
      focus = 0.96;
      motion = 1.2;
      orbitX = 8 + (((hash >>> 8) & 0xff) / 0xff) * 38;
      orbitY = 6 + (((hash >>> 24) & 0xff) / 0xff) * 32;
      wobble = 5 + (((hash >>> 4) & 0xff) / 0xff) * 9;
      baseRadius = 9 + (((hash >>> 12) & 0xff) / 0xff) * 8;
    } else if (status === "running") {
      const jitterX = (((hash >>> 3) & 0xffff) / 0xffff - 0.5) * width * 0.28;
      const jitterY = (((hash >>> 9) & 0xffff) / 0xffff - 0.5) * height * 0.22;
      centerX = width * 0.5 + jitterX;
      centerY = height * 0.5 + jitterY;
      focus = 1;
      motion = 1.45;
      orbitX = 22 + (((hash >>> 8) & 0xff) / 0xff) * 78;
      orbitY = 16 + (((hash >>> 24) & 0xff) / 0xff) * 58;
      wobble = 7 + (((hash >>> 4) & 0xff) / 0xff) * 14;
      baseRadius = 10 + (((hash >>> 12) & 0xff) / 0xff) * 10;
    } else if (status === "passed" || status === "complete") {
      focus = 0.32;
      motion = 0.72;
      baseRadius = 10 + (((hash >>> 12) & 0xff) / 0xff) * 16;
    } else {
      focus = 0.28;
      motion = 0.66;
      baseRadius = 10 + (((hash >>> 12) & 0xff) / 0xff) * 14;
    }

    const existing = previous.get(job.index);

    next.set(job.index, {
      id: job.index,
      label: String(job.index),
      testName: String(job.test_name || "job"),
      seed: job.seed,
      status,
      clusterKey,
      phase: (((hash >>> 1) & 0xffff) / 0xffff) * Math.PI * 2,
      speed: (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52) * motion,
      orbitX,
      orbitY,
      wobble,
      baseRadius,
      focus,
      centerX,
      centerY,
      x: existing?.x ?? centerX + (ordinal % 7) * 7,
      y: existing?.y ?? centerY + (ordinal % 5) * 7,
    });
  });

  return next;
}

function drawBackdrop(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  stars: Star[],
) {
  const bg = context.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, "rgba(2, 8, 20, 0.98)");
  bg.addColorStop(0.52, "rgba(5, 22, 48, 0.98)");
  bg.addColorStop(1, "rgba(2, 12, 30, 0.99)");
  context.fillStyle = bg;
  context.fillRect(0, 0, width, height);

  const hazeA = context.createRadialGradient(
    width * 0.22,
    height * 0.36,
    12,
    width * 0.22,
    height * 0.36,
    width * 0.5,
  );
  hazeA.addColorStop(0, "rgba(91, 129, 214, 0.23)");
  hazeA.addColorStop(1, "rgba(91, 129, 214, 0)");
  context.fillStyle = hazeA;
  context.fillRect(0, 0, width, height);

  const hazeB = context.createRadialGradient(
    width * 0.78,
    height * 0.62,
    12,
    width * 0.78,
    height * 0.62,
    width * 0.46,
  );
  hazeB.addColorStop(0, "rgba(43, 178, 173, 0.18)");
  hazeB.addColorStop(1, "rgba(43, 178, 173, 0)");
  context.fillStyle = hazeB;
  context.fillRect(0, 0, width, height);

  stars.forEach((star) => {
    const flicker = 0.42 + (Math.sin(time * 0.0006 + star.twinkle) + 1) * 0.34;
    context.globalAlpha = flicker;
    context.fillStyle = "#f6fcff";
    context.beginPath();
    context.arc(star.x * width, star.y * height, star.size, 0, Math.PI * 2);
    context.fill();
  });
  context.globalAlpha = 1;
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: DriftNode,
  selected: boolean,
  time: number,
) {
  const palette = paletteForStatus(node.status);
  const pulse = 1 + Math.sin(time * 0.004 + node.phase * 1.7) * 0.14;
  const focus = selected ? 1.12 : node.focus;
  const radius = node.baseRadius * (selected ? 1.25 : 1) * pulse;
  const haloRadius = radius * (focus >= 0.9 ? 4.2 : 6.5);
  const haloAlpha = Math.min(0.72, 0.12 + focus * 0.44);
  const coreAlpha = Math.min(1, 0.35 + focus * 0.68);

  const halo = context.createRadialGradient(
    node.x,
    node.y,
    radius * 0.25,
    node.x,
    node.y,
    haloRadius,
  );
  halo.addColorStop(0, `rgba(${palette.haloRgb}, ${haloAlpha.toFixed(2)})`);
  halo.addColorStop(0.5, `rgba(${palette.haloRgb}, ${(haloAlpha * 0.5).toFixed(2)})`);
  halo.addColorStop(1, `rgba(${palette.haloRgb}, 0)`);
  context.fillStyle = halo;
  context.beginPath();
  context.arc(node.x, node.y, haloRadius, 0, Math.PI * 2);
  context.fill();

  context.shadowColor = `rgba(${palette.haloRgb}, ${Math.min(0.76, focus * 0.76).toFixed(2)})`;
  context.shadowBlur = focus >= 0.9 ? 26 : 34;
  context.fillStyle = `rgba(${palette.coreRgb}, ${coreAlpha.toFixed(2)})`;
  context.beginPath();
  context.arc(node.x, node.y, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  if (focus >= 0.9) {
    context.strokeStyle = `rgba(${palette.coreRgb}, ${selected ? "0.92" : "0.64"})`;
    context.lineWidth = selected ? 1.9 : 1.2;
    context.beginPath();
    context.arc(node.x, node.y, radius + 1.5, 0, Math.PI * 2);
    context.stroke();
  }

  if (selected || focus >= 0.95) {
    context.fillStyle = palette.text;
    context.font = '600 11px "Avenir Next", "Trebuchet MS", sans-serif';
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(node.label, node.x, node.y);
  }
}

export function CellAtlasOverlay({
  jobs,
  selectedJobIndex,
  summary,
  sessionStatus,
  onSelectJob,
  onClose,
}: CellAtlasOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<Map<number, DriftNode>>(new Map());
  const latestNodesRef = useRef<DriftNode[]>([]);
  const animationRef = useRef<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const failureClusters = useMemo(() => buildFailureClusters(jobs), [jobs]);
  const stars = useMemo(() => buildStars(170), []);
  const runningCount = useMemo(
    () => jobs.filter((job) => normalizeStatus(job.status) === "running").length,
    [jobs],
  );

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return;
    }
    requestAnimationFrame(() => {
      overlay.requestFullscreen?.().catch(() => {
        // Keep overlay active when fullscreen API is denied.
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
    return () =>
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
    };
    resize();
    const observer = new ResizeObserver(() => resize());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const render = (time: number) => {
      const context = canvas.getContext("2d");
      if (!context) {
        animationRef.current = window.requestAnimationFrame(render);
        return;
      }

      const ratio = window.devicePixelRatio || 1;
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;

      const nextNodes = buildDriftNodes(
        jobs,
        failureClusters,
        width,
        height,
        nodesRef.current,
      );
      nodesRef.current = nextNodes;
      const nodes = [...nextNodes.values()];

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(ratio, ratio);

      drawBackdrop(context, width, height, time, stars);

      nodes.forEach((node) => {
        const angle = time * 0.001 * node.speed + node.phase;
        const driftX = Math.sin(time * 0.00043 + node.phase * 2.4) * node.wobble;
        const driftY = Math.cos(time * 0.00037 + node.phase * 1.8) * node.wobble * 0.8;
        node.x = node.centerX + Math.cos(angle) * node.orbitX + driftX;
        node.y = node.centerY + Math.sin(angle * 0.86) * node.orbitY + driftY;

        node.x = Math.min(width - 20, Math.max(20, node.x));
        node.y = Math.min(height - 20, Math.max(20, node.y));
      });

      latestNodesRef.current = nodes;

      nodes.forEach((node) => {
        drawNode(context, node, node.id === selectedJobIndex, time);
      });

      animationRef.current = window.requestAnimationFrame(render);
    };

    animationRef.current = window.requestAnimationFrame(render);
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [failureClusters, jobs, selectedJobIndex, stars]);

  const hitTest = (x: number, y: number) => {
    for (let index = latestNodesRef.current.length - 1; index >= 0; index -= 1) {
      const node = latestNodesRef.current[index];
      const dx = x - node.x;
      const dy = y - node.y;
      const radius = node.baseRadius + (node.focus >= 0.9 ? 12 : 16);
      if (Math.hypot(dx, dy) <= radius) {
        return node;
      }
    }
    return null;
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = hitTest(x, y);
    setHover(node ? { x, y, node } : null);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = hitTest(x, y);
    if (node) {
      onSelectJob(node.id);
    }
  };

  return (
    <div ref={overlayRef} className="atlas-overlay atlas-overlay--screensaver" role="dialog" aria-modal="true">
      <div className="atlas-overlay__chrome">
        <div className="atlas-overlay__title">
          <h2>Night Drift</h2>
          <p>Ambient bokeh for queued and passed, focused light on running and failed.</p>
        </div>

        <div className="atlas-overlay__actions">
          <span className={`status-dot status-dot--${statusTone(sessionStatus)}`}>
            {sessionStatus}
          </span>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Return to Monitor
          </button>
        </div>
      </div>

      <div className="atlas-overlay__hud">
        <div className="atlas-stat">
          <strong>{summary.total}</strong>
          <span>planned</span>
        </div>
        <div className="atlas-stat">
          <strong>{runningCount}</strong>
          <span>running</span>
        </div>
        <div className="atlas-stat">
          <strong>{summary.passed}</strong>
          <span>passed</span>
        </div>
        <div className="atlas-stat">
          <strong>{summary.failed}</strong>
          <span>failed</span>
        </div>
        <div className="atlas-stat atlas-stat--wide">
          <strong>{failureClusters.length}</strong>
          <span>failure families</span>
        </div>
      </div>

      <div className="atlas-overlay__canvas-shell">
        <canvas
          ref={canvasRef}
          className="atlas-overlay__canvas"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHover(null)}
          onPointerDown={handlePointerDown}
        />
        {hover ? (
          <div
            className="atlas-overlay__tooltip"
            style={{ left: hover.x + 24, top: hover.y + 16 }}
          >
            <strong>{hover.node.testName}</strong>
            <span>job {hover.node.id}</span>
            <span>seed {hover.node.seed}</span>
            <span>{hover.node.status}</span>
          </div>
        ) : null}
      </div>

      <div className="atlas-overlay__legend">
        <span className="legend-chip legend-chip--queued">queued bokeh</span>
        <span className="legend-chip legend-chip--running">running focus</span>
        <span className="legend-chip legend-chip--passed">passed bokeh</span>
        <span className="legend-chip legend-chip--failed">failed clusters</span>
      </div>
    </div>
  );
}
