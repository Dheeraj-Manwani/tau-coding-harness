import { useState } from "react";
import toast from "react-hot-toast";
import { CopyIcon, KeyRoundIcon, RefreshCwIcon } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { ApiError } from "@/src/lib/api-client";
import {
  useApiKey,
  useCreateApiKey,
  useRevealApiKey,
  useRotateApiKey,
  useSetDailyCap,
} from "./api";

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

async function copy(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Could not copy — select the key and copy it manually.");
  }
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

/**
 * The API key panel.
 *
 * Lives on /billing rather than in Settings because the key is a spend
 * instrument: it draws on the same balance shown directly above it, and the
 * daily cap only makes sense next to that number.
 */
export function ApiKeyCard() {
  const { data, isLoading } = useApiKey();
  const create = useCreateApiKey();
  const reveal = useRevealApiKey();
  const rotate = useRotateApiKey();
  const setCap = useSetDailyCap();

  // Held in component state only — never persisted, and cleared on unmount.
  const [shown, setShown] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState<string>("");
  const [confirmRotate, setConfirmRotate] = useState(false);

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <div className="h-4 w-32 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!data?.exists) {
    return (
      <div className="rounded-xl border bg-card p-5">
        <div className="flex items-center gap-2">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">API key</h2>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Lets apps tau builds for you call an AI model, billed to the credits
          above. tau creates one automatically the first time you ask for an AI
          feature — or you can create it now.
        </p>
        <Button
          variant="outline"
          className="mt-3"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(undefined, {
              onSuccess: (r) => {
                setShown(r.key);
                toast.success("API key created");
              },
              onError: (e) =>
                toast.error(errMessage(e, "Could not create a key")),
            })
          }
        >
          {create.isPending ? "Creating…" : "Create API key"}
        </Button>
      </div>
    );
  }

  const rotating = data.status === "ROTATING";

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <KeyRoundIcon className="size-4 text-muted-foreground" />
          <h2 className="text-sm font-medium">API key</h2>
        </div>
        <span className="text-xs text-muted-foreground">
          Used {fmtDate(data.lastUsedAt)}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs">
          {shown ?? `${data.prefix}${"•".repeat(24)}`}
        </code>
        {shown ? (
          <Button variant="outline" size="sm" onClick={() => void copy(shown)}>
            <CopyIcon className="size-3.5" />
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={reveal.isPending}
            onClick={() =>
              reveal.mutate(undefined, {
                onSuccess: (r) => setShown(r.key),
                onError: (e) =>
                  toast.error(errMessage(e, "Could not reveal the key")),
              })
            }
          >
            {reveal.isPending ? "…" : "Reveal"}
          </Button>
        )}
      </div>

      {rotating && data.revokeAfter && (
        <p className="mt-2 text-xs text-amber-500">
          This key was replaced and stops working on {fmtDate(data.revokeAfter)}.
          Redeploy any live apps with the new key before then.
        </p>
      )}

      {/* The cap is the only thing standing between a popular deployed app and
          the whole balance — its endpoints are public by default. */}
      <div className="mt-4 border-t pt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-xs font-medium">Daily spend limit</span>
          <span className="text-xs text-muted-foreground">
            {data.spentTodayCredits.toFixed(2)} / {data.dailyCapCredits} credits
            used today
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Apps you deploy are public, so anyone who finds them spends your
          credits. Requests are refused past this limit; it resets at 00:00 UTC.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            type="number"
            min={0}
            placeholder={String(data.dailyCapCredits)}
            value={capDraft}
            onChange={(e) => setCapDraft(e.target.value)}
            className="h-9 font-mono"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={capDraft.trim() === "" || setCap.isPending}
            onClick={() =>
              setCap.mutate(Number(capDraft), {
                onSuccess: () => {
                  setCapDraft("");
                  toast.success("Daily limit updated");
                },
                onError: (e) =>
                  toast.error(errMessage(e, "Could not update the limit")),
              })
            }
          >
            Save
          </Button>
        </div>
      </div>

      <div className="mt-4 border-t pt-4">
        {confirmRotate ? (
          <div className="space-y-2">
            <p className="text-xs text-amber-500">
              Rotating issues a new key and retires this one in 24 hours. Every
              app you have deployed will stop working unless you redeploy it with
              the new key first.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={rotate.isPending}
                onClick={() =>
                  rotate.mutate(undefined, {
                    onSuccess: (r) => {
                      setShown(r.key);
                      setConfirmRotate(false);
                      toast.success("New key issued");
                    },
                    onError: (e) =>
                      toast.error(errMessage(e, "Could not rotate the key")),
                  })
                }
              >
                {rotate.isPending ? "Rotating…" : "Yes, rotate"}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmRotate(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRotate(true)}
            className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <RefreshCwIcon className="size-3" />
            Rotate key
          </button>
        )}
      </div>
    </div>
  );
}
