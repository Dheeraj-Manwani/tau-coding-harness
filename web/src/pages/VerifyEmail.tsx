import { useEffect, useRef } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Loader2Icon, XCircleIcon } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { SplashScreen } from "@/src/components/SplashScreen";
import { ApiError } from "@/src/lib/api-client";
import { useMe } from "@/src/features/auth/queries";
import { useVerifyEmail } from "@/src/features/auth/mutations";

/**
 * Landing page for the link in the verification email
 * (`/verify-email?token=…`). Verifies the token then sends the user home. If the
 * current user is already verified (e.g. a reload), we skip straight home too.
 */
function VerifyEmail() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const navigate = useNavigate();
  const { data: user, isLoading } = useMe();
  const verify = useVerifyEmail();

  // StrictMode mounts effects twice in dev; guard so we POST only once.
  const firedRef = useRef(false);
  useEffect(() => {
    if (firedRef.current || !token || user?.emailVerifiedAt) return;
    firedRef.current = true;
    verify.mutate(token, {
      onSuccess: () => navigate("/", { replace: true }),
    });
  }, [token, user, verify, navigate]);

  // Already verified (reload / verified session) → home.
  if (user?.emailVerifiedAt) return <Navigate to="/" replace />;

  // Don't flash an error while we're still resolving auth state.
  if (!token && isLoading) return <SplashScreen />;

  if (!token || verify.isError) {
    const message = !token
      ? "This verification link is missing its token."
      : verify.error instanceof ApiError
        ? verify.error.message
        : "We couldn't verify your email. The link may have expired.";
    return (
      <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
        <div className="flex w-full max-w-sm flex-col items-center gap-4">
          <XCircleIcon className="size-10 text-destructive" />
          <h1 className="text-2xl font-semibold text-foreground">
            Verification failed
          </h1>
          <p className="text-sm text-muted-foreground">{message}</p>
          <Button asChild variant="outline" className="mt-2 h-11 w-full">
            <Link to="/login">Back to sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  // Verifying (will redirect home on success).
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
      <div className="flex flex-col items-center gap-3 text-silver-600">
        <Loader2Icon className="size-6 animate-spin" />
        <p>Verifying your email…</p>
      </div>
    </div>
  );
}

export default VerifyEmail;
