import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "./env";

// One PrismaClient per PROCESS, cached on globalThis.
//
// The cache used to be gated on `NODE_ENV !== "production"` — the usual guard
// against dev hot-reload leaking clients. That was wrong here:
// `deploy/combined.ts` imports both the api and the worker into a single
// process, and each has its own copy of this module, so in production the guard
// produced TWO clients and therefore two connection pools out of one process.
// Caching unconditionally makes the first importer win and the second reuse it,
// which is what was intended in both environments.
//
// Byte-identical to api/src/lib/prisma.ts; test/drift.test.ts enforces that.

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Built lazily: constructing the adapter sets up a pg Pool, so it must not run
// on the path where an existing client is reused.
function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  return new PrismaClient({ adapter });
}

export const prisma = (globalForPrisma.prisma ??= createClient());
