import { useEffect, useRef } from "react";

import {
  agentFaviconHref,
  FAVICON_APPEARANCE,
  resolveAgentBrowserState,
} from "@/src/features/project/agentBrowserState";
import type { JobStatus } from "@/src/stores/useProjectStore";

type AgentFaviconOptions = {
  status: JobStatus;
  pendingQuestion: boolean;
  stalled: boolean;
  previewJob?: boolean;
};

const BLINK_INTERVAL_MS = 650;

/** Reflect the active agent lifecycle in the browser tab. */
export function useAgentFavicon(options: AgentFaviconOptions): void {
  const originalRef = useRef<{ href: string; type: string | null } | null>(null);
  const state = resolveAgentBrowserState(options);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;

    if (!originalRef.current) {
      originalRef.current = {
        href: link.getAttribute("href") ?? "/favicon.ico",
        type: link.getAttribute("type"),
      };
    }

    return () => {
      const original = originalRef.current;
      if (!original) return;
      link.href = original.href;
      if (original.type) link.type = original.type;
      else link.removeAttribute("type");
    };
  }, []);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    const original = originalRef.current;
    if (!link || !original) return;

    if (state === "idle") {
      link.href = original.href;
      if (original.type) link.type = original.type;
      else link.removeAttribute("type");
      return;
    }

    link.type = "image/svg+xml";
    link.href = agentFaviconHref(state);

    if (!FAVICON_APPEARANCE[state].blinks) return;

    let visible = true;
    const timer = window.setInterval(() => {
      visible = !visible;
      link.href = agentFaviconHref(state, visible);
    }, BLINK_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [state]);
}
