/**
 * One-time Cloudflare setup for published apps and custom domains.
 *
 *   bun run scripts/cloudflare-setup.ts           # show what would change
 *   bun run scripts/cloudflare-setup.ts --apply   # make the changes
 *
 * Reads CLOUDFLARE_API_TOKEN (or CLOUDFLARE_SAAS_TOKEN), CLOUDFLARE_ZONE_ID and
 * SITES_DOMAIN from the environment. The token needs DNS: Edit and SSL and
 * Certificates: Edit on the zone. Safe to run again: every step looks at what
 * is already there first and changes only what differs.
 *
 * What it sets up, all proxied and with no real origin (the Worker answers):
 *
 *   *.{domain}       AAAA 100::           every published app's address
 *   fallback.{domain} AAAA 100::          the "fallback origin" Cloudflare for SaaS needs
 *   cname.{domain}   CNAME fallback.{domain}  what owners point their records at
 *
 * and tells Cloudflare for SaaS that `fallback.{domain}` is the fallback origin.
 * The Worker route (`*` + `/*` on the zone) is set in `edge/wrangler.toml`, not
 * here. doc/PUBLISHING.md C10 and Phase 3.
 */
import { env } from "@/lib/env";

const apply = process.argv.includes("--apply");
const zoneId = env.CLOUDFLARE_ZONE_ID;
const token = env.CLOUDFLARE_SAAS_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
const domain = env.SITES_DOMAIN;
if (!zoneId || !token || !domain) {
  console.error("Set CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_TOKEN (or CLOUDFLARE_SAAS_TOKEN) and SITES_DOMAIN first.");
  process.exit(2);
}

const API = `https://api.cloudflare.com/client/v4/zones/${zoneId}`;

async function cf(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[]; result?: unknown } | null;
  if (!res.ok || json?.success === false) {
    throw new Error(`${method} ${path} -> ${res.status}: ${json?.errors?.[0]?.message ?? "no reason given"}`);
  }
  return json?.result;
}

interface Wanted {
  type: "AAAA" | "CNAME";
  name: string;
  content: string;
}

const WANTED: Wanted[] = [
  { type: "AAAA", name: `*.${domain}`, content: "100::" },
  { type: "AAAA", name: `fallback.${domain}`, content: "100::" },
  { type: "CNAME", name: `cname.${domain}`, content: `fallback.${domain}` },
];

let changes = 0;

for (const want of WANTED) {
  const found = (await cf("GET", `/dns_records?name=${encodeURIComponent(want.name)}`)) as {
    id: string;
    type: string;
    content: string;
    proxied: boolean;
  }[];
  const same = found.find((r) => r.type === want.type);
  const other = found.filter((r) => r.type !== want.type && ["A", "AAAA", "CNAME"].includes(r.type));

  if (other.length > 0) {
    console.log(`! ${want.name} already has a ${other.map((r) => r.type).join("/")} record. Remove it in the dashboard, then run this again.`);
    changes += 1;
    continue;
  }
  const payload = { type: want.type, name: want.name, content: want.content, proxied: true, ttl: 1 };
  if (!same) {
    console.log(`+ ${want.type} ${want.name} -> ${want.content} (proxied)`);
    changes += 1;
    if (apply) await cf("POST", "/dns_records", payload);
  } else if (same.content !== want.content || !same.proxied) {
    console.log(`~ ${want.type} ${want.name}: ${same.content}${same.proxied ? "" : " (not proxied)"} -> ${want.content} (proxied)`);
    changes += 1;
    if (apply) await cf("PUT", `/dns_records/${same.id}`, payload);
  } else {
    console.log(`= ${want.type} ${want.name} -> ${want.content}`);
  }
}

const fallback = (await cf("GET", "/custom_hostnames/fallback_origin")) as { origin?: string; status?: string } | null;
const wantOrigin = `fallback.${domain}`;
if (fallback?.origin === wantOrigin) {
  console.log(`= fallback origin ${wantOrigin} (${fallback.status ?? "unknown"})`);
} else {
  console.log(`+ fallback origin ${fallback?.origin ?? "(none)"} -> ${wantOrigin}`);
  changes += 1;
  if (apply) await cf("PUT", "/custom_hostnames/fallback_origin", { origin: wantOrigin });
}

console.log(
  changes === 0
    ? "\nNothing to change."
    : apply
      ? `\nDone: ${changes} change${changes === 1 ? "" : "s"} made. The fallback origin can take a minute to become active; run this again to see its status.`
      : `\n${changes} change${changes === 1 ? "" : "s"} needed. Run again with --apply to make them.`,
);
