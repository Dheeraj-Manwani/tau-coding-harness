import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
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
import type { ProjectDetail } from "@/src/features/project/types";
import {
  clearFreshBuild,
  hasFreshBuild,
} from "@/src/features/project/revealSession";

function useProjectBootstrap() {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const navState = location.state as { jobId?: string; prompt?: string } | null;

  const initProject = useProjectStore((s) => s.initProject);
  const startJob = useProjectStore((s) => s.startJob);
  const hydrate = useProjectStore((s) => s.hydrate);
  const hydrateTree = useProjectStore((s) => s.hydrateTree);
  const resyncFromDetail = useProjectStore((s) => s.resyncFromDetail);
  const status = useProjectStore((s) => s.status);
  const qc = useQueryClient();

  const { data } = useProject(projectId);
  const { data: tree } = useProjectTree(projectId);

  useEffect(() => {
    if (!projectId) return;
    initProject(projectId);
    if (navState?.jobId) startJob(navState.jobId, navState.prompt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (!data) return;
    hydrate(data);
    if (data.activeJobId && !useProjectStore.getState().currentJobId) {
      // Seed the stream cursor to the job's current head BEFORE the stream
      // connects, so a reload resumes past already-persisted events instead of
      // re-streaming them (they're already rendered by hydrate above).
      if (data.activeJobEventIndex != null) {
        seedWatermark(data.activeJobId, data.activeJobEventIndex);
      }
      startJob(data.activeJobId);
    }
  }, [data, hydrate, startJob]);

  useEffect(() => {
    if (tree) hydrateTree(tree);
  }, [tree, hydrateTree]);

  useEffect(() => {
    if (!projectId) return;
    if (status === "done" || status === "cancelled" || status === "error") {
      qc.invalidateQueries({ queryKey: projectKeys.detail(projectId), refetchType: "active" });
    }
  }, [status, projectId, qc]);

  // Backstop: while the store believes a job is streaming, poll the server's
  // authoritative job status. A terminal SSE event (`done`/`error`) is the fast
  // path that clears the "thinking" shimmer; this is the safety net for when that
  // event never arrives (worker crash, dropped terminal frame, dedup edge). If
  // the poll finds the job is no longer active, `resyncFromDetail` finalizes
  // locally so the shimmer can't hang forever.
  useEffect(() => {
    if (!projectId || status !== "streaming") return;
    let cancelled = false;
    const timer = setInterval(() => {
      void api
        .get<ProjectDetail>(`/project/${projectId}`)
        .then((r) => {
          if (cancelled || r.data.activeJobId) return;
          if (useProjectStore.getState().status !== "streaming") return;
          resyncFromDetail(r.data);
        })
        .catch(() => {
          /* transient — the next tick retries */
        });
    }, 6000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, projectId, resyncFromDetail]);

  useJobStream();
}

const WORKSPACE_SPRING = { type: "spring", stiffness: 320, damping: 34 } as const;

export default function ProjectPage() {
  useProjectBootstrap();

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
  const centered = cameFromHome && !buildStarted;

  const chatPanelRef = useRef<PanelImperativeHandle | null>(null);

  // Sync the store's isChatOpen into the panel (for the collapse button in ChatPanel).
  useEffect(() => {
    if (isChatOpen) {
      if (chatPanelRef.current?.isCollapsed()) chatPanelRef.current.expand();
    } else {
      if (!chatPanelRef.current?.isCollapsed()) chatPanelRef.current?.collapse();
    }
  }, [isChatOpen]);

  if (centered) {
    return (
      <div className="flex h-full w-full justify-center">
        <div className="h-full w-full max-w-2xl">
          <ChatPanel showCollapse={false} />
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
        <ChatPanel />
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
