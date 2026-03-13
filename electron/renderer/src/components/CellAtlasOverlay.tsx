/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  failureClusterKeysForJob,
  normalizeStatus,
} from "../lib/regression";
import type { JobRecord, Summary } from "../types";

interface CellAtlasOverlayProps {
  jobs: JobRecord[];
  selectedJobIndex: number | null;
  summary: Summary;
  sessionStatus: string;
  onSelectJob: (index: number | null) => void;
  onClose: () => void;
}

interface DriftNode {
  id: number;
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
  fromStatus: string;
  toStatus: string;
  transitionStart: number;
  transitionDuration: number;
  fromCenterX: number;
  fromCenterY: number;
  toCenterX: number;
  toCenterY: number;
  fromFocus: number;
  toFocus: number;
  fromSpeed: number;
  toSpeed: number;
  fromOrbitX: number;
  toOrbitX: number;
  fromOrbitY: number;
  toOrbitY: number;
  fromWobble: number;
  toWobble: number;
  fromBaseRadius: number;
  toBaseRadius: number;
  blobPhase: number;
  blobLobes: number;
  triageLabel: string | null;
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

interface DriftTarget {
  status: string;
  clusterKey: string | null;
  centerX: number;
  centerY: number;
  focus: number;
  motion: number;
  orbitX: number;
  orbitY: number;
  wobble: number;
  baseRadius: number;
  triageLabel: string | null;
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

function canonicalStatus(status: string): string {
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

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function easeInOutCubic(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  if (t < 0.5) {
    return 4 * t * t * t;
  }
  return 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function transitionDuration(hash: number): number {
  return 2200 + ((((hash >>> 6) & 0xff) / 0xff) * 1300);
}

function pickAnchor(
  anchors: Array<{ x: number; y: number }>,
  hash: number,
): { x: number; y: number } {
  return anchors[(hash >>> 5) % anchors.length];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTriageLabel(clusterKey: string | null): string | null {
  if (!clusterKey) {
    return null;
  }
  const key = String(clusterKey || "unknown").trim() || "unknown";
  return `mismatches=${key}`;
}

function failureGroupKeyForJob(job: JobRecord): string {
  const first = failureClusterKeysForJob(job)[0] || "";
  const [, mismatch] = first.split("|");
  const key = String(mismatch || "").trim();
  return key || "unknown";
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
  failureGroupKeys: string[],
  width: number,
  height: number,
  previous: Map<number, DriftNode>,
  time: number,
): Map<number, DriftNode> {
  const marginX = width * 0.05;
  const marginY = height * 0.07;

  const clusterAnchors = new Map<string, { x: number; y: number }>();
  const golden = 2.399963229728653;
  const maxClusterRadius = Math.min(width, height) * 0.26;
  const failedBaseX = width * 0.68;
  const failedBaseY = height * 0.57;
  failureGroupKeys.forEach((key, index) => {
    const angle = index * golden;
    const radius = Math.min(maxClusterRadius, 68 + Math.sqrt(index + 1) * 54);
    const centerX = failedBaseX + Math.cos(angle) * radius;
    const centerY = failedBaseY + Math.sin(angle) * radius * 0.86;
    clusterAnchors.set(key, {
      x: Math.min(width - marginX, Math.max(marginX, centerX)),
      y: Math.min(height - marginY, Math.max(marginY, centerY)),
    });
  });

  const statusCounts = jobs.reduce(
    (acc, job) => {
      acc[canonicalStatus(job.status)] += 1;
      return acc;
    },
    { queued: 0, running: 0, passed: 0, failed: 0 },
  );
  const occupiedDensity = Math.min(1, jobs.length / 42);
  const emptySpace = 1 - occupiedDensity;
  const driftT = time * 0.000032;
  const driftX = width * (0.03 + emptySpace * 0.07);
  const driftY = height * (0.024 + emptySpace * 0.06);

  const groupCenters: Record<"queued" | "running" | "passed" | "failed", { x: number; y: number }> = {
    queued: {
      x: width * 0.22 + Math.sin(driftT + 0.9) * driftX,
      y: height * 0.34 + Math.cos(driftT * 0.84 + 0.4) * driftY,
    },
    running: {
      x: width * 0.48 + Math.sin(driftT * 1.07 + 2.3) * (driftX * 0.84),
      y: height * 0.52 + Math.cos(driftT * 0.78 + 1.7) * (driftY * 0.72),
    },
    passed: {
      x: width * 0.8 + Math.sin(driftT * 0.72 + 3.2) * (driftX * 0.94),
      y: height * 0.24 + Math.cos(driftT * 1.06 + 2.8) * (driftY * 0.8),
    },
    failed: {
      x: failedBaseX + Math.sin(driftT * 0.94 + 4.5) * (driftX * 0.72),
      y: failedBaseY + Math.cos(driftT * 0.9 + 5.4) * (driftY * 0.76),
    },
  };

  const statuses: Array<"queued" | "running" | "passed" | "failed"> = [
    "queued",
    "running",
    "passed",
    "failed",
  ];
  const minSeparation = Math.min(width, height) * (0.2 + emptySpace * 0.16);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (let left = 0; left < statuses.length; left += 1) {
      for (let right = left + 1; right < statuses.length; right += 1) {
        const a = statuses[left];
        const b = statuses[right];
        if (statusCounts[a] === 0 && statusCounts[b] === 0) {
          continue;
        }
        const ax = groupCenters[a].x;
        const ay = groupCenters[a].y;
        const bx = groupCenters[b].x;
        const by = groupCenters[b].y;
        const dx = bx - ax;
        const dy = by - ay;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance >= minSeparation) {
          continue;
        }
        const push = (minSeparation - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        groupCenters[a].x -= nx * push;
        groupCenters[a].y -= ny * push;
        groupCenters[b].x += nx * push;
        groupCenters[b].y += ny * push;
      }
    }
  }

  statuses.forEach((status) => {
    groupCenters[status].x = clamp(groupCenters[status].x, marginX, width - marginX);
    groupCenters[status].y = clamp(groupCenters[status].y, marginY, height - marginY);
  });

  const failedOffsetX = groupCenters.failed.x - failedBaseX;
  const failedOffsetY = groupCenters.failed.y - failedBaseY;
  clusterAnchors.forEach((anchor, key) => {
    clusterAnchors.set(key, {
      x: clamp(anchor.x + failedOffsetX, marginX, width - marginX),
      y: clamp(anchor.y + failedOffsetY, marginY, height - marginY),
    });
  });

  const separatedFailClusters = [...clusterAnchors.entries()].map(([key, pos]) => ({
    key,
    x: pos.x,
    y: pos.y,
  }));
  const failClusterMinSeparation = Math.min(width, height) * 0.14;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    for (let left = 0; left < separatedFailClusters.length; left += 1) {
      for (let right = left + 1; right < separatedFailClusters.length; right += 1) {
        const a = separatedFailClusters[left];
        const b = separatedFailClusters[right];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const distance = Math.hypot(dx, dy) || 1;
        if (distance >= failClusterMinSeparation) {
          continue;
        }
        const push = (failClusterMinSeparation - distance) * 0.5;
        const nx = dx / distance;
        const ny = dy / distance;
        a.x = clamp(a.x - nx * push, marginX, width - marginX);
        a.y = clamp(a.y - ny * push, marginY, height - marginY);
        b.x = clamp(b.x + nx * push, marginX, width - marginX);
        b.y = clamp(b.y + ny * push, marginY, height - marginY);
      }
    }
  }
  separatedFailClusters.forEach((entry) => {
    clusterAnchors.set(entry.key, { x: entry.x, y: entry.y });
  });

  const queuedSpanX = width * (0.08 + emptySpace * 0.1);
  const queuedSpanY = height * (0.08 + emptySpace * 0.1);
  const runningSpanX = width * (0.05 + emptySpace * 0.06);
  const runningSpanY = height * (0.05 + emptySpace * 0.06);
  const passedSpanX = width * (0.07 + emptySpace * 0.09);
  const passedSpanY = height * (0.06 + emptySpace * 0.08);

  const queuedAnchors = [
    { x: groupCenters.queued.x - queuedSpanX, y: groupCenters.queued.y - queuedSpanY * 0.7 },
    { x: groupCenters.queued.x + queuedSpanX * 0.65, y: groupCenters.queued.y - queuedSpanY },
    { x: groupCenters.queued.x - queuedSpanX * 0.4, y: groupCenters.queued.y + queuedSpanY * 0.6 },
    { x: groupCenters.queued.x + queuedSpanX, y: groupCenters.queued.y + queuedSpanY },
  ];
  const runningAnchors = [
    { x: groupCenters.running.x - runningSpanX, y: groupCenters.running.y - runningSpanY * 0.7 },
    { x: groupCenters.running.x + runningSpanX, y: groupCenters.running.y - runningSpanY * 0.4 },
    { x: groupCenters.running.x, y: groupCenters.running.y + runningSpanY },
  ];
  const passedAnchors = [
    { x: groupCenters.passed.x - passedSpanX, y: groupCenters.passed.y - passedSpanY },
    { x: groupCenters.passed.x + passedSpanX, y: groupCenters.passed.y - passedSpanY * 0.6 },
    { x: groupCenters.passed.x - passedSpanX * 0.25, y: groupCenters.passed.y + passedSpanY * 0.5 },
    { x: groupCenters.passed.x + passedSpanX * 0.92, y: groupCenters.passed.y + passedSpanY },
  ];

  const next = new Map<number, DriftNode>();
  const queuedJobs = jobs
    .filter((job) => canonicalStatus(job.status) === "queued")
    .map((job) => job.index)
    .sort((a, b) => a - b);
  const queuedOrder = new Map<number, number>();
  queuedJobs.forEach((index, order) => queuedOrder.set(index, order));
  const queuedCount = Math.max(1, queuedJobs.length);

  jobs.forEach((job, ordinal) => {
    const key = `${job.test_name || "job"}-${job.index}-${job.seed}`;
    const hash = hashString(key);
    const status = canonicalStatus(job.status);
    const targetForStatus = (targetStatus: string): DriftTarget => {
      let clusterKey: string | null = null;
      let anchor = pickAnchor(queuedAnchors, hash);
      let jitterX = (((hash >>> 10) & 0xffff) / 0xffff - 0.5) * (180 + emptySpace * 180);
      let jitterY = (((hash >>> 26) & 0xffff) / 0xffff - 0.5) * (132 + emptySpace * 150);
      let focus = 0.2;
      let motion = 0.46;
      let orbitX = 10 + (((hash >>> 8) & 0xff) / 0xff) * 54;
      let orbitY = 8 + (((hash >>> 24) & 0xff) / 0xff) * 40;
      let wobble = 3 + (((hash >>> 4) & 0xff) / 0xff) * 8;
      let baseRadius = 9 + (((hash >>> 12) & 0xff) / 0xff) * 12;
      let triageLabel: string | null = null;

      if (targetStatus === "running") {
        anchor = pickAnchor(runningAnchors, hash);
        jitterX = (((hash >>> 3) & 0xffff) / 0xffff - 0.5) * (110 + emptySpace * 118);
        jitterY = (((hash >>> 9) & 0xffff) / 0xffff - 0.5) * (86 + emptySpace * 102);
        focus = 1;
        motion = 0.86;
        orbitX = 14 + (((hash >>> 8) & 0xff) / 0xff) * 46;
        orbitY = 12 + (((hash >>> 24) & 0xff) / 0xff) * 34;
        wobble = 6 + (((hash >>> 4) & 0xff) / 0xff) * 12;
        baseRadius = 10 + (((hash >>> 12) & 0xff) / 0xff) * 9;
      } else if (targetStatus === "passed") {
        anchor = {
          x: marginX + (((hash >>> 7) & 0xffff) / 0xffff) * (width - marginX * 2),
          y: marginY + (((hash >>> 21) & 0xffff) / 0xffff) * (height - marginY * 2),
        };
        jitterX = (((hash >>> 10) & 0xffff) / 0xffff - 0.5) * (64 + emptySpace * 68);
        jitterY = (((hash >>> 26) & 0xffff) / 0xffff - 0.5) * (52 + emptySpace * 54);
        focus = 0.23;
        motion = 0.44;
        orbitX = 12 + (((hash >>> 8) & 0xff) / 0xff) * 58;
        orbitY = 10 + (((hash >>> 24) & 0xff) / 0xff) * 42;
        wobble = 3 + (((hash >>> 4) & 0xff) / 0xff) * 8;
        baseRadius = 10 + (((hash >>> 12) & 0xff) / 0xff) * 13;
      } else if (targetStatus === "failed") {
        const failKey = failureGroupKeyForJob(job);
        clusterKey = clusterAnchors.has(failKey)
          ? failKey
          : failureGroupKeys[0] ?? failKey;
        anchor = {
          x: marginX + (((hash >>> 11) & 0xffff) / 0xffff) * (width - marginX * 2),
          y: marginY + (((hash >>> 23) & 0xffff) / 0xffff) * (height - marginY * 2),
        };
        jitterX = (((hash >>> 10) & 0xffff) / 0xffff - 0.5) * (58 + emptySpace * 62);
        jitterY = (((hash >>> 26) & 0xffff) / 0xffff - 0.5) * (44 + emptySpace * 48);
        focus = 0.96;
        motion = 0.78;
        orbitX = 12 + (((hash >>> 8) & 0xff) / 0xff) * 36;
        orbitY = 10 + (((hash >>> 24) & 0xff) / 0xff) * 30;
        wobble = 5 + (((hash >>> 4) & 0xff) / 0xff) * 10;
        baseRadius = 9 + (((hash >>> 12) & 0xff) / 0xff) * 9;
        triageLabel = formatTriageLabel(clusterKey);
      } else if (targetStatus === "queued") {
        const queuedIndex = queuedOrder.get(job.index) ?? (ordinal % queuedCount);
        const ux = radicalInverse(queuedIndex + 1, 2);
        const uy = radicalInverse(queuedIndex + 1, 3);
        anchor = {
          x: marginX + ux * (width - marginX * 2),
          y: marginY + uy * (height - marginY * 2),
        };

        const avoidCenters = [groupCenters.running, groupCenters.passed, groupCenters.failed];
        const avoidDistance = Math.min(width, height) * 0.22;
        avoidCenters.forEach((center) => {
          const dx = anchor.x - center.x;
          const dy = anchor.y - center.y;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance < avoidDistance) {
            const push = (avoidDistance - distance) * 0.68;
            anchor.x += (dx / distance) * push;
            anchor.y += (dy / distance) * push;
          }
        });
        anchor.x = clamp(anchor.x, marginX, width - marginX);
        anchor.y = clamp(anchor.y, marginY, height - marginY);
        jitterX = (((hash >>> 10) & 0xffff) / 0xffff - 0.5) * (44 + emptySpace * 34);
        jitterY = (((hash >>> 26) & 0xffff) / 0xffff - 0.5) * (38 + emptySpace * 28);
      }

      const centerX = Math.min(width - marginX, Math.max(marginX, anchor.x + jitterX));
      const centerY = Math.min(height - marginY, Math.max(marginY, anchor.y + jitterY));

      return {
        status: targetStatus,
        clusterKey,
        centerX,
        centerY,
        focus,
        motion,
        orbitX,
        orbitY,
        wobble,
        baseRadius,
        triageLabel,
      };
    };

    let target = targetForStatus(status);

    const existing = previous.get(job.index);
    const duration = transitionDuration(hash);

    if (!existing) {
      if (status === "running") {
        const queuedTarget = targetForStatus("queued");
        target = {
          ...target,
          centerX: queuedTarget.centerX,
          centerY: queuedTarget.centerY,
          focus: 0.24,
          motion: queuedTarget.motion,
          orbitX: queuedTarget.orbitX,
          orbitY: queuedTarget.orbitY,
          wobble: queuedTarget.wobble,
        };
      }
      const pendingTarget = targetForStatus("queued");
      const bootFrom = status === "queued" ? target : pendingTarget;
      const bootStart = status === "queued" ? time - duration : time;
      next.set(job.index, {
        id: job.index,
        testName: String(job.test_name || "job"),
        seed: job.seed,
        status: bootFrom.status,
        clusterKey: bootFrom.clusterKey,
        phase: (((hash >>> 1) & 0xffff) / 0xffff) * Math.PI * 2,
        speed: (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52) * bootFrom.motion,
        orbitX: bootFrom.orbitX,
        orbitY: bootFrom.orbitY,
        wobble: bootFrom.wobble,
        baseRadius: bootFrom.baseRadius,
        focus: bootFrom.focus,
        centerX: bootFrom.centerX,
        centerY: bootFrom.centerY,
        x: bootFrom.centerX + (ordinal % 7) * 7,
        y: bootFrom.centerY + (ordinal % 5) * 7,
        fromStatus: bootFrom.status,
        toStatus: target.status,
        transitionStart: bootStart,
        transitionDuration: duration,
        fromCenterX: bootFrom.centerX,
        fromCenterY: bootFrom.centerY,
        toCenterX: target.centerX,
        toCenterY: target.centerY,
        fromFocus: bootFrom.focus,
        toFocus: target.focus,
        fromSpeed: (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52) * bootFrom.motion,
        toSpeed: (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52) * target.motion,
        fromOrbitX: bootFrom.orbitX,
        toOrbitX: target.orbitX,
        fromOrbitY: bootFrom.orbitY,
        toOrbitY: target.orbitY,
        fromWobble: bootFrom.wobble,
        toWobble: target.wobble,
        fromBaseRadius: bootFrom.baseRadius,
        toBaseRadius: target.baseRadius,
        blobPhase: (((hash >>> 2) & 0xffff) / 0xffff) * Math.PI * 2,
        blobLobes: 2 + (((hash >>> 14) & 0xff) % 3),
        triageLabel: target.triageLabel,
      });
      return;
    }

    const progressRaw = Math.min(
      1,
      Math.max(0, (time - existing.transitionStart) / Math.max(1, existing.transitionDuration)),
    );
    const progress = easeInOutCubic(progressRaw);
    const currentCenterX = lerp(existing.fromCenterX, existing.toCenterX, progress);
    const currentCenterY = lerp(existing.fromCenterY, existing.toCenterY, progress);
    const currentFocus = lerp(existing.fromFocus, existing.toFocus, progress);
    const currentSpeed = lerp(existing.fromSpeed, existing.toSpeed, progress);
    const currentOrbitX = lerp(existing.fromOrbitX, existing.toOrbitX, progress);
    const currentOrbitY = lerp(existing.fromOrbitY, existing.toOrbitY, progress);
    const currentWobble = lerp(existing.fromWobble, existing.toWobble, progress);
    const currentBaseRadius = lerp(existing.fromBaseRadius, existing.toBaseRadius, progress);

    if (status === "queued" && existing.toStatus === "queued") {
      target = {
        ...target,
        centerX: existing.toCenterX,
        centerY: existing.toCenterY,
      };
    }
    if (status === "running") {
      target = {
        ...target,
        centerX: currentCenterX,
        centerY: currentCenterY,
        focus: 0.24,
        motion: existing.toSpeed / (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52),
        orbitX: currentOrbitX,
        orbitY: currentOrbitY,
        wobble: currentWobble,
      };
    }
    if (status === "passed" || status === "failed") {
      target = {
        ...target,
        centerX: currentCenterX,
        centerY: currentCenterY,
        motion: existing.toSpeed / (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52),
        orbitX: currentOrbitX,
        orbitY: currentOrbitY,
        wobble: currentWobble,
      };
    }

    const needsRetarget =
      existing.toStatus !== target.status ||
      existing.clusterKey !== target.clusterKey ||
      Math.hypot(existing.toCenterX - target.centerX, existing.toCenterY - target.centerY) > 16;

    if (needsRetarget) {
      const statusChanged = existing.toStatus !== target.status;
      const retargetDuration = statusChanged
        ? Math.round(duration * 1.45)
        : duration;
      next.set(job.index, {
        ...existing,
        testName: String(job.test_name || "job"),
        seed: job.seed,
        status: progressRaw < 0.58 ? existing.fromStatus : existing.toStatus,
        clusterKey: target.clusterKey,
        centerX: currentCenterX,
        centerY: currentCenterY,
        focus: currentFocus,
        speed: currentSpeed,
        orbitX: currentOrbitX,
        orbitY: currentOrbitY,
        wobble: currentWobble,
        baseRadius: currentBaseRadius,
        triageLabel: target.triageLabel,
        fromStatus: progressRaw < 0.58 ? existing.fromStatus : existing.toStatus,
        toStatus: target.status,
        transitionStart: time,
        transitionDuration: retargetDuration,
        fromCenterX: currentCenterX,
        fromCenterY: currentCenterY,
        toCenterX: target.centerX,
        toCenterY: target.centerY,
        fromFocus: currentFocus,
        toFocus: target.focus,
        fromSpeed: currentSpeed,
        toSpeed: (0.14 + (((hash >>> 16) & 0xff) / 0xff) * 0.52) * target.motion,
        fromOrbitX: currentOrbitX,
        toOrbitX: target.orbitX,
        fromOrbitY: currentOrbitY,
        toOrbitY: target.orbitY,
        fromWobble: currentWobble,
        toWobble: target.wobble,
        fromBaseRadius: currentBaseRadius,
        toBaseRadius: target.baseRadius,
      });
      return;
    }

    next.set(job.index, {
      ...existing,
      testName: String(job.test_name || "job"),
      seed: job.seed,
      status: progressRaw < 0.58 ? existing.fromStatus : existing.toStatus,
      centerX: currentCenterX,
      centerY: currentCenterY,
      focus: currentFocus,
      speed: currentSpeed,
      orbitX: currentOrbitX,
      orbitY: currentOrbitY,
      wobble: currentWobble,
      baseRadius: currentBaseRadius,
      triageLabel: existing.toStatus === "failed" ? existing.triageLabel : null,
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

function drawFailureGroupGlow(
  context: CanvasRenderingContext2D,
  nodes: DriftNode[],
  _time: number,
) {
  // Disabled per UX request: no background blob behind failed clusters.
  return;

  const groups = new Map<string, DriftNode[]>();
  nodes.forEach((node) => {
    if (node.toStatus !== "failed" || !node.clusterKey) {
      return;
    }
    const existing = groups.get(node.clusterKey);
    if (existing) {
      existing.push(node);
    } else {
      groups.set(node.clusterKey, [node]);
    }
  });

  groups.forEach((group) => {
    if (group.length < 2) {
      return;
    }
    const centerX = group.reduce((sum, node) => sum + node.x, 0) / group.length;
    const centerY = group.reduce((sum, node) => sum + node.y, 0) / group.length;
    const maxDistance = Math.max(
      ...group.map((node) => Math.hypot(node.x - centerX, node.y - centerY)),
      0,
    );
    const compactThreshold = 145;
    if (maxDistance > compactThreshold) {
      return;
    }

    const contourPoints: Array<{ x: number; y: number }> = [];
    const sampleCount = 36;
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const angle = (sample / sampleCount) * Math.PI * 2;
      const dirX = Math.cos(angle);
      const dirY = Math.sin(angle);
      let radial = 18;
      group.forEach((node) => {
        const dx = node.x - centerX;
        const dy = node.y - centerY;
        const projected = dx * dirX + dy * dirY;
        const normal = Math.abs(-dx * dirY + dy * dirX);
        const influence = Math.max(0, 1 - normal / 44);
        radial = Math.max(radial, projected + (20 + node.baseRadius * 0.8) * influence);
      });
      contourPoints.push({
        x: centerX + dirX * radial,
        y: centerY + dirY * radial,
      });
    }

    const drawBlob = (expand: number, fillStyle: string, strokeStyle?: string, lineWidth = 1) => {
      context.beginPath();
      contourPoints.forEach((point, index) => {
        const prev = contourPoints[(index - 1 + contourPoints.length) % contourPoints.length];
        const curr = {
          x: centerX + (point.x - centerX) * expand,
          y: centerY + (point.y - centerY) * expand,
        };
        const prevScaled = {
          x: centerX + (prev.x - centerX) * expand,
          y: centerY + (prev.y - centerY) * expand,
        };
        const midX = (prevScaled.x + curr.x) * 0.5;
        const midY = (prevScaled.y + curr.y) * 0.5;
        if (index === 0) {
          context.moveTo(midX, midY);
        } else {
          context.quadraticCurveTo(prevScaled.x, prevScaled.y, midX, midY);
        }
      });
      const last = contourPoints[contourPoints.length - 1];
      const first = contourPoints[0];
      const lastScaled = {
        x: centerX + (last.x - centerX) * expand,
        y: centerY + (last.y - centerY) * expand,
      };
      const firstScaled = {
        x: centerX + (first.x - centerX) * expand,
        y: centerY + (first.y - centerY) * expand,
      };
      const closingMidX = (lastScaled.x + firstScaled.x) * 0.5;
      const closingMidY = (lastScaled.y + firstScaled.y) * 0.5;
      context.quadraticCurveTo(lastScaled.x, lastScaled.y, closingMidX, closingMidY);
      context.closePath();
      context.fillStyle = fillStyle;
      context.fill();
      if (strokeStyle) {
        context.strokeStyle = strokeStyle;
        context.lineWidth = lineWidth;
        context.stroke();
      }
    };

    drawBlob(1.2, "rgba(255, 122, 104, 0.08)");
    drawBlob(1, "rgba(255, 122, 104, 0.12)", "rgba(255, 149, 131, 0.26)", 1.2);
  });
}

function drawNode(
  context: CanvasRenderingContext2D,
  node: DriftNode,
  selected: boolean,
  hovered: boolean,
  bokehForced: boolean,
  time: number,
) {
  const palette = paletteForStatus(node.status);
  const pulse = 1 + Math.sin(time * 0.004 + node.phase * 1.7) * 0.14;
  const isFailNode = node.toStatus === "failed" || node.status === "failed";
  let focus = node.focus;
  if (isFailNode) {
    if (selected) {
      focus = Math.max(1.12, focus);
    } else if (hovered) {
      focus = Math.max(1.02, focus);
    }
  } else {
    if (hovered) {
      focus = Math.min(0.34, focus + 0.08);
    } else if (selected) {
      focus = Math.min(0.32, focus + 0.06);
    }
  }
  if (bokehForced) {
    focus = Math.min(0.22, focus * 0.42);
  }
  const radius =
    node.baseRadius *
    (selected ? 1.18 : hovered ? 1.12 : bokehForced ? 0.92 : 1) *
    pulse;
  const isFocused = isFailNode && focus >= 0.88 && !bokehForced;
  const haloRadius = radius * (isFocused ? 4.6 : 8.4);
  const haloAlpha = isFocused
    ? Math.min(0.78, 0.2 + focus * 0.48)
    : Math.min(0.4, 0.06 + focus * 0.34);
  const coreAlpha = isFocused
    ? Math.min(1, 0.52 + focus * 0.54)
    : Math.min(0.5, 0.12 + focus * 0.28);

  const halo = context.createRadialGradient(
    node.x,
    node.y,
    radius * (isFocused ? 0.22 : 0.1),
    node.x,
    node.y,
    haloRadius,
  );
  halo.addColorStop(0, `rgba(${palette.haloRgb}, ${haloAlpha.toFixed(2)})`);
  halo.addColorStop(
    isFocused ? 0.42 : 0.32,
    `rgba(${palette.haloRgb}, ${(haloAlpha * (isFocused ? 0.54 : 0.3)).toFixed(2)})`,
  );
  halo.addColorStop(1, `rgba(${palette.haloRgb}, 0)`);
  context.fillStyle = halo;
  context.beginPath();
  context.arc(node.x, node.y, haloRadius, 0, Math.PI * 2);
  context.fill();

  context.shadowColor = `rgba(${palette.haloRgb}, ${Math.min(0.76, focus * 0.76).toFixed(2)})`;
  context.shadowBlur = isFocused ? 18 : bokehForced ? 52 : 44;
  context.fillStyle = `rgba(${palette.coreRgb}, ${coreAlpha.toFixed(2)})`;
  context.beginPath();
  context.arc(node.x, node.y, radius, 0, Math.PI * 2);
  context.fill();
  if (isFocused) {
    const lobeCount = Math.max(2, Math.min(4, node.blobLobes));
    for (let index = 0; index < lobeCount; index += 1) {
      const mix = index / lobeCount;
      const angle =
        time * (0.0012 + mix * 0.00018) +
        node.blobPhase +
        node.phase * 1.2 +
        mix * Math.PI * 2;
      const drift = radius * (0.44 + mix * 0.18);
      const lobeRadius = radius * (0.32 + mix * 0.08);
      const lx = node.x + Math.cos(angle) * drift;
      const ly = node.y + Math.sin(angle * 1.16) * drift * 0.72;
      context.fillStyle = `rgba(${palette.coreRgb}, ${(coreAlpha * (0.54 - mix * 0.12)).toFixed(2)})`;
      context.beginPath();
      context.arc(lx, ly, lobeRadius, 0, Math.PI * 2);
      context.fill();
    }

    context.strokeStyle = `rgba(${palette.coreRgb}, ${selected ? "0.96" : "0.72"})`;
    context.lineWidth = selected ? 2 : 1.35;
    context.beginPath();
    context.arc(node.x, node.y, radius + 1.2, 0, Math.PI * 2);
    context.stroke();
  }
  if (selected) {
    context.save();
    context.shadowColor = "rgba(235, 245, 255, 0.8)";
    context.shadowBlur = 18;
    context.strokeStyle = "rgba(242, 250, 255, 0.95)";
    context.lineWidth = 2.4;
    context.beginPath();
    context.arc(node.x, node.y, radius + 11, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }
  context.shadowBlur = 0;
}

export function CellAtlasOverlay({
  jobs,
  selectedJobIndex,
  onSelectJob,
  onClose,
}: CellAtlasOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef<Map<number, DriftNode>>(new Map());
  const latestNodesRef = useRef<DriftNode[]>([]);
  const hoverNodeIdRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const forceFrameCounterRef = useRef(0);
  const cachedForcesRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const [hover, setHover] = useState<HoverState | null>(null);
  const [showClose, setShowClose] = useState(false);
  const failureGroupKeys = useMemo(
    () =>
      Array.from(
        new Set(
          jobs
            .filter((job) => canonicalStatus(job.status) === "failed")
            .map((job) => failureGroupKeyForJob(job)),
        ),
      ).slice(0, 6),
    [jobs],
  );
  const stars = useMemo(() => buildStars(170), []);

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
      const edgeX = 20;
      const edgeTop = 20;
      const edgeBottom = 84;
      const minX = edgeX;
      const maxX = width - edgeX;
      const minY = edgeTop;
      const maxY = height - edgeBottom;

      const nextNodes = buildDriftNodes(
        jobs,
        failureGroupKeys,
        width,
        height,
        nodesRef.current,
        time,
      );
      nodesRef.current = nextNodes;
      const nodes = [...nextNodes.values()];

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.scale(ratio, ratio);

      drawBackdrop(context, width, height, time, stars);

      nodes.forEach((node) => {
        const progressRaw = Math.min(
          1,
          Math.max(0, (time - node.transitionStart) / Math.max(1, node.transitionDuration)),
        );
        const progress = easeInOutCubic(progressRaw);
        node.centerX = lerp(node.fromCenterX, node.toCenterX, progress);
        node.centerY = lerp(node.fromCenterY, node.toCenterY, progress);
        node.focus = lerp(node.fromFocus, node.toFocus, progress);
        node.speed = lerp(node.fromSpeed, node.toSpeed, progress);
        node.orbitX = lerp(node.fromOrbitX, node.toOrbitX, progress);
        node.orbitY = lerp(node.fromOrbitY, node.toOrbitY, progress);
        node.wobble = lerp(node.fromWobble, node.toWobble, progress);
        node.baseRadius = lerp(node.fromBaseRadius, node.toBaseRadius, progress);
        node.status = progressRaw < 0.6 ? node.fromStatus : node.toStatus;

        const angle = time * 0.001 * node.speed + node.phase;
        const driftX = Math.sin(time * 0.00043 + node.phase * 2.4) * node.wobble;
        const driftY = Math.cos(time * 0.00037 + node.phase * 1.8) * node.wobble * 0.8;
        node.x = node.centerX + Math.cos(angle) * node.orbitX + driftX;
        node.y = node.centerY + Math.sin(angle * 0.86) * node.orbitY + driftY;

        node.x = clamp(node.x, minX, maxX);
        node.y = clamp(node.y, minY, maxY);
      });

      let forces = new Map<number, { x: number; y: number }>();
      const gravityMass = new Map<string, number>();
      nodes.forEach((node) => {
        let key: string | null = null;
        if (node.toStatus === "passed") {
          key = "passed";
        } else if (node.toStatus === "failed" && node.clusterKey) {
          key = `failed:${node.clusterKey}`;
        }
        if (!key) {
          return;
        }
        gravityMass.set(key, (gravityMass.get(key) ?? 0) + 1);
      });

      forceFrameCounterRef.current += 1;
      const forceInterval =
        nodes.length >= 320 ? 4 : nodes.length >= 220 ? 3 : nodes.length >= 140 ? 2 : 1;
      const shouldRecomputeForces =
        forceFrameCounterRef.current % forceInterval === 0 ||
        cachedForcesRef.current.size !== nodes.length;

      if (shouldRecomputeForces) {
        nodes.forEach((node) => {
          forces.set(node.id, { x: 0, y: 0 });
        });

        for (let left = 0; left < nodes.length; left += 1) {
          for (let right = left + 1; right < nodes.length; right += 1) {
            const a = nodes[left];
            const b = nodes[right];
            const aForce = forces.get(a.id);
            const bForce = forces.get(b.id);
            if (!aForce || !bForce) {
              continue;
            }

            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const distance = Math.hypot(dx, dy) || 1;
            const nx = dx / distance;
            const ny = dy / distance;
            const aGroup = a.toStatus;
            const bGroup = b.toStatus;
            const sameGroup = aGroup === bGroup;
            let magnitude = 0;

            const bothFailed = aGroup === "failed" && bGroup === "failed";
            const sameFailedCluster =
              bothFailed &&
              a.clusterKey !== null &&
              b.clusterKey !== null &&
              a.clusterKey === b.clusterKey;

            if (bothFailed) {
              if (sameFailedCluster) {
                const clusterMass = gravityMass.get(`failed:${a.clusterKey}`) ?? 1;
                const attractionScale = Math.min(2.4, 1 + (clusterMass - 1) * 0.14);
                const targetDistance = 122;
                if (distance > targetDistance) {
                  magnitude =
                    ((distance - targetDistance) / targetDistance) *
                    0.08 *
                    attractionScale;
                } else {
                  magnitude = -((targetDistance - distance) / targetDistance) * 0.24;
                }
              } else {
                const diffClusterSpacing = 168;
                if (distance < diffClusterSpacing) {
                  magnitude = -((diffClusterSpacing - distance) / diffClusterSpacing) * 0.32;
                }
              }
            } else if (sameGroup) {
              if (aGroup === "queued" || aGroup === "running") {
                const spacing = aGroup === "queued" ? 126 : 118;
                if (distance < spacing) {
                  magnitude =
                    -((spacing - distance) / spacing) * (aGroup === "queued" ? 0.3 : 0.22);
                }
              } else {
                const targetDistance = 140;
                const groupMass = aGroup === "passed" ? gravityMass.get("passed") ?? 1 : 1;
                const attractionScale =
                  aGroup === "passed"
                    ? Math.min(2.2, 1 + (groupMass - 1) * 0.12)
                    : 1;
                if (distance > targetDistance) {
                  magnitude =
                    ((distance - targetDistance) / targetDistance) *
                    0.06 *
                    attractionScale;
                } else {
                  magnitude = -((targetDistance - distance) / targetDistance) * 0.24;
                }
              }
            } else {
              const queuedInPair = aGroup === "queued" || bGroup === "queued";
              const failedPassedPair =
                (aGroup === "failed" && bGroup === "passed") ||
                (aGroup === "passed" && bGroup === "failed");
              const repelRange = queuedInPair ? 246 : failedPassedPair ? 272 : 176;
              if (distance < repelRange) {
                magnitude =
                  -((repelRange - distance) / repelRange) *
                  (queuedInPair ? 0.48 : failedPassedPair ? 0.52 : 0.2);
              }
              if (failedPassedPair) {
                const longRange = 520;
                if (distance < longRange) {
                  magnitude += -((longRange - distance) / longRange) * 0.085;
                }
              }
            }

            aForce.x += nx * magnitude;
            aForce.y += ny * magnitude;
            bForce.x -= nx * magnitude;
            bForce.y -= ny * magnitude;
          }
        }
        cachedForcesRef.current = forces;
      } else {
        nodes.forEach((node) => {
          const cached = cachedForcesRef.current.get(node.id);
          forces.set(node.id, {
            x: (cached?.x ?? 0) * 0.85,
            y: (cached?.y ?? 0) * 0.85,
          });
        });
      }

      nodes.forEach((node) => {
        const force = forces.get(node.id);
        if (!force) {
          return;
        }
        const scale = node.toStatus === "queued" ? 1.08 : 0.84;
        node.x += force.x * scale;
        node.y += force.y * scale;
        node.x = clamp(node.x, minX, maxX);
        node.y = clamp(node.y, minY, maxY);
      });

      const cohesionGroups = new Map<string, DriftNode[]>();
      nodes.forEach((node) => {
        let key: string | null = null;
        if (node.toStatus === "failed" && node.clusterKey) {
          key = `failed:${node.clusterKey}`;
        } else if (node.toStatus === "passed") {
          key = "passed";
        }
        if (!key) {
          return;
        }
        const existing = cohesionGroups.get(key);
        if (existing) {
          existing.push(node);
        } else {
          cohesionGroups.set(key, [node]);
        }
      });

      cohesionGroups.forEach((group) => {
        if (group.length < 2) {
          return;
        }
        const gravityScale = Math.min(2.6, 1 + (group.length - 1) * 0.14);
        const cx = group.reduce((sum, node) => sum + node.x, 0) / group.length;
        const cy = group.reduce((sum, node) => sum + node.y, 0) / group.length;
        group.forEach((node) => {
          const dx = cx - node.x;
          const dy = cy - node.y;
          const distance = Math.hypot(dx, dy) || 1;
          const nx = dx / distance;
          const ny = dy / distance;
          const step = Math.min(0.44, distance * 0.0029 * gravityScale);
          node.x = clamp(node.x + nx * step, minX, maxX);
          node.y = clamp(node.y + ny * step, minY, maxY);
          node.centerX = clamp(node.centerX + nx * step * 0.7, minX, maxX);
          node.centerY = clamp(node.centerY + ny * step * 0.7, minY, maxY);
          node.toCenterX = clamp(node.toCenterX + nx * step * 0.5, minX, maxX);
          node.toCenterY = clamp(node.toCenterY + ny * step * 0.5, minY, maxY);
        });
      });

      const passedGroup = cohesionGroups.get("passed") ?? [];
      const failedGroups = [...cohesionGroups.entries()].filter(([key]) => key.startsWith("failed:"));
      if (passedGroup.length > 0 && failedGroups.length > 0) {
        const passedCx = passedGroup.reduce((sum, node) => sum + node.x, 0) / passedGroup.length;
        const passedCy = passedGroup.reduce((sum, node) => sum + node.y, 0) / passedGroup.length;
        failedGroups.forEach(([, failedGroup]) => {
          if (failedGroup.length === 0) {
            return;
          }
          const failedCx = failedGroup.reduce((sum, node) => sum + node.x, 0) / failedGroup.length;
          const failedCy = failedGroup.reduce((sum, node) => sum + node.y, 0) / failedGroup.length;
          const dx = failedCx - passedCx;
          const dy = failedCy - passedCy;
          const distance = Math.hypot(dx, dy) || 1;
          const desired = Math.min(width, height) * 0.42;
          if (distance >= desired) {
            return;
          }
          const push = Math.min(1.05, (desired - distance) * 0.0062);
          const nx = dx / distance;
          const ny = dy / distance;
          passedGroup.forEach((node) => {
            node.x = clamp(node.x - nx * push * 0.55, minX, maxX);
            node.y = clamp(node.y - ny * push * 0.55, minY, maxY);
            node.centerX = clamp(node.centerX - nx * push * 0.72, minX, maxX);
            node.centerY = clamp(node.centerY - ny * push * 0.72, minY, maxY);
            node.toCenterX = clamp(node.toCenterX - nx * push * 0.48, minX, maxX);
            node.toCenterY = clamp(node.toCenterY - ny * push * 0.48, minY, maxY);
          });
          failedGroup.forEach((node) => {
            node.x = clamp(node.x + nx * push * 0.85, minX, maxX);
            node.y = clamp(node.y + ny * push * 0.85, minY, maxY);
            node.centerX = clamp(node.centerX + nx * push * 1.02, minX, maxX);
            node.centerY = clamp(node.centerY + ny * push * 1.02, minY, maxY);
            node.toCenterX = clamp(node.toCenterX + nx * push * 0.68, minX, maxX);
            node.toCenterY = clamp(node.toCenterY + ny * push * 0.68, minY, maxY);
          });
        });
      }

      const boundaryGroups: Array<"running" | "passed" | "failed"> = [
        "running",
        "passed",
        "failed",
      ];
      const boundaryPush = new Map<number, { x: number; y: number }>();
      nodes.forEach((node) => {
        boundaryPush.set(node.id, { x: 0, y: 0 });
      });

      boundaryGroups.forEach((groupStatus) => {
        const members = nodes.filter((node) => node.toStatus === groupStatus);
        if (members.length < 2) {
          return;
        }

        const centerX =
          members.reduce((sum, node) => sum + node.centerX, 0) / members.length;
        const centerY =
          members.reduce((sum, node) => sum + node.centerY, 0) / members.length;
        const memberRadius =
          Math.max(
            ...members.map((node) =>
              Math.hypot(node.centerX - centerX, node.centerY - centerY),
            ),
            24,
          ) + 72;

        nodes.forEach((node) => {
          if (node.toStatus === groupStatus) {
            return;
          }
          const dx = node.centerX - centerX;
          const dy = node.centerY - centerY;
          const distance = Math.hypot(dx, dy) || 1;
          if (distance >= memberRadius) {
            return;
          }
          const overlap = memberRadius - distance;
          const nx = dx / distance;
          const ny = dy / distance;
          const strength = (overlap / memberRadius) * 0.022;
          const push = Math.min(1.1, overlap * strength);
          const entry = boundaryPush.get(node.id);
          if (!entry) {
            return;
          }
          entry.x += nx * push;
          entry.y += ny * push;
        });
      });

      nodes.forEach((node) => {
        const push = boundaryPush.get(node.id);
        if (!push) {
          return;
        }
        const ownDriftX = node.toCenterX - node.centerX;
        const ownDriftY = node.toCenterY - node.centerY;
        const pullBackX = ownDriftX * 0.06;
        const pullBackY = ownDriftY * 0.06;
        const deltaX = push.x + pullBackX;
        const deltaY = push.y + pullBackY;

        node.centerX = clamp(node.centerX + deltaX, minX, maxX);
        node.centerY = clamp(node.centerY + deltaY, minY, maxY);
        node.x = clamp(node.x + deltaX, minX, maxX);
        node.y = clamp(node.y + deltaY, minY, maxY);
      });

      latestNodesRef.current = nodes;
      drawFailureGroupGlow(context, nodes, time);

      nodes.forEach((node) => {
        const hasSelection = selectedJobIndex !== null;
        const bokehForced = hasSelection && node.id !== selectedJobIndex;
        drawNode(
          context,
          node,
          node.id === selectedJobIndex,
          node.id === hoverNodeIdRef.current,
          bokehForced,
          time,
        );
      });

      animationRef.current = window.requestAnimationFrame(render);
    };

    animationRef.current = window.requestAnimationFrame(render);
    return () => {
      if (animationRef.current !== null) {
        window.cancelAnimationFrame(animationRef.current);
      }
    };
  }, [failureGroupKeys, jobs, selectedJobIndex, stars]);

  const hitTest = (x: number, y: number, mode: "hover" | "click" = "hover") => {
    for (let index = latestNodesRef.current.length - 1; index >= 0; index -= 1) {
      const node = latestNodesRef.current[index];
      const dx = x - node.x;
      const dy = y - node.y;
      const radius =
        mode === "click"
          ? Math.max(2, Math.min(6, node.baseRadius * 0.34))
          : node.baseRadius + (node.focus >= 0.9 ? 7 : 4);
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
    const node = hitTest(x, y, "hover");
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
    const node = hitTest(x, y, "click");
    if (node) {
      onSelectJob(node.id === selectedJobIndex ? null : node.id);
    } else {
      onSelectJob(null);
    }
  };

  const handleDoubleClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const node = hitTest(x, y, "click");
    if (node) {
      onSelectJob(node.id);
      onClose();
    }
  };

  const revealClose = () => {
    setShowClose(true);
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setShowClose(false);
    }, 1800);
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
        {hover ? (
          <div
            className="atlas-overlay__tooltip"
            style={{ left: hover.x + 24, top: hover.y + 16 }}
          >
            <strong>{hover.node.testName}</strong>
            <span>job {hover.node.id}</span>
            <span>seed {hover.node.seed}</span>
            <span>{hover.node.status}</span>
            {hover.node.triageLabel ? (
              <span>triaged fail: {hover.node.triageLabel}</span>
            ) : null}
          </div>
        ) : null}
      </div>

    </div>
  );
}
