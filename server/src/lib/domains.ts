/**
 * Custom domains: what an owner types, what they are told to add at their
 * registrar, and how tau checks that they did (doc/PUBLISHING.md C10).
 *
 * Pure except for the DNS lookups, which take a resolver so tests (and nothing
 * else) can answer for the network. Nothing here talks to Cloudflare.
 */
import { randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { getDomain, parse } from "tldts";

/** Domains one project may connect. Each past the first 100 on the whole platform costs tau $0.10 a month. */
export const MAX_DOMAINS_PER_PROJECT = 5;

/** A domain that is not ACTIVE this long after it was added is FAILED. */
export const GIVE_UP_AFTER_MS = 72 * 60 * 60 * 1000;

/** The domains tau itself uses. A page on any of them would read as tau's own. */
const OWN_DOMAINS = ["bytauai.pro", "tauai.pro"];

export type DomainProblem =
  | "invalid"
  | "wildcard"
  | "ip"
  | "single_label"
  | "not_registrable"
  | "own_domain";

export const DOMAIN_MESSAGES: Record<DomainProblem, string> = {
  invalid: "That is not a valid domain name. Enter something like www.example.com.",
  wildcard: "Wildcard domains are not supported. Connect each name you need.",
  ip: "Enter a domain name, not an IP address.",
  single_label: "Enter a full domain name, like www.example.com.",
  not_registrable: "That is not a domain someone can own. Enter your own domain, like example.com.",
  own_domain: "That domain belongs to tau and can't be connected.",
};

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * What was typed, as a bare lower-case ASCII hostname, or null when it cannot be one.
 *
 * Accepts what people paste: a URL, a trailing slash or dot, capitals, a port,
 * an international name (turned into its `xn--` form, which is what DNS holds).
 */
export function normalizeHostname(input: string): string | null {
  let host = input.trim().toLowerCase();
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  host = host.split(/[/?#]/)[0] ?? "";
  host = host.replace(/^[^@]*@/, "");
  host = host.replace(/:\d+$/, "").replace(/\.+$/, "");
  if (!host || host.length > 253) return null;

  const ascii = domainToASCII(host);
  if (!ascii) return null;
  return ascii.length <= 253 ? ascii : null;
}

export function checkCustomHostname(
  input: string,
  opts: { sitesDomain?: string } = {},
): { ok: true; hostname: string } | { ok: false; problem: DomainProblem; message: string } {
  const fail = (problem: DomainProblem) => ({ ok: false as const, problem, message: DOMAIN_MESSAGES[problem] });

  if (input.includes("*")) return fail("wildcard");
  const hostname = normalizeHostname(input);
  if (!hostname) return fail("invalid");
  if (isIP(hostname) || /^\d+(?:\.\d+)*$/.test(hostname)) return fail("ip");

  const labels = hostname.split(".");
  if (labels.length < 2) return fail("single_label");
  if (!labels.every((l) => LABEL.test(l))) return fail("invalid");
  // A top-level name is letters (or punycode); "example.123" is not a domain.
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1]!)) return fail("invalid");

  const owned = [...OWN_DOMAINS, ...(opts.sitesDomain ? [opts.sitesDomain.toLowerCase()] : [])];
  if (owned.some((d) => hostname === d || hostname.endsWith(`.${d}`))) return fail("own_domain");

  // The public-suffix list says whether there is a domain someone could have
  // bought in this name ("co.uk" on its own has none), and whether the ending is
  // a real one at all ("localhost.localdomain" is not).
  const parsed = parse(hostname);
  if (!parsed.domain || !(parsed.isIcann || parsed.isPrivate)) return fail("not_registrable");
  return { ok: true, hostname };
}

/** `root` is a registrable domain itself (`example.com`), `subdomain` anything under one (`www.example.com`). */
export function kindOf(hostname: string): "root" | "subdomain" {
  return getDomain(hostname) === hostname ? "root" : "subdomain";
}

export function newVerificationToken(): string {
  return randomBytes(18).toString("hex");
}

export function verificationValue(token: string): string {
  return `tau-verify=${token}`;
}

export interface DnsRecord {
  type: "CNAME" | "ALIAS" | "TXT";
  /** Relative to the owner's zone, as most registrars want it: `www`, `@`, `_tau.www`. */
  name: string;
  /** The same, in full. */
  fullName: string;
  value: string;
  purpose: "route" | "verify";
}

/**
 * The two records to add at the registrar (C10's two tables).
 *
 * A subdomain takes a CNAME to tau's target. A root cannot hold a CNAME, so it
 * takes an ALIAS (some registrars call it ANAME, or a CNAME on `@`, which they
 * flatten). The TXT record is always at `_tau.` in front of the hostname, which
 * is what proves the owner controls the DNS.
 */
export function dnsRecords(hostname: string, token: string, cnameTarget: string): DnsRecord[] {
  const zone = getDomain(hostname) ?? hostname;
  const root = hostname === zone;
  const relative = root ? "@" : hostname.slice(0, -(zone.length + 1));
  return [
    {
      type: root ? "ALIAS" : "CNAME",
      name: relative,
      fullName: hostname,
      value: cnameTarget,
      purpose: "route",
    },
    {
      type: "TXT",
      name: root ? "_tau" : `_tau.${relative}`,
      fullName: `_tau.${hostname}`,
      value: verificationValue(token),
      purpose: "verify",
    },
  ];
}

/** Whether any TXT record is exactly the ownership value. Long values arrive split into chunks. */
export function txtProves(records: string[][], token: string): boolean {
  const want = verificationValue(token);
  return records.some((chunks) => chunks.join("").trim() === want);
}

// ── DNS lookups ──────────────────────────────────────────────────────────────

export interface Resolver {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
  resolve6(name: string): Promise<string[]>;
}

export const systemResolver: Resolver = dns;

export interface DnsCheck {
  /** The ownership record is there with the right value. */
  txt: boolean;
  /** The hostname leads to tau's target; null when it could not be told. */
  pointsAtTau: boolean | null;
}

const quiet = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);
const bare = (name: string) => name.toLowerCase().replace(/\.$/, "");

/**
 * Look at the owner's DNS.
 *
 * The TXT answer is what decides ownership. Whether the hostname leads to tau
 * only drives the "found / not found yet" line in the panel: a subdomain is
 * checked by its CNAME, and a root (whose ALIAS the registrar flattens into
 * addresses) by whether it shares an address with the target.
 */
export async function checkDns(
  hostname: string,
  token: string,
  cnameTarget: string,
  resolver: Resolver = systemResolver,
): Promise<DnsCheck> {
  const txt = txtProves(await quiet(resolver.resolveTxt(`_tau.${hostname}`), []), token);

  let pointsAtTau: boolean | null = null;
  const cnames = (await quiet(resolver.resolveCname(hostname), [])).map(bare);
  if (cnames.length > 0) {
    pointsAtTau = cnames.includes(bare(cnameTarget));
  } else {
    const [mine4, mine6, theirs4, theirs6] = await Promise.all([
      quiet(resolver.resolve4(hostname), []),
      quiet(resolver.resolve6(hostname), []),
      quiet(resolver.resolve4(cnameTarget), []),
      quiet(resolver.resolve6(cnameTarget), []),
    ]);
    const mine = new Set([...mine4, ...mine6]);
    const theirs = [...theirs4, ...theirs6];
    if (mine.size > 0 && theirs.length > 0) pointsAtTau = theirs.some((a) => mine.has(a));
  }
  return { txt, pointsAtTau };
}

// ── When to look again ───────────────────────────────────────────────────────

/**
 * How long to wait before checking a domain again, by how long it has been waiting.
 *
 * Fast at first, because people add the records and then watch the panel; then
 * slower, because DNS changes can take hours and every check is a handful of
 * lookups (and, once the ownership record is found, Cloudflare API calls).
 */
export function checkIntervalMs(ageMs: number): number {
  if (ageMs < 15 * 60_000) return 60_000;
  if (ageMs < 2 * 3_600_000) return 5 * 60_000;
  if (ageMs < 24 * 3_600_000) return 30 * 60_000;
  return 2 * 3_600_000;
}

export function checkIsDue(
  domain: { createdAt: Date; lastCheckedAt: Date | null },
  now: number = Date.now(),
): boolean {
  if (!domain.lastCheckedAt) return true;
  return now - domain.lastCheckedAt.getTime() >= checkIntervalMs(now - domain.createdAt.getTime());
}
