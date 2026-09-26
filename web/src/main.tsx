import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";

import "./index.css";
import { SplashScreen } from "./components/SplashScreen";
import { Providers } from "./components/providers";
import {
  AuthBootstrap,
  RequireAuth,
  RequireGuest,
  RequireUnverified,
} from "./features/auth/guards";

const lazyComponent =
  (load: () => Promise<{ default: ComponentType }>) => async () => ({
    Component: (await load()).default,
  });

const router = createBrowserRouter([
  {
    element: <Outlet />,
    hydrateFallbackElement: <SplashScreen />,
    children: [
      {
        element: <RequireAuth />,
        children: [
          {
            path: "/",
            lazy: lazyComponent(() => import("./components/AppShell")),
            children: [
              {
                index: true,
                lazy: lazyComponent(() => import("./pages/Home")),
              },
              {
                path: "project/:id",
                lazy: lazyComponent(
                  () => import("./features/project/ProjectPage"),
                ),
              },
              {
                path: "billing",
                lazy: lazyComponent(() => import("./pages/Billing")),
              },
            ],
          },
        ],
      },
      {
        element: <RequireGuest />,
        children: [
          {
            path: "/login",
            lazy: lazyComponent(() => import("./pages/Login")),
          },
          {
            path: "/signup",
            lazy: lazyComponent(() => import("./pages/SignUp")),
          },
          {
            path: "/auth/callback",
            lazy: lazyComponent(() => import("./pages/OAuthCallback")),
          },
        ],
      },
      {
        element: <RequireUnverified />,
        children: [
          {
            path: "/verify-pending",
            lazy: lazyComponent(() => import("./pages/VerifyPending")),
          },
        ],
      },
      {
        path: "/verify-email",
        lazy: lazyComponent(() => import("./pages/VerifyEmail")),
      },
      {
        path: "/checkout",
        lazy: lazyComponent(() => import("./pages/Checkout")),
      },
      {
        path: "*",
        lazy: lazyComponent(() => import("./pages/NotFound")),
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
