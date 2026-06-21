import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

import { env } from "./env";

/**
 * The single axios instance every query/mutation goes through. It owns:
 *   - the in-memory access token (request interceptor adds the Bearer header),
 *   - single-flight 401 → /auth/refresh → replay (response interceptor),
 *   - error normalization into a typed {@link ApiError}.
 *
 * The access token lives in memory only (never localStorage) — an XSS can't read
 * it and it dies with the tab. The refresh token is an httpOnly cookie scoped to
 * `/auth`, so the browser sends it automatically to `/auth/refresh`.
 */

let accessToken: string | null = null;
export const setAccessToken = (token: string | null) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export const api = axios.create({
  baseURL: env.API_URL,
  withCredentials: true, // sends the /auth/* refresh cookie; harmless elsewhere
  headers: { "Content-Type": "application/json" },
});

// Attach the in-memory access token to every outgoing request.
api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Single-flight refresh: many parallel 401s share ONE /auth/refresh call.
let refreshing: Promise<boolean> | null = null;
export function refreshOnce(): Promise<boolean> {
  refreshing ??= (async () => {
    try {
      const { data } = await api.post<{ accessToken: string }>(
        "/auth/refresh",
        {},
      );
      setAccessToken(data.accessToken);
      return true;
    } catch {
      setAccessToken(null);
      return false;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

type RetriableConfig = InternalAxiosRequestConfig & { _retried?: boolean };

// On 401: refresh once, then replay the original request. Everything else is
// normalized into a typed ApiError carrying the API's `{ error: "<string>" }`.
api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ error?: string }>) => {
    const original = error.config as RetriableConfig | undefined;
    const url = original?.url ?? "";
    const isAuthFlow =
      url.includes("/auth/refresh") || url.includes("/auth/login");

    if (
      error.response?.status === 401 &&
      original &&
      !isAuthFlow &&
      !original._retried
    ) {
      original._retried = true;
      if (await refreshOnce()) return api(original); // replay with fresh token
    }

    throw new ApiError(
      error.response?.status ?? 0,
      error.response?.data?.error ?? error.message ?? "Request failed",
    );
  },
);
