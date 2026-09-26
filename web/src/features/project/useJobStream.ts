import { useEffect } from "react";

import { env } from "@/src/lib/env";
import { api, getAccessToken, refreshOnce } from "@/src/lib/api-client";
import { useProjectStore } from "@/src/stores/useProjectStore";
import type { JobEvent, ProjectDetail, ProjectTree } from "./types";

const MAX_BACKOFF_MS = 10_000;

/**
 * Highest event index applied per job, kept at module scope so it survives
 * effect remounts (React StrictMode, reconnects). Events are per-job indexed,
 * so keying by jobId both dedups replays and lets a brand-new job (whose
 * indices restart at 0) stream without being mistaken for already-seen events.
 */
const watermarks = new Map<string, number>();

export function seedWatermark(jobId: string, index: number): void {
  const current = watermarks.get(jobId) ?? -1;
  if (index > current) watermarks.set(jobId, index);
}

/**
 * Subscribes to the live event stream for the project's currently-active job
 * (`currentJobId` in the store) over Server-Sent Events, dispatching each event
 * into the store. Handles:
 *   - resume-on-reconnect: the `lastEventIndex` query param makes the server
 *     replay only events newer than the highest `index` seen (no duplicates),
 *   - access-token expiry (refresh + reconnect): we drive reconnection
 *     ourselves instead of relying on EventSource auto-retry, which would keep
 *     reusing an expired token,
 *   - exponential backoff on transient drops.
 *
 * When the job reaches a terminal event the reducer clears `currentJobId`,
 * which tears this effect down and closes the stream.
 */
export function useJobStream(): void {
  const jobId = useProjectStore((s) => s.currentJobId);
  const projectId = useProjectStore((s) => s.projectId);
  const applyEvent = useProjectStore((s) => s.applyEvent);
  const resyncFromDetail = useProjectStore((s) => s.resyncFromDetail);
  const hydrateTree = useProjectStore((s) => s.hydrateTree);
  const setCanceller = useProjectStore((s) => s.setCanceller);

  useEffect(() => {
    if (!jobId) return;

    let source: EventSource | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let everOpened = false;

    const connect = async () => {
      if (disposed) return;

      let token = getAccessToken();
      // No token (or a prior auth-reject): try a silent refresh first.
      if (!token || (everOpened === false && attempt > 0)) {
        await refreshOnce();
        token = getAccessToken();
      }
      if (disposed) return;
      if (!token) {
        scheduleReconnect();
        return;
      }

      // Resume from the last index we applied so the server replays only newer
      // events (no duplicates) after a reconnect.
      const lastEventIndex = watermarks.get(jobId) ?? -1;
      const url =
        `${env.API_URL}/jobs/${encodeURIComponent(jobId)}/stream` +
        `?token=${encodeURIComponent(token)}&lastEventIndex=${lastEventIndex}`;
      source = new EventSource(url);

      source.onopen = () => {
        everOpened = true;
        attempt = 0;
      };

      source.onmessage = (e) => {
        let event: JobEvent;
        try {
          event = JSON.parse(e.data as string) as JobEvent;
        } catch {
          return;
        }
        if (event.type === "resync" && projectId) {
          // A resync marker deliberately uses the current cursor, so it must
          // be handled before ordinary index deduplication. Close this stream
          // while rebuilding; otherwise live events could race the snapshot.
          source?.close();
          source = null;
          api
            .get<ProjectDetail>(`/project/${projectId}`)
            .then((r) => {
              if (disposed) return;
              resyncFromDetail(r.data);
              if (r.data.activeJobId === jobId) {
                if (r.data.activeJobEventIndex != null && r.data.activeJobEventIndex >= 0) {
                  seedWatermark(jobId, r.data.activeJobEventIndex);
                } else {
                  watermarks.delete(jobId);
                }
                void connect();
              }
            })
            .catch((err) => {
              console.error("[useJobStream] resync project fetch failed:", err);
              scheduleReconnect();
            });
          api
            .get<ProjectTree>(`/project/${projectId}/tree`)
            .then((r) => hydrateTree(r.data))
            .catch((err) => console.error("[useJobStream] resync tree fetch failed:", err));
          return;
        }
        // Dedup using the monotonic per-job index (replayed + live can overlap).
        if (typeof event.index === "number") {
          if (event.index <= (watermarks.get(jobId) ?? -1)) return;
          watermarks.set(jobId, event.index);
        }
        applyEvent(event);
      };

      source.onerror = () => {
        // EventSource would auto-retry with the same (possibly expired) token;
        // take control so we can refresh and resume from the latest watermark.
        source?.close();
        if (disposed) return;
        // Terminal events clear currentJobId → the effect re-runs with no job
        // and disposes; if we're still here, the drop was unexpected: retry.
        if (useProjectStore.getState().currentJobId !== jobId) return;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(() => void connect(), delay);
    };

    // Let the chat panel cancel the job over the regular authed HTTP API.
    setCanceller(() => {
      void api.post(`/jobs/${encodeURIComponent(jobId)}/cancel`);
    });

    void connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      setCanceller(null);
      if (source) {
        source.onerror = null; // avoid the reconnect path on intentional close
        source.close();
      }
    };
  }, [
    jobId,
    projectId,
    applyEvent,
    resyncFromDetail,
    hydrateTree,
    setCanceller,
  ]);
}
