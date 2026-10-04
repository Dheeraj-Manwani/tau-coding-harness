import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { DropdownMenu } from "radix-ui";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";

import { useMe } from "@/src/features/auth/queries";
import { DeleteProjectDialog } from "@/src/features/project/DeleteProjectDialog";
import { EditProjectDialog } from "@/src/features/project/EditProjectDialog";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { APP_HOME, projectPath } from "@/src/lib/routes";
import { useProjectsPage } from "./api";
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
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const { data, isLoading, isError, refetch } = useProjectsPage(
    query,
    cursors.at(-1),
  );
  const projects = data?.projects ?? [];
  useEffect(() => {
    if (search.trim() === query) return;
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setCursors([undefined]);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const navigate = useNavigate();
  const { id: currentProjectId } = useParams<{ id?: string }>();

  const [pendingDelete, setPendingDelete] = useState<ProjectListItem | null>(
    null,
  );
  const [pendingEdit, setPendingEdit] = useState<ProjectListItem | null>(null);

  if (!user) return null;

  return (
    <>
      <section
        aria-labelledby="my-projects-heading"
        className="relative z-10 mx-auto w-full max-w-5xl px-6 pt-16 pb-12"
      >
        <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            {/* <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">Your workspace</p> */}
            <h2
              id="my-projects-heading"
              className="text-xl font-medium tracking-tight"
            >
              My projects
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick up where you left off.
            </p>
          </div>
          <div className="flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:ring-1 focus-within:ring-ring sm:w-72">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              aria-label="Search projects"
              placeholder="Search name or description"
              maxLength={200}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {search && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearch("")}
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-3.5" />
              </button>
            )}
          </div>
        </div>
        {isLoading ? (
          <div className="flex min-h-64 items-center justify-center">
            <DataSpinner label="Loading projects" />
          </div>
        ) : isError ? (
          <div
            role="alert"
            className="rounded-xl border border-border p-10 text-center text-sm text-muted-foreground"
          >
            Could not load your projects.{" "}
            <button
              type="button"
              onClick={() => void refetch()}
              className="text-foreground underline underline-offset-4"
            >
              Try again
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div
            role="status"
            className="flex min-h-56 flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 text-center"
          >
            <FolderOpenIcon className="mb-4 size-6 text-muted-foreground" />
            <p className="text-sm font-medium">
              {query
                ? "No projects found"
                : cursors.length > 1
                  ? "No more projects on this page"
                  : "Your next idea starts here"}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {query
                ? "Try a different name or description."
                : cursors.length > 1
                  ? "Go back to your previous projects."
                  : "Describe an idea above to create your first project."}
            </p>
          </div>
        ) : (
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
        )}
        {(cursors.length > 1 || Boolean(data?.nextCursor)) && <nav
          aria-label="Project pagination"
          className="mt-6 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground"
        >
          <span aria-live="polite">
            Page {cursors.length}
            {query ? " · Search results" : ""}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={cursors.length === 1 || isLoading}
              onClick={() => setCursors((previous) => previous.slice(0, -1))}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-2 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeftIcon className="size-3.5" />
              Previous
            </button>
            <button
              type="button"
              disabled={
                !data?.nextCursor ||
                isLoading ||
                isError ||
                search.trim() !== query
              }
              onClick={() => {
                if (data?.nextCursor)
                  setCursors((previous) => [...previous, data.nextCursor!]);
              }}
              className="flex items-center gap-1 rounded-md border border-border px-3 py-2 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
              <ChevronRightIcon className="size-3.5" />
            </button>
          </div>
        </nav>}
      </section>

      <EditProjectDialog
        project={pendingEdit}
        open={pendingEdit !== null}
        onOpenChange={(open) => {
          if (!open) setPendingEdit(null);
        }}
      />

      <DeleteProjectDialog
        project={pendingDelete}
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null);
        }}
        onDeleted={(id) => {
          if (currentProjectId === id) navigate(APP_HOME);
        }}
      />
    </>
  );
}
