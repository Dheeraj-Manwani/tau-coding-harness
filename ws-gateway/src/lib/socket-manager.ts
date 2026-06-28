import { WebSocket, type RawData } from "ws";
import type { Redis } from "ioredis";
import type { AppSocket, JobEvent } from "./types";

const HEARTBEAT_INTERVAL_MS = 30_000;

const channel = (jobId: string) => `job:${jobId}`;
const controlChannel = (jobId: string) => `job:${jobId}:control`;
const eventsKey = (jobId: string) => `job:${jobId}:events`;

function jobIdFromChannel(channelName: string): string | null {
  if (!channelName.startsWith("job:")) return null;
  const jobId = channelName.slice("job:".length);
  return jobId.length > 0 ? jobId : null;
}

interface SocketManagerDeps {
  redisPub: Redis;
  redisSub: Redis;
  heartbeatIntervalMs?: number;
}

export class SocketManager {
  private readonly connections = new Set<AppSocket>();
  private readonly subscribers = new Map<string, Set<AppSocket>>();
  private readonly redisPub: Redis;
  private readonly redisSub: Redis;
  private readonly heartbeat: ReturnType<typeof setInterval>;

  constructor({
    redisPub,
    redisSub,
    heartbeatIntervalMs = HEARTBEAT_INTERVAL_MS,
  }: SocketManagerDeps) {
    this.redisPub = redisPub;
    this.redisSub = redisSub;
    this.redisSub.on("message", (ch, message) => this.fanOut(ch, message));
    this.heartbeat = setInterval(() => this.reap(), heartbeatIntervalMs);
  }

  register(socket: AppSocket): void {
    this.connections.add(socket);

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("message", (raw: RawData) => void this.onMessage(socket, raw));
    socket.on("close", () => void this.onClose(socket));
    socket.on("error", (err) => console.error("[ws] socket error:", err));
  }

  close(): void {
    clearInterval(this.heartbeat);
  }

  private async onMessage(socket: AppSocket, raw: RawData): Promise<void> {
    try {
      let msg: unknown;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        this.sendError(socket, "Invalid JSON");
        return;
      }

      if (typeof msg !== "object" || msg === null || !("type" in msg)) {
        this.sendError(socket, "Unknown message type");
        return;
      }

      const { type } = msg as { type: unknown };

      switch (type) {
        case "subscribe": {
          const { jobId, lastEventIndex } = msg as {
            jobId?: unknown;
            lastEventIndex?: unknown;
          };
          if (typeof jobId !== "string" || jobId.length === 0) {
            this.sendError(socket, "subscribe requires a non-empty jobId");
            return;
          }
          const fromIndex =
            typeof lastEventIndex === "number" ? lastEventIndex : -1;
          await this.subscribe(jobId, socket, fromIndex);
          return;
        }

        case "cancel": {
          const { jobId } = msg as { jobId?: unknown };
          if (typeof jobId !== "string" || jobId.length === 0) {
            this.sendError(socket, "cancel requires a non-empty jobId");
            return;
          }
          await this.redisPub.publish(
            controlChannel(jobId),
            JSON.stringify({ type: "cancel" }),
          );
          return;
        }

        default:
          this.sendError(socket, "Unknown message type");
      }
    } catch (err) {
      console.error("[ws] message handler error:", err);
      this.sendError(socket, "Internal error");
    }
  }

  private async subscribe(
    jobId: string,
    socket: AppSocket,
    lastEventIndex: number,
  ): Promise<void> {
    let set = this.subscribers.get(jobId);
    if (!set) {
      set = new Set();
      this.subscribers.set(jobId, set);
    }
    const isFirstSubscriber = set.size === 0;
    set.add(socket);

    if (isFirstSubscriber) {
      await this.redisSub.subscribe(channel(jobId));
    }

    const raw = await this.redisPub.lrange(eventsKey(jobId), 0, -1);

    // Replay window expired: the Redis list is gone but the client had prior
    // state (lastEventIndex ≥ 0). Tell the client to re-fetch the tree so it
    // can resync without losing files written after the window closed.
    if (raw.length === 0 && lastEventIndex >= 0) {
      this.safeSend(socket, JSON.stringify({ type: "resync" }));
      return;
    }

    for (const entry of raw) {
      let event: JobEvent;
      try {
        event = JSON.parse(entry) as JobEvent;
      } catch (err) {
        console.error(`[socket-manager] bad replay entry for ${jobId}:`, err);
        continue;
      }
      if (typeof event.index === "number" && event.index > lastEventIndex) {
        this.safeSend(socket, entry);
      }
    }
  }

  private async onClose(socket: AppSocket): Promise<void> {
    this.connections.delete(socket);
    for (const [jobId, set] of this.subscribers) {
      if (!set.delete(socket)) continue;
      if (set.size === 0) {
        await this.dropJob(jobId);
      }
    }
  }

  private fanOut(channelName: string, message: string): void {
    const jobId = jobIdFromChannel(channelName);
    if (!jobId) return;

    const set = this.subscribers.get(jobId);
    if (!set || set.size === 0) return;

    for (const socket of set) {
      this.safeSend(socket, message);
    }

    let type: string | undefined;
    try {
      type = (JSON.parse(message) as JobEvent).type;
    } catch (err) {
      console.error(`[socket-manager] bad live message for ${jobId}:`, err);
    }
    if (type === "done" || type === "error") {
      void this.dropJob(jobId);
    }
  }

  private async dropJob(jobId: string): Promise<void> {
    this.subscribers.delete(jobId);
    await this.redisSub.unsubscribe(channel(jobId)).catch((err) => {
      console.error(`[socket-manager] unsubscribe failed for ${jobId}:`, err);
    });
  }

  private reap(): void {
    for (const socket of this.connections) {
      if (!socket.isAlive) {
        socket.terminate();
        continue;
      }
      socket.isAlive = false;
      socket.ping();
    }
  }

  private safeSend(socket: AppSocket, data: string): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  }

  private sendError(socket: AppSocket, message: string): void {
    this.safeSend(socket, JSON.stringify({ type: "error", message }));
  }
}
