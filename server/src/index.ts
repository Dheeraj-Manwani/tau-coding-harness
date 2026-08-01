import "./load-env"; // must be first: populate process.env before service env.ts runs
import http from "node:http";
import { buildApp, startApiBackground } from "@/api/index";
import { startRunner } from "@/worker/index";
import { mountSse } from "./sse-route";

const PORT = Number(process.env.PORT ?? 8080);

// api HTTP + SSE stream/cancel on one app; the SSE routes are mounted via the
// buildApp hook so they sit before the global requireAuth.
const app = buildApp(mountSse);
startApiBackground(); // hourly credit-hold sweep
startRunner(); // in-process BullMQ-free job consumer

http.createServer(app).listen(PORT, () =>
  console.log(`[economy] combined listening on ${PORT} (no redis, sse)`),
);
