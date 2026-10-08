import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { createPreviewRecovery, type PreviewRecoveryState } from "./previewRecovery";
import { parseRuntimeError } from "./previewRuntimeError";
import type { PreviewRuntimeError } from "./types";

export function usePreviewRecovery(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  src: string | null,
  frameKey: string | null,
  expectHealth: boolean,
) {
  const controller = useRef<ReturnType<typeof createPreviewRecovery> | null>(null);
  const [result, setResult] = useState<(PreviewRecoveryState & { key: string }) | null>(null);
  // What the monitor in the preview says went wrong, for "Ask tau to fix".
  // Kept by frame like the state, so a reload starts with nothing reported.
  const [reported, setReported] = useState<{ error: PreviewRuntimeError; key: string } | null>(null);
  const current = result?.key === frameKey ? result : null;
  const origin = src ? new URL(src).origin : null;
  useEffect(() => {
    if (!frameKey || !origin) return;
    const recovery = createPreviewRecovery({
      expectHealth,
      onChange: (state) => setResult({ ...state, key: frameKey }),
    });
    controller.current = recovery;
    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (data?.source === "tau-visual-edit" && data.type === "tau:ready") {
        recovery.onLegacyReady();
        return;
      }
      if (!data || data.source !== "tau-preview-health") return;
      if (data.type === "errors") {
        const error = parseRuntimeError(data);
        if (error) setReported({ error, key: frameKey! });
        return;
      }
      if (!["waiting", "loaded", "failed"].includes(data.state)) return;
      recovery.onHealth(data);
    }
    window.addEventListener("message", onMessage);
    return () => {
      recovery.dispose();
      if (controller.current === recovery) controller.current = null;
      window.removeEventListener("message", onMessage);
    };
  }, [frameKey, origin, expectHealth, iframeRef]);

  const onLoad = useCallback(() => {
    controller.current?.onLoad();
    if (origin) iframeRef.current?.contentWindow?.postMessage({ type: "tau:preview-probe" }, origin);
  }, [iframeRef, origin]);
  return {
    attempt: current?.attempt ?? 0,
    phase: current?.phase ?? "waiting",
    appError: current?.appError ?? false,
    runtimeError: reported?.key === frameKey ? reported.error : null,
    onLoad,
  };
}
