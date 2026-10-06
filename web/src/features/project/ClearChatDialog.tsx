import type { MouseEvent } from "react";
import { EraserIcon } from "lucide-react";
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
import { ApiError } from "@/src/lib/api-client";
import { useClearChat } from "@/src/features/project/api";
import { useProjectStore } from "@/src/stores/useProjectStore";

interface ClearChatDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function messageFor(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Failed to clear chat";
}

export function ClearChatDialog({
  projectId,
  open,
  onOpenChange,
}: ClearChatDialogProps) {
  const clearChat = useClearChat(projectId);
  const setContextUsage = useProjectStore((s) => s.setContextUsage);

  const handleClear = (event: MouseEvent) => {
    // Keep the dialog open (showing "Clearing…") until the mutation resolves,
    // same as DeleteProjectDialog.
    event.preventDefault();
    clearChat.mutate(undefined, {
      onSuccess: (data) => {
        toast.success("Chat cleared");
        setContextUsage(data);
        onOpenChange(false);
      },
      onError: (err) => {
        toast.error(messageFor(err));
        onOpenChange(false);
      },
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent size="sm" className="border-silver-200 bg-space-surface">
        <AlertDialogHeader>
          <AlertDialogMedia className="bg-red-500/10 text-red-400">
            <EraserIcon />
          </AlertDialogMedia>
          <AlertDialogTitle className="text-silver-900">
            Clear chat?
          </AlertDialogTitle>
          <AlertDialogDescription className="text-silver-600">
            Starts a brand-new conversation. Your current chat history will no
            longer be visible and{" "}
            <span className="text-red-400">cannot be recovered</span>. Your
            project files and build are not affected.
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
            disabled={clearChat.isPending}
            onClick={handleClear}
            className="bg-red-500/15 text-red-400 hover:bg-red-500/25"
          >
            {clearChat.isPending ? "Clearing…" : "Clear chat"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
