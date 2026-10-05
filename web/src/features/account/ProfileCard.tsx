import { useRef, useState } from "react";
import toast from "react-hot-toast";
import { CameraIcon, CheckIcon, PencilIcon, XIcon } from "lucide-react";

import { UserAvatar } from "@/src/components/UserAvatar";
import { Input } from "@/src/components/ui/input";
import { DataSpinner } from "@/src/components/ui/data-spinner";
import { ApiError } from "@/src/lib/api-client";
import { cn } from "@/src/lib/utils";
import type { AuthUser } from "@/src/features/auth/types";
import {
  useActivity,
  useRemoveAvatar,
  useUpdateDisplayName,
  useUploadAvatar,
} from "./profile";
import { nameSavedLine, personaFor, tenureLine } from "./personality";

const NAME_MAX = 40;

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

export function ProfileCard({ user }: { user: AuthUser }) {
  const { data: activity } = useActivity();
  const persona = activity ? personaFor(activity) : null;

  return (
    <div className="relative overflow-hidden rounded-xl border bg-card p-5">
      {/* A faint brand-blue glow behind the header. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full opacity-[0.10] blur-3xl"
        style={{ backgroundImage: "radial-gradient(circle, var(--blue-500), transparent 70%)" }}
      />

      <div className="relative flex items-start gap-4">
        <AvatarEditor user={user} />

        <div className="min-w-0 flex-1 pt-1">
          <NameEditor user={user} />
          <p className="mt-0.5 truncate text-sm text-muted-foreground">{user.email}</p>
          <p className="mt-2 text-xs text-muted-foreground">{tenureLine(user.createdAt)}</p>
        </div>
      </div>

      {persona && (
        <div className="relative mt-4 flex items-center gap-3 rounded-lg border border-silver-400/20 bg-space-overlay/60 px-3 py-2.5">
          <span className="text-xl leading-none" aria-hidden>
            {persona.emoji}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[color:var(--blue-300)]">{persona.title}</p>
            <p className="text-xs text-muted-foreground">{persona.line}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function AvatarEditor({ user }: { user: AuthUser }) {
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadAvatar();
  const remove = useRemoveAvatar();
  const busy = upload.isPending || remove.isPending;

  const onFile = (file: File | undefined) => {
    if (!file) return;
    upload.mutate(file, {
      onSuccess: () => toast.success("Looking sharp."),
      onError: (err) => toast.error(errorText(err, "Couldn't upload that picture")),
    });
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        disabled={busy}
        onClick={() => input.current?.click()}
        aria-label={user.avatarPath ? "Change profile picture" : "Add a profile picture"}
        className="group relative cursor-pointer rounded-[8px] outline-none focus-visible:ring-3 focus-visible:ring-brand/40 disabled:cursor-wait"
      >
        <UserAvatar user={user} className="size-18" fallbackClassName="text-xl" />
        <span
          className={cn(
            "absolute inset-0 flex items-center justify-center rounded-[8px] bg-black/55 text-white transition-opacity",
            busy ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
          )}
        >
          {busy ? <DataSpinner label="Saving picture" /> : <CameraIcon className="size-5" />}
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/*"
        className="hidden"
        onChange={(e) => {
          onFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {user.avatarPath && (
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            remove.mutate(undefined, {
              onSuccess: () => toast.success("Back to the classic."),
              onError: (err) => toast.error(errorText(err, "Couldn't remove it")),
            })
          }
          className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-wait"
        >
          Remove
        </button>
      )}
    </div>
  );
}

function NameEditor({ user }: { user: AuthUser }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const update = useUpdateDisplayName();

  const start = () => {
    setDraft(user.displayName ?? "");
    setEditing(true);
  };

  const save = () => {
    const next = draft.trim() || null;
    setEditing(false);
    if (next === (user.displayName ?? null)) return;
    update.mutate(next, {
      onSuccess: (saved) => toast.success(nameSavedLine(saved)),
      onError: (err) => toast.error(errorText(err, "Couldn't save your name")),
    });
  };

  if (editing) {
    return (
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Input
          autoFocus
          value={draft}
          maxLength={NAME_MAX}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          placeholder="What should tau call you?"
          aria-label="Display name"
          className="h-9 text-base font-semibold"
        />
        <button
          type="submit"
          aria-label="Save name"
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-space-overlay hover:text-foreground"
        >
          <CheckIcon className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Cancel"
          onClick={() => setEditing(false)}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-space-overlay hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      </form>
    );
  }

  if (!user.displayName) {
    return (
      <button
        type="button"
        onClick={start}
        className="group flex cursor-pointer items-center gap-2 text-left text-xl font-semibold tracking-tight text-muted-foreground transition-colors hover:text-foreground"
      >
        What should tau call you?
        <PencilIcon className="size-3.5 opacity-60 group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={start}
      aria-label="Edit display name"
      className="group flex max-w-full cursor-pointer items-center gap-2 text-left"
    >
      <span className="truncate text-xl font-semibold tracking-tight">{user.displayName}</span>
      <PencilIcon className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}
