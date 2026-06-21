import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { SplashScreen } from "@/src/components/SplashScreen";
import { setAccessToken } from "@/src/lib/api-client";
import { authKeys } from "@/src/features/auth/queries";

/**
 * Landing route for Google OAuth. The API redirects here with the access token
 * in the URL *fragment* (`#access_token=…`) — which never reaches a server. We
 * read it, store it in memory, scrub it from history, then resolve `me`.
 */
function OAuthCallback() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get(
      "access_token",
    );
    if (!token) {
      navigate("/login?error=oauth", { replace: true });
      return;
    }
    setAccessToken(token);
    window.history.replaceState(null, "", "/auth/callback"); // drop token from URL
    qc.invalidateQueries({ queryKey: authKeys.me }).finally(() =>
      navigate("/", { replace: true }),
    );
  }, [navigate, qc]);

  return <SplashScreen />;
}

export default OAuthCallback;
