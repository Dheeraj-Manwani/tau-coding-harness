import { MailCheckIcon } from "lucide-react";
import toast from "react-hot-toast";

import { Button } from "@/src/components/ui/button";
import { ApiError } from "@/src/lib/api-client";
import { useMe } from "@/src/features/auth/queries";
import {
  useLogout,
  useResendVerification,
} from "@/src/features/auth/mutations";

/**
 * Holding screen for authenticated users who haven't verified their email. They
 * can't reach the platform until they confirm via the email link (which lands on
 * /verify-email and redirects home). From here they can resend or log out.
 */
function VerifyPending() {
  const { data: user } = useMe();
  const resend = useResendVerification();
  const logout = useLogout();

  const onResend = async () => {
    try {
      await resend.mutateAsync();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Couldn't send the email",
      );
    }
  };

  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center px-6 text-center">
      <div className="w-full max-w-sm">
        <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-blue-500/10 text-blue-500">
          <MailCheckIcon className="size-6" />
        </div>

        <h1 className="text-2xl font-semibold text-foreground">
          Verify your email
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          We sent a verification link to{" "}
          {user ? (
            <span className="font-medium text-foreground">{user.email}</span>
          ) : (
            "your email"
          )}
          . Confirm it to enter the platform.
        </p>

        <Button
          variant="outline"
          className="mt-8 h-11 w-full"
          onClick={onResend}
          disabled={resend.isPending}
        >
          Resend email
        </Button>

        <button
          type="button"
          onClick={() => logout.mutate()}
          className="mt-6 text-sm text-silver-600 hover:text-silver-900"
        >
          Log out
        </button>
      </div>
    </div>
  );
}

export default VerifyPending;
