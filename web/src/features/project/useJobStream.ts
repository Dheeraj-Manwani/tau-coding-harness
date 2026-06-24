import { useEffect } from "react";

import { env } from "@/src/lib/env";
import { getAccessToken, refreshOnce } from "@/src/lib/api-client";
import { useProjectStore } from "@/src/stores/useProjectStore";
import type { JobEvent } from "./types";

const MAX_BACKOFF_MS = 10_000;

/**
 * Highest event index applied per job, kept at module scope so it survives
 * effect remounts (React StrictMode, reconnects). Events are per-job indexed,
 * so keying by jobId both dedups replays and lets a brand-new job (whose
 * indices restart at 0) stream without being mistaken for already-seen events.
 */
const watermarks = new Map<string, number>();

/**
 * Subscribes to the live event stream for the project's currently-active job
 * (`currentJobId` in the store) over the ws-gateway WebSocket, dispatching each
 * event into the store. Handles:
 *   - resume-on-reconnect via the highest `index` seen (the gateway replays
 *     only events newer than `lastEventIndex`, so no duplicates),
 *   - access-token expiry (refresh + reconnect),
 *   - exponential backoff on transient drops.
 *
 * When the job reaches a terminal event the reducer clears `currentJobId`,
 * which tears this effect down and closes the socket.
 */
export function useJobStream(): void {
  const jobId = useProjectStore((s) => s.currentJobId);
  const applyEvent = useProjectStore((s) => s.applyEvent);
  const setCanceller = useProjectStore((s) => s.setCanceller);

  useEffect(() => {
    if (!jobId) return;

    let socket: WebSocket | null = null;
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

      const url = `${env.WS_URL}/?token=${encodeURIComponent(token)}`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        everOpened = true;
        attempt = 0;
        // Resume from the last index we applied so the gateway replays only
        // newer events (no duplicates) after a reconnect.
        const lastEventIndex = watermarks.get(jobId) ?? -1;
        socket?.send(JSON.stringify({ type: "subscribe", jobId, lastEventIndex }));
      };

      socket.onmessage = (e) => {
        let event: JobEvent;
        try {
          event = JSON.parse(e.data as string) as JobEvent;
        } catch {
          return;
        }
        // Dedup using the monotonic per-job index (replayed + live can overlap).
        if (typeof event.index === "number") {
          if (event.index <= (watermarks.get(jobId) ?? -1)) return;
          watermarks.set(jobId, event.index);
        }
        applyEvent(event);
      };

      socket.onclose = () => {
        if (disposed) return;
        // Terminal events clear currentJobId → the effect re-runs with no job
        // and disposes; if we're still here, the drop was unexpected — retry.
        if (useProjectStore.getState().currentJobId !== jobId) return;
        scheduleReconnect();
      };

      socket.onerror = () => socket?.close();
    };

    const scheduleReconnect = () => {
      if (disposed) return;
      attempt += 1;
      const delay = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
      reconnectTimer = setTimeout(() => void connect(), delay);
    };

    // Let the chat panel send a cancel over the live socket.
    setCanceller(() => {
      socket?.send(JSON.stringify({ type: "cancel", jobId }));
    });

    void connect();

    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      setCanceller(null);
      if (socket) {
        socket.onclose = null; // avoid the reconnect path on intentional close
        socket.close();
      }
    };
  }, [jobId, applyEvent, setCanceller]);
}
