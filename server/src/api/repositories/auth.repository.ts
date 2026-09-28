import { prisma } from "@/lib/prisma";
import type {
  User,
  OAuthAccount,
  RefreshToken,
  ClientType,
  Prisma,
} from "@/generated/prisma/client";

export function findUserByEmail(email: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { email } });
}

export function findUserById(id: string): Promise<User | null> {
  return prisma.user.findUnique({ where: { id } });
}

export function createUser(data: {
  email: string;
  passwordHash: string;
}): Promise<User> {
  return prisma.user.create({ data });
}

/**
 * Merge a preferences patch into the stored object in one statement.
 *
 * A Prisma read-modify-write would let two tabs saving different keys drop one
 * another's change. Instead Postgres does the merge: top-level keys via `||`,
 * and `tours` one level deeper so finishing one tour never erases another.
 * Returns the merged object, or null if the user no longer exists.
 */
export async function mergeUserPreferences(
  userId: string,
  top: Record<string, unknown>,
  tours: Record<string, unknown> | undefined,
): Promise<unknown | null> {
  const topJson = JSON.stringify(top);
  const toursJson = JSON.stringify(tours ?? {});
  const rows = await prisma.$queryRaw<{ preferences: unknown }[]>`
    UPDATE "User"
    SET "preferences" =
      COALESCE("preferences", '{}'::jsonb)
      || ${topJson}::jsonb
      || CASE WHEN ${toursJson}::jsonb = '{}'::jsonb THEN '{}'::jsonb
         ELSE jsonb_build_object(
           'tours',
           CASE WHEN jsonb_typeof("preferences"->'tours') = 'object'
             THEN "preferences"->'tours' ELSE '{}'::jsonb END
           || ${toursJson}::jsonb
         )
         END
    WHERE "id" = ${userId}
    RETURNING "preferences"
  `;
  return rows[0]?.preferences ?? null;
}

export function markEmailVerified(userId: string): Promise<User> {
  return prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
}

export function createOAuthUser(data: {
  email: string;
  emailVerifiedAt: Date;
}): Promise<User> {
  return prisma.user.create({ data });
}

export function findOAuthAccount(
  provider: string,
  providerAccountId: string,
): Promise<OAuthAccount | null> {
  return prisma.oAuthAccount.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
  });
}

export function createOAuthAccount(data: {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}): Promise<OAuthAccount> {
  return prisma.oAuthAccount.create({ data });
}

/** The most recent OAuth link a user has for a provider (e.g. "github"). */
export function findOAuthAccountByUser(
  userId: string,
  provider: string,
): Promise<OAuthAccount | null> {
  return prisma.oAuthAccount.findFirst({ where: { userId, provider } });
}

/**
 * Link (or re-link) a provider account to a user. Keyed on the provider's own
 * account id so reconnecting the same GitHub account refreshes the token in
 * place rather than creating a duplicate row.
 */
export function upsertOAuthAccount(data: {
  userId: string;
  provider: string;
  providerAccountId: string;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}): Promise<OAuthAccount> {
  const { provider, providerAccountId } = data;
  return prisma.oAuthAccount.upsert({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    create: data,
    update: {
      userId: data.userId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: data.expiresAt,
    },
  });
}

/** Remove a user's link to a provider (Disconnect). Returns rows deleted. */
export async function deleteOAuthAccountsByUser(
  userId: string,
  provider: string,
): Promise<number> {
  const result = await prisma.oAuthAccount.deleteMany({
    where: { userId, provider },
  });
  return result.count;
}

export function createRefreshToken(data: {
  userId: string;
  tokenHash: string;
  clientType: ClientType;
  deviceInfo?: Prisma.InputJsonValue;
  expiresAt: Date;
}): Promise<RefreshToken> {
  return prisma.refreshToken.create({ data });
}

export function findRefreshTokenByHash(
  tokenHash: string,
): Promise<RefreshToken | null> {
  return prisma.refreshToken.findUnique({ where: { tokenHash } });
}

export function revokeRefreshTokenById(id: string): Promise<RefreshToken> {
  return prisma.refreshToken.update({
    where: { id },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllUserRefreshTokens(
  userId: string,
): Promise<number> {
  const result = await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}
