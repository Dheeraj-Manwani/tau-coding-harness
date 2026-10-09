import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDownIcon,
  ImageIcon,
  LoaderCircleIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react";
import toast from "react-hot-toast";

import { cn } from "@/src/lib/utils";
import { APP_BILLING } from "@/src/lib/routes";
import { useBalance } from "@/src/features/billing/api";
import { useUpgradeModalStore } from "@/src/features/billing/useUpgradeModalStore";
import {
  cleanAddressInput,
  useNameCheck,
  useGenerateLogo,
  useIdentity,
  useSaveIdentity,
  initialTitle,
  isScaffoldTitle,
  type IdentityView,
  type SaveIdentityInput,
} from "@/src/features/project/deploy";
import {
  LOGO_ACCEPT,
  logoFromSource,
  type LogoDraft,
} from "@/src/features/project/logoImage";

/** Same limits as the server's (`appIdentity.ts`); the API refuses anything over. */
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

/** `1,000` style is not needed here: prices are small whole numbers. */
const credits = (n: number) => `${n} credit${n === 1 ? "" : "s"}`;

/**
 * The app's name, description and logo, written into the project when saved.
 *
 * A mechanical edit by tau's server, not a chat turn, so nothing here waits on
 * the agent. Every price is printed on the control that spends it, with the
 * balance beside it, and a control the balance cannot cover is disabled and
 * points at buying credits (doc/PUBLISHING.md D7).
 */
export function IdentitySection({ projectId }: { projectId: string | null }) {
  const [open, setOpen] = useState(false);
  const { data: identity, isLoading } = useIdentity(projectId, open);

  return (
    <div className="rounded-lg border border-silver-400/20 bg-space-void/40">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-medium text-silver-900"
      >
        Name and logo
        <ChevronDownIcon
          className={cn("size-3.5 text-silver-600 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="border-t border-silver-400/20 p-3">
          {isLoading || !identity ? (
            <div className="flex items-center gap-2 py-3 text-[11px] text-silver-600">
              <LoaderCircleIcon className="size-3.5 animate-spin" />
              Loading…
            </div>
          ) : (
            // Keyed on what was saved, so the fields reset to the saved values
            // after a save instead of keeping stale edits.
            <IdentityForm
              key={`${identity.title}|${identity.description}|${identity.icon}`}
              projectId={projectId}
              identity={identity}
            />
          )}
        </div>
      )}
    </div>
  );
}

function IdentityForm({
  projectId,
  identity,
}: {
  projectId: string | null;
  identity: IdentityView;
}) {
  const startTitle = initialTitle(identity);
  const startDescription = identity.description ?? "";
  const [title, setTitle] = useState(startTitle);
  const [description, setDescription] = useState(startDescription);
  const [draft, setDraft] = useState<LogoDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: balance } = useBalance();
  const available = balance?.credits.available ?? 0;
  const openUpgrade = useUpgradeModalStore((s) => s.openModal);
  const save = useSaveIdentity(projectId);
  const generate = useGenerateLogo(projectId);

  const { prices } = identity;
  const isPro = identity.plan === "PRO";

  const titleChanged = title.trim() !== startTitle || isScaffoldTitle(identity.title);
  const descriptionChanged = description.trim() !== startDescription;
  const dirty = (titleChanged && title.trim() !== "") || descriptionChanged || draft !== null;

  // A logo that came from the generator is already paid for.
  const saveCost = draft && !draft.generationId ? prices.logoUpload : 0;
  const cantAfford = saveCost > available;
  const generateShort = isPro && prices.logoGeneration > available;

  const take = (next: LogoDraft | null) => {
    setDraft((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return next;
    });
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setBusy(true);
    try {
      take(await logoFromSource(file));
    } catch (err) {
      setProblem(err instanceof Error ? err.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const onGenerate = async () => {
    if (!isPro) {
      openUpgrade("Generate a logo with AI on the Pro plan");
      return;
    }
    setProblem(null);
    try {
      const made = await generate.mutateAsync();
      take(
        await logoFromSource(`data:${made.mimeType};base64,${made.image}`, made.generationId),
      );
    } catch (err) {
      // The request failure is already a toast; this is a picture that would not decode.
      if (err instanceof Error && !("status" in err)) setProblem(err.message);
    }
  };

  const onSave = () => {
    const input: SaveIdentityInput = {};
    if (titleChanged && title.trim()) input.title = title.trim();
    if (descriptionChanged) input.description = description.trim();
    if (draft) {
      input.logo = {
        favicon: draft.favicon,
        icon512: draft.icon512,
        ...(draft.generationId ? { generationId: draft.generationId } : {}),
      };
    }
    save.mutate(input, {
      onSuccess: () => take(null),
      onError: () => {},
    });
  };

  return (
    <div className="space-y-2.5">
      <label className="block">
        <span className="mb-1 flex justify-between text-[11px] text-silver-600">
          Name
          <span>{title.length}/{TITLE_MAX}</span>
        </span>
        <input
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-md border border-silver-400/30 bg-space-surface px-2 py-1.5 text-xs text-silver-900 outline-none focus:border-brand"
        />
        <span className="mt-1 block text-[10px] leading-snug text-silver-600">
          The title in a browser tab and a shared link. Your address doesn't change.
        </span>
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-[11px] text-silver-600">
          Description
          <span>{description.length}/{DESCRIPTION_MAX}</span>
        </span>
        <textarea
          value={description}
          maxLength={DESCRIPTION_MAX}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full resize-none rounded-md border border-silver-400/30 bg-space-surface px-2 py-1.5 text-xs text-silver-900 outline-none focus:border-brand"
        />
      </label>

      <div>
        <span className="mb-1 block text-[11px] text-silver-600">Logo</span>
        <div className="flex items-center gap-2.5">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-silver-400/30 bg-space-surface">
            {draft ? (
              <img src={draft.previewUrl} alt="New logo" className="size-full object-contain" />
            ) : (
              <ImageIcon className="size-4 text-silver-600" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-[11px] leading-snug text-silver-600">
            {draft ? (
              <>
                New logo. Shown here at tab size:
                <img
                  src={draft.previewUrl}
                  alt=""
                  aria-hidden
                  className="ml-1.5 inline-block size-4 align-middle"
                />
              </>
            ) : identity.icon === "custom" ? (
              "Your own logo"
            ) : (
              "Tau's icon, until you choose one"
            )}
          </div>
        </div>

        <input
          ref={fileRef}
          type="file"
          accept={LOGO_ACCEPT}
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            disabled={busy || save.isPending}
            onClick={() => fileRef.current?.click()}
            className="flex flex-col items-center gap-0.5 rounded-md border border-silver-400/30 px-2 py-1.5 text-[11px] font-medium text-silver-900 transition-colors hover:bg-space-overlay disabled:opacity-50"
          >
            <span className="flex items-center gap-1">
              {busy ? <LoaderCircleIcon className="size-3 animate-spin" /> : <UploadIcon className="size-3" />}
              Upload logo
            </span>
            <span className="text-[10px] font-normal text-silver-600">
              {credits(prices.logoUpload)}
            </span>
          </button>

          {(identity.canGenerate || !isPro) && (
            <button
              type="button"
              disabled={generate.isPending || save.isPending || generateShort || (isPro && identity.generationsLeftToday === 0)}
              onClick={() => void onGenerate()}
              className="flex flex-col items-center gap-0.5 rounded-md border border-silver-400/30 px-2 py-1.5 text-[11px] font-medium text-silver-900 transition-colors hover:bg-space-overlay disabled:opacity-50"
            >
              <span className="flex items-center gap-1">
                {generate.isPending ? (
                  <LoaderCircleIcon className="size-3 animate-spin" />
                ) : (
                  <SparklesIcon className="size-3" />
                )}
                {draft?.generationId ? "Regenerate" : "Generate logo"}
                {!isPro && (
                  <span className="rounded-full bg-brand/10 px-1.5 py-px text-[10px] font-semibold text-brand">
                    PRO
                  </span>
                )}
              </span>
              <span className="text-[10px] font-normal text-silver-600">
                {credits(prices.logoGeneration)} · balance {Math.floor(available)}
              </span>
            </button>
          )}
        </div>
        {generateShort && (
          <BuyCredits>Generating a logo needs {credits(prices.logoGeneration)}.</BuyCredits>
        )}
        {problem && <p className="mt-1.5 text-[11px] leading-snug text-red-300">{problem}</p>}
      </div>

      <button
        type="button"
        disabled={!dirty || save.isPending || cantAfford}
        onClick={onSave}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-silver-400/30 px-3 py-1.5 text-xs font-medium text-silver-900 transition-colors hover:bg-space-overlay disabled:cursor-not-allowed disabled:opacity-50"
      >
        {save.isPending && <LoaderCircleIcon className="size-3.5 animate-spin" />}
        {saveCost > 0 ? `Save · ${credits(saveCost)}` : "Save"}
      </button>
      {cantAfford && (
        <BuyCredits>Saving this logo needs {credits(saveCost)}.</BuyCredits>
      )}
      <p className="text-[10px] leading-snug text-silver-600">
        Saving changes your project's files; publish to put them on the site.
      </p>
    </div>
  );
}

/**
 * The app's address, chosen once before the first publish.
 *
 * Deliberately not inside the collapsed "Name and logo" section: it is the one
 * choice here that cannot be undone, so it is on view next to the Publish
 * button. The title in a browser tab (the section below) is a different thing
 * and stays editable. The check runs as the owner types, after a short pause.
 */
export function AddressPicker({
  projectId,
  suggested,
  domain,
  value,
  onChange,
}: {
  projectId: string | null;
  suggested: string;
  domain: string | null;
  /** What was typed, or null while the suggestion is untouched. */
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const shown = value ?? suggested;
  const [settled, setSettled] = useState(shown);
  useEffect(() => {
    const t = setTimeout(() => setSettled(shown), 400);
    return () => clearTimeout(t);
  }, [shown]);

  const check = useNameCheck(projectId, settled);
  const stale = settled !== shown || check.isFetching;
  const result = check.data && check.data.name === shown.trim().toLowerCase() ? check.data : null;

  return (
    <div className="rounded-lg border border-silver-400/20 bg-space-void/40 p-3">
      <label className="block">
        <span className="mb-1 block text-[11px] text-silver-600">
          Address <span className="text-silver-600">· fixed after you publish</span>
        </span>
        <span className="flex items-center overflow-hidden rounded-md border border-silver-400/30 bg-space-surface focus-within:border-brand">
          <input
            value={shown}
            maxLength={40}
            spellCheck={false}
            autoCapitalize="none"
            aria-label="Address"
            onChange={(e) => onChange(cleanAddressInput(e.target.value))}
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-xs text-silver-900 outline-none"
          />
          <span className="shrink-0 pr-2 text-[11px] text-silver-600">
            {domain ? `.${domain}` : ""}
          </span>
        </span>
      </label>
      <p
        className={cn(
          "mt-1.5 min-h-[14px] text-[11px] leading-snug",
          stale || !result
            ? "text-silver-600"
            : result.available
              ? "text-green-400"
              : "text-red-300",
        )}
        aria-live="polite"
      >
        {stale || !result
          ? "Checking…"
          : result.available
            ? "Available."
            : (result.message ?? "Not available.")}
      </p>
    </div>
  );
}

/** Shown where a price cannot be paid: says so, and links to where credits are bought. */
export function BuyCredits({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[11px] leading-snug text-amber-200">
      {children}{" "}
      <Link
        to={`${APP_BILLING}#buy-credits`}
        onClick={() => toast.dismiss()}
        className="font-medium underline underline-offset-2"
      >
        Buy credits
      </Link>
    </p>
  );
}
