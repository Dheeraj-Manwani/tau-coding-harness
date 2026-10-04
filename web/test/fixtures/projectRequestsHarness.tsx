import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "../../src/components/ui/tooltip";
import ProjectPage from "../../src/features/project/ProjectPage";
import { usePreviewStatus } from "../../src/features/project/api";
import { useDeployStatus } from "../../src/features/project/deploy";
import { useBalance } from "../../src/features/billing/api";
import { useAttachments } from "../../src/features/composer/attachments/useAttachments";
import { queryClient } from "../../src/lib/query-client";
import { setAccessToken } from "../../src/lib/api-client";

setAccessToken("harness-token");
const scenario = new URLSearchParams(location.search).get("scenario") ?? "forbidden";

export function PollingProbes() {
  const preview = usePreviewStatus("denied-poll", { enabled: true, previewUrl: `${location.origin}/preview/denied-poll` });
  const deploy = useDeployStatus("denied-poll");
  const balance = useBalance();
  const attachments = useAttachments();
  const restore = attachments.restore;
  useEffect(() => restore([{
    key: "attachment", id: "denied-attachment", kind: "FILE", status: "EXTRACTING",
    filename: "file.txt", mimeType: "text/plain", sizeBytes: 5, extractionError: null,
    preview: null, lineCount: null,
  }]), [restore]);
  return <output>{JSON.stringify({ preview: preview.status, deploy: deploy.status, balance: balance.status, attachment: attachments.attachments[0]?.status })}</output>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[`/project/${scenario}`]}>
          {scenario === "denied-poll" ? <PollingProbes /> : <Routes><Route path="/project/:id" element={<ProjectPage />} /></Routes>}
          <button onClick={() => { focusManager.setFocused(false); focusManager.setFocused(true); }}>Simulate tab focus</button>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
