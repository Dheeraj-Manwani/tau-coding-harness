import { useState } from "react";
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
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { ApiError } from "@/src/lib/api-client";
import {
  compactConfig,
  useDesignCatalog,
  useRestyle,
  type DesignConfig,
  type DesignSummary,
  type RestyleResponse,
} from "@/src/features/design/api";
import { DesignPicker } from "@/src/features/design/DesignPicker";

/**
 * The form, mounted only while the dialog is open so every opening starts from
 * an empty draft: "change nothing" is the starting point of a restyle, and a
 * half-made choice from last time should not be waiting to be applied.
 */
function RestyleForm({
  projectId,
  current,
  onClose,
  onRestyled,
}: {
  projectId: string;
  current: DesignSummary;
  onClose: () => void;
  onRestyled: (result: RestyleResponse) => void;
}) {
  const catalog = useDesignCatalog();
  const restyle = useRestyle(projectId);
  const [draft, setDraft] = useState<DesignConfig>({});
  const config = compactConfig(draft);

  const apply = () => {
    if (!config || restyle.isPending) return;
    restyle.mutate(config, {
      onSuccess: (result) => {
        onRestyled(result);
        onClose();
      },
      onError: (err) => {
        const conflict = err instanceof ApiError && err.status === 409;
        toast.error(
          conflict
            ? "Can't change the style while tau is building."
            : err instanceof ApiError
              ? err.message
              : "Couldn't change the style.",
        );
      },
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Change the look</DialogTitle>
        <DialogDescription>
          Choose what to change; everything else stays as it is. Colours, type
          and the shape of buttons, cards and fields change at once. Page
          layouts stay as they are until you ask tau to adapt them.
        </DialogDescription>
      </DialogHeader>

      {catalog.data ? (
        <DesignPicker
          catalog={catalog.data}
          value={draft}
          onChange={setDraft}
          current={current}
        />
      ) : (
        <DataSpinner label="Loading styles" />
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={restyle.isPending}>
          Cancel
        </Button>
        <Button onClick={apply} disabled={!config || restyle.isPending}>
          {restyle.isPending ? "Applying…" : "Apply"}
        </Button>
      </DialogFooter>
    </>
  );
}

/** Restyle an existing app: the same picker as the composer's, starting from what the app has. */
export function RestyleDialog({
  projectId,
  current,
  open,
  onOpenChange,
  onRestyled,
}: {
  projectId: string;
  current: DesignSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestyled: (result: RestyleResponse) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 sm:max-w-3xl">
        {open && (
          <RestyleForm
            projectId={projectId}
            current={current}
            onClose={() => onOpenChange(false)}
            onRestyled={onRestyled}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
