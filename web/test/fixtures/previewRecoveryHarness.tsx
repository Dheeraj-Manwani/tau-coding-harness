import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { usePreviewRecovery } from "../../src/features/project/usePreviewRecovery";
import { resolvePreviewSurface } from "../../src/features/project/previewAvailability";

function Harness() {
  const frame = useRef<HTMLIFrameElement>(null);
  const scenario = new URLSearchParams(location.search).get("scenario") ?? "transient";
  const [replacementReady, setReplacementReady] = useState(false);
  const [streaming, setStreaming] = useState(true);
  const [failed, setFailed] = useState(false);
  const isRestoration = scenario === "dead-recovery";
  const surface = resolvePreviewSurface({ hasUrl: true, alive: isRestoration && !replacementReady ? false : true, streaming, restoring: isRestoration && !replacementReady && streaming, restoreFailed: failed, starting: false, checkFailed: false });
  const scenarioUrl = isRestoration ? replacementReady ? "delayed" : "provider-error" : scenario;
  const src = `${location.origin.replace("localhost", "127.0.0.1")}/preview?scenario=${scenarioUrl}`;
  const recovery = usePreviewRecovery(frame, surface === "frame" ? src : null, surface === "frame" ? src : null, scenario !== "provider-error" && scenario !== "legacy-live");
  return <>
    <output data-testid="state">{JSON.stringify({ phase: recovery.phase, attempt: recovery.attempt, appError: recovery.appError })}</output>
    <span data-testid="surface">{surface}</span>
    <button onClick={() => setReplacementReady(true)}>Replacement ready</button>
    <button onClick={() => { setStreaming(false); setFailed(true); }}>Fail restoration</button>
    <button onClick={() => setStreaming(false)}>Cancel chat</button>
    {surface === "restoring" && <p role="status">Restoring your preview…</p>}
    {surface === "failed" && <p role="alert">We couldn’t restore the preview.</p>}
    {surface === "frame" && <iframe ref={frame} src={src} key={recovery.attempt} onLoad={recovery.onLoad} style={{ visibility: recovery.phase === "loaded" ? "visible" : "hidden" }} sandbox="allow-scripts allow-same-origin" />}
  </>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
