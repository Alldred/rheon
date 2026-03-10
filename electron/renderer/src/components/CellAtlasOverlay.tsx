/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { buildFailureClusters, normalizeStatus, statusTone } from "../lib/regression";
import { buildCellAtlasTargets, cellAtlasPalette, type CellAtlasTarget } from "../lib/cellAtlas";
import type { JobRecord, Summary } from "../types";

interface CellAtlasOverlayProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  summary: Summary;
  sessionStatus: string;
  onSelectJob: (index: number) => void;
  onClose: () => void;
}

interface SimNode extends CellAtlasTarget {
  vx: number;
  vy: number;
  currentRadius: number;
  targetX: number;
  targetY: number;
  targetRadius: number;
}

interface HoverState {
  x: number;
  y: number;
  node: SimNode;
}

function drawBlob(
  context: CanvasRenderingContext2D,
  node: SimNode,
  frameMs: number,
  selected: boolean,
) {
  const palette = cellAtlasPalette(node.status);
  const points = 18;
  const wobbleBase = normalizeStatus(node.status) === "running" ? 0.13 : 0.08;
  const wobble = node.currentRadius * wobbleBase;

  const gradient = context.createRadialGradient(
    node.x - node.currentRadius * 0.3,
    node.y - node.currentRadius * 0.36,
    2,
    node.x,
    node.y,
    node.currentRadius * 1.22,
  );
  gradient.addColorStop(0, palette.fillA);
  gradient.addColorStop(1, palette.fillB);

  context.beginPath();
  for (let point = 0; point <= points; point += 1) {
    const t = (point / points) * Math.PI * 2;
    const offset =
      Math.sin(t * 2 + frameMs * 0.0014 + node.phase) * wobble * 0.45 +
      Math.sin(t * 5 - frameMs * 0.001 + node.phase * 0.8) * wobble * 0.3 +
      Math.cos(t * 3 + node.phase * 1.5) * wobble * 0.2;
    const radius = node.currentRadius + offset;
    const x = node.x + Math.cos(t) * radius;
    const y = node.y + Math.sin(t) * radius;
    if (point === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }
  context.closePath();

  context.shadowColor = palette.glow;
  context.shadowBlur = selected ? 24 : 18;
  context.fillStyle = gradient;
  context.fill();
  context.shadowBlur = 0;
  context.lineWidth = selected ? 2.6 : 1.4;
  context.strokeStyle = selected ? "#fff4ea" : palette.outline;
  context.stroke();

  if (node.currentRadius >= 16) {
    context.fillStyle = palette.text;
    context.font = `600 ${Math.max(11, Math.floor(node.currentRadius * 0.52))}px "SF Pro Display", sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(node.label, node.x, node.y);
  }
}

function layoutSimNodes(
  nodes: SimNode[],
  width: number,
  height: number,
  frameMs: number,
) {
  const iterations = 3;
  const left = 46;
  const right = Math.max(width - 46, 80);
  const top = 42;
  const bottom = Math.max(height - 42, 80);

  for (const node of nodes) {
    const spring = normalizeStatus(node.status) === "running" ? 0.03 : 0.02;
    const driftX = Math.sin(frameMs * 0.0008 + node.phase) * 0.08;
    const driftY = Math.cos(frameMs * 0.001 + node.phase * 1.2) * 0.08;
    node.vx = (node.vx + (node.targetX - node.x) * spring + driftX) * 0.9;
    node.vy = (node.vy + (node.targetY - node.y) * spring + driftY) * 0.9;
    node.x += node.vx;
    node.y += node.vy;
    node.currentRadius += (node.targetRadius - node.currentRadius) * 0.12;
  }

  for (let step = 0; step < iterations; step += 1) {
    for (let index = 0; index < nodes.length; index += 1) {
      for (let peerIndex = index + 1; peerIndex < nodes.length; peerIndex += 1) {
        const leftNode = nodes[index];
        const rightNode = nodes[peerIndex];
        const dx = rightNode.x - leftNode.x;
        const dy = rightNode.y - leftNode.y;
        const distance = Math.hypot(dx, dy) || 0.001;
        const minDistance = leftNode.currentRadius + rightNode.currentRadius - 3;
        if (distance >= minDistance) {
          continue;
        }
        const overlap = (minDistance - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        leftNode.x -= nx * overlap;
        leftNode.y -= ny * overlap;
        rightNode.x += nx * overlap;
        rightNode.y += ny * overlap;
      }
    }
  }

  for (const node of nodes) {
    node.x = Math.min(right - node.currentRadius, Math.max(left + node.currentRadius, node.x));
    node.y = Math.min(bottom - node.currentRadius, Math.max(top + node.currentRadius, node.y));
  }
}

function drawAtlas(
  canvas: HTMLCanvasElement,
  nodes: SimNode[],
  selectedJobIndex: number | null,
  frameMs: number,
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.width;
  const height = canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.scale(ratio, ratio);
  const cssWidth = width / ratio;
  const cssHeight = height / ratio;

  const bg = context.createLinearGradient(0, 0, cssWidth, cssHeight);
  bg.addColorStop(0, "rgba(5, 18, 34, 0.98)");
  bg.addColorStop(0.44, "rgba(8, 31, 58, 0.98)");
  bg.addColorStop(1, "rgba(7, 22, 42, 0.98)");
  context.fillStyle = bg;
  context.fillRect(0, 0, cssWidth, cssHeight);

  const zoneWashes = [
    { x: cssWidth * 0.12, color: "rgba(141, 168, 186, 0.10)", label: "queued bank" },
    { x: cssWidth * 0.38, color: "rgba(255, 210, 92, 0.08)", label: "running current" },
    { x: cssWidth * 0.66, color: "rgba(72, 220, 180, 0.08)", label: "passed wash" },
    { x: cssWidth * 0.86, color: "rgba(255, 111, 90, 0.10)", label: "failure colonies" },
  ];
  zoneWashes.forEach((zone) => {
    const wash = context.createRadialGradient(zone.x, cssHeight * 0.42, 24, zone.x, cssHeight * 0.42, cssHeight * 0.66);
    wash.addColorStop(0, zone.color);
    wash.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = wash;
    context.fillRect(0, 0, cssWidth, cssHeight);
  });

  context.strokeStyle = "rgba(162, 199, 221, 0.08)";
  context.lineWidth = 1;
  [0.2, 0.5, 0.8].forEach((fraction) => {
    const x = cssWidth * fraction;
    context.beginPath();
    context.moveTo(x, 22);
    context.lineTo(x, cssHeight - 22);
    context.stroke();
  });

  context.fillStyle = "rgba(197, 216, 231, 0.72)";
  context.font = '600 12px "SF Pro Display", sans-serif';
  context.textAlign = "left";
  zoneWashes.forEach((zone) => {
    context.fillText(zone.label, zone.x - 34, 24);
  });

  nodes.forEach((node) => {
    drawBlob(context, node, frameMs, node.id === selectedJobIndex);
  });
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
  const nodesRef = useRef<Map<number, SimNode>>(new Map());
  const latestNodesRef = useRef<SimNode[]>([]);
  const animationRef = useRef<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const failureClusters = useMemo(() => buildFailureClusters(jobs), [jobs]);

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
        // Fallback to the fixed overlay if the browser blocks fullscreen.
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

    const render = (frameMs: number) => {
      const targets = buildCellAtlasTargets(jobs, canvas.clientWidth, canvas.clientHeight);
      const nextMap = new Map<number, SimNode>();
      targets.forEach((target, ordinal) => {
        const existing = nodesRef.current.get(target.id);
        nextMap.set(target.id, {
          ...target,
          targetX: target.x,
          targetY: target.y,
          targetRadius: target.radius,
          x: existing?.x ?? 42 + (ordinal % 6) * 18,
          y: existing?.y ?? 90 + ordinal * 12,
          vx: existing?.vx ?? 0,
          vy: existing?.vy ?? 0,
          currentRadius: existing?.currentRadius ?? 8,
        });
      });
      nodesRef.current = nextMap;
      const nodes = [...nextMap.values()];
      layoutSimNodes(nodes, canvas.clientWidth, canvas.clientHeight, frameMs);
      latestNodesRef.current = nodes;
      drawAtlas(canvas, nodes, selectedJobIndex, frameMs);
      animationRef.current = window.requestAnimationFrame(render);
    };

    animationRef.current = window.requestAnimationFrame(render);
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [jobs, selectedJobIndex]);

  const hitTest = (x: number, y: number) => {
    for (let index = latestNodesRef.current.length - 1; index >= 0; index -= 1) {
      const node = latestNodesRef.current[index];
      const dx = x - node.x;
      const dy = y - node.y;
      if (Math.hypot(dx, dy) <= node.currentRadius + 4) {
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
    <div ref={overlayRef} className="atlas-overlay" role="dialog" aria-modal="true">
      <div className="atlas-overlay__chrome">
        <div className="atlas-overlay__title">
          <span className="eyebrow">Fullscreen Lens</span>
          <h2>Cell Atlas</h2>
          <p>
            Queued jobs gather in the bank, running jobs swell in the current,
            passed jobs settle into the wash, and failures cluster by triage key.
          </p>
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
          <strong>{summary.running}</strong>
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
