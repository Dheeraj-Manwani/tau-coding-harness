import type { IncomingMessage } from "node:http";
import { WebSocketServer } from "ws";
import { env } from "./lib/env";
import { verifyConnectionToken } from "./lib/auth";
import { redisPub, redisSub } from "./lib/redis";
import { SocketManager } from "./lib/socket-manager";
import type { AppSocket, SocketData } from "./lib/types";

type AuthedRequest = IncomingMessage & { socketData?: SocketData };

const manager = new SocketManager({ redisPub, redisSub });

const wss = new WebSocketServer({
  port: env.PORT,
  verifyClient: ({ req }, done) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const token = url.searchParams.get("token");
    const payload = token ? verifyConnectionToken(token) : null;
    if (!payload) {
      done(false, 401, "Unauthorized");
      return;
    }
    (req as AuthedRequest).socketData = { userId: payload.sub };
    done(true);
  },
});

wss.on("connection", (socket: AppSocket, req: AuthedRequest) => {
  socket.data = req.socketData ?? { userId: "" };
  manager.register(socket);
});

wss.on("close", () => manager.close());

wss.on("listening", () => {
  console.log(`ws-gateway listening on ws://localhost:${env.PORT}`);
});
