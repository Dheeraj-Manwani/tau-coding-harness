/**
 * How a person shows up in the UI: their name (or a graceful stand-in), their
 * initials, and where their picture lives.
 * Pure functions, so the menu, the account page and Home all agree.
 */
import { env } from "@/src/lib/env";
import type { AuthUser } from "@/src/features/auth/types";

export type Identity = Pick<AuthUser, "id" | "email" | "displayName" | "avatarPath">;

/** The name to show, falling back to the email's local part. */
export function nameOf(user: Identity): string {
  return user.displayName?.trim() || user.email.split("@")[0] || user.email;
}

/** First name only, for greetings. Null when there's no real name to greet. */
export function firstNameOf(user: Pick<AuthUser, "displayName">): string | null {
  const first = user.displayName?.trim().split(/\s+/)[0];
  return first || null;
}

export function initialsOf(user: Identity): string {
  const words = user.displayName?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (words.length >= 2) {
    return (Array.from(words[0]!)[0]! + Array.from(words[words.length - 1]!)[0]!).toUpperCase();
  }
  const source = words[0] ?? user.email;
  return Array.from(source).slice(0, 2).join("").toUpperCase();
}

export function avatarSrc(user: Pick<AuthUser, "avatarPath">): string | undefined {
  return user.avatarPath ? `${env.API_URL}${user.avatarPath}` : undefined;
}
