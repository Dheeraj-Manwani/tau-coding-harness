import { useLocation, useOutlet } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";

import { UserMenu } from "@/src/components/UserMenu";

function App() {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  // The project editor is a full-screen workspace — it hides the app navbar.
  const isProject = pathname.startsWith("/project/");
  // One key per "page" so navigating between project files (store state, same
  // route) doesn't retrigger the transition — only Home <-> project does.
  const routeKey = isProject ? "project" : "home";

  return (
    <div className="flex h-[100svh] flex-col">
      {!isProject && (
        <header className="shrink-0">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
            <span className="logo-mark size-6" role="img" aria-label="tau" />
            <UserMenu />
          </div>
        </header>
      )}

      <main className="relative min-h-0 flex-1">
        {/* Pages cross-fade as absolutely-stacked layers so they overlap during
            the route change instead of stacking in flow. */}
        <AnimatePresence mode="sync">
          <motion.div
            key={routeKey}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: "easeInOut" }}
            className="absolute inset-0"
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default App;
