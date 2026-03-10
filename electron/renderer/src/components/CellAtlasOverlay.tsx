/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { buildFailureClusters, normalizeStatus, statusTone } from "../lib/regression";
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
  phase: number;
  speed: number;
  orbitX: number;
  orbitY: number;
  wobble: number;
  baseRadius: number;
  centerX: number;
  centerY: number;
  x: number;
  y: number;
  trail: Array<{ x: number; y: number }>;
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
  core: string;
  halo: string;
  trail: string;
  ring: string;
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

function laneForStatus(status: string): number {
  switch (normalizeStatus(status)) {
    case "queued":
      return 0;
    case "running":
      return 1;
    case "passed":
    case "complete":
      return 2;
    case "failed":
    case "timeout":
    case "cancelled":
    case "interrupted":
      return 3;
    default:
      return 1;
  }
}

function paletteForStatus(status: string): StatusPalette {
  switch (normalizeStatus(status)) {
    case "running":
      return {
        core: "rgba(255, 221, 128, 0.98)",
        halo: "rgba(255, 186, 76, 0.34)",
        trail: "rgba(255, 202, 109, 0.34)",
        ring: "rgba(255, 244, 202, 0.72)",
        text: "#fff7dc",
      };
    case "passed":
    case "complete":
      return {
        core: "rgba(129, 245, 204, 0.96)",
        halo: "rgba(86, 221, 176, 0.30)",
        trail: "rgba(114, 234, 189, 0.28)",
        ring: "rgba(210, 255, 240, 0.72)",
        text: "#eafff6",
      };
    case "failed":
    case "timeout":
    case "cancelled":
    case "interrupted":
      return {
        core: "rgba(255, 148, 129, 0.98)",
        halo: "rgba(255, 112, 93, 0.36)",
        trail: "rgba(255, 119, 98, 0.33)",
        ring: "rgba(255, 218, 210, 0.74)",
        text: "#fff1ed",
      };
    case "queued":
    default:
      return {
        core: "rgba(162, 196, 226, 0.92)",
        halo: "rgba(120, 166, 205, 0.25)",
        trail: "rgba(124, 175, 219, 0.22)",
        ring: "rgba(218, 234, 246, 0.68)",
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
  width: number,
  height: number,
  previous: Map<number, DriftNode>,
): Map<number, DriftNode> {
  const bandLeft = width * 0.08;
  const bandWidth = width * 0.84;
  const bandTop = height * 0.16;
  const bandHeight = height * 0.72;

  const next = new Map<number, DriftNode>();

  jobs.forEach((job, ordinal) => {
    const key = `${job.test_name || "job"}-${job.index}-${job.seed}`;
    const hash = hashString(key);
    const lane = laneForStatus(job.status || "queued");
    const laneBase = bandLeft + (lane / 3) * bandWidth;
    const laneSpread = Math.max(56, bandWidth * 0.09);
    const jitterX = (((hash >>> 3) & 0xffff) / 0xffff - 0.5) * laneSpread;
    const jitterY = (((hash >>> 9) & 0xffff) / 0xffff - 0.5) * bandHeight * 0.8;
    const centerX = laneBase + jitterX;
    const centerY = bandTop + bandHeight * 0.5 + jitterY;
    const motion = normalizeStatus(job.status) === "running" ? 1.45 : 1;
    const radiusBoost = normalizeStatus(job.status) === "running" ? 2.5 : 0;

    const existing = previous.get(job.index);

    next.set(job.index, {
      id: job.index,
      label: String(job.index),
      testName: String(job.test_name || "job"),
      seed: job.seed,
      status: normalizeStatus(job.status),
      phase: (((hash >>> 1) & 0xffff) / 0xffff) * Math.PI * 2,
      speed: (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52) * motion,
      orbitX: 26 + (((hash >>> 8) & 0xff) / 0xff) * 150,
      orbitY: 16 + (((hash >>> 24) & 0xff) / 0xff) * 82,
      wobble: 8 + (((hash >>> 4) & 0xff) / 0xff) * 14,
      baseRadius: 5 + (((hash >>> 12) & 0xff) / 0xff) * 7 + radiusBoost,
      centerX,
      centerY,
      x: existing?.x ?? centerX + (ordinal % 6) * 8,
      y: existing?.y ?? centerY + (ordinal % 4) * 8,
      trail: existing?.trail ?? [],
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

  context.strokeStyle = "rgba(194, 217, 238, 0.09)";
  context.lineWidth = 1;
  [0.12, 0.38, 0.62, 0.88].forEach((position) => {
    const x = width * position;
    context.beginPath();
    context.moveTo(x, 24);
    context.lineTo(x, height - 24);
    context.stroke();
  });

  context.fillStyle = "rgba(208, 223, 237, 0.6)";
  context.font = '600 11px "Avenir Next", "Trebuchet MS", sans-serif';
  context.textAlign = "center";
  context.fillText("queued", width * 0.12, 22);
  context.fillText("running", width * 0.38, 22);
  context.fillText("passed", width * 0.62, 22);
  context.fillText("failed", width * 0.88, 22);
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: DriftNode,
  selected: boolean,
  time: number,
) {
  const palette = paletteForStatus(node.status);

  if (node.trail.length >= 2) {
    context.lineWidth = selected ? 2.1 : 1.4;
    for (let index = 1; index < node.trail.length; index += 1) {
      const prev = node.trail[index - 1];
      const curr = node.trail[index];
      const alpha = (index / node.trail.length) * (selected ? 0.52 : 0.34);
      context.strokeStyle = palette.trail.replace(/0\.[0-9]+\)/, `${alpha.toFixed(2)})`);
      context.beginPath();
      context.moveTo(prev.x, prev.y);
      context.lineTo(curr.x, curr.y);
      context.stroke();
    }
  }

  const pulse = 1 + Math.sin(time * 0.004 + node.phase * 1.7) * 0.14;
  const radius = node.baseRadius * (selected ? 1.26 : 1) * pulse;

  context.shadowColor = palette.halo;
  context.shadowBlur = selected ? 28 : 18;
  context.fillStyle = palette.core;
  context.beginPath();
  context.arc(node.x, node.y, radius, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;

  context.strokeStyle = palette.ring;
  context.lineWidth = selected ? 2.4 : 1.2;
  context.beginPath();
  context.arc(node.x, node.y, radius + (selected ? 4 : 2), 0, Math.PI * 2);
  context.stroke();

  if (selected || radius > 8.5) {
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

      const nextNodes = buildDriftNodes(jobs, width, height, nodesRef.current);
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

        node.trail.push({ x: node.x, y: node.y });
        const maxTrail = normalizeStatus(node.status) === "running" ? 20 : 14;
        while (node.trail.length > maxTrail) {
          node.trail.shift();
        }
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
  }, [jobs, selectedJobIndex, stars]);

  const hitTest = (x: number, y: number) => {
    for (let index = latestNodesRef.current.length - 1; index >= 0; index -= 1) {
      const node = latestNodesRef.current[index];
      const dx = x - node.x;
      const dy = y - node.y;
      const radius = node.baseRadius + 9;
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
        <span className="legend-chip legend-chip--queued">queued</span>
        <span className="legend-chip legend-chip--running">running</span>
        <span className="legend-chip legend-chip--passed">passed</span>
        <span className="legend-chip legend-chip--failed">failed</span>
      </div>
    </div>
  );
}
