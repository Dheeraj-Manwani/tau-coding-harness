import type { WebSocket } from "ws";

export interface SocketData {
  userId: string;
}

export interface AppSocket extends WebSocket {
  data: SocketData;
  isAlive: boolean;
}

export interface JobEvent {
  index: number;
  type: string;
  [key: string]: unknown;
}
