const API_URL = (
  import.meta.env.VITE_API_URL ?? "http://localhost:3000"
).replace(/\/$/, "");

export interface AuthUser {
  id: string;
  email: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Network error — is the API running?", 0);
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      (data && (data.error?.message ?? data.message)) ||
      `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

export function register(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/register", {
    ...input,
    clientType: "web",
  });
}

export function verifyOtp(input: {
  email: string;
  code: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/verify-otp", {
    ...input,
    clientType: "web",
  });
}

export function resendOtp(input: { email: string }): Promise<void> {
  return request<void>("/auth/resend-otp", { ...input, clientType: "web" });
}

export function login(input: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  return request<AuthResponse>("/auth/login", { ...input, clientType: "web" });
}

export function googleAuthUrl(): string {
  return `${API_URL}/auth/google`;
}
