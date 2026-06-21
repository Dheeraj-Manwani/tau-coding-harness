import { Outlet } from "react-router-dom";

import { UserMenu } from "@/src/components/UserMenu";

function App() {
  return (
    <div className="flex min-h-[100svh] flex-col bg-space-void">
      <header className="border-b border-silver-400/30">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4">
          <span className="logo-mark size-6" role="img" aria-label="tau" />
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <Outlet />
      </main>
    </div>
  );
}

export default App;
