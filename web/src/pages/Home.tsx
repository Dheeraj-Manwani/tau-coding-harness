import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import { StarsBackground } from "@/src/components/ui/stars-background";
import { TextAnimate } from "@/src/components/ui/text-animate";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useInitProject } from "@/src/features/project/api";
import { ApiError } from "@/src/lib/api-client";

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
    // Create the project + enqueue the first job, then hand off to the project
    // route — the composer morphs into the chat dock via its shared layoutId.
    // The prompt + jobId ride along in router state so the workspace can show
    // the message and subscribe to the live stream immediately.
    initProject.mutate(message, {
      onSuccess: ({ projectId, jobId }) =>
        navigate(`/project/${projectId}`, { state: { jobId, prompt: message } }),
      onError: (err) =>
        toast.error(
          err instanceof ApiError ? err.message : "Couldn't start your project",
        ),
    });
  };

  return (
    <>
      <StarsBackground
        className="fixed inset-0 -z-10 pointer-events-none"
        pointerEvents={false}
        factor={2}
        speed={50}
        starColor="rgba(226, 232, 240, 0.55)"
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
    </>
  );
}

export default Home;
