import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import { AppShell } from "./components/AppShell.tsx";
import { Providers } from "./components/providers.tsx";
import {
  AuthBootstrap,
  RequireAuth,
  RequireGuest,
  RequireUnverified,
  RootGate,
} from "./features/auth/guards.tsx";
import Home from "./pages/Home.tsx";
import ProjectPage from "./features/project/ProjectPage.tsx";
import BillingPage from "./pages/Billing.tsx";
import Login from "./pages/Login.tsx";
import SignUp from "./pages/SignUp.tsx";
import OAuthCallback from "./pages/OAuthCallback.tsx";
import VerifyEmail from "./pages/VerifyEmail.tsx";
import VerifyPending from "./pages/VerifyPending.tsx";
import NotFound from "./pages/NotFound.tsx";
import PrivacyPage from "./pages/Privacy.tsx";
import TermsPage from "./pages/Terms.tsx";
import PricingPage from "./pages/Pricing.tsx";
import CheckoutPage from "./pages/Checkout.tsx";

// Marketing and docs are code-split so a signed-in user never downloads the
// motion kit and the docs shell. The reverse — keeping the builder out of a
// stranger's first load — needs the product routes lazy too; they are still
// eager here, which is what keeps the entry chunk over the <160KB landing
// budget in §10. Phase 1 owns closing that gap.
//
// Route-level `lazy` rather than `React.lazy` + `<Suspense>`: the data router
// resolves the module as part of the navigation, so there is no fallback flash
// between the click and the page.
const lazyComponent =
  (load: () => Promise<{ default: React.ComponentType }>) => async () => ({
    Component: (await load()).default,
  });

const router = createBrowserRouter([
  // ── Product ───────────────────────────────────────────────────────────────
  // Everything the signed-in user does lives under /app so that `/` can always
  // be the shareable marketing link. See doc/LANDING_AND_DOCS_PLAN.md §3.
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/app",
        element: <AppShell />,
        children: [
          { index: true, element: <Home /> },
          { path: "project/:id", element: <ProjectPage /> },
          { path: "billing", element: <BillingPage /> },
        ],
      },
    ],
  },

  // ── Public: marketing + docs, sharing one starfield ───────────────────────
  {
    lazy: lazyComponent(() => import("./features/marketing/CosmosRoot.tsx")),
    children: [
      {
        // Above MarketingShell on purpose — see RootGate. When /pricing and
        // /changelog join the shell (Phases 3 and 7) they belong in a sibling
        // MarketingShell branch outside this gate: a signed-in user is allowed
        // to read those, they are just never sent to the landing page.
        element: <RootGate />,
        children: [
          {
            lazy: lazyComponent(
              () => import("./features/marketing/MarketingShell.tsx"),
            ),
            children: [
              {
                path: "/",
                lazy: lazyComponent(
                  () => import("./features/marketing/Landing.tsx"),
                ),
              },
            ],
          },
        ],
      },
      {
        lazy: lazyComponent(() => import("./features/docs/DocsShell.tsx")),
        children: [
          {
            path: "/docs",
            lazy: lazyComponent(() => import("./features/docs/DocsIndex.tsx")),
          },
        ],
      },
    ],
  },

  // ── Auth ──────────────────────────────────────────────────────────────────
  {
    element: <RequireGuest />,
    children: [
      { path: "/login", element: <Login /> },
      { path: "/signup", element: <SignUp /> },
      { path: "/auth/callback", element: <OAuthCallback /> },
    ],
  },
  {
    element: <RequireUnverified />,
    children: [{ path: "/verify-pending", element: <VerifyPending /> }],
  },
  { path: "/verify-email", element: <VerifyEmail /> },

  // ── Standalone public pages ───────────────────────────────────────────────
  { path: "/privacy", element: <PrivacyPage /> },
  { path: "/terms", element: <TermsPage /> },
  { path: "/pricing", element: <PricingPage /> },
  // Intentionally unguarded: this is the mobile app's credit-pack checkout,
  // opened in an in-app browser tab that carries no session. See Checkout.tsx.
  { path: "/checkout", element: <CheckoutPage /> },
  { path: "*", element: <NotFound /> },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Providers>
      <AuthBootstrap>
        <RouterProvider router={router} />
      </AuthBootstrap>
    </Providers>
  </StrictMode>,
);
