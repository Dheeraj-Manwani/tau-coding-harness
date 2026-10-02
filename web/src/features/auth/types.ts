import type { Preferences } from "@/src/features/settings/preferences";

export type Role = "USER" | "ADMIN";

export interface AuthUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  /**
   * Decides whether the admin entry points render. Presentation only: the API
   * re-reads this from the database on every `/admin/*` request, so tampering
   * with it in devtools reveals a menu item and nothing behind it.
   */
  role: Role;
  createdAt: string;
  /** Account-level UI preferences. See features/settings/preferences.ts. */
  preferences: Preferences;
  /** What tau calls you. Null falls back to the email. */
  displayName: string | null;
  /**
   * Profile picture path relative to the API origin (versioned), or null for
   * the generated avatar. Resolve with `avatarSrc()` in features/account/identity.
   */
  avatarPath: string | null;
}

/** Shape returned by /auth/login and /auth/register. */
export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}
