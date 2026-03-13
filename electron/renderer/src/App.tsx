/*
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 Stuart Alldred.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  attachRun,
  cancelRun,
  exportYaml,
  getJobLog,
  getTestSuites,
  getRunInfo,
  getRuns,
  getSessionState,
  importYaml,
  pauseRun,
  resumeRun,
  rerunFailed,
  setParallelism,
  startRun,
} from "./api/client";
import { ArchiveDeck } from "./components/ArchiveDeck";
import { BottomDrawer } from "./components/BottomDrawer";
import { CellAtlasOverlay } from "./components/CellAtlasOverlay";
import { JobInspector } from "./components/JobInspector";
import { LiveWorkbench } from "./components/LiveWorkbench";
import { QuickRunBar } from "./components/QuickRunBar";
import { CurrentRunPanel, RecentRunsPanel } from "./components/SessionRail";
import { readStorage, writeStorage } from "./lib/storage";
import {
  applyConfigToDraft,
  buildMonitorJobs,
  chooseInterestingJob,
  cloneAsTemplate,
  createDefaultDraft,
  draftToPayload,
} from "./lib/regression";
import type {
  BannerState,
  DensityMode,
  DrawerTab,
  JobRecord,
  MonitorLens,
  RunDraft,
} from "./types";

type AppTab = "run" | "monitor" | "archive";
type MonitorPane = "main" | "inspector";

const LENS_STORAGE_KEY = "rheonDeckLens";
const DRAWER_TAB_STORAGE_KEY = "rheonDeckDrawerTab";
const DENSITY_STORAGE_KEY = "rheonDeckDensity";
const DRAFT_STORAGE_KEY = "rheonDeckDraft";
const ACTIVE_TAB_STORAGE_KEY = "rheonDeckActiveTab";
const MONITOR_INSPECTOR_WIDTH_STORAGE_KEY = "rheonDeckMonitorInspectorWidth";

function readInitialDraft(): RunDraft {
  const cpuDefault =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  const fallback = createDefaultDraft(cpuDefault);
  const raw = readStorage(DRAFT_STORAGE_KEY, "");
  if (!raw) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RunDraft>;
    return {
      ...fallback,
      ...parsed,
      tests:
        Array.isArray(parsed.tests) && parsed.tests.length > 0
          ? parsed.tests.map((test) => ({
              name: String(test.name || ""),
              count: Number(test.count || 0),
            }))
          : fallback.tests,
    };
  } catch (_error) {
    return fallback;
  }
}

function readInitialLens(): MonitorLens {
  const stored = readStorage(LENS_STORAGE_KEY, "table");
  return stored === "bloom" ? "bloom" : "table";
}

function readInitialDrawerTab(): DrawerTab {
  const stored = readStorage(DRAWER_TAB_STORAGE_KEY, "advanced");
  return stored === "archive" || stored === "yaml" ? stored : "advanced";
}

function readInitialDensity(): DensityMode {
  const stored = readStorage(DENSITY_STORAGE_KEY, "dense");
  return stored === "balanced" ? "balanced" : "dense";
}

function readInitialTab(): AppTab {
  const stored = readStorage(ACTIVE_TAB_STORAGE_KEY, "monitor");
  if (stored === "run" || stored === "archive") {
    return stored;
  }
  return "monitor";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function readInitialMonitorInspectorWidth(): number {
  const stored = Number(readStorage(MONITOR_INSPECTOR_WIDTH_STORAGE_KEY, "520"));
  return Number.isFinite(stored) ? stored : 520;
}

function PaneToggleButton({
  expanded,
  onClick,
  label,
}: {
  expanded: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {expanded ? (
          <path
            d="M5 2H2v3M11 2h3v3M2 11v3h3M14 11v3h-3"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M6 2H2v4M10 2h4v4M2 10v4h4M14 10v4h-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

function jobStatusAllowsLog(job: JobRecord | null): boolean {
  if (!job) {
    return false;
  }
  return !["queued", "idle"].includes(String(job.status || "queued").toLowerCase());
}

export default function App() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RunDraft>(() => readInitialDraft());
  const [activeTab, setActiveTab] = useState<AppTab>(() => readInitialTab());
  const [lens, setLens] = useState<MonitorLens>(() => readInitialLens());
  const [drawerTab, setDrawerTab] = useState<DrawerTab>(() => readInitialDrawerTab());
  const [density, setDensity] = useState<DensityMode>(() => readInitialDensity());
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [bannerExiting, setBannerExiting] = useState(false);
  const [selectedActiveJobIndex, setSelectedActiveJobIndex] = useState<number | null>(null);
  const [selectedArchiveDir, setSelectedArchiveDir] = useState<string | null>(null);
  const [selectedArchiveJobIndex, setSelectedArchiveJobIndex] = useState<number | null>(null);
  const [parallelismDraft, setParallelismDraft] = useState(draft.jobs);
  const [monitorInspectorWidth, setMonitorInspectorWidth] = useState(() =>
    readInitialMonitorInspectorWidth(),
  );
  const [monitorMaximizedPane, setMonitorMaximizedPane] = useState<MonitorPane | null>(null);
  const [monitorLogMaximized, setMonitorLogMaximized] = useState(false);
  const [yamlImportText, setYamlImportText] = useState("");
  const [yamlExportText, setYamlExportText] = useState("");
  const [quickAttachLatestState, setQuickAttachLatestState] = useState<"idle" | "pending" | "done">(
    "idle",
  );
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | "unsupported"
  >(
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );
  const notificationKeyRef = useRef<string | null>(null);
  const previousTabRef = useRef<AppTab>(activeTab);
  const [tabSlideDirection, setTabSlideDirection] = useState<"left" | "right">("right");
  const activeSelectionClearedRef = useRef(false);
  const monitorWorkspaceRef = useRef<HTMLDivElement | null>(null);
  const activeTabIndex = activeTab === "run" ? 0 : activeTab === "monitor" ? 1 : 2;

  const setActiveSelection = (index: number | null) => {
    activeSelectionClearedRef.current = index === null;
    setSelectedActiveJobIndex(index);
  };

  const sessionQuery = useQuery({
    queryKey: ["session-state"],
    queryFn: getSessionState,
    refetchInterval: 2000,
  });

  const runsQuery = useQuery({
    queryKey: ["runs"],
    queryFn: getRuns,
    refetchInterval: 12000,
  });

  const testSuitesQuery = useQuery({
    queryKey: ["test-suites"],
    queryFn: getTestSuites,
    staleTime: 300_000,
  });

  const archiveSnapshotQuery = useQuery({
    queryKey: ["archive-run", selectedArchiveDir],
    queryFn: () => getRunInfo(selectedArchiveDir || ""),
    enabled: Boolean(selectedArchiveDir),
    refetchInterval: 15000,
  });

  const activeJobs = useMemo(
    () => buildMonitorJobs(sessionQuery.data),
    [sessionQuery.data],
  );

  const archiveJobs = useMemo(
    () => buildMonitorJobs(archiveSnapshotQuery.data),
    [archiveSnapshotQuery.data],
  );

  const selectedActiveJob =
    activeJobs.find((job) => job.index === selectedActiveJobIndex) || null;

  const logQuery = useQuery({
    queryKey: [
      "job-log",
      "active",
      sessionQuery.data?.output_dir || null,
      selectedActiveJob?.index || null,
      sessionQuery.data?.revision || 0,
      selectedActiveJob?.updated_at || null,
    ],
    queryFn: () => getJobLog(sessionQuery.data?.output_dir || "", selectedActiveJob?.index || 0),
    enabled: Boolean(
      activeTab === "monitor" &&
        sessionQuery.data?.output_dir &&
        selectedActiveJob &&
        jobStatusAllowsLog(selectedActiveJob),
    ),
    retry: false,
    refetchInterval:
      activeTab === "monitor" &&
      String(selectedActiveJob?.status || "").toLowerCase() === "running"
        ? 3000
        : false,
  });

  const selectedArchiveRun =
    runsQuery.data?.find((run) => run.output_dir === selectedArchiveDir) || null;

  useEffect(() => {
    writeStorage(LENS_STORAGE_KEY, lens);
  }, [lens]);

  useEffect(() => {
    writeStorage(DRAWER_TAB_STORAGE_KEY, drawerTab);
  }, [drawerTab]);

  useEffect(() => {
    writeStorage(DENSITY_STORAGE_KEY, density);
  }, [density]);

  useEffect(() => {
    writeStorage(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    writeStorage(ACTIVE_TAB_STORAGE_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    const order: Record<AppTab, number> = { run: 0, monitor: 1, archive: 2 };
    const previous = previousTabRef.current;
    if (previous !== activeTab) {
      setTabSlideDirection(order[activeTab] > order[previous] ? "left" : "right");
      previousTabRef.current = activeTab;
    }
  }, [activeTab]);

  useEffect(() => {
    writeStorage(
      MONITOR_INSPECTOR_WIDTH_STORAGE_KEY,
      String(Math.round(monitorInspectorWidth)),
    );
  }, [monitorInspectorWidth]);

  useEffect(() => {
    if (!banner) {
      setBannerExiting(false);
      return;
    }
    setBannerExiting(false);
    const exitTimer = window.setTimeout(() => {
      setBannerExiting(true);
    }, 2100);
    const clearTimer = window.setTimeout(() => {
      setBanner(null);
    }, 2600);
    return () => {
      window.clearTimeout(exitTimer);
      window.clearTimeout(clearTimer);
    };
  }, [banner]);

  useEffect(() => {
    if (quickAttachLatestState !== "done") {
      return;
    }
    const timer = window.setTimeout(() => {
      setQuickAttachLatestState("idle");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [quickAttachLatestState]);

  useEffect(() => {
    const runs = runsQuery.data || [];
    if (runs.length === 0) {
      if (selectedArchiveDir !== null) {
        setSelectedArchiveDir(null);
      }
      if (selectedArchiveJobIndex !== null) {
        setSelectedArchiveJobIndex(null);
      }
      return;
    }
    const selectedStillExists = selectedArchiveDir
      ? runs.some((run) => run.output_dir === selectedArchiveDir)
      : false;
    if (selectedStillExists) {
      return;
    }
    setSelectedArchiveDir(runs[0].output_dir);
    setSelectedArchiveJobIndex(null);
  }, [runsQuery.data, selectedArchiveDir, selectedArchiveJobIndex]);

  useEffect(() => {
    if (selectedActiveJobIndex === null && activeSelectionClearedRef.current) {
      return;
    }
    const next = activeJobs.some((job) => job.index === selectedActiveJobIndex)
      ? selectedActiveJobIndex
      : chooseInterestingJob(activeJobs);
    if (next !== selectedActiveJobIndex) {
      setSelectedActiveJobIndex(next);
    }
  }, [activeJobs, selectedActiveJobIndex]);

  useEffect(() => {
    const next = archiveJobs.some((job) => job.index === selectedArchiveJobIndex)
      ? selectedArchiveJobIndex
      : chooseInterestingJob(archiveJobs);
    if (next !== selectedArchiveJobIndex) {
      setSelectedArchiveJobIndex(next);
    }
  }, [archiveJobs, selectedArchiveJobIndex]);

  useEffect(() => {
    if (!sessionQuery.data) {
      return;
    }
    setParallelismDraft(String(sessionQuery.data.config?.jobs ?? draft.jobs));
  }, [sessionQuery.data?.config?.jobs]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }
    setNotificationPermission(Notification.permission);
  }, []);

  useEffect(() => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return;
    }
    const snapshot = sessionQuery.data;
    if (!snapshot || !snapshot.output_dir) {
      return;
    }
    const terminal = ["complete", "failed", "cancelled", "interrupted"];
    if (!terminal.includes(String(snapshot.status || "").toLowerCase())) {
      return;
    }
    const key = `${snapshot.output_dir}:${snapshot.revision}:${snapshot.status}`;
    if (notificationKeyRef.current === key) {
      return;
    }
    notificationKeyRef.current = key;
    new Notification("Rheon regression updated", {
      body: `${snapshot.status}: ${snapshot.summary.failed} failed, ${snapshot.summary.passed} passed.`,
    });
  }, [sessionQuery.data]);

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ["session-state"] });
    void queryClient.invalidateQueries({ queryKey: ["runs"] });
    if (selectedArchiveDir) {
      void queryClient.invalidateQueries({ queryKey: ["archive-run", selectedArchiveDir] });
    }
  };

  const handleMutationSuccess = (message: string) => {
    setBanner({ tone: "success", message });
    invalidateAll();
  };

  const handleMutationError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setBanner({ tone: "error", message });
  };

  const startMutation = useMutation({
    mutationFn: () => startRun(draftToPayload(draft)),
    onSuccess: () => {
      setActiveTab("monitor");
      handleMutationSuccess("Regression started.");
    },
    onError: handleMutationError,
  });

  const attachMutation = useMutation({
    mutationFn: (outputDir: string) => attachRun(outputDir),
    onSuccess: (_data, outputDir) => {
      if (outputDir !== "latest") {
        setSelectedArchiveDir(outputDir);
        setSelectedArchiveJobIndex(null);
      }
      setActiveTab("monitor");
      setBanner(null);
      if (outputDir === "latest") {
        setQuickAttachLatestState("done");
      }
      invalidateAll();
    },
    onError: (error) => {
      setQuickAttachLatestState("idle");
      handleMutationError(error);
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseRun,
    onSuccess: () => handleMutationSuccess("Regression paused."),
    onError: handleMutationError,
  });

  const resumeMutation = useMutation({
    mutationFn: resumeRun,
    onSuccess: () => handleMutationSuccess("Regression resumed."),
    onError: handleMutationError,
  });

  const cancelMutation = useMutation({
    mutationFn: cancelRun,
    onSuccess: () => handleMutationSuccess("Regression cancelled."),
    onError: handleMutationError,
  });

  const rerunFailedMutation = useMutation({
    mutationFn: rerunFailed,
    onSuccess: () => {
      handleMutationSuccess("Started rerun of failed jobs.");
    },
    onError: handleMutationError,
  });

  const setParallelismMutation = useMutation({
    mutationFn: () => setParallelism(Number.parseInt(parallelismDraft, 10)),
    onSuccess: () => handleMutationSuccess("Parallelism updated."),
    onError: handleMutationError,
  });

  const importYamlMutation = useMutation({
    mutationFn: () => importYaml(yamlImportText),
    onSuccess: (config) => {
      setDraft((current) => ({
        ...applyConfigToDraft(config, current),
        templateSource: "",
      }));
      setActiveTab("run");
      setBanner({ tone: "success", message: "YAML imported into the draft." });
      setDrawerTab("advanced");
    },
    onError: handleMutationError,
  });

  const exportYamlMutation = useMutation({
    mutationFn: () => exportYaml(draftToPayload(draft)),
    onSuccess: (yaml) => {
      setYamlExportText(yaml);
      setActiveTab("run");
      setBanner({ tone: "success", message: "YAML exported from the current draft." });
      setDrawerTab("yaml");
    },
    onError: handleMutationError,
  });

  const handleApplyTemplate = (outputDir: string) => {
    if (!outputDir) {
      setDraft((current) => ({ ...current, templateSource: "" }));
      return;
    }
    const template = runsQuery.data?.find((run) => run.output_dir === outputDir)?.config;
    if (!template) {
      return;
    }
    setDraft((current) => ({
      ...applyConfigToDraft(cloneAsTemplate(template), current),
      templateSource: outputDir,
    }));
    setActiveTab("run");
    setDrawerTab("advanced");
    setBanner({ tone: "info", message: "Template applied to the draft." });
  };

  const activateTab = (tab: AppTab) => {
    setActiveTab(tab);
    if (tab !== "monitor") {
      setLens("table");
    }
    if (tab === "archive") {
      setDrawerTab((current) => (current === "yaml" ? "yaml" : "archive"));
      return;
    }
    if (tab === "run") {
      setDrawerTab((current) => (current === "yaml" ? "yaml" : "advanced"));
      return;
    }
  };

  const updateDraftField = (field: keyof RunDraft, value: string | boolean) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const updateTestRow = (index: number, field: "name" | "count", value: string) => {
    setDraft((current) => {
      const next = current.tests.map((test, entry) =>
        entry === index
          ? {
              ...test,
              [field]: field === "count" ? Number.parseInt(value || "0", 10) || 0 : value,
            }
          : test,
      );
      return { ...current, tests: next };
    });
  };

  const activeBusy =
    startMutation.isPending ||
    attachMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    cancelMutation.isPending ||
    rerunFailedMutation.isPending ||
    setParallelismMutation.isPending;

  const handleCopyLog = async () => {
    const text =
      logQuery.status === "success"
        ? logQuery.data
        : logQuery.error instanceof Error
          ? logQuery.error.message
          : "";
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setBanner({ tone: "success", message: "Log copied to clipboard." });
      }
    } catch (error) {
      handleMutationError(error);
    }
  };

  const requestNotifications = async () => {
    if (typeof Notification === "undefined") {
      setNotificationPermission("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
    setBanner({
      tone: permission === "granted" ? "success" : "warn",
      message: `Notification permission: ${permission}`,
    });
  };

  const focusActiveSeed = (seed: number) => {
    const match = activeJobs.find((job) => job.seed === seed);
    if (match) {
      activeSelectionClearedRef.current = false;
      setSelectedActiveJobIndex(match.index);
      setLens("table");
    }
  };

  const handleQuickAttachLatest = () => {
    setQuickAttachLatestState("pending");
    attachMutation.mutate("latest");
  };

  const beginResize = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();

    const startX = event.clientX;
    const startMonitor = monitorInspectorWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const delta = moveEvent.clientX - startX;
      const totalWidth =
        monitorWorkspaceRef.current?.clientWidth ?? window.innerWidth - 96;
      const minMain = 760;
      const minInspector = 420;
      const maxInspector = Math.max(minInspector, totalWidth - minMain);
      setMonitorInspectorWidth(
        clamp(startMonitor - delta, minInspector, maxInspector),
      );
    };

    const handleMouseUp = () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  };

  const effectiveMonitorMaximizedPane = monitorLogMaximized
    ? "inspector"
    : monitorMaximizedPane;

  return (
    <div className="app-shell">
      <div
        className={`app-tabs app-tabs--slide-${tabSlideDirection}`}
        role="tablist"
        aria-label="Deck sections"
        style={
          {
            "--active-index": activeTabIndex,
          } as CSSProperties
        }
      >
        {([
          ["run", "Setup"],
          ["monitor", "Monitor"],
          ["archive", "Archive"],
        ] as const).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            className={`app-tabs__button${activeTab === tab ? " is-active" : ""}`}
            onClick={() => activateTab(tab)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab !== "run" && banner ? (
        <div
          className={`banner banner--${banner.tone} app-banner${
            bannerExiting ? " app-banner--exiting" : ""
          }`}
          role="status"
        >
          {banner.message}
        </div>
      ) : null}

      {activeTab === "run" ? (
        <QuickRunBar
          activeTab={activeTab}
          draft={draft}
          runs={runsQuery.data || []}
          busy={activeBusy}
          banner={banner}
          onChangeField={updateDraftField}
          onApplyTemplate={handleApplyTemplate}
          onStartRun={() => startMutation.mutate()}
          onAttachLatest={handleQuickAttachLatest}
          attachLatestState={quickAttachLatestState}
        />
      ) : null}

      {activeTab === "run" ? (
        <main
          key={`view-${activeTab}`}
          className={`screen-shell screen-shell--slide-in-${tabSlideDirection}`}
        >
          <div className="screen-layout screen-layout--setup">
            <section className="screen-main">
              <BottomDrawer
                open
                embedded
                tabs={["advanced", "yaml"]}
                tab={drawerTab === "archive" ? "advanced" : drawerTab}
                draft={draft}
                selectedArchiveRun={selectedArchiveRun}
                archiveSnapshot={archiveSnapshotQuery.data}
                archiveJobs={archiveJobs}
                selectedArchiveJobIndex={selectedArchiveJobIndex}
                yamlImport={yamlImportText}
                yamlExport={yamlExportText}
                notificationPermission={notificationPermission}
                onChangeTab={setDrawerTab}
                onChangeField={updateDraftField}
                availableTestNames={testSuitesQuery.data ?? []}
                onAddTestRow={() =>
                  setDraft((current) => ({
                    ...current,
                    tests: [...current.tests, { name: "", count: 1 }],
                  }))
                }
                onRemoveTestRow={(index) =>
                  setDraft((current) => ({
                    ...current,
                    tests: current.tests.filter((_, entry) => entry !== index),
                  }))
                }
                onUpdateTestRow={updateTestRow}
                onSelectArchiveJob={setSelectedArchiveJobIndex}
                onAttachArchive={() => {
                  if (selectedArchiveDir) {
                    attachMutation.mutate(selectedArchiveDir);
                  }
                }}
                onUseArchiveTemplate={() => {
                  if (selectedArchiveDir) {
                    handleApplyTemplate(selectedArchiveDir);
                  }
                }}
                onImportYamlChange={setYamlImportText}
                onImportYaml={() => importYamlMutation.mutate()}
                onExportYaml={() => exportYamlMutation.mutate()}
                onRequestNotifications={() => {
                  void requestNotifications();
                }}
              />
            </section>

            <aside className="screen-side-stack">
              <CurrentRunPanel session={sessionQuery.data} />
              <RecentRunsPanel
                runs={runsQuery.data || []}
                selectedArchiveDir={selectedArchiveDir}
                onInspectRun={(outputDir) => {
                  setSelectedArchiveDir(outputDir);
                  setSelectedArchiveJobIndex(null);
                  activateTab("archive");
                }}
                onAttachRun={(outputDir) => attachMutation.mutate(outputDir)}
                onUseTemplate={handleApplyTemplate}
                showActions={false}
              />
            </aside>
          </div>
        </main>
      ) : null}

      {activeTab === "monitor" ? (
        <main
          key={`view-${activeTab}`}
          className={`screen-shell screen-shell--slide-in-${tabSlideDirection}`}
        >
          <div
            ref={monitorWorkspaceRef}
            className={`workspace workspace--monitor${
              effectiveMonitorMaximizedPane ? " workspace--maximized" : ""
            }`}
            style={
              effectiveMonitorMaximizedPane
                ? undefined
                : ({
                    "--monitor-inspector-width": `${monitorInspectorWidth}px`,
                  } as CSSProperties)
            }
          >
            {(effectiveMonitorMaximizedPane === null || effectiveMonitorMaximizedPane === "main") ? (
              <section className="workspace-pane">
                <div className="workspace-pane__body">
                  <LiveWorkbench
                    session={sessionQuery.data}
                    jobs={activeJobs}
                    selectedJobIndex={selectedActiveJobIndex}
                    parallelismDraft={parallelismDraft}
                    onSelectJob={setActiveSelection}
                    onChangeParallelismDraft={setParallelismDraft}
                    onSetParallelism={() => setParallelismMutation.mutate()}
                    onPause={() => pauseMutation.mutate()}
                    onResume={() => resumeMutation.mutate()}
                    onCancel={() => cancelMutation.mutate()}
                    onRerunFailed={() => rerunFailedMutation.mutate()}
                    onOpenAtlas={() => setLens("bloom")}
                    headerAction={
                      <PaneToggleButton
                        expanded={effectiveMonitorMaximizedPane === "main"}
                        label={
                          effectiveMonitorMaximizedPane === "main"
                            ? "Restore main panel"
                            : "Maximize main panel"
                        }
                        onClick={() =>
                          setMonitorMaximizedPane((current) => {
                            setMonitorLogMaximized(false);
                            return current === "main" ? null : "main";
                          })
                        }
                      />
                    }
                  />
                </div>
              </section>
            ) : null}

            {effectiveMonitorMaximizedPane === null ? (
              <div
                className="workspace-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize monitor panels"
                onMouseDown={beginResize}
              />
            ) : null}

            {(effectiveMonitorMaximizedPane === null || effectiveMonitorMaximizedPane === "inspector") ? (
              <section className="workspace-pane">
                <div className="workspace-pane__body">
                  <JobInspector
                    source="active"
                    snapshot={sessionQuery.data}
                    job={selectedActiveJob}
                    logText={logQuery.data || ""}
                    logStatus={
                      logQuery.isLoading
                        ? "loading"
                        : logQuery.isError
                          ? "error"
                          : logQuery.isSuccess
                            ? "ready"
                            : "idle"
                    }
                    logError={logQuery.error instanceof Error ? logQuery.error.message : null}
                    onReloadLog={() => {
                      void logQuery.refetch();
                    }}
                    onCopyLog={() => {
                      void handleCopyLog();
                    }}
                    logMaximized={monitorLogMaximized}
                    onToggleLogMaximized={() => {
                      setMonitorLogMaximized((current) => {
                        const next = !current;
                        setMonitorMaximizedPane(next ? "inspector" : null);
                        return next;
                      });
                    }}
                    headerAction={
                      <PaneToggleButton
                        expanded={effectiveMonitorMaximizedPane === "inspector"}
                        label={
                          effectiveMonitorMaximizedPane === "inspector"
                            ? "Restore inspector panel"
                            : "Maximize inspector panel"
                        }
                        onClick={() =>
                          setMonitorMaximizedPane((current) => {
                            setMonitorLogMaximized(false);
                            return current === "inspector" ? null : "inspector";
                          })
                        }
                      />
                    }
                    layoutMode={effectiveMonitorMaximizedPane === "inspector" ? "wide" : "default"}
                  />
                </div>
              </section>
            ) : null}
          </div>
        </main>
      ) : null}

      {activeTab === "archive" ? (
        <main
          key={`view-${activeTab}`}
          className={`screen-shell screen-shell--slide-in-${tabSlideDirection}`}
        >
          <ArchiveDeck
            runs={runsQuery.data || []}
            runsLoading={runsQuery.isLoading}
            runsError={runsQuery.error instanceof Error ? runsQuery.error.message : null}
            selectedArchiveDir={selectedArchiveDir}
            selectedArchiveRun={selectedArchiveRun}
            onSelectRun={(outputDir) => {
              setSelectedArchiveDir(outputDir);
              setSelectedArchiveJobIndex(null);
            }}
            archiveSnapshot={archiveSnapshotQuery.data}
            archiveSnapshotLoading={archiveSnapshotQuery.isLoading}
            archiveSnapshotError={
              archiveSnapshotQuery.error instanceof Error ? archiveSnapshotQuery.error.message : null
            }
            archiveJobs={archiveJobs}
            selectedArchiveJobIndex={selectedArchiveJobIndex}
            onSelectJob={setSelectedArchiveJobIndex}
            onAttachRun={(outputDir) => attachMutation.mutate(outputDir)}
            onUseTemplate={handleApplyTemplate}
          />
        </main>
      ) : null}

      {lens === "bloom" && activeTab === "monitor" ? (
        <CellAtlasOverlay
          jobs={activeJobs}
          selectedJobIndex={selectedActiveJobIndex}
          summary={sessionQuery.data?.summary || {
            total: 0,
            scheduled: 0,
            skipped_resume: 0,
            passed: 0,
            failed: 0,
            not_run: 0,
            timed_out: 0,
            running: 0,
          }}
          sessionStatus={sessionQuery.data?.status || "idle"}
          onSelectJob={setActiveSelection}
          onClose={() => setLens("table")}
        />
      ) : null}
    </div>
  );
}
