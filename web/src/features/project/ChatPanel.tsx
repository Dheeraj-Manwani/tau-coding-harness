import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { PanelLeftCloseIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { PromptComposer } from "@/src/features/composer/PromptComposer";
import { useProjectStore, type Message } from "@/src/stores/useProjectStore";

// The τ mark beside AI replies, recolored off-white (distinct from the blue
// header logo) with a soft matching glow so it stands out on the dark surface.
function AiLogo() {
  return (
    <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--silver-200)] bg-[var(--space-overlay)]">
      <span
        className="logo-mark size-3"
        role="img"
        aria-label="tau"
        style={{ backgroundColor: "var(--silver-900)" }}
      />
    </span>
  );
}

function ChatBubble({ message, delay }: { message: Message; delay: number }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 36, delay }}
      className={cn("flex gap-2", isUser ? "justify-end" : "flex-row")}
    >
      {!isUser && <AiLogo />}
      <div
        className={cn(
          "max-w-[80%] rounded-[var(--radius-lg)] px-3 py-2 text-sm leading-relaxed text-[var(--silver-900)]",
          isUser
            ? "border border-[var(--silver-200)] bg-[var(--space-overlay)]"
            : "border border-[var(--silver-200)] bg-[var(--space-void)]",
        )}
      >
        {message.content}
      </div>
    </motion.div>
  );
}

function TypingBubble() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex gap-2"
    >
      <AiLogo />
      <div className="flex items-center gap-1 rounded-[var(--radius-lg)] border border-[var(--silver-200)] bg-[var(--space-void)] px-3 py-3">
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="size-1.5 rounded-full bg-[var(--silver-600)]"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
          />
        ))}
      </div>
    </motion.div>
  );
}

export function ChatPanel() {
  const messages = useProjectStore((s) => s.chatMessages);
  const isAiTyping = useProjectStore((s) => s.isAiTyping);
  const sendMessage = useProjectStore((s) => s.sendMessage);
  const toggleChat = useProjectStore((s) => s.toggleChat);

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

  const canSend = draft.trim().length > 0;

  const submit = () => {
    if (!canSend) return;
    sendMessage(draft.trim());
    setDraft("");
  };

  return (
    <div className="flex h-full flex-col bg-[var(--space-void)]">
      <div className="flex items-center justify-between px-4 py-3">
        <Link
          to="/"
          aria-label="Go to home"
          className="transition-opacity hover:opacity-80"
        >
          <span className="logo-mark size-6" role="img" aria-label="tau" />
        </Link>
        <motion.button
          type="button"
          onClick={toggleChat}
          whileHover={{ scale: 1.1 }}
          aria-label="Collapse chat"
          className="flex size-8 items-center justify-center rounded-[var(--radius-md)] text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
        >
          <PanelLeftCloseIcon className="size-4.5" />
        </motion.button>
      </div>

      <div
        ref={scrollRef}
        className="scrollbar-thin flex-1 space-y-4 overflow-y-auto px-4 py-2"
      >
        {messages.map((m, i) => (
          <ChatBubble
            key={m.id}
            message={m}
            delay={i < initialCount ? i * 0.04 : 0}
          />
        ))}
        <AnimatePresence>{isAiTyping && <TypingBubble />}</AnimatePresence>
      </div>

      <div className="border-t border-[var(--silver-200)] p-3">
        <PromptComposer
          value={draft}
          onChange={setDraft}
          onSubmit={submit}
          placeholder="Ask tau to change something…"
          minRows={1}
          maxRows={4}
          compact
        />
      </div>
    </div>
  );
}
