export interface AuthUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

/** Shape returned by /auth/login and /auth/register. */
export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}
