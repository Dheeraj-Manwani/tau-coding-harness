import TauLogoAnimation from "@/src/components/tauAnimation";

/** Full-screen brand splash shown while auth state is being resolved. */
export function SplashScreen() {
  return (
    <div className="flex min-h-[100svh] flex-col items-center justify-center bg-space-void">
      <TauLogoAnimation size={120} accentColor="#60A5FA" coreColor="#FFFFFF" />
    </div>
  );
}

export default SplashScreen;
