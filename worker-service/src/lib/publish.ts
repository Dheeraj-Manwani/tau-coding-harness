import { bus, type JobEvent } from "./bus";

export async function publish(jobId: string, event: object, index: number) {
  bus.emit(jobId, { ...(event as Record<string, unknown>), index } as JobEvent);
}

export function makeIndexer(start = 0): () => number {
  let i = start;
  return () => i++;
}
