import { useState, type KeyboardEvent } from "react";
import { XIcon } from "lucide-react";
import toast from "react-hot-toast";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/src/components/ui/dialog";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import {
  useUpdateProject,
  type UpdateProjectResponse,
} from "@/src/features/project/api";

const MAX_DESCRIPTION = 2_000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;

export interface EditableProject {
  id: string;
  name: string;
  description: string | null;
  tags: string[];
}

interface EditProjectDialogProps {
  project: EditableProject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (updated: UpdateProjectResponse) => void;
}

/**
 * The actual form, mounted only while a project is set — same trick as
 * `FeedbackModal`'s `{isOpen && <FeedbackForm />}`: it keys the mutation hook
 * to a real project id instead of juggling a nullable one, and `key={project.id}`
 * below gives every project its own fresh draft state rather than leaking the
 * previous project's edits in for a flash before the effect would reset them.
 */
function EditProjectForm({
  project,
  onOpenChange,
  onSaved,
}: {
  project: EditableProject;
  onOpenChange: (open: boolean) => void;
  onSaved?: EditProjectDialogProps["onSaved"];
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? "");
  const [tags, setTags] = useState<string[]>(project.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const update = useUpdateProject(project.id);

  const addTag = (raw: string) => {
    const value = raw.trim().slice(0, MAX_TAG_LENGTH);
    setTagDraft("");
    if (!value || tags.length >= MAX_TAGS) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) return;
    setTags((prev) => [...prev, value]);
  };

  const handleTagKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagDraft);
    } else if (e.key === "Backspace" && tagDraft.length === 0 && tags.length > 0) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && !update.isPending;

  const handleSave = () => {
    if (!canSave) return;
    update.mutate(
      { name: trimmedName, description: description.trim(), tags },
      {
        onSuccess: (updated) => {
          toast.success("Project updated");
          onOpenChange(false);
          onSaved?.(updated);
        },
        onError: () => toast.error("Failed to update project"),
      },
    );
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit project</DialogTitle>
        <DialogDescription>
          Update the name, description and tags.
        </DialogDescription>
      </DialogHeader>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          handleSave();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="edit-project-name">Name</Label>
          <Input
            id="edit-project-name"
            value={name}
            maxLength={100}
            disabled={update.isPending}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-project-description">
            Description <span className="text-muted-foreground">(optional)</span>
          </Label>
          <textarea
            id="edit-project-description"
            value={description}
            maxLength={MAX_DESCRIPTION}
            disabled={update.isPending}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What's this project about?"
            rows={3}
            className="w-full resize-y rounded-lg border border-input bg-background p-3 text-sm outline-none transition-shadow focus-visible:border-brand focus-visible:ring-3 focus-visible:ring-brand/25"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="edit-project-tags">
            Tags <span className="text-muted-foreground">(optional)</span>
          </Label>
          <div
            onClick={() => document.getElementById("edit-project-tags")?.focus()}
            className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-1.5 transition-shadow focus-within:border-brand focus-within:ring-3 focus-within:ring-brand/25"
          >
            {tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-space-overlay px-2 py-0.5 text-xs text-foreground"
              >
                {tag}
                <button
                  type="button"
                  aria-label={`Remove ${tag}`}
                  disabled={update.isPending}
                  onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                >
                  <XIcon className="size-3" />
                </button>
              </span>
            ))}
            <input
              id="edit-project-tags"
              value={tagDraft}
              disabled={update.isPending || tags.length >= MAX_TAGS}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={handleTagKeyDown}
              onBlur={() => addTag(tagDraft)}
              placeholder={tags.length === 0 ? "e.g. side project, client work" : ""}
              className="min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Press Enter or comma to add a tag.
          </p>
        </div>

        {update.error && (
          <p role="alert" className="text-sm text-red-400">
            Couldn't update the project. Try again.
          </p>
        )}
      </form>

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={update.isPending}
          onClick={() => onOpenChange(false)}
        >
          Cancel
        </Button>
        <Button type="button" disabled={!canSave} onClick={handleSave}>
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Edit-project modal shared verbatim by Home (`MyProjects`) and the project
 *  page (`ProjectSwitcher`) — same component, same fields, opened from either
 *  place a project's identity shows up. */
export function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onSaved,
}: EditProjectDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {project && (
          <EditProjectForm
            key={project.id}
            project={project}
            onOpenChange={onOpenChange}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
