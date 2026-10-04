/** HTTP readiness after Vite configuration/files have finished changing. */
export type PreviewHttpState = "ready" | "build-error" | "starting";

export async function previewSupportsHealth(origin: string): Promise<boolean> {
  try {
    const response = await fetch(origin, { signal: AbortSignal.timeout(3_000), cache: "no-store" });
    return response.ok && (await response.text()).includes('source: "tau-preview-health"');
  } catch {
    return false;
  }
}

export async function probePreviewHttp(
  origin: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<PreviewHttpState> {
  try {
    const get = (url: string) => request(url, { signal: AbortSignal.timeout(3_000), cache: "no-store" });
    const response = await get(origin);
    if (response.status === 500) return "build-error";
    if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return "starting";
    const html = await response.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].flatMap(([tag]) => {
      if (!/\btype\s*=\s*["']module["']/i.test(tag)) return [];
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
      if (!src) return [];
      const url = new URL(src, origin);
      // Do not probe third-party scripts or follow an app-controlled base URL.
      return url.origin === new URL(origin).origin ? [url.href] : [];
    });
    for (const url of scripts) {
      const module = await get(url);
      if (module.status === 500) return "build-error";
      if (!module.ok || !/javascript|ecmascript/.test(module.headers.get("content-type") ?? "")) return "starting";
      await module.text(); // Wait for transforms, not just response headers.
    }
    return "ready";
  } catch {
    return "starting";
  }
}

export async function waitForPreviewHttp(
  origin: string,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
    probe?: (origin: string) => Promise<PreviewHttpState>;
  } = {},
): Promise<Exclude<PreviewHttpState, "starting">> {
  const deadline = Date.now() + (options.timeoutMs ?? 30_000);
  let previous: PreviewHttpState = "starting";
  while (Date.now() < deadline) {
    const state = await (options.probe ?? probePreviewHttp)(origin);
    // Two stable responses across the restart window. A compile error is a
    // usable error page: allow the agent/user to fix it instead of rebuilding
    // the sandbox repeatedly or blocking the agent from accessing its files.
    if (state !== "starting" && state === previous) return state;
    previous = state;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 750));
  }
  throw new Error("The preview server did not become ready after sandbox setup.");
}
