/**
 * Custom domains, from the owner's side (doc/PUBLISHING.md C10, Phase 3).
 *
 * The life of a domain:
 *
 *   PENDING_DNS  the owner has not yet added the TXT record tau looked for
 *   VERIFYING    tau saw it, asked Cloudflare for the hostname, and Cloudflare
 *                is waiting to see the CNAME/ALIAS resolve to tau's target
 *   ISSUING      Cloudflare is issuing the certificate
 *   ACTIVE       serving over HTTPS; the only state with a routing record
 *   FAILED       gave up, with a reason; checking again starts over
 *
 * The rule everything here protects: **tau checks the TXT record itself before
 * it ever asks Cloudflare for the hostname.** Cloudflare alone would accept any
 * hostname whose CNAME already points at tau, so an owner who removed a domain
 * but left the CNAME in place would let another project claim it. The TXT value
 * is a token that belongs to one row, and a removed name gets a new token when
 * it is added again, so nothing left behind in someone's DNS proves a new claim.
 */
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { createLogger } from "@/lib/log";
import {
  checkDns,
  checkCustomHostname,
  checkIsDue,
  dnsRecords,
  GIVE_UP_AFTER_MS,
  kindOf,
  MAX_DOMAINS_PER_PROJECT,
  newVerificationToken,
  systemResolver,
  type DnsCheck,
  type Resolver,
} from "@/lib/domains";
import {
  CloudflareHostnameError,
  cloudflareHostnames,
  hostnamesConfig,
  stateFromCloudflare,
  type HostnamesClient,
} from "@/lib/cloudflareHostnames";
import { removeHostnames, syncProject } from "@/lib/edgeRegistry";
import { DomainStatus } from "@/generated/prisma/enums";
import type { Domain, Project } from "@/generated/prisma/client";
import { Errors } from "../lib/errors";
import * as projectRepo from "../repositories/project.repository";

const { log } = createLogger("domains");

// ── What the service depends on, so tests can stand in for the world ─────────

interface Deps {
  resolver: Resolver;
  /** Null where Cloudflare is not configured: DNS is still checked, nothing is requested. */
  hostnames: () => HostnamesClient | null;
  now: () => number;
}

const realDeps: Deps = {
  resolver: systemResolver,
  hostnames: () => {
    const config = hostnamesConfig();
    return config ? cloudflareHostnames(config) : null;
  },
  now: () => Date.now(),
};
let deps: Deps = realDeps;

/** Tests hand in their own. Pass null to put the real ones back. */
export function setDomainDepsForTests(next: Partial<Deps> | null): void {
  deps = next ? { ...realDeps, ...next } : realDeps;
}

/** What owners point their records at. */
export function cnameTarget(): string {
  return `cname.${env.SITES_DOMAIN ?? "bytauai.pro"}`;
}

// ── The view the panel reads ─────────────────────────────────────────────────

export interface DomainView {
  id: string;
  hostname: string;
  kind: "root" | "subdomain";
  status: DomainStatus;
  isPrimary: boolean;
  error: string | null;
  records: ReturnType<typeof dnsRecords>;
  /** Live DNS answers, for domains that are not ACTIVE yet. */
  dns: DnsCheck | null;
  lastCheckedAt: Date | null;
  /** When tau stops waiting. */
  checkUntil: Date;
  createdAt: Date;
}

function toView(domain: Domain, dns: DnsCheck | null): DomainView {
  return {
    id: domain.id,
    hostname: domain.hostname,
    kind: kindOf(domain.hostname),
    status: domain.status,
    isPrimary: domain.isPrimary,
    error: domain.error,
    records: dnsRecords(domain.hostname, domain.verificationToken, cnameTarget()),
    dns,
    lastCheckedAt: domain.lastCheckedAt,
    checkUntil: domain.checkUntil,
    createdAt: domain.createdAt,
  };
}

async function ownedProject(projectId: string, userId: string): Promise<Project> {
  const project = await projectRepo.findProjectById(projectId);
  if (!project) throw Errors.notFound("Project not found");
  if (project.userId !== userId) throw Errors.forbidden("You do not have access to this project");
  return project;
}

async function ownedDomain(projectId: string, domainId: string, userId: string): Promise<Domain> {
  await ownedProject(projectId, userId);
  const domain = await prisma.domain.findUnique({ where: { id: domainId } });
  // Another project's domain is "not found", not "forbidden": it says nothing about who holds a name.
  if (!domain || domain.projectId !== projectId) throw Errors.notFound("That domain isn't connected to this project");
  return domain;
}

export async function listDomains(projectId: string, userId: string): Promise<DomainView[]> {
  await ownedProject(projectId, userId);
  const rows = await prisma.domain.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return Promise.all(
    rows.map(async (d) =>
      toView(
        d,
        d.status === DomainStatus.ACTIVE
          ? null
          : await checkDns(d.hostname, d.verificationToken, cnameTarget(), deps.resolver).catch(() => null),
      ),
    ),
  );
}

// ── Adding ───────────────────────────────────────────────────────────────────

export async function addDomain(projectId: string, userId: string, input: string): Promise<DomainView> {
  const project = await ownedProject(projectId, userId);

  const checked = checkCustomHostname(input, { sitesDomain: env.SITES_DOMAIN });
  if (!checked.ok) throw Errors.badRequest(checked.message);

  // A domain serves the published app, and the routing record is built from the
  // app's own address. Before that there is nothing to point it at.
  if (!project.slug) {
    throw Errors.conflict("Publish your app once before connecting a domain, so there is something to show on it.");
  }

  const held = await prisma.domain.count({ where: { projectId } });
  if (held >= MAX_DOMAINS_PER_PROJECT) {
    throw Errors.conflict(`A project can have ${MAX_DOMAINS_PER_PROJECT} domains. Remove one to add another.`);
  }

  const taken = await prisma.domain.findUnique({ where: { hostname: checked.hostname }, select: { projectId: true } });
  if (taken) {
    throw Errors.conflict(
      taken.projectId === projectId
        ? "That domain is already connected to this project."
        : "That domain is already connected to another project.",
    );
  }

  let created: Domain;
  try {
    created = await prisma.domain.create({
      data: {
        projectId,
        hostname: checked.hostname,
        verificationToken: newVerificationToken(),
        checkUntil: new Date(deps.now() + GIVE_UP_AFTER_MS),
      },
    });
  } catch (err) {
    // The unique index decides a race between two projects adding one name.
    if ((err as { code?: string }).code === "P2002") {
      throw Errors.conflict("That domain is already connected to another project.");
    }
    throw err;
  }
  log.info("domain.added", { projectId, hostname: created.hostname });
  return toView(created, await checkDns(created.hostname, created.verificationToken, cnameTarget(), deps.resolver).catch(() => null));
}

// ── Checking ─────────────────────────────────────────────────────────────────

const WAITING: DomainStatus[] = [DomainStatus.PENDING_DNS, DomainStatus.VERIFYING, DomainStatus.ISSUING];

/**
 * Move one domain as far along as the world allows, once.
 *
 * Idempotent and safe to call as often as wanted: each step is only taken when
 * its condition holds now, so a domain whose records appear mid-way carries on
 * from where it was. Returns the row as it ends up.
 */
export async function checkDomain(domain: Domain): Promise<Domain> {
  if (domain.status === DomainStatus.ACTIVE) return domain;
  const now = new Date(deps.now());
  const client = deps.hostnames();
  let current = domain;

  const save = async (data: Partial<Domain>) => {
    current = await prisma.domain.update({ where: { id: domain.id }, data: { lastCheckedAt: now, ...data } });
  };

  if (current.status === DomainStatus.FAILED) return current;

  if (now > current.checkUntil) {
    if (current.cloudflareHostnameId && client) {
      await client.remove(current.cloudflareHostnameId).catch((e) => log.warn("domain.cf_remove_failed", { hostname: domain.hostname, error: String(e).slice(0, 200) }));
    }
    await save({
      status: DomainStatus.FAILED,
      error: "This domain was not connected within 72 hours. Check the records, then check again.",
    });
    return current;
  }

  const dns = await checkDns(current.hostname, current.verificationToken, cnameTarget(), deps.resolver);

  if (current.status === DomainStatus.PENDING_DNS) {
    // Ownership first. Nothing is asked of Cloudflare until this record is seen.
    if (!dns.txt) {
      await save({});
      return current;
    }
    if (!client) {
      // Seen, but custom domains are not switched on here: leave it waiting.
      await save({});
      return current;
    }
    let hostname = await client.create(current.hostname).catch(async (err: unknown) => {
      // Left over from an earlier attempt that was not cleaned up: take it over.
      if (err instanceof CloudflareHostnameError && err.code === 1406) return client.findByName(current.hostname);
      throw err;
    });
    if (!hostname) throw new Error("Cloudflare reported a duplicate hostname it could not find");
    await save({ status: DomainStatus.VERIFYING, cloudflareHostnameId: hostname.id, error: null });
  }

  if (current.cloudflareHostnameId && client) {
    const hostname = await client.get(current.cloudflareHostnameId);
    const mapped = stateFromCloudflare(hostname);
    if (mapped.state === "FAILED") {
      await save({ status: DomainStatus.FAILED, error: mapped.reason });
    } else {
      await save({ status: DomainStatus[mapped.state], error: null });
      if (mapped.state === "ACTIVE") {
        log.info("domain.active", { projectId: current.projectId, hostname: current.hostname });
        // Now, and only now, it gets a routing record.
        await syncProject(current.projectId);
      }
    }
  } else {
    await save({});
  }
  return current;
}

/**
 * The owner pressed Refresh. A FAILED domain starts over from the top with
 * a fresh 72 hours; anything else is just checked now.
 */
export async function recheckDomain(projectId: string, domainId: string, userId: string): Promise<DomainView> {
  let domain = await ownedDomain(projectId, domainId, userId);
  const client = deps.hostnames();

  if (domain.status === DomainStatus.FAILED) {
    if (domain.cloudflareHostnameId && client) {
      await client.remove(domain.cloudflareHostnameId).catch(() => {});
    }
    domain = await prisma.domain.update({
      where: { id: domain.id },
      data: {
        status: DomainStatus.PENDING_DNS,
        cloudflareHostnameId: null,
        error: null,
        checkUntil: new Date(deps.now() + GIVE_UP_AFTER_MS),
      },
    });
  }

  try {
    domain = await checkDomain(domain);
  } catch (err) {
    // A Cloudflare hiccup is not the owner's failure: say so, and let the next pass retry.
    log.warn("domain.check_failed", { hostname: domain.hostname, error: String(err).slice(0, 300) });
    throw Errors.tooMany("We couldn't reach our certificate provider just now. Try again in a minute.");
  }
  return toView(domain, domain.status === DomainStatus.ACTIVE ? null : await checkDns(domain.hostname, domain.verificationToken, cnameTarget(), deps.resolver).catch(() => null));
}

let running = false;

/** The periodic pass: every domain that is waiting and due, oldest check first. */
export async function runDomainVerification(): Promise<number> {
  if (running) return 0;
  running = true;
  let checked = 0;
  try {
    const waiting = await prisma.domain.findMany({
      where: { status: { in: WAITING } },
      orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
      take: 100,
    });
    for (const domain of waiting) {
      if (!checkIsDue(domain, deps.now())) continue;
      try {
        await checkDomain(domain);
        checked += 1;
      } catch (err) {
        // Recorded as a check so the back-off still applies, and left for the next pass.
        await prisma.domain.update({ where: { id: domain.id }, data: { lastCheckedAt: new Date(deps.now()) } }).catch(() => {});
        log.warn("domain.check_failed", { hostname: domain.hostname, error: String(err).slice(0, 300) });
      }
    }
  } finally {
    running = false;
  }
  return checked;
}

/** Entry point beside the other periodic jobs. */
export async function runDomainVerificationSafely(): Promise<void> {
  try {
    await runDomainVerification();
  } catch (err) {
    log.warn("domain.verification_failed", { error: String(err).slice(0, 300) });
  }
}

// ── Primary, and removal ─────────────────────────────────────────────────────

/**
 * Make a domain the one the app lives at (the default address then redirects to
 * it), or stop doing so. Only an ACTIVE domain can be primary: a redirect to
 * something that does not serve yet would break the working address.
 */
export async function setPrimary(projectId: string, domainId: string, userId: string, primary: boolean): Promise<DomainView[]> {
  const domain = await ownedDomain(projectId, domainId, userId);
  if (primary && domain.status !== DomainStatus.ACTIVE) {
    throw Errors.conflict("A domain can be made primary once it is active.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.domain.updateMany({ where: { projectId }, data: { isPrimary: false } });
    if (primary) await tx.domain.update({ where: { id: domain.id }, data: { isPrimary: true } });
  });
  await syncProject(projectId);
  return listDomains(projectId, userId);
}

/** Stop serving a hostname: at Cloudflare, at the edge, and in the database. */
async function release(domain: Domain): Promise<void> {
  const client = deps.hostnames();
  if (domain.cloudflareHostnameId && client) {
    await client.remove(domain.cloudflareHostnameId).catch((err) => {
      // The row goes anyway: a hostname left at Cloudflare is adopted if the name is added again.
      log.warn("domain.cf_remove_failed", { hostname: domain.hostname, error: String(err).slice(0, 200) });
    });
  }
  await removeHostnames([domain.hostname]);
}

export async function removeDomain(projectId: string, domainId: string, userId: string): Promise<DomainView[]> {
  const domain = await ownedDomain(projectId, domainId, userId);
  await release(domain);
  await prisma.domain.delete({ where: { id: domain.id } });
  // A removed primary leaves the default address serving again.
  if (domain.isPrimary) await syncProject(projectId);
  log.info("domain.removed", { projectId, hostname: domain.hostname });
  return listDomains(projectId, userId);
}

/** Deleting a project takes its domains with it, at Cloudflare and the edge too. */
export async function releaseProjectDomains(projectId: string): Promise<void> {
  const domains = await prisma.domain.findMany({ where: { projectId } });
  for (const domain of domains) await release(domain);
}
