import { handle, type Env } from "./serve";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      // A KV or R2 outage is the one thing here that can throw. Say so plainly
      // rather than leaking a stack trace onto a published app's domain.
      return new Response("Temporarily unavailable", {
        status: 503,
        headers: { "Retry-After": "30", "Cache-Control": "no-store" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
