import { Redis } from "ioredis";
import { env } from "./env";

export const redisSub = new Redis(env.REDIS_URL);

export const redisPub = new Redis(env.REDIS_URL);

for (const [name, client] of [
  ["redisSub", redisSub],
  ["redisPub", redisPub],
] as const) {
  client.on("error", (err) => {
    console.error(`[redis:${name}] connection error:`, err);
  });
}
