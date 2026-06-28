import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

import { cn } from "@/src/lib/utils";
import { useProjectStore } from "@/src/stores/useProjectStore";
import { ChatPanel } from "@/src/features/project/ChatPanel";
import { RightPanel } from "@/src/features/project/RightPanel";
import { ResizeHandle } from "@/src/features/project/ResizeHandle";
import { useProject, useProjectTree } from "@/src/features/project/api";
import { useJobStream } from "@/src/features/project/useJobStream";
import {
  clearFreshBuild,
  hasFreshBuild,
} from "@/src/features/project/revealSession";

const MIN_LEFT = 240;
const MIN_RIGHT = 400;

/** Loads persisted project state, replays any in-flight prompt from navigation,
 *  hydrates the store, and opens the live job stream. */
function useProjectBootstrap() {
  const { id: projectId } = useParams<{ id: string }>();
  const location = useLocation();
  const navState = location.state as { jobId?: string; prompt?: string } | null;

  const initProject = useProjectStore((s) => s.initProject);
  const startJob = useProjectStore((s) => s.startJob);
  const hydrate = useProjectStore((s) => s.hydrate);
  const hydrateTree = useProjectStore((s) => s.hydrateTree);

  const { data } = useProject(projectId);
  const { data: tree } = useProjectTree(projectId);

  // Reset store on (re-)entry, then replay the just-submitted prompt/job.
  useEffect(() => {
    if (!projectId) return;
    initProject(projectId);
    if (navState?.jobId) startJob(navState.jobId, navState.prompt);
    // navState is read once on entry; subsequent renders shouldn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Seed chat/preview from the DB once it loads (guarded inside hydrate),
  // and resume an in-flight job if we aren't already streaming one (reload).
  useEffect(() => {
    if (!data) return;
    hydrate(data);
    if (data.activeJobId && !useProjectStore.getState().currentJobId) {
      startJob(data.activeJobId);
    }
  }, [data, hydrate, startJob]);

  // Populate the file tree from the manifest endpoint.
  useEffect(() => {
    if (tree) hydrateTree(tree);
  }, [tree, hydrateTree]);

  useJobStream();
}

const REVEAL_SPRING = { type: "spring", stiffness: 320, damping: 34 } as const;

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
  const splitPosition = useProjectStore((s) => s.splitPosition);
  const setSplitPosition = useProjectStore((s) => s.setSplitPosition);
  const buildStarted = useProjectStore((s) => s.buildStarted);
  const centered = cameFromHome && !buildStarted;

  const containerRef = useRef<HTMLDivElement>(null);
  // While dragging, width must track the pointer 1:1 (no spring); the spring is
  // only for the collapse/expand and dock-left slide.
  const [isDragging, setIsDragging] = useState(false);

  // Measure the container so the chat width can animate in pixels (px↔px is
  // smooth; animating "100%"↔px snaps). Pre-build the chat fills this width.
  const [containerWidth, setContainerWidth] = useState(0);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleDrag = (clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const width = el.clientWidth;
    const next = Math.min(
      Math.max(clientX - left, MIN_LEFT),
      width - MIN_RIGHT,
    );
    setSplitPosition(next);
  };

  // Centered (full width) only during the home-launched pre-build phase; docked
  // at splitPosition otherwise. Fall back to "100%" until the first measurement.
  const chatWidth = centered ? containerWidth || "100%" : splitPosition;

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <AnimatePresence initial={false}>
        {isChatOpen && (
          <motion.div
            key="chat"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: chatWidth, opacity: 1 }}
            exit={{ width: 0, x: -40, opacity: 0 }}
            transition={isDragging ? { duration: 0 } : REVEAL_SPRING}
            className="shrink-0 overflow-hidden"
          >
            {/* Centered, max-width column while the chat owns the whole screen;
                full-bleed once it docks to the left at splitPosition. */}
            <div
              className={cn("mx-auto h-full w-full", centered && "max-w-2xl")}
            >
              <ChatPanel showCollapse={!centered} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isChatOpen && !centered && (
        <ResizeHandle
          onDrag={handleDrag}
          onDragStart={() => setIsDragging(true)}
          onDragEnd={() => setIsDragging(false)}
        />
      )}

      {/* Hidden only during the centered pre-build phase. On any non-home entry
          `centered` is false from the first commit, so the workspace is present
          immediately and `AnimatePresence initial={false}` shows it with no
          slide; for a home-launched build it mounts on the first file and slides
          in from the right like a panel toggled open. */}
      <AnimatePresence initial={false}>
        {!centered && (
          <motion.div
            key="workspace"
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            transition={REVEAL_SPRING}
            className="min-w-0 flex-1"
          >
            <RightPanel />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
