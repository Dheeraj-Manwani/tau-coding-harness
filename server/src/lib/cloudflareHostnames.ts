/**
 * Cloudflare for SaaS custom hostnames: the calls tau makes, and how their
 * answers map to a domain's state.
 *
 * Tau only asks Cloudflare for a hostname after it has seen the owner's TXT
 * record itself (`services/domain.service.ts`). Cloudflare alone would accept
 * any hostname whose CNAME already points at tau, so without that check an owner
 * who removes a domain but leaves the CNAME would let another project claim it
 * (doc/PUBLISHING.md C10).
 */
import { env } from "@/lib/env";

const API = "https://api.cloudflare.com/client/v4";

export interface HostnamesConfig {
  zoneId: string;
  token: string;
  /** What owners point their CNAME or ALIAS at: `cname.{SITES_DOMAIN}`. */
  cnameTarget: string;
}

/**
 * The settings, or null where custom domains are off. The token needs SSL and
 * Certificates: Edit on the zone. `CLOUDFLARE_SAAS_TOKEN` keeps that apart from
 * the KV-only token the routing records use; one token that has both works too.
 */
export function hostnamesConfig(): HostnamesConfig | null {
  const zoneId = env.CLOUDFLARE_ZONE_ID;
  const token = env.CLOUDFLARE_SAAS_TOKEN ?? env.CLOUDFLARE_API_TOKEN;
  const domain = env.SITES_DOMAIN;
  return zoneId && token && domain ? { zoneId, token, cnameTarget: `cname.${domain}` } : null;
}

/** The part of Cloudflare's custom hostname object tau reads. */
export interface CfHostname {
  id: string;
  hostname?: string;
  status: string;
  verification_errors?: string[];
  ssl?: {
    status?: string;
    validation_errors?: { message?: string }[];
  };
}

export class CloudflareHostnameError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Cloudflare's own error code, e.g. 1406 for a hostname that already exists. */
    readonly code: number | null,
  ) {
    super(message);
  }
}

export interface HostnamesClient {
  create(hostname: string): Promise<CfHostname>;
  get(id: string): Promise<CfHostname>;
  findByName(hostname: string): Promise<CfHostname | null>;
  /** Succeeds when it is already gone. */
  remove(id: string): Promise<void>;
}

export function cloudflareHostnames(config: HostnamesConfig, fetcher: typeof fetch = fetch): HostnamesClient {
  const base = `${API}/zones/${config.zoneId}/custom_hostnames`;

  async function call(method: string, url: string, body?: unknown) {
    const res = await fetcher(url, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => null)) as {
      success?: boolean;
      errors?: { code?: number; message?: string }[];
      result?: unknown;
    } | null;
    if (!res.ok || json?.success === false) {
      const first = json?.errors?.[0];
      throw new CloudflareHostnameError(
        `Cloudflare ${method} custom hostname answered ${res.status}: ${first?.message ?? "no reason given"}`,
        res.status,
        first?.code ?? null,
      );
    }
    return json?.result;
  }

  return {
    async create(hostname) {
      // Validation is by HTTP: once the owner's CNAME points at tau's target and
      // traffic reaches Cloudflare, it proves itself and issues the certificate.
      return (await call("POST", base, {
        hostname,
        ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
      })) as CfHostname;
    },
    async get(id) {
      return (await call("GET", `${base}/${encodeURIComponent(id)}`)) as CfHostname;
    },
    async findByName(hostname) {
      const found = (await call("GET", `${base}?hostname=${encodeURIComponent(hostname)}`)) as CfHostname[] | undefined;
      return found?.find((h) => h.hostname === hostname) ?? null;
    },
    async remove(id) {
      try {
        await call("DELETE", `${base}/${encodeURIComponent(id)}`);
      } catch (err) {
        if (err instanceof CloudflareHostnameError && err.status === 404) return;
        throw err;
      }
    },
  };
}

// ── Reading Cloudflare's answer ──────────────────────────────────────────────

export type HostnameState =
  | { state: "VERIFYING" | "ISSUING" | "ACTIVE" }
  | { state: "FAILED"; reason: string };

const DEAD_STATUS = new Set(["blocked", "moved", "deleted", "pending_deletion", "pending_blocked", "test_failed", "test_blocked"]);
const TIMED_OUT = new Set([
  "initializing_timed_out",
  "validation_timed_out",
  "issuance_timed_out",
  "deployment_timed_out",
  "deletion_timed_out",
  "expired",
]);
const ISSUING = new Set(["pending_issuance", "pending_deployment", "staging_deployment", "staging_active", "holding_deployment", "backup_issued"]);

const TIMED_OUT_MESSAGE =
  "Cloudflare could not validate this domain in time. Check that both records are exactly as shown, that nothing at your registrar (a CDN, a proxy, a parking page) is answering for the name, then check again.";

/**
 * A domain's state from what Cloudflare says about its hostname.
 *
 * `pending_validation` is Cloudflare waiting to see the owner's CNAME resolve to
 * tau's target, so it is VERIFYING; once it is issuing the certificate it is
 * ISSUING; only an active hostname with an active certificate is ACTIVE. Any
 * dead or timed-out state is FAILED with the most specific reason on hand.
 */
export function stateFromCloudflare(h: Pick<CfHostname, "status" | "ssl" | "verification_errors">): HostnameState {
  const ssl = h.ssl?.status ?? "";
  if (h.status === "active" && ssl === "active") return { state: "ACTIVE" };

  const detail =
    [...(h.verification_errors ?? []), ...(h.ssl?.validation_errors ?? []).map((e) => e.message ?? "")]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);

  if (TIMED_OUT.has(ssl)) return { state: "FAILED", reason: TIMED_OUT_MESSAGE };
  if (DEAD_STATUS.has(h.status)) {
    return {
      state: "FAILED",
      reason: detail || "Cloudflare rejected this domain. Remove it and add it again, or contact support.",
    };
  }
  if (ISSUING.has(ssl) || h.status === "active" || h.status === "provisioned") return { state: "ISSUING" };
  return { state: "VERIFYING" };
}
