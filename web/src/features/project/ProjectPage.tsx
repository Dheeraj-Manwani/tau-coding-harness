import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

import { useProjectStore } from "@/src/stores/useProjectStore";
import { ChatPanel } from "@/src/features/project/ChatPanel";
import { RightPanel } from "@/src/features/project/RightPanel";
import { ResizeHandle } from "@/src/features/project/ResizeHandle";
import { useProject } from "@/src/features/project/api";
import { useJobStream } from "@/src/features/project/useJobStream";

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

  const { data } = useProject(projectId);

  // Reset store on (re-)entry, then replay the just-submitted prompt/job.
  useEffect(() => {
    if (!projectId) return;
    initProject(projectId);
    if (navState?.jobId) startJob(navState.jobId, navState.prompt);
    // navState is read once on entry; subsequent renders shouldn't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Seed chat/files/preview from the DB once it loads (guarded inside hydrate),
  // and resume an in-flight job if we aren't already streaming one (reload).
  useEffect(() => {
    if (!data) return;
    hydrate(data);
    if (data.activeJobId && !useProjectStore.getState().currentJobId) {
      startJob(data.activeJobId);
    }
  }, [data, hydrate, startJob]);

  useJobStream();
}

export default function ProjectPage() {
  useProjectBootstrap();

  const isChatOpen = useProjectStore((s) => s.isChatOpen);
  const splitPosition = useProjectStore((s) => s.splitPosition);
  const setSplitPosition = useProjectStore((s) => s.setSplitPosition);

  const containerRef = useRef<HTMLDivElement>(null);
  // While dragging, width must track the pointer 1:1 (no spring); the spring is
  // only for the collapse/expand slide.
  const [isDragging, setIsDragging] = useState(false);

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

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      <AnimatePresence initial={false}>
        {isChatOpen && (
          <motion.div
            key="chat"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: splitPosition, opacity: 1 }}
            exit={{ width: 0, x: -40, opacity: 0 }}
            transition={
              isDragging
                ? { duration: 0 }
                : { type: "spring", stiffness: 320, damping: 34 }
            }
            className="shrink-0 overflow-hidden"
          >
            <ChatPanel />
          </motion.div>
        )}
      </AnimatePresence>

      {isChatOpen && (
        <ResizeHandle
          onDrag={handleDrag}
          onDragStart={() => setIsDragging(true)}
          onDragEnd={() => setIsDragging(false)}
        />
      )}

      {/* Plain flex child: it reclaims space in real time as the left panel's
          width animates (on collapse) or is dragged — no layout prop, which
          would otherwise lag a frame behind the drag handle. */}
      <div className="min-w-0 flex-1">
        <RightPanel />
      </div>
    </div>
  );
}
