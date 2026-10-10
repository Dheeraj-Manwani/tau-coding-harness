import type { MouseEvent } from "react";
import { Trash2Icon } from "lucide-react";
import toast from "react-hot-toast";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/src/components/ui/alert-dialog";
import { useDeleteProject } from "@/src/features/project/api";
import { useProjectStorage } from "@/src/features/project/storage";
import type { ProjectListItem } from "@/src/features/project/types";

interface DeleteProjectDialogProps {
  project: ProjectListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: (projectId: string) => void;
}

export function DeleteProjectDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: DeleteProjectDialogProps) {
  const deleteProject = useDeleteProject();
  // Only asked for while the dialog is open: stored files are deleted with the project.
  const storage = useProjectStorage(project?.id, open);
  const storedFiles = (storage.data?.environments ?? []).reduce((n, e) => n + e.fileCount, 0);

  const handleDelete = (event: MouseEvent) => {
    // Prevent Radix from auto-closing the dialog on Action click so it stays
    // open (showing the "Deleting…" state) until the mutation resolves.
    event.preventDefault();
    if (!project) return;
    const id = project.id;
    deleteProject.mutate(id, {
      onSuccess: () => {
        toast.success("Project deleted");
        onOpenChange(false);
        onDeleted?.(id);
      },
      onError: () => {
        toast.error("Failed to delete project");
        onOpenChange(false);
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        size="sm"
        className="border-silver-200 bg-space-surface"
      >
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-red-500/10 text-red-400">
            <Trash2Icon />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-silver-900">
            Delete project?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-silver-600">
            <span className="font-medium text-silver-900">{project?.name}</span>{" "}
            and all its messages, files, and history will be permanently deleted
            and{" "}
            <span className="text-red-400">cannot be recovered</span>.
            {storedFiles > 0 && (
              <>
                {" "}
                The {storedFiles === 1 ? "1 file" : `${storedFiles} files`} its app has stored will be deleted too.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="border-t border-border pt-4">
          <AlertDialogCancel
            variant="outline"
            className="border-silver-200 bg-transparent text-silver-600 hover:bg-space-overlay hover:text-silver-900"
          >
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={deleteProject.isPending}
            onClick={handleDelete}
            className="bg-red-500/15 text-red-400 hover:bg-red-500/25"
          >
            {deleteProject.isPending ? "Deleting…" : "Delete project"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
