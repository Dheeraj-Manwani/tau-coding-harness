import { ArrowUpRightIcon, Globe2Icon, SparklesIcon } from "lucide-react";
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
          {/* <p className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground"><SparklesIcon className="size-3" />Made with tau</p> */}
          <h2
            id="community-projects-heading"
            className="text-xl font-medium tracking-tight"
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
        <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-gradient-to-br from-space-overlay/60 to-transparent px-6 text-center">
          <Globe2Icon className="mb-4 size-7 text-muted-foreground" />
          <p className="text-sm font-medium">Good things are taking shape.</p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">
            As builders refine and publish their projects, you’ll find a
            selection of their live sites here.
          </p>
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
