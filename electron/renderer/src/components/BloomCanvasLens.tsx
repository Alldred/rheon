/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { buildBloomNodes, bloomPalette } from "../lib/bloom";
import { normalizeStatus, statusTone } from "../lib/regression";
import type { JobRecord, Summary } from "../types";

interface BloomCanvasLensProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  summary: Summary;
  sessionStatus: string;
  onSelectJob: (index: number) => void;
}

interface HoverState {
  x: number;
  y: number;
  job: JobRecord;
}

function drawBloomCanvas(
  canvas: HTMLCanvasElement,
  jobs: JobRecord[],
  selectedJobIndex: number | null,
  frameMs: number,
) {
  const context = canvas.getContext("2d");
  if (!context) {
    return [];
  }

  const width = canvas.width;
  const height = canvas.height;
  const ratio = window.devicePixelRatio || 1;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.scale(ratio, ratio);

  const cssWidth = width / ratio;
  const cssHeight = height / ratio;
  const nodes = buildBloomNodes(jobs, cssWidth, cssHeight, frameMs);

  const bg = context.createLinearGradient(0, 0, cssWidth, cssHeight);
  bg.addColorStop(0, "rgba(7, 24, 49, 0.96)");
  bg.addColorStop(0.45, "rgba(12, 39, 67, 0.94)");
  bg.addColorStop(1, "rgba(20, 51, 70, 0.98)");
  context.fillStyle = bg;
  context.fillRect(0, 0, cssWidth, cssHeight);

  for (let wash = 0; wash < 4; wash += 1) {
    const radius = 120 + wash * 80;
    const washGradient = context.createRadialGradient(
      cssWidth * (0.2 + wash * 0.2),
      cssHeight * (0.15 + wash * 0.13),
      8,
      cssWidth * (0.2 + wash * 0.2),
      cssHeight * (0.15 + wash * 0.13),
      radius,
    );
    washGradient.addColorStop(0, "rgba(102, 182, 160, 0.08)");
    washGradient.addColorStop(1, "rgba(10, 22, 43, 0)");
    context.fillStyle = washGradient;
    context.fillRect(0, 0, cssWidth, cssHeight);
  }

  context.strokeStyle = "rgba(118, 170, 176, 0.16)";
  context.lineWidth = 1;
  for (let index = 0; index < 5; index += 1) {
    const y = cssHeight * (0.22 + index * 0.16);
    context.beginPath();
    context.moveTo(24, y);
    context.bezierCurveTo(cssWidth * 0.32, y - 12, cssWidth * 0.67, y + 9, cssWidth - 24, y - 4);
    context.stroke();
  }

  nodes.forEach((node) => {
    const palette = bloomPalette(node.status);
    const selected = node.id === selectedJobIndex;
    const status = normalizeStatus(node.status);
    const bloomY = node.tipY;

    context.beginPath();
    context.lineCap = "round";
    context.lineWidth = selected ? 3.2 : 2.4;
    context.strokeStyle = palette.stem;
    context.moveTo(node.x, node.stemBaseY);
    context.quadraticCurveTo(
      node.x + Math.sin((frameMs / 900) + node.id) * 6,
      node.stemBaseY - node.stemLength * 0.45,
      node.x,
      bloomY,
    );
    context.stroke();

    context.fillStyle = palette.wash;
    for (let shadow = 0; shadow < 3; shadow += 1) {
      context.beginPath();
      context.arc(
        node.x + shadow * 2,
        bloomY + shadow * 2,
        node.blossomRadius + shadow * 6,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    const pulse = status === "running" ? 0.88 + Math.sin(frameMs / 230 + node.id) * 0.12 : 1;
    const petals =
      node.detailLevel === "minimal" ? 3 : node.detailLevel === "compact" ? 4 : 5;
    const radius = node.blossomRadius * pulse;
    for (let petal = 0; petal < petals; petal += 1) {
      const angle = (Math.PI * 2 * petal) / petals + (frameMs / 2500) * 0.05;
      const offset = status === "queued" ? radius * 0.18 : radius * 0.5;
      const px = node.x + Math.cos(angle) * offset;
      const py = bloomY + Math.sin(angle) * offset;
      context.fillStyle = palette.bloom;
      context.beginPath();
      context.ellipse(
        px,
        py,
        radius * (status === "queued" ? 0.42 : 0.72),
        radius * (status === "queued" ? 0.54 : 1.02),
        angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    if (status === "failed") {
      context.strokeStyle = "rgba(255, 157, 143, 0.40)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.moveTo(node.x + radius * 0.2, bloomY + radius * 0.9);
      context.lineTo(node.x + radius * 0.8, bloomY + radius * 2);
      context.stroke();
    }

    if (["timeout", "cancelled", "interrupted"].includes(status)) {
      context.strokeStyle = "rgba(240, 219, 182, 0.46)";
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(node.x + radius * 0.2, bloomY + radius * 0.4, radius * 1.2, 0, Math.PI);
      context.stroke();
    }

    context.fillStyle = palette.accent;
    context.beginPath();
    context.arc(node.x, bloomY, Math.max(radius * 0.32, 2.2), 0, Math.PI * 2);
    context.fill();

    if (selected) {
      context.strokeStyle = "rgba(251, 247, 239, 0.96)";
      context.lineWidth = 2.4;
      context.beginPath();
      context.arc(node.x, bloomY, radius + 6, 0, Math.PI * 2);
      context.stroke();
    }
  });

  return nodes;
}

function hitTest(
  jobs: JobRecord[],
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
  frameMs: number,
) {
  const nodes = buildBloomNodes(jobs, canvas.clientWidth, canvas.clientHeight, frameMs);
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    const dx = x - node.x;
    const dy = y - node.tipY;
    if (Math.hypot(dx, dy) <= node.blossomRadius + 8) {
      return jobs.find((job) => job.index === node.id) || null;
    }
  }
  return null;
}

export function BloomCanvasLens({
  jobs,
  selectedJobIndex,
  summary,
  sessionStatus,
  onSelectJob,
}: BloomCanvasLensProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const jobsByIndex = useMemo(
    () => new Map(jobs.map((job) => [job.index, job])),
    [jobs],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      canvas.width = Math.max(Math.floor(width * ratio), 1);
      canvas.height = Math.max(Math.floor(height * ratio), 1);
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
      drawBloomCanvas(canvas, jobs, selectedJobIndex, frameMs);
      animationRef.current = window.requestAnimationFrame(render);
    };
    animationRef.current = window.requestAnimationFrame(render);
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [jobs, selectedJobIndex]);

  useEffect(() => {
    const handleFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === sceneRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  const toggleFullscreen = async () => {
    if (!sceneRef.current) {
      return;
    }
    if (document.fullscreenElement === sceneRef.current) {
      await document.exitFullscreen();
      return;
    }
    await sceneRef.current.requestFullscreen();
  };

  const updateHover = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hitTest(jobs, canvas, x, y, performance.now());
    if (!hit) {
      setHover(null);
      return;
    }
    setHover({ x, y, job: hit });
  };

  const handleSelect = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const hit = hitTest(jobs, canvas, x, y, performance.now());
    if (hit) {
      onSelectJob(hit.index);
    }
  };

  return (
    <section
      ref={sceneRef}
      className={`panel lens-panel bloom-panel${isFullscreen ? " bloom-panel--fullscreen" : ""}`}
    >
      <div className="panel__header panel__header--stack-mobile">
        <div>
          <span className="eyebrow">Whimsy lens</span>
          <h3>Bloom view</h3>
        </div>
        <div className="toolbar toolbar--tight">
          <span className={`status-dot status-dot--${statusTone(sessionStatus)}`}>
            {sessionStatus}
          </span>
          <button type="button" className="btn btn--ghost" onClick={toggleFullscreen}>
            {isFullscreen ? "Return to Console" : "Fullscreen Bloom"}
          </button>
        </div>
      </div>

      <div className="bloom-scene">
        <canvas
          ref={canvasRef}
          className="bloom-canvas"
          onPointerMove={updateHover}
          onPointerLeave={() => setHover(null)}
          onPointerDown={handleSelect}
        />
        {hover ? (
          <div
            className="bloom-tooltip"
            style={{ left: hover.x + 20, top: hover.y + 14 }}
          >
            <strong>{hover.job.test_name || `job ${hover.job.index}`}</strong>
            <span>seed {hover.job.seed}</span>
            <span>{normalizeStatus(hover.job.status)}</span>
          </div>
        ) : null}

        <div className="bloom-legend">
          <span className="legend-chip legend-chip--queued">queued</span>
          <span className="legend-chip legend-chip--running">running</span>
          <span className="legend-chip legend-chip--passed">passed</span>
          <span className="legend-chip legend-chip--failed">failed</span>
        </div>
      </div>

      <p className="bloom-copy">
        Seeds wait quietly, running jobs push stems upward, completed jobs bloom,
        and failures bleed into the paper instead of colliding.
      </p>

      {isFullscreen ? (
        <div className="fullscreen-hud">
          <div>
            <strong>{summary.total}</strong>
            <span>planned</span>
          </div>
          <div>
            <strong>{summary.running}</strong>
            <span>running</span>
          </div>
          <div>
            <strong>{summary.failed}</strong>
            <span>failed</span>
          </div>
          <div>
            <strong>{jobsByIndex.get(selectedJobIndex ?? -1)?.seed ?? "-"}</strong>
            <span>selected seed</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
