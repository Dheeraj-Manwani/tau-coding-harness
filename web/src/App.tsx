import { useLocation, useOutlet } from "react-router-dom";

import { UserMenu } from "@/src/components/UserMenu";
import { OutOfCreditsModal } from "@/src/features/billing/OutOfCreditsModal";
import { SiteFooter } from "@/src/components/SiteFooter";
import { cn } from "@/src/lib/utils";

function App() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  // The project editor is a full-screen workspace — it hides the app navbar.
  const isProject = pathname.startsWith("/project/");
  const isHome = pathname === "/";

  return (
    <div className="flex h-[100svh] flex-col">
      {!isProject && (
        <header className="pointer-events-none absolute inset-x-0 top-0 z-50">
          <div className="pointer-events-auto mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <span
              className={cn("logo-mark size-6", isHome && "logo-mark--white")}
              role="img"
              aria-label="tau"
            />
            <div className="flex items-center gap-3">
              <UserMenu />
            </div>
          </div>
        </header>
      )}

      <main className="min-h-0 flex-1 overflow-auto">{outlet}</main>
      {!isProject && <SiteFooter />}
      <OutOfCreditsModal />
    </div>
  );
}

export default App;
