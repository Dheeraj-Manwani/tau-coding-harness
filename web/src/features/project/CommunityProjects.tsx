import { ArrowUpRightIcon } from "lucide-react";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { useProjectShowcase } from "./api";

const PALETTES = [
  "from-cyan-400/15 via-sky-500/5 to-transparent",
  "from-violet-400/15 via-fuchsia-500/5 to-transparent",
  "from-amber-400/15 via-orange-500/5 to-transparent",
  "from-emerald-400/15 via-teal-500/5 to-transparent",
  "from-rose-400/15 via-pink-500/5 to-transparent",
  "from-blue-400/15 via-indigo-500/5 to-transparent",
];

export function CommunityProjects() {
  const { data: projects, isLoading, isError, refetch } = useProjectShowcase();
  return (
    <section
      aria-labelledby="community-projects-heading"
      className="relative z-10 mx-auto w-full max-w-5xl px-6 py-12"
    >
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">// 02</p>
          <h2
            id="community-projects-heading"
            className="display-heading mt-1 text-3xl text-silver-900"
          >
            See what others are building
          </h2>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Small ideas, real websites. Explore what the community is putting
            into the world.
          </p>
        </div>
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] text-muted-foreground sm:flex">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Published sites
        </span>
      </div>
      {isLoading ? (
        <div className="flex min-h-48 items-center justify-center">
          <DataSpinner label="Loading community projects" />
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground"
        >
          Community projects are unavailable right now.{" "}
          <button
            type="button"
            onClick={() => void refetch()}
            className="text-foreground underline underline-offset-4"
          >
            Try again
          </button>
        </div>
      ) : !projects?.length ? (
        <div className="relative flex min-h-52 flex-col items-center gap-8 overflow-hidden rounded-xl border border-border bg-space-surface px-6 py-10 text-center sm:flex-row sm:text-left">
          <div aria-hidden="true" className="rain-streaks" />
          <div
            aria-hidden="true"
            className="relative size-32 shrink-0 rounded-full border border-blue-500/20"
          >
            <div className="absolute inset-4 rounded-full border border-blue-500/20" />
            <div className="absolute inset-8 rounded-full border border-blue-500/20" />
            <div className="absolute inset-x-0 top-1/2 h-px bg-blue-500/15" />
            <div className="absolute inset-y-0 left-1/2 w-px bg-blue-500/15" />
            <div className="absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-blue-300" />
            <div className="absolute left-[38%] top-[28%] size-1 rounded-full bg-silver-600" />
            <div className="absolute left-[62%] top-[68%] size-1 rounded-full bg-silver-600" />
            <div
              className="absolute left-1/2 top-1/2 h-1/2 w-px origin-top bg-gradient-to-b from-blue-300 to-transparent"
              style={{ animation: "orbit-spin 3.2s linear infinite" }}
            />
          </div>
          <div className="relative z-10">
            <p className="eyebrow">Scanning for live sites</p>
            <p className="display-heading mt-1 text-2xl text-silver-900">
              Good things are taking shape.
            </p>
            <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
              As builders refine and publish their projects, you’ll find a
              selection of their live sites here.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project, index) => (
            <a
              key={project.slug}
              href={project.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Visit ${project.slug} (opens in a new tab)`}
              className="group overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-silver-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div
                className={`relative flex h-36 items-center justify-center overflow-hidden bg-gradient-to-br ${PALETTES[index % PALETTES.length]}`}
              >
                <div
                  aria-hidden="true"
                  className="absolute size-48 rounded-full border border-foreground/5"
                />
                <div
                  aria-hidden="true"
                  className="absolute size-32 rounded-full border border-foreground/5"
                />
                <span
                  aria-hidden="true"
                  className="text-4xl font-light uppercase tracking-tighter text-foreground/70 transition-transform duration-300 group-hover:scale-110"
                >
                  {project.slug.slice(0, 2)}
                </span>
                <span className="absolute left-3 top-3 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  Live
                </span>
                <ArrowUpRightIcon className="absolute right-3 top-3 size-4 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
              <div className="p-4">
                <h3 className="truncate text-sm font-medium capitalize">
                  {project.slug.replace(/-/g, " ")}
                </h3>
                <p className="mt-1.5 truncate text-xs text-muted-foreground">
                  {project.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        Featuring live sites published in the last 90 days, shaped through at
        least three build prompts.
      </p>
    </section>
  );
}
