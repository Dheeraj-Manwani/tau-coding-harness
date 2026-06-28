import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDownIcon, HomeIcon, PanelLeftCloseIcon } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import toast from "react-hot-toast";

import { ChatLoader } from "@/src/components/ui/tau-loader";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useProjectStore, type Message } from "@/src/stores/useProjectStore";
import { useAddMessage, useProject } from "@/src/features/project/api";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { ApiError } from "@/src/lib/api-client";

function formatRelativeTime(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

const ENTRANCE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { type: "spring", stiffness: 500, damping: 36 },
} as const;

// User turns sit in a right-aligned bubble with a timestamp underneath; tau's
// replies render as flat, full-width text on the surface (no bubble), the way a
// chat transcript reads.
function ChatBubble({ message, delay }: { message: Message; delay: number }) {
  const transition = { ...ENTRANCE.transition, delay };

  if (message.role === "user") {
    return (
      <motion.div
        initial={ENTRANCE.initial}
        animate={ENTRANCE.animate}
        transition={transition}
        className="flex flex-col items-end gap-1"
      >
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--space-overlay)] px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words text-[var(--silver-900)]">
          {message.content}
        </div>
        <span className="px-1 text-[11px] text-[var(--silver-600)]">
          {formatRelativeTime(message.timestamp)}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={ENTRANCE.initial}
      animate={ENTRANCE.animate}
      transition={transition}
      className="text-sm leading-relaxed whitespace-pre-wrap break-words text-[var(--silver-900)]"
    >
      {message.content}
    </motion.div>
  );
}

// While tau works, surface its live activity as a flat icon + shimmer-label row
// (no bubble) — matching the inline "step" rows in the conversation flow.
function TypingBubble({ activity }: { activity: string | null }) {
  return (
    <motion.div
      initial={ENTRANCE.initial}
      animate={ENTRANCE.animate}
      exit={{ opacity: 0 }}
      className="flex items-center"
    >
      <ChatLoader text={activity ?? "Processing"} />
    </motion.div>
  );
}

function ProjectSwitcher({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data: detail } = useProject(projectId);
  const name = detail?.project.name ?? "Project";
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const el = nameRef.current;
    if (el) setIsTruncated(el.scrollWidth > el.clientWidth);
  }, [name]);

  return (
    <DropdownMenu.Root>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-[var(--silver-900)] outline-none transition-colors hover:bg-[var(--space-overlay)]"
            >
              <span ref={nameRef} className="max-w-[220px] truncate">{name}</span>
              <ChevronDownIcon className="size-3.5 shrink-0 text-[var(--silver-600)] transition-transform group-data-[state=open]:rotate-180" />
            </button>
          </DropdownMenu.Trigger>
        </TooltipTrigger>
        {isTruncated && <TooltipContent>{name}</TooltipContent>}
      </Tooltip>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-64 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-1.5 shadow-2xl"
        >
          <DropdownMenu.Item
            onSelect={() => navigate("/")}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[var(--silver-600)] outline-none select-none transition-colors data-[highlighted]:bg-[var(--space-overlay)] data-[highlighted]:text-[var(--silver-900)]"
          >
            <HomeIcon className="size-3.5 shrink-0" />
            Home
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export function ChatPanel({ showCollapse = true }: { showCollapse?: boolean }) {
  const { id: projectId } = useParams<{ id: string }>();
  const messages = useProjectStore((s) => s.chatMessages);
  const isAiTyping = useProjectStore((s) => s.isAiTyping);
  const activity = useProjectStore((s) => s.activity);
  const status = useProjectStore((s) => s.status);
  const appendUserMessage = useProjectStore((s) => s.appendUserMessage);
  const startJob = useProjectStore((s) => s.startJob);
  const cancelStream = useProjectStore((s) => s.cancelStream);
  const toggleChat = useProjectStore((s) => s.toggleChat);

  const addMessage = useAddMessage(projectId ?? "");
  const isStreaming = status === "streaming";

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  // Messages present on first render get a staggered entrance; later ones don't.
  const [initialCount] = useState(messages.length);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isAiTyping]);

  const canSend =
    draft.trim().length > 0 && !isStreaming && !addMessage.isPending;

  const submit = () => {
    const content = draft.trim();
    if (!content || !projectId || isStreaming || addMessage.isPending) return;

    appendUserMessage(content);
    setDraft("");
    addMessage.mutate(content, {
      onSuccess: ({ jobId }) => startJob(jobId, content),
      onError: (err) =>
        toast.error(
          err instanceof ApiError && err.status === 409
            ? "A generation is already in progress."
            : err instanceof ApiError
              ? err.message
              : "Couldn't send your message",
        ),
    });
  };

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <div className="flex items-center justify-between px-3 py-2.5">
        {projectId && <ProjectSwitcher projectId={projectId} />}
        {/* Collapse only makes sense once the chat is docked beside the
            workspace; pre-build it owns the whole (centered) screen. */}
        {showCollapse && (
          <motion.button
            type="button"
            onClick={toggleChat}
            whileHover={{ scale: 1.1 }}
            aria-label="Collapse chat"
            className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
          >
            <PanelLeftCloseIcon className="size-4.5" />
          </motion.button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 space-y-5 overflow-y-auto px-4 py-3"
      >
        {messages.map((m, i) => (
          <ChatBubble
            key={m.id}
            message={m}
            delay={i < initialCount ? i * 0.04 : 0}
          />
        ))}
        <AnimatePresence>
          {isAiTyping && <TypingBubble activity={activity} />}
        </AnimatePresence>
      </div>

      <div className="border-[var(--silver-200)] p-3">
        <PromptComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          onStop={isStreaming && cancelStream ? cancelStream : undefined}
          placeholder={
            isStreaming ? "tau is working…" : "Ask tau to change something…"
          }
          minRows={1}
          maxRows={4}
          isSubmitting={!canSend && draft.trim().length > 0}
          compact
        />
      </div>
    </div>
  );
}
