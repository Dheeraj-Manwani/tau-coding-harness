import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, setAccessToken } from "@/src/lib/api-client";
import { authKeys } from "./queries";
import type { AuthResponse, AuthUser } from "./types";
import type { LoginValues, SignUpValues } from "./schemas";

/** Credentials are always tagged clientType "web" so the API uses cookie auth. */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: LoginValues) =>
      api
        .post<AuthResponse>("/auth/login", { ...values, clientType: "web" })
        .then((r) => r.data),
    onSuccess: ({ user, accessToken }) => {
      setAccessToken(accessToken);
      qc.setQueryData(authKeys.me, { user }); // seed cache, skip an extra /me
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: Omit<SignUpValues, "confirmPassword">) =>
      api
        .post<AuthResponse>("/auth/register", {
          email: values.email,
          password: values.password,
          clientType: "web",
        })
        .then((r) => r.data),
    onSuccess: ({ user, accessToken }) => {
      setAccessToken(accessToken);
      qc.setQueryData(authKeys.me, { user });
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout", {}),
    // Even if the network call fails, locally we are logged out. A full reload to
    // /login guarantees all in-memory state (token, cache) is wiped clean.
    onSettled: () => {
      setAccessToken(null);
      qc.clear();
      window.location.assign("/login");
    },
  });
}

/** Confirm an email from the token in the verification link. */
export function useVerifyEmail() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      api
        .post<{ user: AuthUser }>("/auth/verify-email", { token })
        .then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}

/** Re-send the verification email to the logged-in user. */
export function useResendVerification() {
  return useMutation({
    mutationFn: () => api.post("/auth/resend-verification", {}),
  });
}

/** Revoke every session for the user (all devices). */
export function useLogoutAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout-all", {}),
    onSettled: () => {
      setAccessToken(null);
      qc.clear();
    },
  });
}
