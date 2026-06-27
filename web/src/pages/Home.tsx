import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import toast from "react-hot-toast";

import { SparkleParticles } from "@/src/components/ui/star-particles";
import { TextAnimate } from "@/src/components/ui/text-animate";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { MyProjects } from "@/src/features/project/MyProjects";
import { useInitProject } from "@/src/features/project/api";
import { markFreshBuild } from "@/src/features/project/revealSession";
import { ApiError } from "@/src/lib/api-client";

const STAR_COLORS = [
  "rgba(203, 213, 225, 0.7)",
  "rgba(203, 213, 225, 0.7)",
  "rgba(203, 213, 225, 0.7)",
  "rgba(226, 232, 240, 0.75)",
  "rgba(253, 230, 138, 0.7)",
  "rgba(186, 230, 253, 0.7)",
];

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
  const [prompt, setPrompt] = useState("");
  const [suggestion, setSuggestion] = useState(0);
  const [initializing, setInitializing] = useState(false);
  const isSubmitting = initProject.isPending;
  const showPlaceholder = prompt.length === 0;

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
    if (message.length === 0 || isSubmitting) return;
    setInitializing(true);
    // Create the project + enqueue the first job, then hand off to the project
    // route. The prompt + jobId ride along in router state so the workspace can
    // show the message and subscribe to the live stream immediately.
    initProject.mutate(message, {
      onSuccess: ({ projectId, jobId }) => {
        // Flag this project so its page plays the centered → split reveal once.
        markFreshBuild(projectId);
        navigate(`/project/${projectId}`, {
          state: { jobId, prompt: message },
        });
      },
      onError: (err) => {
        setInitializing(false);
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't start your project",
        );
      },
    });
  };

  return (
    <div className="h-full overflow-y-auto">
      <SparkleParticles
        className="fixed inset-0 -z-10"
        particleColor={STAR_COLORS}
        baseDensity={70}
        maxParticleSize={1.4}
        maxOpacity={0.7}
        minParticleOpacity={0.4}
        maxSpeed={0.5}
        enableShootingStars
      />
      <div className="flex min-h-[70svh] flex-col items-center justify-center">
        <div className="relative z-10 w-full max-w-2xl px-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            What do you want to build?
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Describe your idea and let tau bring it to life.
          </p>

          <div className="mt-8 text-left">
            <PromptComposer
              value={prompt}
              onChange={setPrompt}
              onSubmit={submit}
              isSubmitting={isSubmitting}
              minRows={3}
              maxRows={12}
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
          </div>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!initializing && (
          <motion.div key="projects" exit={{ opacity: 0 }}>
            <MyProjects />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default Home;
