import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DropdownMenu } from "radix-ui";
import { MoreHorizontalIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { useMe } from "@/src/features/auth/queries";
import { DeleteProjectDialog } from "@/src/features/project/DeleteProjectDialog";
import { EditProjectDialog } from "@/src/features/project/EditProjectDialog";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { APP_HOME, projectPath } from "@/src/lib/routes";
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

function ThumbnailPlaceholder() {
  // Covers all three thumbnail-less states uniformly: never built, build in
  // progress, or a failed/absent capture.
  return (
    <div className="flex size-full items-center justify-center bg-gradient-to-br from-space-overlay to-space-surface">
      <span className="text-2xl font-semibold text-silver-600/40 select-none">
        τ
      </span>
    </div>
  );
}

function ProjectCard({
  project,
  onEditClick,
  onDeleteClick,
}: {
  project: ProjectListItem;
  onEditClick: (project: ProjectListItem) => void;
  onDeleteClick: (project: ProjectListItem) => void;
}) {
  return (
    <div className="group relative">
      <Link
        to={projectPath(project.id)}
        className="flex flex-col overflow-hidden rounded-xl border border-border bg-card text-left transition-colors hover:border-silver-400/60 hover:bg-space-overlay"
      >
        <div className="aspect-video w-full overflow-hidden bg-space-overlay">
          {project.previewImageUrl ? (
            <img
              src={project.previewImageUrl}
              alt={project.name}
              loading="lazy"
              className="size-full object-cover object-top"
            />
          ) : (
            <ThumbnailPlaceholder />
          )}
        </div>
        <div className="flex flex-col gap-2 p-5">
          <span className="truncate pr-8 text-sm font-medium text-silver-900 group-hover:text-foreground">
            {project.name}
          </span>
          {project.description && (
            <span className="line-clamp-2 text-xs text-silver-600">
              {project.description}
            </span>
          )}
          {project.tags && project.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {project.tags.slice(0, 4).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-silver-200 px-2 py-0.5 text-[11px] text-silver-600"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          <span className="text-xs text-silver-600">
            Updated {formatUpdated(project.updatedAt)}
          </span>
        </div>
      </Link>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label="Project options"
            onClick={(e) => e.preventDefault()}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md text-[var(--silver-500)] opacity-0 transition-all hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)] group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[140px] rounded-lg border border-[var(--silver-200)] bg-[var(--space-surface)] p-1 shadow-xl"
          >
            <DropdownMenu.Item
              onSelect={() => onEditClick(project)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm text-silver-600 outline-none select-none transition-colors data-[highlighted]:bg-[var(--space-overlay)] data-[highlighted]:text-silver-900"
            >
              <PencilIcon className="size-3.5 shrink-0" />
              Edit project
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => onDeleteClick(project)}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-1.5 text-sm text-red-400 outline-none select-none transition-colors data-[highlighted]:bg-red-500/10 data-[highlighted]:text-red-500"
            >
              <Trash2Icon className="size-3.5 shrink-0" />
              Delete project
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}


export function MyProjects() {
  const { data: user } = useMe();
  const { data: projects, isLoading, isError } = useProjects();
  const navigate = useNavigate();
  const { id: currentProjectId } = useParams<{ id?: string }>();

  const [pendingDelete, setPendingDelete] = useState<ProjectListItem | null>(null);
  const [pendingEdit, setPendingEdit] = useState<ProjectListItem | null>(null);

  if (!user) return null;
  if (isLoading) {
    return (
      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pt-24 pb-16">
        <h2 className="mb-4 text-sm font-medium text-silver-600">My projects</h2>
        <div className="flex min-h-24 items-center justify-center">
          <DataSpinner label="Loading projects" />
        </div>
      </section>
    );
  }
  if (isError || !projects || projects.length === 0) return null;

  return (
    <>
      <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pt-24 pb-16">
        <h2 className="mb-4 text-sm font-medium text-silver-600">My projects</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onEditClick={setPendingEdit}
              onDeleteClick={setPendingDelete}
            />
          ))}
        </div>
      </section>

      <EditProjectDialog
        project={pendingEdit}
        open={pendingEdit !== null}
        onOpenChange={(open) => { if (!open) setPendingEdit(null); }}
      />

      <DeleteProjectDialog
        project={pendingDelete}
        open={pendingDelete !== null}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        onDeleted={(id) => {
          if (currentProjectId === id) navigate(APP_HOME);
        }}
      />
    </>
  );
}
