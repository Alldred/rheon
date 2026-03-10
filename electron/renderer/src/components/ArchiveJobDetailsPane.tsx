/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import { JobInspector } from "./JobInspector";
import type { JobRecord, SessionSnapshot } from "../types";

interface ArchiveJobDetailsPaneProps {
  snapshot: SessionSnapshot | undefined;
  job: JobRecord | null;
  logText: string;
  logStatus: "idle" | "loading" | "error" | "ready";
  logError: string | null;
  onReloadLog: () => void;
  onCopyLog: () => void;
}

export function ArchiveJobDetailsPane({
  snapshot,
  job,
  logText,
  logStatus,
  logError,
  onReloadLog,
  onCopyLog,
}: ArchiveJobDetailsPaneProps) {
  return (
    <section className="archive-details-pane">
      <JobInspector
        source="archive"
        snapshot={snapshot}
        job={job}
        logText={logText}
        logStatus={logStatus}
        logError={logError}
        onReloadLog={onReloadLog}
        onCopyLog={onCopyLog}
        layoutMode="wide"
      />
    </section>
  );
}
