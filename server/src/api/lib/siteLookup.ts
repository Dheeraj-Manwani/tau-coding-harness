/**
 * slug → live deployment, cached briefly.
 *
 * One page load of a published app is a dozen requests (html, bundles, fonts,
 * images) that all resolve to the same two rows. Without a cache, every
 * published site would put a pair of queries on the primary for every asset it
 * serves, forever, for traffic we do not control.
 *
 * Its own module so the publish path can invalidate an entry without importing
 * the router that reads it.
 */
import { prisma } from "@/lib/prisma";
import { DeploymentStatus } from "@/generated/prisma/enums";

/** Short enough that a publish shows up about as fast as a browser reload. */
const LOOKUP_TTL_MS = 10_000;

export interface LiveSite {
  storagePrefix: string;
}

const cache = new Map<string, { value: LiveSite | null; expiresAt: number }>();

export async function resolveLiveSite(slug: string): Promise<LiveSite | null> {
  const cached = cache.get(slug);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const project = await prisma.project.findUnique({
    where: { slug },
    select: { liveDeploymentId: true },
  });

  let value: LiveSite | null = null;
  if (project?.liveDeploymentId) {
    const deployment = await prisma.deployment.findFirst({
      where: { id: project.liveDeploymentId, status: DeploymentStatus.READY },
      select: { storagePrefix: true },
    });
    if (deployment?.storagePrefix) {
      value = { storagePrefix: deployment.storagePrefix };
    }
  }

  // Misses are cached too, deliberately: an unpublished slug is exactly what a
  // scanner probes for, and each one is otherwise two queries.
  cache.set(slug, { value, expiresAt: Date.now() + LOOKUP_TTL_MS });
  return value;
}

/**
 * Drop a slug's entry so a just-finished publish is visible immediately.
 *
 * Correctness does not depend on this — the TTL gets there on its own — but the
 * ten seconds it saves are precisely the ten seconds the user spends clicking
 * the link we just handed them.
 */
export function invalidateSiteLookup(slug: string): void {
  cache.delete(slug);
}
