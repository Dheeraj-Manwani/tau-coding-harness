import argon2 from "argon2";
import type { ClientType, Prisma, User } from "../generated/prisma/client";
import * as authRepository from "../repositories/auth.repository";
import * as tokens from "../lib/tokens";
import type { IssuedTokens } from "../lib/tokens";
import { sendVerificationEmail } from "../lib/email";
import { AppError, Errors } from "../lib/errors";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export interface SafeUser {
  id: string;
  email: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}

export interface AuthResult {
  user: SafeUser;
  tokens: IssuedTokens;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    email: user.email,
    emailVerifiedAt: user.emailVerifiedAt,
    createdAt: user.createdAt,
  };
}

export async function register(input: {
  email: string;
  password: string;
  clientType: ClientType;
  deviceInfo?: Prisma.InputJsonValue;
}): Promise<AuthResult> {
  const { email } = input;

  const existing = await authRepository.findUserByEmail(email);
  if (existing) {
    throw Errors.conflict("An account with this email already exists");
  }

  const passwordHash = await argon2.hash(input.password, ARGON2_OPTIONS);
  const user = await authRepository.createUser({ email, passwordHash });

  sendVerificationEmail({ userId: user.id, email: user.email }).catch((err) => {
    console.error(
      `[auth] failed to send verification email for ${user.id}:`,
      err,
    );
  });

  const issued = await tokens.issueTokenPair(
    user,
    input.clientType,
    input.deviceInfo,
  );
  return { user: toSafeUser(user), tokens: issued };
}

export async function login(input: {
  email: string;
  password: string;
  clientType: ClientType;
  deviceInfo?: Prisma.InputJsonValue;
}): Promise<AuthResult> {
  const { email } = input;
  const invalid = Errors.unauthorized("Invalid credentials");

  const user = await authRepository.findUserByEmail(email);

  if (!user || !user.passwordHash) {
    throw invalid;
  }

  const ok = await argon2.verify(user.passwordHash, input.password);
  if (!ok) {
    throw invalid;
  }

  const issued = await tokens.issueTokenPair(
    user,
    input.clientType,
    input.deviceInfo,
  );
  return { user: toSafeUser(user), tokens: issued };
}

export async function refresh(input: {
  rawToken: string | undefined;
  clientType: ClientType;
  deviceInfo?: Prisma.InputJsonValue;
}): Promise<AuthResult> {
  if (!input.rawToken) {
    throw Errors.unauthorized("Refresh token required");
  }

  const { user, tokens: issued } = await tokens.rotateRefreshToken({
    rawToken: input.rawToken,
    clientType: input.clientType,
    deviceInfo: input.deviceInfo,
  });

  return { user: toSafeUser(user), tokens: issued };
}

export async function logout(rawToken: string | undefined): Promise<void> {
  if (!rawToken) return;
  await tokens.revokeRefreshToken(rawToken);
}

export async function logoutAll(userId: string): Promise<void> {
  await authRepository.revokeAllUserRefreshTokens(userId);
}

export async function findOrCreateGoogleUser(profile: {
  providerAccountId: string;
  email: string | undefined;
  accessToken?: string | null;
  refreshToken?: string | null;
}): Promise<User> {
  const provider = "google";

  const linked = await authRepository.findOAuthAccount(
    provider,
    profile.providerAccountId,
  );
  if (linked) {
    const user = await authRepository.findUserById(linked.userId);
    if (!user) throw new AppError("Linked account has no user", 500);
    return user;
  }

  const email = profile.email?.trim().toLowerCase();
  if (!email) {
    throw Errors.badRequest("Google account did not provide an email");
  }

  const existingUser = await authRepository.findUserByEmail(email);
  if (existingUser) {
    await authRepository.createOAuthAccount({
      userId: existingUser.id,
      provider,
      providerAccountId: profile.providerAccountId,
      accessToken: profile.accessToken,
      refreshToken: profile.refreshToken,
    });
    return existingUser;
  }

  const newUser = await authRepository.createOAuthUser({
    email,
    emailVerifiedAt: new Date(),
  });
  await authRepository.createOAuthAccount({
    userId: newUser.id,
    provider,
    providerAccountId: profile.providerAccountId,
    accessToken: profile.accessToken,
    refreshToken: profile.refreshToken,
  });
  return newUser;
}

export async function issueSession(
  user: User,
  clientType: ClientType,
  deviceInfo?: Prisma.InputJsonValue,
): Promise<AuthResult> {
  const issued = await tokens.issueTokenPair(user, clientType, deviceInfo);
  return { user: toSafeUser(user), tokens: issued };
}

export async function getCurrentUser(userId: string): Promise<SafeUser> {
  const user = await authRepository.findUserById(userId);
  if (!user) {
    throw Errors.notFound("User not found");
  }
  return toSafeUser(user);
}
