// Shim: the logger itself lives in shared/log.ts, shared with worker-service.
// This file exists so every `import { log } from ".../lib/log"` in this service
// keeps resolving, and so the deep relative path lives in exactly one place —
// the same pattern as lib/bus.ts.
import { createLogger } from "@/lib/log";

export type { LogContext, LogLevel, Logger } from "@/lib/log";

export const { log, captureException } = createLogger("worker");
