import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import toast from "react-hot-toast";

import { TextAnimate } from "@/src/components/ui/text-animate";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useAttachments } from "@/src/features/composer/attachments/useAttachments";
import { LightningComposer } from "@/src/features/composer/LightningComposer";
import { EffortDropdown } from "@/src/features/composer/EffortDropdown";
import { useEffortChoice } from "@/src/features/composer/useEffortChoice";
import { AdminHomeCard } from "@/src/features/admin/AdminHomeCard";
import { MyProjects } from "@/src/features/project/MyProjects";
import { useInitProject, useProjects } from "@/src/features/project/api";
import { markFreshBuild } from "@/src/features/project/revealSession";
import { showConcurrentJobLimitToast } from "@/src/features/project/concurrencyToast";
import { ApiError } from "@/src/lib/api-client";
import { projectPath } from "@/src/lib/routes";
import { clearPendingPrompt, peekPendingPrompt } from "@/src/lib/promptHandoff";
import { useBillingStore } from "@/src/features/billing/useBillingStore";
import { useBalance } from "@/src/features/billing/api";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { AmbientStars } from "@/src/components/AmbientStars";

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
  const navigate = useNavigate();
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

  // A prefilled prompt is a one-time welcome, not a sticky draft.
  useEffect(() => clearPendingPrompt(), []);

  // Cycle through suggestions while the input is empty.
  useEffect(() => {
    if (!showPlaceholder || isSubmitting) return;
    const id = setInterval(
      () => setSuggestion((i) => (i + 1) % SUGGESTIONS.length),
      5000,
    );
    return () => clearInterval(id);
  }, [showPlaceholder, isSubmitting]);

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
      <AmbientStars />
      <div className="flex min-h-[70svh] flex-col items-center justify-center">
        <div className="relative z-10 w-full max-w-2xl px-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            What do you want to build?
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            describe it. build it.
          </p>

          <div className="mt-8 text-left">
            <LightningComposer active={maxActive}>
              <PromptComposer
                value={prompt}
                onChange={setPrompt}
                onSubmit={submit}
                isSubmitting={isSubmitting}
                disabled={atProjectLimit}
                minRows={3}
                maxRows={12}
                attachments={attachments.attachments}
                onAttach={(files) => attachments.addFiles(files, prompt)}
                onRemoveAttachment={attachments.remove}
                onPasteLarge={attachments.addPaste}
                attachmentsBusy={attachments.isBusy}
                rightSlot={
                  <EffortDropdown
                    effort={effort}
                    onChange={setEffort}
                    ceilings={balance?.effortCeilings}
                  />
                }
                overlay={
                  showPlaceholder ? (
                    <TextAnimate
                      key={suggestion}
                      as="span"
                      by="character"
                      animation="slideLeft"
                      startOnView={false}
                      once
                      className="pointer-events-none absolute left-2 top-1 text-base text-muted-foreground"
                    >
                      {SUGGESTIONS[suggestion]}
                    </TextAnimate>
                  ) : null
                }
              />
            </LightningComposer>
            {limitsLoading ? (
              <div className="mt-2 flex h-5 items-center px-1">
                <DataSpinner label="Loading account limits" className="[&_svg]:size-3" />
              </div>
            ) : isFreePlan && (
              <div className="mt-2 flex items-center justify-between px-1 text-xs text-muted-foreground">
                <span>
                  {Math.min(projectCount, FREE_PLAN_MAX_PROJECTS)} /{" "}
                  {FREE_PLAN_MAX_PROJECTS} projects
                </span>
                {atProjectLimit && (
                  <span className="text-amber-400">
                    Free plan limit reached.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!initializing && (
          <motion.div key="projects" exit={{ opacity: 0 }}>
            <AdminHomeCard />
            <MyProjects />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Home;
