const freshBuilds = new Set<string>();

/** Mark a project as freshly launched from home (call right before navigating). */
export function markFreshBuild(projectId: string): void {
  freshBuilds.add(projectId);
}

/** Pure read — safe to call from a render / useState initializer. */
export function hasFreshBuild(projectId: string): boolean {
  return freshBuilds.has(projectId);
}

/** Consume the flag once the project page has read it. */
export function clearFreshBuild(projectId: string): void {
  freshBuilds.delete(projectId);
}
