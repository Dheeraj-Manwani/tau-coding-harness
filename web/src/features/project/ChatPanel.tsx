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
  BugIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleIcon,
  FileIcon,
  FilePen,
  FilePlus,
  FileX,
  FolderOpenIcon,
  GlobeIcon,
  GitPullRequestIcon,
  CircleDotIcon,
  DownloadIcon,
  HammerIcon,
  HeartPulseIcon,
  HomeIcon,
  ImagesIcon,
  ListPlusIcon,
  Loader2Icon,
  RulerIcon,
  MessageCircleQuestionMark,
  MinusIcon,
  PanelLeftCloseIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SquareCheckBigIcon,
  TelescopeIcon,
  TerminalIcon,
  TimerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { ChatMarkdown } from "@/src/components/ChatMarkdown";
import { ChatLoader } from "@/src/components/ui/tau-loader";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { EffortDropdown } from "@/src/features/composer/EffortDropdown";
import { useAttachments } from "@/src/features/composer/attachments/useAttachments";
import { MessageAttachmentRail } from "@/src/features/composer/attachments/AttachmentRail";
import { toMessageAttachments } from "@/src/features/composer/attachments/chipModel";
import {
  useProjectStore,
  type ActionItem,
  type DividerMeta,
  type Message,
} from "@/src/stores/useProjectStore";
import {
  fetchOlderMessages,
  submitJobAnswer,
  useAddMessage,
  useProject,
} from "@/src/features/project/api";
import type { Effort } from "@/src/features/project/types";
import { DeleteProjectDialog } from "@/src/features/project/DeleteProjectDialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/src/components/ui/tooltip";
import { ApiError } from "@/src/lib/api-client";
import { APP_HOME } from "@/src/lib/routes";
import { showConcurrentJobLimitToast } from "@/src/features/project/concurrencyToast";
import { useBillingStore } from "@/src/features/billing/useBillingStore";
import { useBalance } from "@/src/features/billing/api";
import { useSettingsStore } from "@/src/stores/useSettingsStore";

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
  if (kind === "add_todos") return <ListPlusIcon className="size-3.5" />;
  if (kind === "run_command") return <TerminalIcon className="size-3.5" />;

  if (kind === "create_file") return <FilePlus className="size-3.5" />;

  if (kind === "edit_file") return <FilePen className="size-3.5" />;

  if (kind === "read_file") return <BookOpen className="size-3.5" />;
  if (kind === "list_dir") return <FolderOpenIcon className="size-3.5" />;
  if (kind === "delete_file") return <FileX className="size-3.5" />;
  if (kind === "tail_command_output")
    return <ScrollTextIcon className="size-3.5" />;
  if (kind === "wait_for_port") return <TimerIcon className="size-3.5" />;
  if (kind === "check_sandbox") return <HeartPulseIcon className="size-3.5" />;
  if (kind === "provision_sandbox") return <Box className="size-3.5" />;
  if (kind === "ask_user")
    return <MessageCircleQuestionMark className="size-3.5" />;
  if (kind === "dispatch_explorer")
    return <TelescopeIcon className="size-3.5" />;
  if (kind === "dispatch_debugger") return <BugIcon className="size-3.5" />;
  if (kind === "dispatch_verifier")
    return <ShieldCheckIcon className="size-3.5" />;
  if (kind === "dispatch_implementer")
    return <HammerIcon className="size-3.5" />;
  if (kind === "web_search") return <GlobeIcon className="size-3.5" />;
  if (kind === "search_images") return <ImagesIcon className="size-3.5" />;
  if (kind === "image_dimensions") return <RulerIcon className="size-3.5" />;
  if (kind === "download_asset") return <DownloadIcon className="size-3.5" />;
  if (kind === "push_to_github")
    return <GitPullRequestIcon className="size-3.5" />;
  if (kind === "create_github_issue")
    return <CircleDotIcon className="size-3.5" />;
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

  if (action.kind === "add_todos") {
    const meta = action.meta as { todos?: string[] } | undefined;
    if (!meta?.todos?.length) return null;
    return (
      <div className="space-y-1">
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

  if (
    action.kind === "dispatch_explorer" ||
    action.kind === "dispatch_debugger" ||
    action.kind === "dispatch_verifier" ||
    action.kind === "dispatch_implementer" ||
    action.kind === "web_search" ||
    action.kind === "search_images" ||
    action.kind === "push_to_github" ||
    action.kind === "create_github_issue"
  ) {
    const meta = action.meta as
      | { prompt?: string; result?: string }
      | undefined;
    const taskLabel =
      action.kind === "web_search" || action.kind === "search_images"
        ? "Query"
        : action.kind === "push_to_github"
          ? "Update"
          : action.kind === "create_github_issue"
            ? "Issue"
            : "Task";
    const resultLabel =
      action.kind === "search_images"
        ? "Images"
        : action.kind === "web_search"
          ? "Results"
          : "Result";
    const loadingLabel =
      action.kind === "web_search" || action.kind === "search_images"
        ? "Searching…"
        : action.kind === "push_to_github"
          ? "Pushing…"
          : action.kind === "create_github_issue"
            ? "Filing…"
            : "Working…";
    return (
      <div className="space-y-2.5">
        {meta?.prompt && (
          <div>
            <div className="mb-1 text-[10px] font-medium tracking-wide text-[var(--silver-600)] uppercase">
              {taskLabel}
            </div>
            <p className="whitespace-pre-wrap leading-relaxed text-[var(--silver-700)]">
              {meta.prompt}
            </p>
          </div>
        )}
        <div>
          <div className="mb-1 text-[10px] font-medium tracking-wide text-[var(--silver-600)] uppercase">
            {resultLabel}
          </div>
          {meta?.result ? (
            <div className="text-[var(--silver-700)]">
              <ChatMarkdown content={meta.result} compact />
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[var(--silver-600)] italic">
              <Loader2Icon className="size-3 animate-spin" />
              {loadingLabel}
            </p>
          )}
        </div>
      </div>
    );
  }

  return null;
}

const FILE_LINK_KINDS = new Set<ActionItem["kind"]>([
  "create_file",
  "edit_file",
  "read_file",
  "download_asset",
]);

function ActionsAccordion({ actions }: { actions: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const openFile = useProjectStore((s) => s.openFile);
  const setActiveTab = useProjectStore((s) => s.setActiveTab);

  const openInCodePanel = (path: string) => {
    openFile(path);
    setActiveTab("code");
  };

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
            action.kind === "create_plan" ||
            action.kind === "add_todos" ||
            action.kind === "update_todo" ||
            action.kind === "dispatch_explorer" ||
            action.kind === "dispatch_debugger" ||
            action.kind === "dispatch_verifier" ||
            action.kind === "dispatch_implementer" ||
            action.kind === "web_search" ||
            action.kind === "search_images" ||
            action.kind === "push_to_github" ||
            action.kind === "create_github_issue";
          const isOpen = expanded.has(i);
          const isFileLink = FILE_LINK_KINDS.has(action.kind);
          const filePath = isFileLink
            ? ((action.meta as { path?: string } | undefined)?.path ?? "")
            : "";
          const isInteractive = isExpandable || (isFileLink && !!filePath);
          const handleActivate = isExpandable
            ? () => toggle(i)
            : isFileLink && filePath
              ? () => openInCodePanel(filePath)
              : undefined;
          return (
            <div key={i}>
              <div
                role={isInteractive ? "button" : undefined}
                tabIndex={isInteractive ? 0 : undefined}
                onClick={handleActivate}
                onKeyDown={
                  handleActivate
                    ? (e) => e.key === "Enter" && handleActivate()
                    : undefined
                }
                className={cn(
                  "flex items-center gap-2.5 px-1.5 py-1.5 transition-colors",
                  isExpandable && !isOpen
                    ? "cursor-pointer rounded-md hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
                    : isExpandable && isOpen
                      ? "cursor-pointer rounded-t-md bg-[var(--space-overlay)] text-[var(--silver-900)]"
                      : isFileLink && filePath
                        ? "cursor-pointer rounded-md hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
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
                <div className="mb-1 rounded-b-md border border-white/10 bg-[var(--space-surface)] px-3 py-2.5 text-[11px]">
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
    const attachments = message.attachments ?? [];
    const bubble = (
      <div className="flex flex-col items-end gap-1">
        {attachments.length > 0 && (
          <div className="max-w-[85%]">
            <MessageAttachmentRail attachments={attachments} />
          </div>
        )}
        {/* Attachment-only turns have no text of their own — render the chips
            and the timestamp, but no empty bubble. */}
        {message.content && (
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
        )}
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
function TypingBubble({
  activity,
  max = false,
  stalled = false,
  onStop,
}: {
  activity: string | null;
  max?: boolean;
  /** The run has gone quiet past the stall threshold — say so instead of
   *  shimmering indefinitely at a job that may never speak again. */
  stalled?: boolean;
  onStop?: (() => void) | null;
}) {
  if (stalled) {
    return (
      <motion.div
        initial={ENTRANCE.initial}
        animate={ENTRANCE.animate}
        exit={{ opacity: 0 }}
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
      >
        <span>This run has gone quiet — it may have stopped responding.</span>
        {onStop && (
          <button
            type="button"
            onClick={onStop}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Stop it
          </button>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={ENTRANCE.initial}
      animate={ENTRANCE.animate}
      exit={{ opacity: 0 }}
      className="flex items-center"
    >
      <ChatLoader text={activity ?? "Thinking"} max={max} />
    </motion.div>
  );
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

function ContextDivider({ meta }: { meta: DividerMeta }) {
  const [open, setOpen] = useState(false);
  const hasSummary = meta.summary.trim().length > 0;
  const hasStat = meta.tokensBefore > 0;

  return (
    <div className="my-1">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-[var(--silver-200)]" />
        <button
          type="button"
          disabled={!hasSummary}
          onClick={() => hasSummary && setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-full bg-[var(--space-surface)] px-2.5 py-1 text-[11px] text-[var(--silver-600)] transition-colors hover:text-[var(--silver-900)] disabled:cursor-default disabled:hover:text-[var(--silver-600)]"
        >
          <ScrollTextIcon className="size-3 shrink-0 opacity-60" />
          <span>Earlier conversation summarized</span>
          {hasStat && (
            <span className="opacity-50">
              ≈{formatTokens(meta.tokensBefore)} →{" "}
              {formatTokens(meta.tokensAfter)} tokens
            </span>
          )}
          {hasSummary &&
            (open ? (
              <ChevronUpIcon className="size-3 shrink-0" />
            ) : (
              <ChevronDownIcon className="size-3 shrink-0" />
            ))}
        </button>
        <div className="h-px flex-1 bg-[var(--silver-200)]" />
      </div>
      {open && hasSummary && (
        <div className="mt-2 rounded-md border border-white/10 bg-[var(--space-surface)] px-3 py-2.5 text-[11px] text-[var(--silver-700)]">
          <ChatMarkdown content={meta.summary} compact />
        </div>
      )}
    </div>
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
        previewImageUrl: null,
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
            className="z-50 w-44 rounded-xl border border-[var(--silver-200)] bg-[var(--space-surface)] p-1 shadow-2xl"
          >
            <DropdownMenu.Item
              onSelect={() => navigate(APP_HOME)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-[var(--silver-600)] outline-none select-none transition-colors data-[highlighted]:bg-[var(--space-overlay)] data-[highlighted]:text-[var(--silver-900)]"
            >
              <HomeIcon className="size-3.5 shrink-0" />
              Home
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-[var(--silver-200)]" />

            <DropdownMenu.Item
              onSelect={() => setDeleteOpen(true)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-red-400 outline-none select-none transition-colors data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-500"
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
        onDeleted={() => navigate(APP_HOME)}
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
  const isStalled = useProjectStore((s) => s.isStalled);
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
  const { data: balance } = useBalance();
  const isFreePlan = (balance?.plan ?? "FREE") === "FREE";
  const isStreaming = status === "streaming";

  // Restore the last effort the user explicitly picked (persisted in
  // localStorage, shared with the Home composer) so a MAX choice made on Home
  // carries into the project chat instead of resetting to LOW.
  const lastEffort = useSettingsStore((s) => s.lastEffort);
  const setLastEffort = useSettingsStore((s) => s.setLastEffort);
  const [effort, setEffort] = useState<Effort>(lastEffort ?? "LOW");
  // If we restored a saved choice, don't let the plan-based default override it.
  const effortDefaultedRef = useRef(lastEffort != null);
  useEffect(() => {
    if (effortDefaultedRef.current || balance === undefined) return;
    effortDefaultedRef.current = true;
    if (!isFreePlan) setEffort("HIGH");
  }, [balance, isFreePlan]);

  const handleEffortChange = (next: Effort) => {
    setEffort(next);
    setLastEffort(next);
  };

  const [draft, setDraft] = useState("");
  const attachments = useAttachments();
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
      const {
        messages: older,
        hasMore,
        checkpoints,
      } = await fetchOlderMessages(projectId, oldestSequence);
      older.forEach((m) => prependedIdsRef.current.add(m.id));
      prependMessages(older, hasMore, checkpoints);
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
    (draft.trim().length > 0 || attachments.attachments.length > 0) &&
    !isStreaming &&
    !addMessage.isPending &&
    !attachments.isBusy;

  const submit = () => {
    const content = draft.trim();
    const attachmentIds = attachments.readyIds;
    if (
      (!content && attachmentIds.length === 0) ||
      !projectId ||
      isStreaming ||
      addMessage.isPending ||
      attachments.isBusy
    )
      return;

    // Snapshot for rollback — a failed send shouldn't eat the attachments.
    const sentAttachments = attachments.attachments;
    const msgId = appendUserMessage(content, toMessageAttachments(sentAttachments));
    setDraft("");
    attachments.clear();
    addMessage.mutate(
      { message: content, effort, attachmentIds },
      {
        onSuccess: ({ jobId }) => startJob(jobId, content),
        onError: (err) => {
          removeChatMessage(msgId);
          setDraft(content);
          attachments.restore(sentAttachments);
          if (err instanceof ApiError && err.status === 402) {
            openOutOfCredits();
          } else if (err instanceof ApiError && err.status === 429) {
            showConcurrentJobLimitToast();
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
      },
    );
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
          {messages.map((m, i) =>
            m.role === "divider" && m.divider ? (
              <ContextDivider key={m.id} meta={m.divider} />
            ) : (
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
            ),
          )}
          <AnimatePresence>
            {isAiTyping && (
              <TypingBubble
                activity={activity}
                max={effort === "MAX"}
                stalled={isStalled}
                onStop={cancelStream}
              />
            )}
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
            attachments={attachments.attachments}
            onAttach={(files) => attachments.addFiles(files, draft)}
            onRemoveAttachment={attachments.remove}
            onPasteLarge={attachments.addPaste}
            attachmentsBusy={attachments.isBusy}
            rightSlot={
              <EffortDropdown
                effort={effort}
                onChange={handleEffortChange}
                ceilings={balance?.effortCeilings}
              />
            }
          />
        )}
      </div>
    </div>
  );
}
