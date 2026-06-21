import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import "./index.css";
import App from "./App.tsx";
import { Providers } from "./components/providers.tsx";
import {
  AuthBootstrap,
  RequireAuth,
  RequireGuest,
  RequireUnverified,
} from "./features/auth/guards.tsx";
import Home from "./pages/Home.tsx";
import Login from "./pages/Login.tsx";
import SignUp from "./pages/SignUp.tsx";
import OAuthCallback from "./pages/OAuthCallback.tsx";
import VerifyEmail from "./pages/VerifyEmail.tsx";
import VerifyPending from "./pages/VerifyPending.tsx";
import NotFound from "./pages/NotFound.tsx";

const router = createBrowserRouter([
  {
    element: <RequireAuth />,
    children: [
      {
        path: "/",
        element: <App />,
        children: [{ index: true, element: <Home /> }],
      },
    ],
  },
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
