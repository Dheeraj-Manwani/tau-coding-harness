import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BookOpen,
  Box,
  BrainIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  FileIcon,
  FilePen,
  FilePlus,
  FileX,
  HomeIcon,
  Loader2Icon,
  MessageCircleQuestionMark,
  MinusIcon,
  PanelLeftCloseIcon,
  SquareCheckBigIcon,
  TerminalIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { ChatMarkdown } from "@/src/components/ChatMarkdown";
import { ChatLoader } from "@/src/components/ui/tau-loader";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import {
  useProjectStore,
  type ActionItem,
  type Message,
} from "@/src/stores/useProjectStore";
import {
  fetchOlderMessages,
  submitJobAnswer,
  useAddMessage,
  useProject,
} from "@/src/features/project/api";
import { DeleteProjectDialog } from "@/src/features/project/DeleteProjectDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { ApiError } from "@/src/lib/api-client";
import { useBillingStore } from "@/src/features/billing/useBillingStore";

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

function ActionIcon({ kind }: { kind: ActionItem["kind"] }) {
  if (kind === "create_plan") return <BrainIcon className="size-3.5" />;
  if (kind === "update_todo")
    return <SquareCheckBigIcon className="size-3.5" />;
  if (kind === "run_command") return <TerminalIcon className="size-3.5" />;

  if (kind === "create_file") return <FilePlus className="size-3.5" />;

  if (kind === "edit_file") return <FilePen className="size-3.5" />;

  if (kind === "read_file") return <BookOpen className="size-3.5" />;
  if (kind === "delete_file") return <FileX className="size-3.5" />;
  if (kind === "provision_sandbox") return <Box className="size-3.5" />;
  if (kind === "ask_user")
    return <MessageCircleQuestionMark className="size-3.5" />;
  return <FileIcon className="size-3.5" />;
}

const TODO_STATUS_CFG = {
  done: { Icon: CheckIcon, label: "Done", cls: "text-green-400" },
  skipped: {
    Icon: MinusIcon,
    label: "Skipped",
    cls: "text-[var(--silver-600)]",
  },
  blocked: { Icon: XIcon, label: "Blocked", cls: "text-red-400" },
  pending: {
    Icon: CircleIcon,
    label: "Pending",
    cls: "text-[var(--silver-600)] opacity-50",
  },
} as const;

function ActionDetail({ action }: { action: ActionItem }) {
  if (action.kind === "create_plan") {
    const meta = action.meta as
      | { description?: string; todos?: string[] }
      | undefined;
    return (
      <div className="space-y-2">
        {meta?.description && (
          <p className="leading-relaxed text-[var(--silver-700)]">
            {meta.description}
          </p>
        )}
        {!!meta?.todos?.length && (
          <div className="space-y-1 pt-1">
            <div>Todo:</div>
            {meta.todos.map((todo, i) => (
              <div
                key={i}
                className="flex items-start gap-2 text-[var(--silver-700)]"
              >
                <CircleIcon className="mt-0.5 size-2.5 shrink-0 opacity-30" />
                <span>{todo}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (action.kind === "update_todo") {
    const meta = action.meta as
      | {
          sno?: number;
          status?: string;
          todos?: { sno: number; label: string; status: string }[];
        }
      | undefined;

    // Full plan snapshot available (live streaming path).
    if (meta?.todos?.length) {
      return (
        <div className="space-y-1.5">
          {meta.todos.map((todo) => {
            const s = todo.status as keyof typeof TODO_STATUS_CFG;
            const cfg = TODO_STATUS_CFG[s] ?? TODO_STATUS_CFG.pending;
            return (
              <div
                key={todo.sno}
                className="flex items-center gap-2 text-[var(--silver-700)]"
              >
                <cfg.Icon className={cn("size-3 shrink-0", cfg.cls)} />
                <span
                  className={cn(
                    todo.status === "done" ? "line-through opacity-50" : "",
                  )}
                >
                  {todo.label}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    // Reload path — only sno + status available.
    if (meta?.sno !== undefined) {
      const s = (meta.status ?? "pending") as keyof typeof TODO_STATUS_CFG;
      const cfg = TODO_STATUS_CFG[s] ?? TODO_STATUS_CFG.pending;
      return (
        <div className="flex items-center gap-2 text-[var(--silver-700)]">
          <cfg.Icon className={cn("size-3 shrink-0", cfg.cls)} />
          <span>
            Item #{meta.sno} marked as {meta.status}
          </span>
        </div>
      );
    }

    return null;
  }

  return null;
}

function ActionsAccordion({ actions }: { actions: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (i: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 flex items-center gap-2 rounded-md px-1.5 py-1 text-xs text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
      >
        <div className="flex items-center gap-1.5 opacity-60">
          {actions.slice(0, 8).map((a, i) => (
            <span key={i}>
              <ActionIcon kind={a.kind} />
            </span>
          ))}
          {actions.length > 8 && <span className="text-[10px]">…</span>}
        </div>
        <span>
          {actions.length} action{actions.length !== 1 ? "s" : ""}
        </span>
      </button>
    );
  }

  return (
    <div className="mt-3 text-xs text-[var(--silver-600)]">
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mb-0.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:text-[var(--silver-900)]"
      >
        <ChevronUpIcon className="size-3.5 shrink-0" />
        <span>Show less</span>
      </button>

      <div>
        {actions.map((action, i) => {
          const isExpandable =
            action.kind === "create_plan" || action.kind === "update_todo";
          const isOpen = expanded.has(i);
          return (
            <div key={i}>
              <div
                role={isExpandable ? "button" : undefined}
                tabIndex={isExpandable ? 0 : undefined}
                onClick={isExpandable ? () => toggle(i) : undefined}
                onKeyDown={
                  isExpandable
                    ? (e) => e.key === "Enter" && toggle(i)
                    : undefined
                }
                className={cn(
                  "flex items-center gap-2.5 px-1.5 py-1.5 transition-colors",
                  isExpandable && !isOpen
                    ? "cursor-pointer rounded-md hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
                    : isExpandable && isOpen
                      ? "cursor-pointer rounded-t-md bg-[var(--space-overlay)] text-[var(--silver-900)]"
                      : "rounded-md",
                )}
              >
                <span className="shrink-0 opacity-50">
                  <ActionIcon kind={action.kind} />
                </span>
                <span className="flex-1 truncate">{action.label}</span>
                {isExpandable && (
                  <span className="shrink-0 opacity-40">
                    {isOpen ? (
                      <ChevronUpIcon className="size-3" />
                    ) : (
                      <ChevronDownIcon className="size-3" />
                    )}
                  </span>
                )}
              </div>
              {isExpandable && isOpen && (
                <div className="mb-1 rounded-b-md border-t border-white/5 bg-[var(--space-overlay)] px-3 py-2.5 text-[11px]">
                  <ActionDetail action={action} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const USER_MSG_LINE_CLAMP = 4;

// User turns sit in a right-aligned bubble with a timestamp underneath; tau's
// replies render as flat, full-width text on the surface (no bubble), the way a
// chat transcript reads.
function ChatBubble({
  message,
  delay,
  noAnimate = false,
}: {
  message: Message;
  delay: number;
  noAnimate?: boolean;
}) {
  const transition = { ...ENTRANCE.transition, delay };
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    // Compare clamped height vs full scroll height to detect overflow.
    setOverflows(el.scrollHeight > el.clientHeight + 2);
  }, [message.content]);

  if (message.role === "user") {
    const bubble = (
      <div className="flex flex-col items-end gap-1">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-[var(--space-overlay)] px-3.5 py-2 text-sm leading-relaxed text-[var(--silver-900)]">
          <div
            ref={contentRef}
            style={
              expanded
                ? undefined
                : {
                    WebkitLineClamp: USER_MSG_LINE_CLAMP,
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }
            }
            className="whitespace-pre-wrap break-words"
          >
            {message.content}
          </div>
          {(overflows || expanded) && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-[11px] text-[var(--blue-500)] hover:underline"
            >
              {expanded ? "Show less" : "Show more"}
            </button>
          )}
        </div>
        <span className="px-1 text-[11px] text-[var(--silver-600)]">
          {formatRelativeTime(message.timestamp)}
        </span>
      </div>
    );

    if (noAnimate) return bubble;
    return (
      <motion.div
        initial={ENTRANCE.initial}
        animate={ENTRANCE.animate}
        transition={transition}
      >
        {bubble}
      </motion.div>
    );
  }

  const aiBody = (
    <div>
      {message.content && (
        <div className="text-sm text-[var(--silver-900)]">
          <ChatMarkdown content={message.content} />
        </div>
      )}
      {message.actions && message.actions.length > 0 && (
        <ActionsAccordion actions={message.actions} />
      )}
    </div>
  );

  if (noAnimate) return aiBody;

  return (
    <motion.div
      initial={ENTRANCE.initial}
      animate={ENTRANCE.animate}
      transition={transition}
    >
      {aiBody}
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
      <ChatLoader text={activity ?? "Thinking"} />
    </motion.div>
  );
}

function ProjectSwitcher({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const { data: detail } = useProject(projectId);
  const name = detail?.project.name ?? "Project";
  const nameRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    const el = nameRef.current;
    if (el) setIsTruncated(el.scrollWidth > el.clientWidth);
  }, [name]);

  const projectAsListItem = detail
    ? {
        id: projectId,
        name: detail.project.name,
        sandboxStatus: detail.project.sandboxStatus,
        createdAt: "",
        updatedAt: "",
      }
    : null;

  return (
    <>
      <DropdownMenu.Root>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenu.Trigger asChild>
              <button
                type="button"
                className="group flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-[var(--silver-900)] outline-none transition-colors hover:bg-[var(--space-overlay)]"
              >
                <span ref={nameRef} className="max-w-[220px] truncate">
                  {name}
                </span>
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
            className="z-50 w-52 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-1.5 shadow-2xl"
          >
            <DropdownMenu.Item
              onSelect={() => navigate("/")}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[var(--silver-600)] outline-none select-none transition-colors data-[highlighted]:bg-[var(--space-overlay)] data-[highlighted]:text-[var(--silver-900)]"
            >
              <HomeIcon className="size-3.5 shrink-0" />
              Home
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-[var(--silver-200)]" />

            <DropdownMenu.Item
              onSelect={() => setDeleteOpen(true)}
              className="flex cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-red-400 outline-none select-none transition-colors data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-500"
            >
              <Trash2Icon className="size-3.5 shrink-0" />
              Delete project
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      <DeleteProjectDialog
        project={projectAsListItem}
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onDeleted={() => navigate("/")}
      />
    </>
  );
}

function AskUserPrompt({
  projectId,
  jobId,
  options,
  onAnswered,
}: {
  projectId: string;
  jobId: string;
  options: string[];
  onAnswered: (answer: string) => void;
}) {
  const [custom, setCustom] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (answer: string) => {
    if (!answer.trim() || submitting) return;
    setSubmitting(true);
    // Add the user bubble immediately so it appears before the AI's response,
    // not after (the HTTP round-trip would otherwise let streaming events arrive
    // first and push the bubble below the AI's reply).
    onAnswered(answer.trim());
    try {
      await submitJobAnswer(projectId, jobId, answer.trim());
    } catch {
      toast.error("Failed to send your answer. Please try again.");
    }
  };

  return (
    <div className="rounded-xl border border-silver-400/40 bg-space-surface p-2 shadow-xl focus-within:border-silver-600/45 focus-within:ring-3 focus-within:ring-silver-400/10">
      {/* <p className="px-2 pt-1 pb-2 text-xs text-muted-foreground border-b border-white/5 mb-2">
        {question}
      </p> */}
      {options.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5 px-2 pt-1">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              disabled={submitting}
              onClick={() => void submit(opt)}
              className="rounded-lg border border-silver-400/40 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-silver-600/60 hover:bg-space-overlay hover:text-foreground disabled:opacity-50"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      <input
        autoFocus
        type="text"
        value={custom}
        onChange={(e) => setCustom(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit(custom);
          }
        }}
        disabled={submitting}
        placeholder="Or type a custom answer…"
        className="w-full bg-transparent px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none disabled:opacity-50"
      />

      <div className="mt-1 flex justify-end">
        <button
          type="button"
          disabled={!custom.trim() || submitting}
          onClick={() => void submit(custom)}
          className={cn(
            "flex size-7 items-center justify-center rounded-lg transition-[background-color,transform]",
            custom.trim()
              ? "bg-brand text-primary-foreground hover:bg-brand/90 active:scale-95"
              : "cursor-not-allowed bg-space-overlay text-silver-600",
          )}
        >
          {submitting ? (
            <Loader2Icon className="size-4 animate-spin" />
          ) : (
            <ArrowUpIcon className="size-4" />
          )}
        </button>
      </div>
    </div>
  );
}

export function ChatPanel({ showCollapse = true }: { showCollapse?: boolean }) {
  const { id: projectId } = useParams<{ id: string }>();
  const messages = useProjectStore((s) => s.chatMessages);
  const isAiTyping = useProjectStore((s) => s.isAiTyping);
  const activity = useProjectStore((s) => s.activity);
  const status = useProjectStore((s) => s.status);
  const appendUserMessage = useProjectStore((s) => s.appendUserMessage);
  const removeChatMessage = useProjectStore((s) => s.removeChatMessage);
  const prependMessages = useProjectStore((s) => s.prependMessages);
  const hasMoreMessages = useProjectStore((s) => s.hasMoreMessages);
  const oldestSequence = useProjectStore((s) => s.oldestSequence);
  const startJob = useProjectStore((s) => s.startJob);
  const cancelStream = useProjectStore((s) => s.cancelStream);
  const toggleChat = useProjectStore((s) => s.toggleChat);
  const pendingQuestion = useProjectStore((s) => s.pendingQuestion);
  const answerPendingQuestion = useProjectStore((s) => s.answerPendingQuestion);
  const currentJobId = useProjectStore((s) => s.currentJobId);

  const addMessage = useAddMessage(projectId ?? "");
  const openOutOfCredits = useBillingStore((s) => s.open);
  const isStreaming = status === "streaming";

  const [draft, setDraft] = useState("");
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Messages present on first render get a staggered entrance; later ones don't.
  const [initialCount] = useState(messages.length);
  // Tracks message IDs prepended via pagination — they skip the entrance animation.
  const prependedIdsRef = useRef(new Set<string>());
  // Scroll height snapshot taken just before prepending, used to hold position.
  const scrollHeightBeforePrependRef = useRef<number | null>(null);
  // Whether the viewport was near the bottom before the last messages change.
  const wasNearBottomRef = useRef(true);
  // Tracks whether we've done the initial snap-to-bottom on first load.
  const initialScrollDoneRef = useRef(false);

  // Snap to bottom instantly on the first render that has messages.
  useLayoutEffect(() => {
    if (initialScrollDoneRef.current || messages.length === 0) return;
    initialScrollDoneRef.current = true;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // After prepend: compensate scrollTop so the visible content doesn't jump.
  useLayoutEffect(() => {
    if (scrollHeightBeforePrependRef.current === null) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop += el.scrollHeight - scrollHeightBeforePrependRef.current;
    }
    scrollHeightBeforePrependRef.current = null;
  }, [messages]);

  // Auto-scroll to bottom only when the user was already near the bottom.
  useEffect(() => {
    if (!wasNearBottomRef.current) return;
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isAiTyping]);

  const loadOlderMessages = useCallback(async () => {
    if (
      isLoadingOlder ||
      !hasMoreMessages ||
      !projectId ||
      oldestSequence === null
    )
      return;
    setIsLoadingOlder(true);
    scrollHeightBeforePrependRef.current =
      scrollRef.current?.scrollHeight ?? null;
    try {
      const { messages: older, hasMore } = await fetchOlderMessages(
        projectId,
        oldestSequence,
      );
      older.forEach((m) => prependedIdsRef.current.add(m.id));
      prependMessages(older, hasMore);
    } catch {
      scrollHeightBeforePrependRef.current = null;
    } finally {
      setIsLoadingOlder(false);
    }
  }, [
    isLoadingOlder,
    hasMoreMessages,
    projectId,
    oldestSequence,
    prependMessages,
  ]);

  // When the loaded messages don't fill the viewport there is no scroll event
  // to trigger the normal scroll-up pagination — auto-load until they do.
  useEffect(() => {
    if (isStreaming || isLoadingOlder || !hasMoreMessages) return;
    const el = scrollRef.current;
    if (!el || el.scrollTop >= 80) return;
    void loadOlderMessages();
  }, [
    messages,
    isStreaming,
    isLoadingOlder,
    hasMoreMessages,
    loadOlderMessages,
  ]);

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    wasNearBottomRef.current = distFromBottom < 120;
    setShowScrollDown(distFromBottom > 200);
    if (el.scrollTop < 80 && hasMoreMessages && !isLoadingOlder) {
      void loadOlderMessages();
    }
  };

  const canSend =
    draft.trim().length > 0 && !isStreaming && !addMessage.isPending;

  const submit = () => {
    const content = draft.trim();
    if (!content || !projectId || isStreaming || addMessage.isPending) return;

    const msgId = appendUserMessage(content);
    setDraft("");
    addMessage.mutate(content, {
      onSuccess: ({ jobId }) => startJob(jobId, content),
      onError: (err) => {
        removeChatMessage(msgId);
        if (err instanceof ApiError && err.status === 402) {
          openOutOfCredits();
        } else {
          toast.error(
            err instanceof ApiError && err.status === 409
              ? "A generation is already in progress."
              : err instanceof ApiError
                ? err.message
                : "Couldn't send your message",
          );
        }
      },
    });
  };

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <div className="flex items-center justify-between px-3 py-2.5">
        {projectId && <ProjectSwitcher projectId={projectId} />}
        <div className="flex items-center gap-2">
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
      </div>

      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="h-full space-y-5 overflow-y-auto px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {isLoadingOlder && (
            <div className="flex justify-center py-2">
              <div className="size-4 animate-spin rounded-full border-2 border-[var(--silver-600)] border-t-transparent" />
            </div>
          )}
          {messages.map((m, i) => (
            <ChatBubble
              key={m.id}
              message={m}
              delay={
                prependedIdsRef.current.has(m.id)
                  ? 0
                  : i < initialCount
                    ? i * 0.04
                    : 0
              }
              noAnimate={prependedIdsRef.current.has(m.id)}
            />
          ))}
          <AnimatePresence>
            {isAiTyping && <TypingBubble activity={activity} />}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {showScrollDown && (
            <motion.button
              key="scroll-down"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              type="button"
              onClick={scrollToBottom}
              aria-label="Scroll to bottom"
              className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center justify-center size-8 rounded-full bg-[var(--space-surface)] border border-[var(--silver-200)] shadow-md text-[var(--silver-600)] hover:text-[var(--silver-900)] hover:border-[var(--silver-400)] transition-colors"
            >
              <ArrowDownIcon className="size-4" />
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      <div className="border-[var(--silver-200)] p-3">
        {pendingQuestion && currentJobId && projectId ? (
          <AskUserPrompt
            projectId={projectId}
            jobId={currentJobId}
            // question={pendingQuestion.question}
            options={pendingQuestion.options}
            onAnswered={answerPendingQuestion}
          />
        ) : (
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
        )}
      </div>
    </div>
  );
}
