import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";
import "./index.css";
import { SplashScreen } from "./components/SplashScreen.tsx";
import { Providers } from "./components/providers.tsx";
import {
  AuthBootstrap,
  RequireAuth,
  RequireGuest,
  RequireUnverified,
  RootGate,
} from "./features/auth/guards.tsx";

/**
 * Every screen is code-split. The entry chunk holds the router, the auth
 * guards and the splash — nothing else.
 *
 * That split is what makes the landing page's JS budget (§10: <160KB gzipped)
 * achievable at all. Eagerly importing the product put the builder, CodeMirror
 * and tsparticles in the first bytes a stranger downloaded, which is roughly
 * 370KB gzipped of code they will never run.
 *
 * Route-level `lazy` rather than `React.lazy` + `<Suspense>`: the data router
 * resolves the module as part of the navigation, so there is no fallback flash
 * between the click and the page. On a cold load the module fetch overlaps with
 * the silent token refresh `AuthBootstrap` is already waiting on, and the root
 * route's `hydrateFallbackElement` covers the remainder.
 */
const lazyComponent =
  (load: () => Promise<{ default: ComponentType }>) => async () => ({
    Component: (await load()).default,
  });

const router = createBrowserRouter([
  {
    // Pathless root, purely so there is somewhere to hang the hydrate fallback.
    element: <Outlet />,
    hydrateFallbackElement: <SplashScreen />,
    children: [
      // ── Product ───────────────────────────────────────────────────────────
      // Everything the signed-in user does lives under /app so that `/` can
      // always be the shareable marketing link. See LANDING_AND_DOCS_PLAN §3.
      {
        element: <RequireAuth />,
        children: [
          {
            path: "/app",
            lazy: lazyComponent(() => import("./components/AppShell.tsx")),
            children: [
              {
                index: true,
                lazy: lazyComponent(() => import("./pages/Home.tsx")),
              },
              {
                path: "project/:id",
                lazy: lazyComponent(
                  () => import("./features/project/ProjectPage.tsx"),
                ),
              },
              {
                path: "billing",
                lazy: lazyComponent(() => import("./pages/Billing.tsx")),
              },
            ],
          },
        ],
      },

      // ── Public: marketing + docs, sharing one starfield ───────────────────
      {
        lazy: lazyComponent(() => import("./features/marketing/CosmosRoot.tsx")),
        children: [
          {
            // Above MarketingShell on purpose — see RootGate. When /pricing and
            // /changelog join the shell (Phases 3 and 7) they belong in a
            // sibling MarketingShell branch outside this gate: a signed-in user
            // is allowed to read those, they are just never sent to the landing
            // page.
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
                lazy: lazyComponent(
                  () => import("./features/docs/DocsIndex.tsx"),
                ),
              },
            ],
          },
        ],
      },

      // ── Auth ──────────────────────────────────────────────────────────────
      {
        element: <RequireGuest />,
        children: [
          {
            path: "/login",
            lazy: lazyComponent(() => import("./pages/Login.tsx")),
          },
          {
            path: "/signup",
            lazy: lazyComponent(() => import("./pages/SignUp.tsx")),
          },
          {
            path: "/auth/callback",
            lazy: lazyComponent(() => import("./pages/OAuthCallback.tsx")),
          },
        ],
      },
      {
        element: <RequireUnverified />,
        children: [
          {
            path: "/verify-pending",
            lazy: lazyComponent(() => import("./pages/VerifyPending.tsx")),
          },
        ],
      },
      {
        path: "/verify-email",
        lazy: lazyComponent(() => import("./pages/VerifyEmail.tsx")),
      },

      // ── Standalone public pages ───────────────────────────────────────────
      {
        path: "/privacy",
        lazy: lazyComponent(() => import("./pages/Privacy.tsx")),
      },
      {
        path: "/terms",
        lazy: lazyComponent(() => import("./pages/Terms.tsx")),
      },
      {
        path: "/pricing",
        lazy: lazyComponent(() => import("./pages/Pricing.tsx")),
      },
      // Intentionally unguarded: this is the mobile app's credit-pack checkout,
      // opened in an in-app browser tab that carries no session. See Checkout.
      {
        path: "/checkout",
        lazy: lazyComponent(() => import("./pages/Checkout.tsx")),
      },
      {
        path: "*",
        lazy: lazyComponent(() => import("./pages/NotFound.tsx")),
      },
    ],
  },
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
