import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Loader2Icon } from "lucide-react";
import toast from "react-hot-toast";

import TauLogoAnimation from "@/src/components/tauAnimation";
import { SiteFooter } from "@/src/components/SiteFooter";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { PasswordInput } from "@/src/components/ui/password-input";
import { Label } from "@/src/components/ui/label";
import { ApiError } from "@/src/lib/api-client";
import { GoogleButton } from "@/src/features/auth/GoogleButton";
import { useLogin } from "@/src/features/auth/mutations";
import { loginSchema, type LoginValues } from "@/src/features/auth/schemas";

function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: LoginValues) => {
    try {
      const { user } = await login.mutateAsync(values);
      toast.success(`Welcome back, ${user.email}`);
      const from = (location.state as { from?: Location } | null)?.from;
      navigate(from?.pathname ?? "/", { replace: true });
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
          Sign in
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
              {...register("email")}
            />
            {errors.email && (
              <p className="text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              placeholder="Your password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password && (
              <p className="text-xs text-destructive">
                {errors.password.message}
              </p>
            )}
          </div>

          <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
            {isSubmitting && <Loader2Icon className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3 text-xs text-silver-600">
          <span className="h-px flex-1 bg-silver-400/30" />
          or
          <span className="h-px flex-1 bg-silver-400/30" />
        </div>

        <GoogleButton label="Continue with Google" />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Don&apos;t have an account?{" "}
          <Link
            to="/signup"
            className="font-medium text-foreground hover:underline"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
    <SiteFooter />
    </div>
  );
}

export default Login;
