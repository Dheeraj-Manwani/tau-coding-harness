# Web auth & data-fetching plan

Design notes for: (1) using **TanStack Query** for every API call, (2) **route
protection** — guests can't reach `/`, authenticated users can't reach the auth
routes, and (3) the **production-grade work** worth doing in `web/` against the
endpoints `api/` already exposes.

> This is a plan/RFC, not an implementation. Code blocks are sketches to lock in
> the shape of things before we build.

---

## 1. What the API actually gives us (ground truth)

Read from `api/src` so the frontend matches reality:

| Endpoint | Auth | Returns | Notes |
|---|---|---|---|
| `POST /auth/register` | public (rate-limited) | `201 { user, accessToken }` + sets refresh cookie | also fires a verification **email link** |
| `POST /auth/login` | public (rate-limited) | `200 { user, accessToken }` + refresh cookie | |
| `POST /auth/refresh` | refresh cookie | `200 { user, accessToken }` + **rotated** cookie | reuse detection revokes all sessions |
| `POST /auth/logout` | refresh cookie | `204` + clears cookie | |
| `POST /auth/logout-all` | Bearer | `204` | revokes every session for the user |
| `GET  /auth/google` → `/auth/google/callback` | OAuth | `302` redirect to `OAUTH_SUCCESS_REDIRECT#access_token=…` | token in URL **fragment** |
| `GET  /auth/me` | Bearer | `200 { user }` | our auth source-of-truth |
| `POST /project` | Bearer | — | currently a **stub** (see §8) |

Token model (`api/src/lib/tokens.ts`, `auth.controller.ts`):

- **Access token** — JWT, **15-minute** TTL, returned in the JSON **body**.
  Sent back to the API as `Authorization: Bearer <token>`. It is *not* a cookie.
- **Refresh token** — opaque random, delivered as an **httpOnly cookie**
  (`refresh_token`, `SameSite=Strict`, `Secure` in prod, **`Path=/auth`**).
  Rotated on every refresh.

Two consequences drive the whole frontend design:

1. **The access token lives in memory only.** On a hard reload it's gone, but the
   refresh cookie survives — so app startup = "call `/auth/refresh` once to mint a
   fresh access token, then I know who I am." This is also our redirect-flicker fix.
2. **The refresh cookie is scoped to `Path=/auth`.** The browser only sends it to
   `/auth/*`. So `withCredentials: true` matters for the auth endpoints; every
   other call (`/project`, …) authenticates purely via the Bearer header.

Error shape is **`{ error: "<message string>" }`** (`error.middleware.ts`) — a
plain string, not `{ error: { message } }`. (The current `web/src/lib/auth-api.ts`
reads `data.error?.message ?? data.message`, which never matches — see §8.)

---

## 2. Data layer — TanStack Query everywhere

### 2.1 One axios instance, used by every query/mutation

A single configured **axios instance** is the only place that knows about base
URL, the Bearer header, credentials, error normalization, and
**401 → silent refresh → retry**. Components never touch axios directly — they go
through the feature hooks in §2.2. The interceptor pattern is exactly what axios
is good at, so the retry/refresh logic is tidier than the hand-rolled fetch
version.

> `axios` is **not yet a dependency** — add it first: `pnpm add axios`.

```ts
// src/lib/api-client.ts
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

let accessToken: string | null = null;            // in-memory only
export const setAccessToken = (t: string | null) => { accessToken = t; };
export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,            // sends /auth/* cookie; harmless elsewhere
  headers: { "Content-Type": "application/json" },
});

// Attach the in-memory access token to every outgoing request.
api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Single-flight refresh: many parallel 401s share ONE /auth/refresh call.
let refreshing: Promise<boolean> | null = null;
function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const { data } = await api.post("/auth/refresh", {});
      setAccessToken(data.accessToken);
      return true;
    } catch {
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

// On 401: refresh once, then replay the original request. Everything else gets
// normalized into a typed ApiError carrying the API's `{ error: "<string>" }`.
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ error?: string }>) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean };
    const url = original?.url ?? "";
    const isAuthFlow = url.includes("/auth/refresh") || url.includes("/auth/login");

    if (error.response?.status === 401 && !isAuthFlow && !original._retried) {
      original._retried = true;
      if (await refreshOnce()) return api(original);   // replay with fresh token
    }
    throw new ApiError(
      error.response?.status ?? 0,
      error.response?.data?.error ?? error.message ?? "Request failed",
    );
  },
);
```

Why in-memory (not `localStorage`): an XSS that can read `localStorage` steals a
long-lived credential. A memory token dies with the tab, and the refresh token is
httpOnly so JS can never read it. This is the standard SPA posture and it's what
the API was built for.

### 2.2 The `me` query is the single source of auth truth

Everything ("am I logged in?", guards, the user menu) derives from one query.

```ts
// src/features/auth/queries.ts
export const authKeys = { me: ["auth", "me"] as const };

export function useMe() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: () => api.get<{ user: AuthUser }>("/auth/me").then((r) => r.data),
    select: (d) => d.user,
    retry: false,           // a 401 is an answer, not a failure to retry
    staleTime: 5 * 60_000,
  });
}
```

Mutations stay thin and **invalidate `me`** (or seed the cache) on success:

```ts
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (b: LoginInput) =>
      api.post<AuthResponse>("/auth/login", { ...b, clientType: "web" }).then((r) => r.data),
    onSuccess: ({ user, accessToken }) => {
      setAccessToken(accessToken);
      qc.setQueryData(authKeys.me, { user });   // no extra /me round-trip
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout", {}),
    onSuccess: () => { setAccessToken(null); qc.clear(); }, // wipe all cached data
  });
}
```

`register` works the same and (per the API) returns tokens immediately — the user
is logged in right after sign-up; the email link is for *verification*, not a gate.

### 2.3 QueryClient defaults & conventions

- Defaults: `retry: (n, e) => e.status >= 500 && n < 2` (never retry 4xx),
  `refetchOnWindowFocus: false`, `staleTime: 60_000`.
- **Query-key factories** per feature (`authKeys`, `projectKeys`) — no inline arrays.
- Fix the dev-only Devtools guard in `providers.tsx` to `import.meta.env.DEV`
  (it currently reads `import.meta.resolve("NODE_ENV")`, which is wrong — §8).
- Co-locate hooks under `src/features/<domain>/` (queries, mutations, schemas).

---

## 3. Route protection

### 3.1 Bootstrap first, to kill the redirect flicker

Before the router decides anything, run refresh **once** so we don't bounce a
logged-in user to `/login` on every reload (their access token is always null at
t=0). Gate the app on that.

```tsx
function AuthBootstrap({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { refreshOnce().finally(() => setReady(true)); }, []);
  if (!ready) return <SplashScreen />;     // brand splash, not a layout flash
  return <>{children}</>;
}
```

After bootstrap, `useMe()` resolves synchronously from cache for guards.

### 3.2 Two guards, mirror images of each other

```tsx
// Protected area ("/"): guests are sent to /login, remembering where they were.
function RequireAuth() {
  const { data: user, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <SplashScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: loc }} />;
  return <Outlet />;
}

// Auth area: authenticated users can't see login/signup — send them home.
function RequireGuest() {
  const { data: user, isLoading } = useMe();
  const loc = useLocation();
  if (isLoading) return <SplashScreen />;
  if (user) return <Navigate to={loc.state?.from?.pathname ?? "/"} replace />;
  return <Outlet />;
}
```

Router layout makes the two zones explicit:

```tsx
createBrowserRouter([
  { element: <RequireAuth />, children: [
      { path: "/", element: <AppLayout />, children: [ { index: true, element: <Home /> } ] },
      { path: "/projects/:id", element: <Project /> },
  ]},
  { element: <RequireGuest />, children: [
      { path: "/login",  element: <Login /> },
      { path: "/signup", element: <SignUp /> },
      { path: "/auth/callback", element: <OAuthCallback /> }, // §4
  ]},
  { path: "*", element: <NotFound /> },
]);
```

Guards are **UX, not security** — the API enforces auth on every protected route
(`app.use(requireAuth)`). The guard just avoids showing a shell we can't fill.

### 3.3 Honoring "where they wanted to go"

`RequireAuth` stashes the attempted location in `state.from`; `RequireGuest`
reads it after login so a deep link → login → original page round-trips cleanly.

---

## 4. Google OAuth callback

`/auth/google/callback` 302-redirects to `OAUTH_SUCCESS_REDIRECT` with the access
token in the **URL fragment** (`#access_token=…`). Set that env var to a web route
like `/auth/callback`, then:

```tsx
function OAuthCallback() {
  const qc = useQueryClient();
  const nav = useNavigate();
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("access_token");
    if (!token) return void nav("/login?error=oauth", { replace: true });
    setAccessToken(token);
    window.history.replaceState(null, "", "/auth/callback"); // scrub token from URL/history
    qc.invalidateQueries({ queryKey: authKeys.me }).then(() => nav("/", { replace: true }));
  }, []);
  return <SplashScreen />;
}
```

The fragment never hits the server and we wipe it from history immediately.

---

## 5. Production hardening checklist (web)

**Security**
- In-memory access token; refresh stays httpOnly (already so server-side).
- Scrub OAuth token from URL/history; never log tokens.
- Treat the API as the only authority — guards are convenience.
- CSP / security headers at the host/CDN; sanitize any user-rendered HTML.

**Resilience / correctness**
- Single-flight refresh (§2.1) so a burst of 401s triggers one refresh.
- On refresh failure → clear token, `qc.clear()`, redirect to `/login`.
- Retry only 5xx/network; respect **429** from `authRateLimiter` (surface
  "too many attempts," optionally back off using any `Retry-After`).
- Error boundary per route + a typed `ApiError` → friendly messages from `{ error }`.
- Loading/splash + skeletons; disable submit while mutating (no double-submit).

**UX**
- **Email-verification banner** when `user.emailVerifiedAt == null` (register
  sends a link, so freshly-signed-up users are unverified) with a resend action
  *once the API exposes one*.
- Account/session UI: **Logout** and **Logout everywhere** (`/auth/logout-all`).
- Toasts for mutation success/failure (sonner is already wired).
- Optimistic updates where it reads well; `crypto.randomUUID()` keys.

**DX / build**
- Typed `VITE_API_URL` via a validated env module; commit `.env.example`.
- Route-level code splitting (`lazy`), Query Devtools in dev only.
- Share zod schemas with the API contract (mirror `auth.schema.ts`: email
  normalization, password ≥ 8) so client validation == server validation.
- A tiny generated/typed API surface so endpoint shapes stay honest.

---

## 6. Suggested file layout

```
src/
  lib/
    api-client.ts        # axios instance + interceptors, token store, single-flight refresh
    env.ts               # validated import.meta.env
  features/
    auth/
      queries.ts         # useMe
      mutations.ts       # useLogin/useRegister/useLogout/useLogoutAll
      guards.tsx         # RequireAuth, RequireGuest, AuthBootstrap
      schemas.ts         # zod (mirror api)
    project/
      queries.ts mutations.ts
  components/providers.tsx   # QueryClientProvider (+ fixed dev guard)
  pages/                     # Login, SignUp, Home, Project, OAuthCallback, NotFound
```

---

## 7. Phased rollout

1. **Plumbing** — `api-client.ts` (token store + refresh + 401 retry); fix
   `providers.tsx` dev guard and QueryClient defaults.
2. **Auth feature** — `useMe`, login/register/logout mutations; port `auth-api.ts`
   onto the `api` axios instance and **delete the dead OTP calls** (§8).
3. **Guards + bootstrap** — `AuthBootstrap`, `RequireAuth`, `RequireGuest`, restructure
   the router; splash screen.
4. **OAuth callback** route + set `OAUTH_SUCCESS_REDIRECT`.
5. **Hardening** — verification banner, logout-all, error boundaries, 429 handling,
   env validation, code splitting.
6. **Project feature** on Query — once the API route is real (§8).

---

## 8. API-side gaps found while planning (blockers / mismatches)

These will break the web flows above until fixed on `api/` — flagging, not fixing here:

1. **No CORS middleware** (`api/src/index.ts`). The browser will block every
   cross-origin call from the Vite dev server (`:5173` → `:3000`), and
   axios `withCredentials: true` *requires* `Access-Control-Allow-Credentials: true`
   with an explicit origin (not `*`). **Hard blocker** — add `cors` with an origin
   allowlist + credentials before any of this works in a browser.
2. **OTP endpoints don't exist.** `web/src/lib/auth-api.ts` calls
   `/auth/verify-otp` and `/auth/resend-otp`, but the router has neither;
   verification is **link-based** (`lib/email.ts`). Remove those client functions
   and drop any OTP step from the sign-up UI.
3. **Error parsing mismatch.** The API returns `{ error: "<string>" }`; the current
   client reads `data.error?.message ?? data.message` and so always falls back to a
   generic message. Read `data.error` (handled by the axios response interceptor above).
4. **`POST /project` is a stub** — `project.routes.ts` wires an **undefined**
   `initializeProject` handler (not imported), which will throw at route
   registration / call time. Defer the project Query feature until the handler and
   its response contract exist.
5. **Devtools guard bug** — `providers.tsx` uses
   `import.meta.resolve("NODE_ENV") === "development"`; should be `import.meta.env.DEV`.
6. **Refresh cookie `Path=/auth`** is deliberate and fine, but note it means only
   `/auth/*` can refresh — the client must never expect the cookie to authenticate
   `/project` (Bearer only). Documented so nobody "fixes" it by widening the path.
```
