export interface MockFile {
  name: string;
  content: string;
}

/**
 * Flat map of fileId -> file metadata + content. The folder structure itself is
 * declared as JSX in CodePane via the file-tree primitives, keyed by these ids.
 */
export const MOCK_FILES: Record<string, MockFile> = {
  main: {
    name: "main.tsx",
    content: `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);`,
  },
  app: {
    name: "App.tsx",
    content: `import { Hero } from "./components/Hero";
import { Features } from "./components/Features";
import { Pricing } from "./components/Pricing";

// Top-level page composition for the landing site.
export default function App() {
  return (
    <main className="min-h-screen bg-white text-slate-900">
      <Hero />
      <Features />
      <Pricing />
    </main>
  );
}`,
  },
  hero: {
    name: "Hero.tsx",
    content: `export function Hero() {
  return (
    <section className="bg-gradient-to-b from-indigo-50 to-white py-24 text-center">
      <h1 className="text-5xl font-bold tracking-tight">
        Ship your idea in minutes
      </h1>
      <p className="mt-4 text-lg text-slate-600">
        The fastest way to launch your SaaS product.
      </p>
      <button className="mt-8 rounded-lg bg-indigo-600 px-6 py-3 font-medium text-white transition hover:scale-105 hover:bg-indigo-500">
        Get started free
      </button>
    </section>
  );
}`,
  },
  features: {
    name: "Features.tsx",
    content: `const FEATURES = [
  { title: "Fast", body: "Built on a modern, optimized stack." },
  { title: "Flexible", body: "Customize everything to your needs." },
  { title: "Secure", body: "Enterprise-grade security by default." },
];

export function Features() {
  return (
    <section className="mx-auto grid max-w-5xl grid-cols-1 gap-8 px-6 py-20 md:grid-cols-3">
      {FEATURES.map((f) => (
        <div key={f.title} className="rounded-xl border p-6">
          <h3 className="text-xl font-semibold">{f.title}</h3>
          <p className="mt-2 text-slate-600">{f.body}</p>
        </div>
      ))}
    </section>
  );
}`,
  },
  pricing: {
    name: "Pricing.tsx",
    content: `const TIERS = ["Starter", "Pro", "Enterprise"];

export function Pricing() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-20">
      <h2 className="text-center text-3xl font-bold">Pricing</h2>
      <div className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        {TIERS.map((tier) => (
          <div key={tier} className="rounded-2xl border p-8 text-center">
            <h3 className="text-lg font-semibold">{tier}</h3>
          </div>
        ))}
      </div>
    </section>
  );
}`,
  },
  homePage: {
    name: "Home.tsx",
    content: `import App from "../App";

// Route entry — re-exports the composed landing page.
export default function Home() {
  return <App />;
}`,
  },
  indexCss: {
    name: "index.css",
    content: `@import "tailwindcss";

:root {
  --brand: #4f46e5;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}`,
  },
  indexHtml: {
    name: "index.html",
    content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>SaaS Landing</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>`,
  },
  pkg: {
    name: "package.json",
    content: `{
  "name": "saas-landing",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vite": "^6.0.0"
  }
}`,
  },
  viteConfig: {
    name: "vite.config.ts",
    content: `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config
export default defineConfig({
  plugins: [react()],
});`,
  },
  tsconfig: {
    name: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "jsx": "react-jsx",
    "strict": true,
    "moduleResolution": "bundler"
  },
  "include": ["src"]
}`,
  },
};
