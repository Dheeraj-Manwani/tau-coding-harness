import { redis } from "./redis";

export async function publish(jobId: string, event: object, index: number) {
  const payload = JSON.stringify({ ...event, index });
  await Promise.all([
    redis.rpush(`job:${jobId}:events`, payload),
    redis.publish(`job:${jobId}`, payload),
  ]);
  await redis.expire(`job:${jobId}:events`, 3600);
}

export function makeIndexer(start = 0): () => number {
  let i = start;
  return () => i++;
}
