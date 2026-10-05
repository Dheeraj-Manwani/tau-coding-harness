import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import toast from "react-hot-toast";

import { useDocumentMeta } from "@/src/components/useDocumentMeta";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useAttachments } from "@/src/features/composer/attachments/useAttachments";
import { LightningComposer } from "@/src/features/composer/LightningComposer";
import { EffortToggle } from "@/src/features/composer/EffortToggle";
import { useEffortChoice } from "@/src/features/composer/useEffortChoice";
import { MyProjects } from "@/src/features/project/MyProjects";
import { CommunityProjects } from "@/src/features/project/CommunityProjects";
import { HomeFooter } from "@/src/components/HomeFooter";
import { useInitProject, useProjects } from "@/src/features/project/api";
import { markFreshBuild } from "@/src/features/project/revealSession";
import { showConcurrentJobLimitToast } from "@/src/features/project/concurrencyToast";
import { ApiError } from "@/src/lib/api-client";
import { projectPath } from "@/src/lib/routes";
import { clearPendingPrompt, peekPendingPrompt } from "@/src/lib/promptHandoff";
import { useBillingStore } from "@/src/features/billing/useBillingStore";
import { useBalance } from "@/src/features/billing/api";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { StormCanvas } from "@/src/components/StormCanvas";
import { useReduceMotion } from "@/src/hooks/useReduceMotion";
import { cn } from "@/src/lib/utils";

// Free plan may own at most this many concurrent projects (mirrors
// FREE_PLAN_MAX_PROJECTS in api/src/lib/pricing.ts). PRO is unlimited.
const FREE_PLAN_MAX_PROJECTS = 3;

const SUGGESTIONS = [
  "Build me a personal finance dashboard with charts…",
  "Create a landing page for my coffee shop…",
  "Make a kanban board with drag-and-drop…",
  "Design a portfolio site with a blog…",
  "Build a real-time chat app with rooms…",
  "Spin up an admin panel for my store…",
];

function Home() {
  useDocumentMeta({ title: "Tau", exactTitle: true, noIndex: true });

  const navigate = useNavigate();
  // Target for StormCanvas's rain splash - landing splashes drops against the
  // composer's top edge the same way.
  const composerRef = useRef<HTMLDivElement>(null);
  const initProject = useInitProject();
  const openOutOfCredits = useBillingStore((s) => s.open);
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { data: balance, isLoading: balanceLoading } = useBalance();
  // If they described their idea on the landing page before signing up, it is
  // waiting for them here. Read without consuming (StrictMode may run this
  // initializer twice); the effect below retires it once we're mounted.
  const [prompt, setPrompt] = useState(() => peekPendingPrompt() ?? "");
  const [suggestion, setSuggestion] = useState(0);
  const [initializing, setInitializing] = useState(false);
  const attachments = useAttachments();
  const isSubmitting = initProject.isPending;
  // Otherwise the suggestion carousel animates over the chip rail.
  const showPlaceholder =
    prompt.length === 0 && attachments.attachments.length === 0;

  // Proactively surface the free-plan project cap instead of only failing on
  // submit with a 403. PRO users are unlimited, so only gate FREE.
  const isFreePlan = (balance?.plan ?? "FREE") === "FREE";
  const limitsLoading = projectsLoading || balanceLoading;
  const projectCount = projects?.length ?? 0;
  const atProjectLimit = isFreePlan && projectCount >= FREE_PLAN_MAX_PROJECTS;

  // Shared with the project composer and the visual-edit inspector.
  const { effort, setEffort } = useEffortChoice();
  // Drives the Home-only dramatic animations (lightning composer + glitch stars).
  const maxActive = effort === "MAX";
  // Covers both the OS setting and the in-app Settings toggle - the tube
  // flicker and the placeholder's stutter-in/rotation both defer to it.
  const reduceMotion = useReduceMotion();

  // A prefilled prompt is a one-time welcome, not a sticky draft.
  useEffect(() => clearPendingPrompt(), []);

  // Cycle through suggestions while the input is empty. Same 4s cadence as
  // landing's StormComposer - which, like here, just shows the first
  // suggestion statically under reduced motion rather than rotating it.
  useEffect(() => {
    if (!showPlaceholder || isSubmitting || reduceMotion) return;
    const id = setInterval(
      () => setSuggestion((i) => (i + 1) % SUGGESTIONS.length),
      4000,
    );
    return () => clearInterval(id);
  }, [showPlaceholder, isSubmitting, reduceMotion]);

  const submit = () => {
    const message = prompt.trim();
    const attachmentIds = attachments.readyIds;
    if ((message.length === 0 && attachmentIds.length === 0) || isSubmitting)
      return;
    if (attachments.isBusy) return;
    if (atProjectLimit) {
      toast.error(
        "You've reached the free plan limit of 3 projects. Delete one or upgrade to Pro to create more.",
      );
      return;
    }
    setInitializing(true);
    // Create the project + enqueue the first job, then hand off to the project
    // route. The prompt + jobId ride along in router state so the workspace can
    // show the message and subscribe to the live stream immediately.
    initProject.mutate(
      { message, effort, attachmentIds },
      {
        onSuccess: ({ projectId, jobId }) => {
          attachments.clear();
          // Flag this project so its page plays the centered → split reveal once.
          markFreshBuild(projectId);
          navigate(projectPath(projectId), {
            state: { jobId, prompt: message },
          });
        },
        onError: (err) => {
          setInitializing(false);
          if (err instanceof ApiError && err.status === 402) {
            openOutOfCredits();
          } else if (err instanceof ApiError && err.status === 429) {
            showConcurrentJobLimitToast();
          } else if (
            err instanceof ApiError &&
            err.message === "PROJECT_LIMIT_REACHED"
          ) {
            toast.error(
              "You've reached the free plan limit of 3 projects. Delete one or upgrade to Pro to create more.",
            );
          } else {
            toast.error(
              err instanceof ApiError
                ? err.message
                : "Couldn't start your project",
            );
          }
        },
      },
    );
  };

  return (
    <div className="h-full overflow-y-auto pt-12">
      <StormCanvas target={() => composerRef.current} />
      <div className="relative flex min-h-[70svh] flex-col items-center justify-center overflow-hidden">
        <div className="relative z-10 w-full max-w-4xl px-6 text-center">
          <p className="eyebrow">— describe it. build it. —</p>
          <h1 className="display-heading mt-4 text-7xl text-silver-900 sm:text-8xl">
            What do you want
            <br />
            <span
              className={reduceMotion ? "text-blue-300" : "tube-text"}
              data-text="to build?"
              style={
                reduceMotion
                  ? {
                      filter:
                        "drop-shadow(0 0 28px #60a5fa88) drop-shadow(0 0 60px #60a5fa33)",
                    }
                  : undefined
              }
            >
              to build?
            </span>
          </h1>

          <div ref={composerRef} className="mt-10 text-left">
            <LightningComposer active={maxActive}>
              <PromptComposer
                value={prompt}
                onChange={setPrompt}
                onSubmit={submit}
                isSubmitting={isSubmitting}
                disabled={atProjectLimit}
                minRows={2}
                maxRows={12}
                submitLabel="Build"
                attachments={attachments.attachments}
                onAttach={(files) => attachments.addFiles(files, prompt)}
                onRemoveAttachment={attachments.remove}
                onPasteLarge={attachments.addPaste}
                attachmentsBusy={attachments.isBusy}
                rightSlot={<EffortToggle effort={effort} onChange={setEffort} />}
                overlay={
                  showPlaceholder ? (
                    <span
                      key={suggestion}
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute left-2 top-1 text-lg whitespace-pre-wrap text-muted-foreground",
                        !reduceMotion && "composer-glitch",
                      )}
                    >
                      {SUGGESTIONS[suggestion]}
                    </span>
                  ) : null
                }
              />
            </LightningComposer>
            {limitsLoading ? (
              <div className="mt-2 flex h-5 items-center px-1">
                <DataSpinner
                  label="Loading account limits"
                  className="[&_svg]:size-3"
                />
              </div>
            ) : (
              isFreePlan && (
                <div className="mt-2 px-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">
                      {Math.min(projectCount, FREE_PLAN_MAX_PROJECTS)} /{" "}
                      {FREE_PLAN_MAX_PROJECTS} projects
                    </span>
                    {atProjectLimit && (
                      <span className="text-amber-400">
                        Free plan limit reached.
                      </span>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!initializing && (
          <motion.div key="projects" exit={{ opacity: 0 }}>
            <MyProjects />
            <CommunityProjects />
            <HomeFooter />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Home;
