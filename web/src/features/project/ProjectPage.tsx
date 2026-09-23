import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { LoaderCircleIcon } from "lucide-react";
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from "react-resizable-panels";

import { cn } from "@/src/lib/utils";
import { api } from "@/src/lib/api-client";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { ChatPanel } from "@/src/features/project/ChatPanel";
import { RightPanel } from "@/src/features/project/RightPanel";
import { useProject, useProjectTree, projectKeys } from "@/src/features/project/api";
import { useJobStream, seedWatermark } from "@/src/features/project/useJobStream";
import type { ProjectDetail, ProjectJobStatusResponse } from "@/src/features/project/types";
import { jobStatusFromDetail, jobStatusNeedsResync } from "@/src/features/project/projectJobPoll";
import {
  clearFreshBuild,
  hasFreshBuild,
} from "@/src/features/project/revealSession";
import { useReadyNotification } from "@/src/features/project/useReadyNotification";
import { useAgentFavicon } from "@/src/features/project/useAgentFavicon";
import { resolveProjectLayout } from "@/src/features/project/projectLayout";

/**
 * How long an "active" job may send nothing before the UI calls it stalled.
 *
 * Generously above the quietest legitimate gap: a single agent turn is bounded
 * by the LLM request timeout (4 min) and streams `llm_chunk` frames throughout,
 * and long tool calls publish `tool_req`/`tool_res` around themselves. Silence
 * past this is a wedged or orphaned run, not a slow one.
 */
const STALL_AFTER_MS = 5 * 60_000;

function useProjectBootstrap() {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const navState = location.state as { jobId?: string; prompt?: string } | null;

  const initProject = useProjectStore((s) => s.initProject);
  const startJob = useProjectStore((s) => s.startJob);
  const hydrate = useProjectStore((s) => s.hydrate);
  const hydrateTree = useProjectStore((s) => s.hydrateTree);
  const resyncFromDetail = useProjectStore((s) => s.resyncFromDetail);
  const setStalled = useProjectStore((s) => s.setStalled);
  const status = useProjectStore((s) => s.status);
  const qc = useQueryClient();

  const projectQuery = useProject(projectId);
  const { data } = projectQuery;
  const { data: tree } = useProjectTree(projectId);

  useEffect(() => {
    if (!projectId) return;
    initProject(projectId);
    if (navState?.jobId) {
      startJob(navState.jobId, navState.prompt);

      // The job handoff from Home is a one-shot instruction, not durable route
      // state. Leaving it on the history entry makes browser Back replay an old
      // job after initProject clears the transcript; hydrate then correctly
      // refuses to overwrite the resulting "streaming" state. Consume it now
      // so returning from Billing hydrates the persisted conversation instead.
      void navigate(
        `${location.pathname}${location.search}${location.hash}`,
        { replace: true, state: null },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!data || !projectQuery.isFetchedAfterMount) return;
    const wasLive = useProjectStore.getState().currentJobId === data.activeJobId &&
      useProjectStore.getState().status === "streaming";
    hydrate(data);
    if (data.activeJobId && !wasLive && data.activeJobEventIndex != null) {
      // Hydration restored the durable question/transcript. Skip events already
      // reflected in that snapshot, but never skip on the Home handoff where
      // hydrate deliberately leaves a live optimistic stream alone.
      seedWatermark(data.activeJobId, data.activeJobEventIndex);
    }
  }, [data, hydrate, projectQuery.isFetchedAfterMount]);

  useEffect(() => {
    if (tree) hydrateTree(tree);
  }, [tree, hydrateTree]);

  useEffect(() => {
    if (!projectId) return;
    if (status === "done" || status === "cancelled" || status === "error") {
      // Rebuild from the final persisted transcript. A snapshot/stream handoff
      // can miss a transient frame, but it must never leave final messages or
      // terminal reasons missing until the next full page refresh.
      void api.get<ProjectDetail>(`/project/${projectId}`).then((response) => {
        if (useProjectStore.getState().projectId !== projectId) return;
        qc.setQueryData(projectKeys.detail(projectId), response.data);
        resyncFromDetail(response.data);
      }).catch(() => {});
      void qc.invalidateQueries({ queryKey: projectKeys.tree(projectId), refetchType: "active" });
    }
  }, [status, projectId, qc, resyncFromDetail]);

  // Backstop: while the store believes a job is streaming, poll only the
  // authoritative job state. A terminal SSE event (`done`/`error`) is the fast
  // path; fetch the full transcript only when this small snapshot disagrees.
  //
  // When the server *does* still call the job active, that used to be the end of
  // it — the poll simply re-confirmed the shimmer every 6s, forever, which is
  // what made a stranded job look like an eternally-thinking project. Now a job
  // that has sent nothing for STALL_AFTER_MS is flagged as stalled so the UI can
  // say so and offer the stop button, rather than shimmering indefinitely.
  useEffect(() => {
    if (!projectId || status !== "streaming") return;
    let cancelled = false;
    let inFlight = false;
    const timer = setInterval(() => {
      const { lastEventAt, isStalled, pendingQuestion } = useProjectStore.getState();
      if (
        !pendingQuestion &&
        !isStalled &&
        lastEventAt !== null &&
        Date.now() - lastEventAt > STALL_AFTER_MS
      ) {
        setStalled(true);
      }

      if (inFlight) return;
      inFlight = true;
      void (async () => {
        try {
          const { data: snapshot } = await api.get<ProjectJobStatusResponse>(
            `/project/${projectId}/job-status`,
          );
          if (cancelled) return;
          const current = useProjectStore.getState();
          if (current.projectId !== projectId || current.status !== "streaming") return;
          if (!jobStatusNeedsResync(snapshot, current)) return;

          const { data: detail } = await api.get<ProjectDetail>(`/project/${projectId}`);
          if (cancelled) return;
          const latest = useProjectStore.getState();
          if (latest.projectId !== projectId || latest.status !== "streaming") return;
          // The SSE stream may have caught up during the two requests. Only
          // replace its state if the full server snapshot still disagrees.
          if (jobStatusNeedsResync(jobStatusFromDetail(detail), latest)) {
            qc.setQueryData(projectKeys.detail(projectId), detail);
            resyncFromDetail(detail);
          }
        } catch {
          // Transient network failure: keep the live stream and retry next tick.
        } finally {
          inFlight = false;
        }
      })();
    }, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, projectId, qc, resyncFromDetail, setStalled]);

  useJobStream();

  return {
    detail: projectQuery.isFetchedAfterMount ? data : undefined,
    detailPending: projectQuery.isPending || !projectQuery.isFetchedAfterMount,
  };
}

const WORKSPACE_SPRING = { type: "spring", stiffness: 320, damping: 34 } as const;

export default function ProjectPage() {
  const { detail, detailPending } = useProjectBootstrap();

  const { id: projectId } = useParams<{ id: string }>();
  const [cameFromHome] = useState(() =>
    projectId ? hasFreshBuild(projectId) : false,
  );
  useEffect(() => {
    if (projectId) clearFreshBuild(projectId);
  }, [projectId]);

  const isChatOpen = useProjectStore((s) => s.isChatOpen);
  const setChatOpen = useProjectStore((s) => s.setChatOpen);
  const buildStarted = useProjectStore((s) => s.buildStarted);
  const storeProjectId = useProjectStore((s) => s.projectId);
  const status = useProjectStore((s) => s.status);
  const currentJobId = useProjectStore((s) => s.currentJobId);
  const terminalOutcome = useProjectStore((s) => s.terminalOutcome);
  const pendingQuestion = useProjectStore((s) => s.pendingQuestion);
  const isStalled = useProjectStore((s) => s.isStalled);
  const layoutMode = resolveProjectLayout({
    liveBuildStarted: storeProjectId === projectId && buildStarted,
    workspaceStartedAt: detail?.project.workspaceStartedAt,
    hasPreviewFragment: detail?.latestFragment != null,
    detailPending,
    freshBuild: cameFromHome,
  });
  const centered = layoutMode === "chat";
  const readyNotification = useReadyNotification({
    projectId,
    currentJobId,
    status,
    terminalOutcome,
    pendingQuestion,
  });
  useAgentFavicon({
    status,
    pendingQuestion: pendingQuestion != null,
    stalled: isStalled,
  });

  const chatPanelRef = useRef<PanelImperativeHandle | null>(null);

  // Sync the store's isChatOpen into the panel (for the collapse button in ChatPanel).
  useEffect(() => {
    if (isChatOpen) {
      if (chatPanelRef.current?.isCollapsed()) chatPanelRef.current.expand();
    } else {
      if (!chatPanelRef.current?.isCollapsed()) chatPanelRef.current?.collapse();
    }
  }, [isChatOpen]);

  if (layoutMode === "loading") {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-[var(--silver-600)]">
        <LoaderCircleIcon className="mr-2 size-4 animate-spin" />
        Loading project…
      </div>
    );
  }

  if (centered) {
    return (
      <div className="flex h-full w-full justify-center">
        <div className="h-full w-full max-w-2xl">
          <ChatPanel
            showCollapse={false}
            readyNotification={readyNotification}
          />
        </div>
      </div>
    );
  }

  return (
    <Group orientation="horizontal" className="h-full w-full">
      {/* Strings (without units) = percentages in v4; numbers = pixels. */}
      <Panel
        panelRef={chatPanelRef}
        defaultSize="25"
        minSize="18"
        collapsible
        collapsedSize="0"
        onResize={() => {
          const collapsed = chatPanelRef.current?.isCollapsed() ?? false;
          setChatOpen(!collapsed);
        }}
      >
        <ChatPanel readyNotification={readyNotification} />
      </Panel>

      <Separator
        className={cn(
          "group relative w-px shrink-0 cursor-col-resize",
          "bg-[var(--silver-200)] transition-colors",
          "hover:bg-[var(--blue-500)]",
        )}
      >
        {/* Wide invisible grab zone so the 1px line is easy to grab. */}
        <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" />
      </Separator>

      <Panel minSize="30" className="min-w-0">
        <motion.div
          initial={{ x: "100%", opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={WORKSPACE_SPRING}
          className="h-full w-full"
        >
          <RightPanel />
        </motion.div>
      </Panel>
    </Group>
  );
}
