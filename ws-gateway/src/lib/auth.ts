import jwt from "jsonwebtoken";
import { env } from "./env";

export interface ConnectionTokenPayload {
  sub: string;
  email: string;
}

export function verifyConnectionToken(
  token: string,
): ConnectionTokenPayload | null {
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.ACCESS_TOKEN_SECRET, {
      algorithms: ["HS256"],
    });
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.sub !== "string" ||
      typeof decoded.email !== "string"
    ) {
      return null;
    }
    return { sub: decoded.sub, email: decoded.email };
  } catch {
    return null;
  }
}
