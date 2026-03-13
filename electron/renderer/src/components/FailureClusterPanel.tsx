/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import type { FailureCluster } from "../types";

interface FailureClusterPanelProps {
  clusters: FailureCluster[];
  onFocusSeed: (seed: number) => void;
}

export function FailureClusterPanel({
  clusters,
  onFocusSeed,
}: FailureClusterPanelProps) {
  return (
    <section className="panel workbench-card">
      <div className="panel__header">
        <div>
          <h3>Failure clusters</h3>
        </div>
      </div>
      {clusters.length === 0 ? (
        <div className="empty-copy">Failures will cluster here once the run starts diverging.</div>
      ) : (
        <div className="cluster-grid">
          {clusters.map((cluster) => (
            <button
              type="button"
              key={cluster.key}
              className="cluster-card"
              onClick={() => onFocusSeed(cluster.samples[0] ?? 0)}
            >
              <strong>{cluster.label}</strong>
              <span>{cluster.mismatch}</span>
              <small>
                {cluster.count} jobs • sample seed {cluster.samples[0] ?? "-"}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
