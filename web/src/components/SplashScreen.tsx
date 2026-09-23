/** The glowing brand mark shared by full-page and in-workspace loading states. */
export function TauShimmerLogo({
  size = 72,
  decorative = false,
}: {
  size?: number;
  decorative?: boolean;
}) {
  return (
    <>
      <style>{`
        @keyframes tau-shimmer {
         0%   { background-position: -250% center; }
          100% { background-position:  250% center; }
        }
        .tau-splash-logo {
          -webkit-mask: url(/logo.png) no-repeat center / contain;
          mask:         url(/logo.png) no-repeat center / contain;
          background: linear-gradient(
            105deg,
            #3b82f6 0%,
            #3b82f6 30%,
            #93c5fd 48%,
            #ffffff 52%,
            #93c5fd 56%,
            #3b82f6 70%,
            #3b82f6 100%
          );
          background-size: 250% 100%;
          filter: drop-shadow(0 0 18px #3b82f688);
          animation: tau-shimmer 3s linear infinite;
        }
      `}</style>
      <span
        className="tau-splash-logo inline-block shrink-0"
        style={{ width: size, height: size }}
        role={decorative ? undefined : "img"}
        aria-label={decorative ? undefined : "tau"}
        aria-hidden={decorative || undefined}
      />
    </>
  );
}

/** Full-screen brand splash shown while auth state is being resolved. */
export function SplashScreen() {
  return (
    <div className="flex min-h-[100svh] items-center justify-center bg-[var(--space-void)]">
      <TauShimmerLogo />
    </div>
  );
}

export default SplashScreen;
