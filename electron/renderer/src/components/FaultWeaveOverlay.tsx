/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { failureClusterKeysForJob, normalizeStatus } from "../lib/regression";
import type { JobRecord } from "../types";

interface FaultWeaveOverlayProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  onSelectJob: (index: number | null) => void;
  onClose: () => void;
}

interface CellSeed {
  id: string;
  jobIndex: number;
  testName: string;
  seed: number;
  count: number;
  status: "queued" | "running" | "passed" | "failed";
  failGroup: string | null;
}

interface CellNode extends CellSeed {
  x: number;
  y: number;
  vx: number;
  vy: number;
  homeX: number;
  homeY: number;
  phase: number;
  weight: number;
  baseWeight: number;
  areaEstimate: number;
  targetArea: number;
  compressedFor: number;
  targetFill: [number, number, number];
  targetEdge: [number, number, number];
  currentFill: [number, number, number];
  currentEdge: [number, number, number];
}

interface HoverState {
  x: number;
  y: number;
  node: CellNode;
}

interface CellColor {
  fill: [number, number, number];
  edge: [number, number, number];
}

interface GlResources {
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  attribPosition: number;
  uniformResolution: WebGLUniformLocation | null;
  uniformPixelRatio: WebGLUniformLocation | null;
  uniformTime: WebGLUniformLocation;
  uniformCount: WebGLUniformLocation;
  uniformNodes: WebGLUniformLocation;
  uniformFill: WebGLUniformLocation;
  uniformEdge: WebGLUniformLocation;
  uniformSelected: WebGLUniformLocation;
  uniformHover: WebGLUniformLocation;
}

const MAX_RENDER_CELLS = 30;
const MAX_GPU_NODES = 30;

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;
const int MAX_NODES = ${MAX_GPU_NODES};
uniform vec2 u_resolution;
uniform float u_pixelRatio;
uniform float u_time;
uniform int u_count;
uniform vec4 u_nodes[MAX_NODES];
uniform vec3 u_fill[MAX_NODES];
uniform vec3 u_edge[MAX_NODES];
uniform int u_selected;
uniform int u_hover;

float smoothstepSafe(float e0, float e1, float x) {
  float t = clamp((x - e0) / max(0.0001, e1 - e0), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}

float hash1(float n) {
  return fract(sin(n) * 43758.5453123);
}

vec2 rotate2d(vec2 p, float a) {
  float s = sin(a);
  float c = cos(a);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y);
}

void main() {
  vec2 p = gl_FragCoord.xy / max(1.0, u_pixelRatio);
  float bestSdf = 1e9;
  float bestRadius = 1.0;
  float bestNorm = 0.0;
  float bestFailed = 0.0;
  vec3 bestFill = vec3(0.08, 0.12, 0.18);
  vec3 bestEdge = vec3(0.32, 0.42, 0.58);
  int bestIdx = 0;

  for (int i = 0; i < MAX_NODES; i += 1) {
    if (i >= u_count) {
      continue;
    }

    vec4 node = u_nodes[i];
    float f = float(i) + 1.0;
    float morphA = sin(u_time * 0.00014 + f * 1.7) * 0.08;
    float morphB = cos(u_time * 0.00012 + f * 2.1) * 0.08;
    float angle = (hash1(f * 11.3) - 0.5) * 1.9 + sin(u_time * 0.00009 + f * 0.83) * 0.26;
    float axisA = node.z * mix(0.82, 1.22, hash1(f * 3.1)) * (1.0 + morphA);
    float axisB = node.z * mix(0.82, 1.22, hash1(f * 7.7)) * (1.0 + morphB);
    float power = 2.4 + hash1(f * 5.9) * 1.2;

    vec2 q = rotate2d(p - node.xy, angle);
    float nx = pow(abs(q.x) / max(1.0, axisA), power);
    float ny = pow(abs(q.y) / max(1.0, axisB), power);
    float norm = pow(nx + ny, 1.0 / power);
    // Shrink each blob by a fixed amount to create stable dark goop gaps.
    float signedDist = (norm - 1.0) * min(axisA, axisB) + 2.2;

    if (signedDist < bestSdf) {
      bestSdf = signedDist;
      bestRadius = min(axisA, axisB);
      bestNorm = norm;
      bestFailed = node.w;
      bestFill = u_fill[i] / 255.0;
      bestEdge = u_edge[i] / 255.0;
      bestIdx = i;
    }
  }

  vec3 gapColor = vec3(0.008, 0.013, 0.022);
  vec3 color = gapColor;
  if (bestSdf <= 0.0) {
    color = mix(bestFill, bestEdge, 0.14);
    float innerLight = 1.0 - smoothstepSafe(0.16, 1.02, bestNorm);
    color += vec3(0.026, 0.03, 0.034) * innerLight * 0.48;
  } else {
    color = gapColor;
  }

  if (bestFailed > 0.5) {
    float pulse = 0.986 + sin(u_time * 0.0014 + float(bestIdx) * 0.37) * 0.014;
    color.r *= pulse;
  }

  if (bestSdf <= 0.0 && bestIdx == u_selected) {
    color += vec3(0.08, 0.08, 0.09);
  }
  if (bestSdf <= 0.0 && bestIdx == u_hover) {
    color += vec3(0.04, 0.04, 0.05);
  }

  gl_FragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
`;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function radicalInverse(index: number, base: number): number {
  let value = 0;
  let denom = 1;
  let n = index;
  while (n > 0) {
    denom *= base;
    value += (n % base) / denom;
    n = Math.floor(n / base);
  }
  return value;
}

function canonicalStatus(status: string): "queued" | "running" | "passed" | "failed" {
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
  return "queued";
}

function failGroupForJob(job: JobRecord): string {
  const key = failureClusterKeysForJob(job)[0] || "";
  const [, mismatch] = key.split("|");
  return String(mismatch || "unknown").trim() || "unknown";
}

function splitIntoBuckets(cells: CellSeed[], maxCells: number): CellSeed[] {
  if (cells.length <= maxCells) {
    return cells;
  }

  const byKey = new Map<string, CellSeed[]>();
  cells.forEach((cell) => {
    const key = cell.status === "failed" ? `failed:${cell.failGroup || "unknown"}` : cell.status;
    const list = byKey.get(key);
    if (list) {
      list.push(cell);
    } else {
      byKey.set(key, [cell]);
    }
  });

  const total = cells.length;
  const buckets: CellSeed[] = [];
  byKey.forEach((list, key) => {
    const target = Math.max(1, Math.round((list.length / total) * maxCells));
    const chunkSize = Math.max(1, Math.ceil(list.length / target));
    for (let index = 0; index < list.length; index += chunkSize) {
      const chunk = list.slice(index, index + chunkSize);
      const first = chunk[0];
      buckets.push({
        id: `${key}:${index / chunkSize}`,
        jobIndex: first.jobIndex,
        testName: chunk.length === 1 ? first.testName : `${first.testName} +${chunk.length - 1}`,
        seed: first.seed,
        count: chunk.length,
        status: first.status,
        failGroup: first.failGroup,
      });
    }
  });

  return buckets.slice(0, maxCells);
}

function buildCellSeeds(jobs: JobRecord[]): CellSeed[] {
  const sorted = [...jobs].sort((left, right) => left.index - right.index);
  const raw = sorted.map((job) => {
    const status = canonicalStatus(job.status || "queued");
    return {
      id: `job:${job.index}`,
      jobIndex: job.index,
      testName: String(job.test_name || "job"),
      seed: Number(job.seed || 0),
      count: 1,
      status,
      failGroup: status === "failed" ? failGroupForJob(job) : null,
    } satisfies CellSeed;
  });
  return splitIntoBuckets(raw, MAX_RENDER_CELLS);
}

function colorForCell(status: CellNode["status"], failGroup: string | null): CellColor {
  if (status === "failed") {
    const hueOffset = ((hashString(failGroup || "unknown") % 42) - 21) * 0.2;
    const hue = clamp(12 + hueOffset, 3, 30);
    const edgeHue = clamp(hue + 5, 6, 36);
    return {
      fill: [Math.round(220 + hue), 118, 98],
      edge: [255, Math.round(192 + edgeHue), 165],
    };
  }
  if (status === "running") {
    return { fill: [244, 204, 112], edge: [255, 236, 180] };
  }
  if (status === "passed") {
    return { fill: [100, 206, 144], edge: [164, 236, 186] };
  }
  return { fill: [118, 146, 186], edge: [166, 188, 224] };
}

function nearestNode(nodes: CellNode[], x: number, y: number): CellNode | null {
  if (nodes.length === 0) {
    return null;
  }
  let best: CellNode | null = null;
  let bestIndex = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    const dx = node.x - x;
    const dy = node.y - y;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
      bestIndex = index;
    }
  }
  if (!best) {
    return null;
  }

  const hashFloat = (value: number): number => {
    const n = Math.sin(value) * 43758.5453123;
    return n - Math.floor(n);
  };

  const time = performance.now();
  const f = bestIndex + 1;
  const morphA = Math.sin(time * 0.00014 + f * 1.7) * 0.08;
  const morphB = Math.cos(time * 0.00012 + f * 2.1) * 0.08;
  const angle = (hashFloat(f * 11.3) - 0.5) * 1.9 + Math.sin(time * 0.00009 + f * 0.83) * 0.26;
  const axisA = best.weight * (0.82 + 0.4 * hashFloat(f * 3.1)) * (1 + morphA);
  const axisB = best.weight * (0.82 + 0.4 * hashFloat(f * 7.7)) * (1 + morphB);
  const power = 2.4 + hashFloat(f * 5.9) * 1.2;

  const px = x - best.x;
  const py = y - best.y;
  const sinA = Math.sin(angle);
  const cosA = Math.cos(angle);
  const qx = cosA * px - sinA * py;
  const qy = sinA * px + cosA * py;
  const nx = Math.pow(Math.abs(qx) / Math.max(1, axisA), power);
  const ny = Math.pow(Math.abs(qy) / Math.max(1, axisB), power);
  const norm = Math.pow(nx + ny, 1 / power);
  const signedDist = (norm - 1) * Math.min(axisA, axisB) + 2.2;
  return signedDist <= 0 ? best : null;
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || "Unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(info);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext): GlResources {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create shader program");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(info);
  }

  const positionBuffer = gl.createBuffer();
  if (!positionBuffer) {
    gl.deleteProgram(program);
    throw new Error("Failed to create position buffer");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      -1, 1,
      1, -1,
      1, 1,
    ]),
    gl.STATIC_DRAW,
  );

  const attribPosition = gl.getAttribLocation(program, "a_position");
  const uniformResolution = gl.getUniformLocation(program, "u_resolution");
  const uniformPixelRatio = gl.getUniformLocation(program, "u_pixelRatio");
  const uniformTime = gl.getUniformLocation(program, "u_time");
  const uniformCount = gl.getUniformLocation(program, "u_count");
  const uniformNodes = gl.getUniformLocation(program, "u_nodes");
  const uniformFill = gl.getUniformLocation(program, "u_fill");
  const uniformEdge = gl.getUniformLocation(program, "u_edge");
  const uniformSelected = gl.getUniformLocation(program, "u_selected");
  const uniformHover = gl.getUniformLocation(program, "u_hover");

  if (
    attribPosition < 0 ||
    !uniformTime ||
    !uniformCount ||
    !uniformNodes ||
    !uniformFill ||
    !uniformEdge ||
    !uniformSelected ||
    !uniformHover
  ) {
    gl.deleteBuffer(positionBuffer);
    gl.deleteProgram(program);
    throw new Error("Missing shader attributes/uniforms");
  }

  return {
    gl,
    program,
    positionBuffer,
    attribPosition,
    uniformResolution,
    uniformPixelRatio,
    uniformTime,
    uniformCount,
    uniformNodes,
    uniformFill,
    uniformEdge,
    uniformSelected,
    uniformHover,
  };
}

export function FaultWeaveOverlay({ jobs, selectedJobIndex, onSelectJob, onClose }: FaultWeaveOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const nodesRef = useRef<Map<string, CellNode>>(new Map());
  const latestNodesRef = useRef<CellNode[]>([]);
  const hoverNodeIdRef = useRef<string | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const glRef = useRef<GlResources | null>(null);
  const nodeUniformRef = useRef<Float32Array>(new Float32Array(MAX_GPU_NODES * 4));
  const fillUniformRef = useRef<Float32Array>(new Float32Array(MAX_GPU_NODES * 3));
  const edgeUniformRef = useRef<Float32Array>(new Float32Array(MAX_GPU_NODES * 3));
  const [showClose, setShowClose] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [glError, setGlError] = useState<string | null>(null);
  const cellSeeds = useMemo(() => buildCellSeeds(jobs), [jobs]);

  useEffect(() => {
    onSelectJob(null);
    // intentional one-time clear for screensaver mode
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

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
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const resize = () => {
      const ratio = clamp(window.devicePixelRatio || 1, 1, 1.25);
      canvas.width = Math.max(1, Math.floor(canvas.clientWidth * ratio));
      canvas.height = Math.max(1, Math.floor(canvas.clientHeight * ratio));
      if (glRef.current) {
        glRef.current.gl.viewport(0, 0, canvas.width, canvas.height);
      }
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

    try {
      const gl = canvas.getContext("webgl", {
        alpha: false,
        antialias: true,
        preserveDrawingBuffer: false,
      });
      if (!gl) {
        throw new Error("WebGL unavailable");
      }
      glRef.current = createProgram(gl);
      gl.viewport(0, 0, canvas.width, canvas.height);
      setGlError(null);
    } catch (error) {
      glRef.current = null;
      setGlError(error instanceof Error ? error.message : "WebGL renderer unavailable");
      // eslint-disable-next-line no-console
      console.error("Fracture Bloom WebGL init failed", error);
    }

    return () => {
      const resources = glRef.current;
      if (!resources) {
        return;
      }
      const { gl } = resources;
      gl.deleteBuffer(resources.positionBuffer);
      gl.deleteProgram(resources.program);
      glRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const render = (time: number) => {
      const resources = glRef.current;
      if (!resources) {
        animationRef.current = window.requestAnimationFrame(render);
        return;
      }

      const lastTime = lastTimeRef.current;
      if (lastTime !== null && time - lastTime < 28) {
        animationRef.current = window.requestAnimationFrame(render);
        return;
      }
      const dt = clamp(lastTime === null ? 1 / 60 : (time - lastTime) / 1000, 1 / 120, 0.05);
      lastTimeRef.current = time;

      const ratio = clamp(window.devicePixelRatio || 1, 1, 1.25);
      const width = canvas.width / ratio;
      const height = canvas.height / ratio;
      const margin = 14;
      const minX = margin;
      const maxX = width - margin;
      const minY = margin;
      const maxY = height - 68;
      const centerX = (minX + maxX) * 0.5;
      const centerY = (minY + maxY) * 0.5;

      const nextMap = new Map<string, CellNode>();
      const nodes: CellNode[] = [];

      const meanArea = (width * height) / Math.max(1, cellSeeds.length || 1);
      const baseSpacing = clamp(Math.sqrt(meanArea) * 0.58, 26, 84);

      cellSeeds.forEach((seed, index) => {
        const hash = hashString(seed.id);
        const ux = radicalInverse(index + 1, 2);
        const uy = radicalInverse(index + 1, 3);
        const homeX = minX + ux * (maxX - minX);
        const homeY = minY + uy * (maxY - minY);
        const existing = nodesRef.current.get(seed.id);
        const color = colorForCell(seed.status, seed.failGroup);
        const sizeFactor = clamp(0.95 + Math.log2(seed.count + 1) * 0.12, 0.95, 1.25);
        const desiredArea = meanArea * sizeFactor;

        if (existing) {
          existing.homeX = homeX;
          existing.homeY = homeY;
          existing.status = seed.status;
          existing.failGroup = seed.failGroup;
          existing.testName = seed.testName;
          existing.seed = seed.seed;
          existing.jobIndex = seed.jobIndex;
          existing.count = seed.count;
          existing.id = seed.id;
          existing.targetArea = desiredArea;
          existing.baseWeight = clamp(baseSpacing * (0.92 + Math.log2(seed.count + 1) * 0.08), 24, 98);
          existing.targetFill = color.fill;
          existing.targetEdge = color.edge;
          nodes.push(existing);
          nextMap.set(seed.id, existing);
          return;
        }

        const baseWeightForSeed = clamp(baseSpacing * (0.92 + Math.log2(seed.count + 1) * 0.08), 24, 98);
        const node: CellNode = {
          ...seed,
          x: homeX + (((hash >>> 8) & 0xffff) / 0xffff - 0.5) * 24,
          y: homeY + (((hash >>> 22) & 0xffff) / 0xffff - 0.5) * 24,
          vx: (((hash >>> 2) & 0xffff) / 0xffff - 0.5) * 0.14,
          vy: (((hash >>> 16) & 0xffff) / 0xffff - 0.5) * 0.14,
          homeX,
          homeY,
          phase: (((hash >>> 4) & 0xffff) / 0xffff) * Math.PI * 2,
          weight: baseWeightForSeed,
          baseWeight: baseWeightForSeed,
          areaEstimate: desiredArea,
          targetArea: desiredArea,
          compressedFor: 0,
          targetFill: color.fill,
          targetEdge: color.edge,
          currentFill: color.fill,
          currentEdge: color.edge,
        };
        nodes.push(node);
        nextMap.set(seed.id, node);
      });

      if (nodes.length === 0) {
        const { gl } = resources;
        gl.clearColor(0.02, 0.06, 0.14, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        latestNodesRef.current = [];
        nodesRef.current = nextMap;
        animationRef.current = window.requestAnimationFrame(render);
        return;
      }

      const failNodes = nodes.filter((node) => node.status === "failed");

      const failGroupCenters = new Map<string, { x: number; y: number; count: number }>();
      failNodes.forEach((node) => {
        const key = node.failGroup || "unknown";
        const current = failGroupCenters.get(key);
        if (current) {
          current.x += node.x;
          current.y += node.y;
          current.count += 1;
        } else {
          failGroupCenters.set(key, { x: node.x, y: node.y, count: 1 });
        }
      });
      failGroupCenters.forEach((group) => {
        group.x /= Math.max(1, group.count);
        group.y /= Math.max(1, group.count);
      });

      const groupEntries = [...failGroupCenters.entries()];
      for (let iteration = 0; iteration < 2; iteration += 1) {
        for (let left = 0; left < groupEntries.length; left += 1) {
          for (let right = left + 1; right < groupEntries.length; right += 1) {
            const a = groupEntries[left][1];
            const b = groupEntries[right][1];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || 1;
            const desired = baseSpacing * 8.8;
            if (distance >= desired) {
              continue;
            }
            const push = (desired - distance) * 0.1;
            const nx = dx / distance;
            const ny = dy / distance;
            a.x = clamp(a.x - nx * push, minX, maxX);
            a.y = clamp(a.y - ny * push, minY, maxY);
            b.x = clamp(b.x + nx * push, minX, maxX);
            b.y = clamp(b.y + ny * push, minY, maxY);
          }
        }
      }

      nodes.forEach((node) => {
        for (let index = 0; index < 3; index += 1) {
          node.currentFill[index] = lerp(node.currentFill[index], node.targetFill[index], 0.024);
          node.currentEdge[index] = lerp(node.currentEdge[index], node.targetEdge[index], 0.028);
        }

        const wanderX = Math.sin(time * 0.00018 + node.phase * 0.9) * baseSpacing * 0.2;
        const wanderY = Math.cos(time * 0.00016 + node.phase * 1.07) * baseSpacing * 0.18;
        const drift = 0.0048 + Math.sin(time * 0.00054 + node.phase) * 0.0018;
        node.vx += Math.sin(time * 0.00034 + node.phase * 1.3) * drift;
        node.vy += Math.cos(time * 0.00029 + node.phase * 1.1) * drift;
        node.vx += (centerX - node.x) * 0.0003;
        node.vy += (centerY - node.y) * 0.0003;

        if (node.status === "failed") {
          const ownKey = node.failGroup || "unknown";
          const ownGroup = failGroupCenters.get(ownKey);
          if (ownGroup) {
            const dxGroup = ownGroup.x - node.x;
            const dyGroup = ownGroup.y - node.y;
            const groupDistance = Math.hypot(dxGroup, dyGroup) || 1;
            node.vx += (dxGroup / groupDistance) * 0.0018;
            node.vy += (dyGroup / groupDistance) * 0.0018;
          }

          failGroupCenters.forEach((group, key) => {
            if (key === ownKey) {
              return;
            }
            const dx = node.x - group.x;
            const dy = node.y - group.y;
            const distance = Math.hypot(dx, dy) || 1;
            const repelRange = baseSpacing * 10.5;
            if (distance < repelRange) {
              const strength = ((repelRange - distance) / repelRange) * 0.058;
              node.vx += (dx / distance) * strength;
              node.vy += (dy / distance) * strength;
            }
          });
        } else if (node.status === "passed") {
          const dxHome = node.homeX + wanderX - node.x;
          const dyHome = node.homeY + wanderY - node.y;
          node.vx += dxHome * 0.0012;
          node.vy += dyHome * 0.0012;
          failGroupCenters.forEach((group) => {
            const dx = node.x - group.x;
            const dy = node.y - group.y;
            const distance = Math.hypot(dx, dy) || 1;
            const repelRange = baseSpacing * 13.5;
            if (distance < repelRange) {
              const repel = ((repelRange - distance) / repelRange) * 0.085;
              node.vx += (dx / distance) * repel;
              node.vy += (dy / distance) * repel;
            }
          });
        } else {
          // Queued/running: no explicit status force; they move from ambient drift and collisions.
        }
      });

      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const a = nodes[left];
          const b = nodes[right];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const distance = Math.hypot(dx, dy) || 1;
          const nx = dx / distance;
          const ny = dy / distance;

          const aPassed = a.status === "passed";
          const bPassed = b.status === "passed";
          const aFailed = a.status === "failed";
          const bFailed = b.status === "failed";
          const involvesPassed = aPassed || bPassed;
          const passedVsFailed = (aPassed && bFailed) || (aFailed && bPassed);
          const passedVsPassed = aPassed && bPassed;
          let minDistance = (a.weight + b.weight) * 0.9 + 6;
          if (involvesPassed) {
            minDistance += 22;
          }
          if (passedVsFailed) {
            minDistance += 16;
          }
          if (passedVsPassed) {
            minDistance += 10;
          }
          if (distance < minDistance) {
            const repel = ((minDistance - distance) / minDistance) * (involvesPassed ? 0.28 : 0.16);
            a.vx -= nx * repel;
            a.vy -= ny * repel;
            b.vx += nx * repel;
            b.vy += ny * repel;

            if (involvesPassed) {
              const overlap = minDistance - distance;
              const correction = overlap * 0.38;
              a.x = clamp(a.x - nx * correction, minX, maxX);
              a.y = clamp(a.y - ny * correction, minY, maxY);
              b.x = clamp(b.x + nx * correction, minX, maxX);
              b.y = clamp(b.y + ny * correction, minY, maxY);
            }
          }

          // Passed cells mildly repel all other cells.
          if (involvesPassed) {
            const repelRange = minDistance * 2.7;
            if (distance < repelRange) {
              const repel = passedVsFailed
                ? ((repelRange - distance) / repelRange) * 0.082
                : passedVsPassed
                  ? ((repelRange - distance) / repelRange) * 0.066
                  : ((repelRange - distance) / repelRange) * 0.048;
              a.vx -= nx * repel;
              a.vy -= ny * repel;
              b.vx += nx * repel;
              b.vy += ny * repel;
            }
          }
        }
      }

      nodes.forEach((node) => {
        node.vx *= 0.93;
        node.vy *= 0.93;
        const speed = Math.hypot(node.vx, node.vy);
        const maxSpeed = node.status === "failed" ? 0.16 : 0.13;
        if (speed > maxSpeed) {
          const scale = maxSpeed / speed;
          node.vx *= scale;
          node.vy *= scale;
        }
        node.x = clamp(node.x + node.vx, minX, maxX);
        node.y = clamp(node.y + node.vy, minY, maxY);

        if (node.areaEstimate < node.targetArea * 0.72) {
          node.compressedFor += dt;
        } else {
          node.compressedFor = Math.max(0, node.compressedFor - dt * 1.5);
        }
        if (node.compressedFor > 0.12) {
          node.weight += baseSpacing * 0.22 * dt;
        }
        if (node.areaEstimate > node.targetArea * 1.04) {
          node.weight -= baseSpacing * 0.24 * dt;
        }
        node.weight = clamp(lerp(node.weight, node.baseWeight, 0.12), node.baseWeight * 0.92, node.baseWeight * 1.14);
      });

      const nodeCount = Math.min(nodes.length, MAX_GPU_NODES);
      const nodesData = nodeUniformRef.current;
      const fillData = fillUniformRef.current;
      const edgeData = edgeUniformRef.current;

      let selectedShaderIndex = -1;
      let hoverShaderIndex = -1;
      for (let index = 0; index < nodeCount; index += 1) {
        const node = nodes[index];
        nodesData[index * 4 + 0] = node.x;
        nodesData[index * 4 + 1] = height - node.y;
        nodesData[index * 4 + 2] = node.weight;
        nodesData[index * 4 + 3] = node.status === "failed" ? 1 : 0;
        fillData[index * 3 + 0] = node.currentFill[0];
        fillData[index * 3 + 1] = node.currentFill[1];
        fillData[index * 3 + 2] = node.currentFill[2];
        edgeData[index * 3 + 0] = node.currentEdge[0];
        edgeData[index * 3 + 1] = node.currentEdge[1];
        edgeData[index * 3 + 2] = node.currentEdge[2];

        const areaFactor = clamp(node.weight / Math.max(1, node.baseWeight), 0.6, 1.8);
        node.areaEstimate = lerp(node.areaEstimate, node.targetArea * areaFactor, 0.16);

        if (selectedJobIndex !== null && node.jobIndex === selectedJobIndex) {
          selectedShaderIndex = index;
        }
        if (hoverNodeIdRef.current !== null && node.id === hoverNodeIdRef.current) {
          hoverShaderIndex = index;
        }
      }
      nodesData.fill(0, nodeCount * 4, nodesData.length);
      fillData.fill(0, nodeCount * 3, fillData.length);
      edgeData.fill(0, nodeCount * 3, edgeData.length);

      const { gl, program, positionBuffer } = resources;
      gl.useProgram(program);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
      gl.enableVertexAttribArray(resources.attribPosition);
      gl.vertexAttribPointer(resources.attribPosition, 2, gl.FLOAT, false, 0, 0);

      if (resources.uniformResolution) {
        gl.uniform2f(resources.uniformResolution, width, height);
      }
      if (resources.uniformPixelRatio) {
        gl.uniform1f(resources.uniformPixelRatio, ratio);
      }
      gl.uniform1f(resources.uniformTime, time);
      gl.uniform1i(resources.uniformCount, nodeCount);
      gl.uniform4fv(resources.uniformNodes, nodesData);
      gl.uniform3fv(resources.uniformFill, fillData);
      gl.uniform3fv(resources.uniformEdge, edgeData);
      gl.uniform1i(resources.uniformSelected, selectedShaderIndex);
      gl.uniform1i(resources.uniformHover, hoverShaderIndex);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      latestNodesRef.current = nodes;
      nodesRef.current = nextMap;
      animationRef.current = window.requestAnimationFrame(render);
    };

    animationRef.current = window.requestAnimationFrame(render);
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [cellSeeds, selectedJobIndex]);

  const revealClose = () => {
    setShowClose(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setShowClose(false);
    }, 1800);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = nearestNode(latestNodesRef.current, x, y);
    hoverNodeIdRef.current = node?.id ?? null;
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
    const node = nearestNode(latestNodesRef.current, x, y);
    if (node) {
      onSelectJob(node.jobIndex === selectedJobIndex ? null : node.jobIndex);
      return;
    }
    onSelectJob(null);
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = nearestNode(latestNodesRef.current, x, y);
    if (!node) {
      return;
    }
    onSelectJob(node.jobIndex);
    onClose();
  };

  return (
    <div
      ref={overlayRef}
      className="atlas-overlay atlas-overlay--screensaver"
      role="dialog"
      aria-modal="true"
      onPointerMove={revealClose}
    >
      <button
        type="button"
        className={`atlas-overlay__close${showClose ? " is-visible" : ""}`}
        onClick={onClose}
        aria-label="Return to Monitor"
      >
        ×
      </button>

      <div className="atlas-overlay__mode">Fracture Bloom</div>

      <div className="atlas-overlay__canvas-shell">
        <canvas
          ref={canvasRef}
          className="atlas-overlay__canvas"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => {
            hoverNodeIdRef.current = null;
            setHover(null);
          }}
          onPointerDown={handlePointerDown}
          onDoubleClick={handleDoubleClick}
        />
        {glError ? (
          <div className="atlas-overlay__tooltip" style={{ left: 24, top: 24 }}>
            <strong>Fracture Bloom fallback required</strong>
            <span>{glError}</span>
          </div>
        ) : null}
        {hover ? (
          <div className="atlas-overlay__tooltip" style={{ left: hover.x + 24, top: hover.y + 16 }}>
            <strong>{hover.node.testName}</strong>
            <span>job {hover.node.jobIndex}</span>
            <span>seed {hover.node.seed}</span>
            <span>{hover.node.status}</span>
            {hover.node.count > 1 ? <span>{hover.node.count} tests</span> : null}
            {hover.node.failGroup ? <span>fail group: {hover.node.failGroup}</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
