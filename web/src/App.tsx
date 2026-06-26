import { useLocation, useOutlet } from "react-router-dom";

import { UserMenu } from "@/src/components/UserMenu";
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
        <header className="shrink-0">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <span
              className={cn("logo-mark size-6", isHome && "logo-mark--white")}
              role="img"
              aria-label="tau"
            />
            <UserMenu />
          </div>
        </header>
      )}

      <main className="min-h-0 flex-1">{outlet}</main>
    </div>
  );
}

export default App;
