import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useNavigate } from "react-router-dom";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Loader2Icon } from "lucide-react";
import toast from "react-hot-toast";

import TauLogoAnimation from "@/src/components/tauAnimation";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { PasswordInput } from "@/src/components/ui/password-input";
import { Label } from "@/src/components/ui/label";
import { ApiError } from "@/src/lib/api-client";
import { GoogleButton } from "@/src/features/auth/GoogleButton";
import { useRegister } from "@/src/features/auth/mutations";
import { signUpSchema, type SignUpValues } from "@/src/features/auth/schemas";

function SignUp() {
  const navigate = useNavigate();
  const registerMutation = useRegister();
  const {
    register: field,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({
    resolver: zodResolver(signUpSchema),
    defaultValues: { email: "", password: "", confirmPassword: "" },
  });

  const onSubmit = async (values: SignUpValues) => {
    try {
      const { user } = await registerMutation.mutateAsync({
        email: values.email,
        password: values.password,
      });
      toast.success(`Welcome to tau, ${user.email}`);
      navigate("/", { replace: true });
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Something went wrong",
      );
    }
  };

  return (
    <div className="flex min-h-[100svh] flex-col">
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm text-left">
        <TauLogoAnimation
          size={88}
          className="mx-auto mb-6"
          accentColor="#60A5FA"
          coreColor="#FFFFFF"
        />
        <h1 className="mb-6 text-center text-2xl font-semibold text-foreground">
          Create your account
        </h1>

        <form
          onSubmit={handleSubmit(onSubmit)}
          className="space-y-4"
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
              {...field("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="At least 8 characters"
              aria-invalid={!!errors.password}
              {...field("password")}
            />
            {errors.password && (
              <p className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirm password</Label>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="Re-enter your password"
              aria-invalid={!!errors.confirmPassword}
              {...field("confirmPassword")}
            />
            {errors.confirmPassword && (
              <p className="text-xs text-destructive">
                {errors.confirmPassword.message}
              </p>
            )}
          </div>

          <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
            Create account
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-silver-600">
          <span className="h-px flex-1 bg-silver-400/30" />
          or
          <span className="h-px flex-1 bg-silver-400/30" />
        </div>

        <GoogleButton label="Sign up with Google" />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            to="/login"
            className="font-medium text-foreground hover:underline"
          >
            Sign in
          </Link>
        </p>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          By creating an account you agree to our{" "}
          <Link to="/terms" className="underline hover:text-foreground">
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link to="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>
          .
        </p>
      </div>
    </div>
    <SiteFooter />
    </div>
  );
}

export default SignUp;
