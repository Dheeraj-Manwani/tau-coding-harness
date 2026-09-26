import { StrictMode, type ComponentType } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Outlet, RouterProvider } from "react-router-dom";

import "./index.css";

const lazyComponent =
  (load: () => Promise<{ default: ComponentType }>) => async () => ({
    Component: (await load()).default,
  });

const router = createBrowserRouter([
  {
    element: <Outlet />,
    children: [
      {
        lazy: lazyComponent(() => import("./features/marketing/CosmosRoot")),
        children: [
          {
            lazy: lazyComponent(
              () => import("./features/marketing/MarketingShell"),
            ),
            children: [
              {
                path: "/",
                lazy: lazyComponent(
                  () => import("./features/marketing/Landing"),
                ),
              },
              {
                path: "/changelog",
                lazy: lazyComponent(
                  () => import("./features/marketing/Changelog.tsx"),
                ),
              },
            ],
          },
          {
            lazy: lazyComponent(() => import("./features/docs/DocsShell")),
            children: [
              {
                path: "/docs",
                lazy: lazyComponent(() => import("./features/docs/DocsIndex")),
              },
              {
                path: "/docs/:section",
                lazy: lazyComponent(
                  () => import("./features/docs/DocsSectionRedirect"),
                ),
              },
              {
                path: "/docs/:section/:slug",
                lazy: lazyComponent(() => import("./features/docs/DocsPage")),
              },
              {
                path: "/docs/*",
                lazy: lazyComponent(
                  () => import("./features/docs/DocsNotFound"),
                ),
              },
            ],
          },
        ],
      },
      {
        path: "/pricing",
        lazy: lazyComponent(() => import("./pages/Pricing")),
      },
      {
        path: "/privacy",
        lazy: lazyComponent(() => import("./pages/Privacy")),
      },
      {
        path: "/terms",
        lazy: lazyComponent(() => import("./pages/Terms")),
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
    <RouterProvider router={router} />
  </StrictMode>,
);
