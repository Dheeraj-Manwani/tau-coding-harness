import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, import.meta.dirname, "VITE_");

  // A production bundle with no API URL would fall back to localhost and ship
  // a console that can never sign in. Fail the build instead. The CSP in
  // vercel.json pins connect-src to this origin, so the two must agree.
  if (command === "build" && mode === "production" && !env.VITE_API_URL) {
    throw new Error("VITE_API_URL must be set for a production build (e.g. https://api.tauai.pro)");
  }

  // `vite preview` serves the same security headers Vercel will, so a CSP that
  // breaks the app breaks it locally first. Single source: vercel.json.
  const vercel = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "vercel.json"), "utf8")) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const productionHeaders = Object.fromEntries(
    (vercel.headers.find((h) => h.source === "/(.*)")?.headers ?? []).map((h) => [h.key, h.value]),
  );

  return {
    plugins: [react(), tailwindcss()],
    preview: { port: 5176, headers: productionHeaders },
    server: {
      // web/ is 5174; the server's ADMIN_URL must match this in dev
      // (ADMIN_URL=http://localhost:5175) for CORS and Google sign-in.
      port: 5175,
      strictPort: true,
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "./src"),
      },
    },
  };
});
