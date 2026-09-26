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
}

/** Shape returned by /auth/login and /auth/register. */
export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}
