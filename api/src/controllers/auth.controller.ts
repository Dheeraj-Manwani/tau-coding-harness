import type { Request, Response, NextFunction } from "express";
import type { ClientType, Prisma, User } from "../generated/prisma/client";
import type { AuthResult } from "../services/auth.service";
import * as authService from "../services/auth.service";
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
  verifyEmailSchema,
} from "../schemas/auth.schema";
import { Errors } from "../lib/errors";
import { env } from "../lib/env";
import { parse } from "../lib/utils";

const REFRESH_COOKIE = "refresh_token";
const isProd = env.NODE_ENV === "production";

function deviceInfoFrom(req: Request): Prisma.InputJsonValue {
  return {
    userAgent: req.headers["user-agent"] ?? null,
    ip: req.ip ?? null,
  };
}

function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: isProd,
    sameSite: "strict",
    expires: expiresAt,
    path: "/auth",
  });
}

function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE, { path: "/auth" });
}

function sendAuthResult(
  res: Response,
  result: AuthResult,
  clientType: ClientType,
  status = 200,
): void {
  const { user, tokens } = result;
  if (clientType === "mobile") {
    res.status(status).json({
      user,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    });
    return;
  }
  setRefreshCookie(res, tokens.refreshToken, tokens.refreshTokenExpiresAt);
  res.status(status).json({ user, accessToken: tokens.accessToken });
}

export async function register(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password, clientType } = parse(registerSchema, req.body);
    const result = await authService.register({
      email,
      password,
      clientType,
      deviceInfo: deviceInfoFrom(req),
    });
    sendAuthResult(res, result, clientType, 201);
  } catch (err) {
    next(err);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { email, password, clientType } = parse(loginSchema, req.body);
    const result = await authService.login({
      email,
      password,
      clientType,
      deviceInfo: deviceInfoFrom(req),
    });
    sendAuthResult(res, result, clientType);
  } catch (err) {
    next(err);
  }
}

export async function refresh(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { clientType, refreshToken } = parse(refreshSchema, req.body);
    const rawToken =
      clientType === "mobile" ? refreshToken : req.cookies?.[REFRESH_COOKIE];
    const result = await authService.refresh({
      rawToken,
      clientType,
      deviceInfo: deviceInfoFrom(req),
    });
    sendAuthResult(res, result, clientType);
  } catch (err) {
    next(err);
  }
}

export async function logout(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { clientType, refreshToken } = parse(logoutSchema, req.body);
    const rawToken =
      clientType === "mobile" ? refreshToken : req.cookies?.[REFRESH_COOKIE];
    await authService.logout(rawToken);
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function logoutAll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    await authService.logoutAll(req.user.id);
    clearRefreshCookie(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function googleCallback(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const user = res.locals["oauthUser"] as User | undefined;
    if (!user) throw Errors.unauthorized("OAuth authentication failed");

    const clientType: ClientType = "web" as ClientType;
    const result = await authService.issueSession(
      user,
      clientType,
      deviceInfoFrom(req),
    );

    setRefreshCookie(
      res,
      result.tokens.refreshToken,
      result.tokens.refreshTokenExpiresAt,
    );

    const redirectBase = env.OAUTH_SUCCESS_REDIRECT;

    res.redirect(`${redirectBase}#access_token=${result.tokens.accessToken}`);
  } catch (err) {
    next(err);
  }
}

export async function verifyEmail(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { token } = parse(verifyEmailSchema, req.body);
    const user = await authService.verifyEmail(token);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function resendVerification(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    await authService.resendVerification(req.user.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

export async function me(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw Errors.unauthorized("Authentication required");
    const user = await authService.getCurrentUser(req.user.id);
    res.status(200).json({ user });
  } catch (err) {
    next(err);
  }
}
