import { Link } from "react-router-dom";

import { useMe } from "@/src/features/auth/queries";
import { useProjects } from "./api";
import type { ProjectListItem } from "./types";

function formatUpdated(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function ProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <Link
      to={`/project/${project.id}`}
      className="group flex flex-col gap-2 rounded-lg border border-silver-400/30 bg-space-surface p-4 text-left transition-colors hover:border-silver-400/60 hover:bg-space-overlay"
    >
      <span className="truncate text-sm font-medium text-silver-900 group-hover:text-foreground">
        {project.name}
      </span>
      <span className="text-xs text-silver-600">
        Updated {formatUpdated(project.updatedAt)}
      </span>
    </Link>
  );
}

export function MyProjects() {
  const { data: user } = useMe();
  const { data: projects, isLoading, isError } = useProjects();

  // Only signed-in users have projects to show.
  if (!user) return null;
  // Don't render an empty section while loading or before the first project.
  if (isLoading || isError || !projects || projects.length === 0) return null;

  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pt-24 pb-16">
      <h2 className="mb-4 text-sm font-medium text-silver-600">My projects</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => (
          <ProjectCard key={project.id} project={project} />
        ))}
      </div>
    </section>
  );
}
