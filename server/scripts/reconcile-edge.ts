/** Pushes every site's routing record into Cloudflare KV. Safe to rerun. bun run scripts/reconcile-edge.ts */
import { reconcileEdge } from "@/lib/edgeRegistry";

console.log(JSON.stringify(await reconcileEdge(), null, 2));
process.exit(0);
