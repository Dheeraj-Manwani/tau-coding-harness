import { useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { MenuIcon } from "./components/icons";
import { Loading } from "./components/ui";
import { API_URL } from "./lib/api";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Jobs from "./pages/Jobs";
import JobDetail from "./pages/JobDetail";
import Sandboxes from "./pages/Sandboxes";
import Errors from "./pages/Errors";
import Users from "./pages/Users";
import UserDetail from "./pages/UserDetail";
import ProjectDetail from "./pages/ProjectDetail";
import Gateway from "./pages/Gateway";
import Feedback from "./pages/Feedback";
import Tools from "./pages/Tools";

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/jobs", label: "Jobs" },
  { to: "/sandboxes", label: "Sandboxes" },
  { to: "/errors", label: "Errors" },
  { to: "/users", label: "Users" },
  { to: "/gateway", label: "AI gateway" },
  { to: "/feedback", label: "Feedback" },
  { to: "/tools", label: "Tools" },
];

export default function App() {
  const { state, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (state.status === "loading") {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Loading label="Checking session…" />
      </div>
    );
  }
  if (state.status === "out") return <Login reason={state.reason} />;

  const host = API_URL.replace(/^https?:\/\//, "");

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Main">
      {NAV.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={() => setMenuOpen(false)}
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm transition-colors ${
              isActive ? "bg-accent-soft font-medium text-accent" : "text-fg-2 hover:bg-surface-2 hover:text-fg"
            }`
          }
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-line pt-3 text-xs">
      <div className="truncate text-fg-2" title={state.me.email}>
        {state.me.email}
      </div>
      <div className="mt-0.5 truncate text-fg-3" title={API_URL}>
        {host}
      </div>
      <button type="button" onClick={() => void signOut()} className="mt-2 text-fg-2 hover:text-critical-text">
        Sign out
      </button>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[13rem_1fr]">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-line bg-surface px-3 py-5 lg:flex">
        <Brand />
        <div className="flex-1">{nav}</div>
        {footer}
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-4 py-3 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded-lg border border-line p-1.5 text-fg-2"
          aria-expanded={menuOpen}
          aria-label="Menu"
        >
          <MenuIcon className="size-5" />
        </button>
      </div>
      {menuOpen && (
        <div className="sticky top-[57px] z-10 border-b border-line bg-surface px-3 py-3 lg:hidden">
          {nav}
          <div className="mt-3">{footer}</div>
        </div>
      )}

      <main className="min-w-0 px-4 py-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1400px]">
          <ErrorBoundary key={location.pathname}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:id" element={<JobDetail />} />
              <Route path="/sandboxes" element={<Sandboxes />} />
              <Route path="/errors" element={<Errors />} />
              <Route path="/users" element={<Users />} />
              <Route path="/users/:id" element={<UserDetail />} />
              <Route path="/projects/:id" element={<ProjectDetail />} />
              <Route path="/gateway" element={<Gateway />} />
              <Route path="/feedback" element={<Feedback />} />
              <Route path="/tools" element={<Tools />} />
              {/* After Google sign-in the server lands us on `/`; a stale /login goes home. */}
              <Route path="/login" element={<Navigate to="/" replace />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2 px-1">
      <span className="grid size-7 place-items-center rounded-lg bg-accent text-sm font-bold text-white">τ</span>
      <span className="text-sm font-semibold tracking-tight">tau ops</span>
    </div>
  );
}
