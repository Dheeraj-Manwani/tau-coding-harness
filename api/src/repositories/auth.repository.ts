import { prisma } from "../lib/prisma";
import type {
  User,
  OAuthAccount,
  RefreshToken,
  ClientType,
  Prisma,
} from "../generated/prisma/client";

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
