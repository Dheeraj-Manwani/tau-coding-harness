import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import type { ClientType, Prisma, User } from "../generated/prisma/client";
import * as authRepository from "../repositories/auth.repository";
import { Errors } from "./errors";
import { env } from "./env";

const ACCESS_TOKEN_SECRET = env.ACCESS_TOKEN_SECRET;
const ACCESS_TOKEN_TTL = "15m";
const REFRESH_TOKEN_TTL_DAYS = env.REFRESH_TOKEN_TTL_DAYS;
const REFRESH_TOKEN_BYTES = 64;

export interface AccessTokenPayload {
  sub: string;
  email: string;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export function issueAccessToken(user: Pick<User, "id" | "email">): string {
  const payload: AccessTokenPayload = { sub: user.id, email: user.email };
  const options: SignOptions = {
    algorithm: "HS256",
    expiresIn: ACCESS_TOKEN_TTL,
  };
  return jwt.sign(payload, ACCESS_TOKEN_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    });
    return decoded as AccessTokenPayload;
  } catch {
    throw Errors.unauthorized("Invalid or expired token");
  }
}

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export async function issueRefreshToken(input: {
  userId: string;
  clientType: ClientType;
  deviceInfo?: Prisma.InputJsonValue;
}): Promise<{ refreshToken: string; expiresAt: Date }> {
  const rawToken = crypto.randomBytes(REFRESH_TOKEN_BYTES).toString("hex");
  const expiresAt = new Date(
    Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  await authRepository.createRefreshToken({
    userId: input.userId,
    tokenHash: hashToken(rawToken),
    clientType: input.clientType,
    deviceInfo: input.deviceInfo,
    expiresAt,
  });

  return { refreshToken: rawToken, expiresAt };
}

export async function issueTokenPair(
  user: Pick<User, "id" | "email">,
  clientType: ClientType,
  deviceInfo?: Prisma.InputJsonValue,
): Promise<IssuedTokens> {
  const accessToken = issueAccessToken(user);
  const { refreshToken, expiresAt } = await issueRefreshToken({
    userId: user.id,
    clientType,
    deviceInfo,
  });
  return { accessToken, refreshToken, refreshTokenExpiresAt: expiresAt };
}

export async function rotateRefreshToken(input: {
  rawToken: string;
  clientType: ClientType;
  deviceInfo?: Prisma.InputJsonValue;
}): Promise<{ user: User; tokens: IssuedTokens }> {
  const existing = await authRepository.findRefreshTokenByHash(
    hashToken(input.rawToken),
  );

  if (!existing) {
    throw Errors.unauthorized("Invalid refresh token");
  }

  if (existing.revokedAt) {
    await authRepository.revokeAllUserRefreshTokens(existing.userId);
    throw Errors.unauthorized("Refresh token reuse detected");
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw Errors.unauthorized("Refresh token expired");
  }

  const user = await authRepository.findUserById(existing.userId);
  if (!user) {
    throw Errors.unauthorized("Invalid refresh token");
  }

  await authRepository.revokeRefreshTokenById(existing.id);
  const tokens = await issueTokenPair(user, input.clientType, input.deviceInfo);

  return { user, tokens };
}

export async function revokeRefreshToken(rawToken: string): Promise<void> {
  const existing = await authRepository.findRefreshTokenByHash(
    hashToken(rawToken),
  );
  if (existing && !existing.revokedAt) {
    await authRepository.revokeRefreshTokenById(existing.id);
  }
}
