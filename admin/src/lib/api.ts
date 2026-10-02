/**
 * The only way this app talks to the server.
 *
 * Every request goes to `${VITE_API_URL}/admin/*` with credentials, so the
 * `/admin`-scoped HttpOnly session cookie rides along. This app never sees or
 * stores a token — the cookie is the whole session, and it's invisible to JS.
 *
 * 401 (no/expired session) and 403 (session valid, ADMIN role revoked) both
 * broadcast `UNAUTHORIZED_EVENT`; the auth provider listens and drops to the
 * login screen, so no page has to handle it.
 */

export const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:8080").replace(/\/+$/, "");

export const UNAUTHORIZED_EVENT = "tau-admin:unauthorized";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/admin${path}`, {
      ...init,
      credentials: "include",
      headers: {
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, `Can't reach the API at ${API_URL}`);
  }

  if (res.status === 401 || res.status === 403) {
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: res.status }));
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, body?.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

/** Where "Sign in with Google" goes. The server lands back on this origin. */
export const GOOGLE_SIGN_IN_URL = `${API_URL}/auth/google?client=admin`;
