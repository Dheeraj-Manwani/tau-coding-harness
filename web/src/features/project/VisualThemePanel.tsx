import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { MoonIcon, SunIcon, SwatchBookIcon, XIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { ApiError } from "@/src/lib/api-client";
import {
  useProjectTheme,
  useThemeEdit,
  type ThemeScope,
} from "@/src/features/project/api";
import { useProjectStore } from "@/src/stores/useProjectStore";

/**
 * The theme variables the panel offers, grouped the way someone thinks about
 * them rather than the way the stylesheet declares them.
 *
 * Mirrors `THEME_TOKENS` in `server/src/api/lib/themeEdit.ts` — the server
 * validates against its own list, so a name only in one place is a control that
 * always fails. Kept short on purpose: these are the knobs that visibly change
 * an app, not every variable the shadcn palette defines.
 *
 * The grouping matters more than it looks. Eleven flat swatches called
 * "Primary", "On primary", "Muted" and "Muted text" is a list you have to read
 * twice to find anything in; four short groups is one you can scan.
 */
const GROUPS: { title: string; tokens: { name: string; label: string }[] }[] = [
  {
    title: "Brand",
    tokens: [
      { name: "--primary", label: "Primary" },
      { name: "--primary-foreground", label: "On primary" },
      { name: "--accent", label: "Accent" },
      { name: "--ring", label: "Focus ring" },
    ],
  },
  {
    title: "Surface",
    tokens: [
      { name: "--background", label: "Background" },
      { name: "--card", label: "Card" },
      { name: "--muted", label: "Muted" },
      { name: "--border", label: "Border" },
    ],
  },
  {
    title: "Text",
    tokens: [
      { name: "--foreground", label: "Body text" },
      { name: "--muted-foreground", label: "Muted text" },
    ],
  },
  {
    title: "Alerts",
    tokens: [{ name: "--destructive", label: "Danger" }],
  },
];

/** Stepped, like the style vocabulary — one click, one commit, no drag state. */
const RADIUS_STEPS = [
  { label: "Square", value: "0" },
  { label: "SM", value: "0.25rem" },
  { label: "MD", value: "0.5rem" },
  { label: "LG", value: "0.625rem" },
  { label: "XL", value: "1rem" },
  { label: "Round", value: "1.5rem" },
];

/**
 * Pending values are keyed by palette as well as token.
 *
 * `--background` is `#ffffff` in light and `#121212` in dark; a key of just the
 * token name would show a colour picked for one palette on the other's tab.
 */
function pendingKey(scope: ThemeScope, name: string): string {
  return `${scope}|${name}`;
}

function dropKey(
  map: Record<string, string>,
  key: string,
): Record<string, string> {
  if (!(key in map)) return map;
  const next = { ...map };
  delete next[key];
  return next;
}

/**
 * One colour, as a tile you can obviously click.
 *
 * The previous version put a 20px swatch and a text label inside a bare
 * `<label>` in a grid cell. A `<label>` forwards every click to its input, and
 * that one stretched the full column width — so clicking in the empty space
 * beside "Border" opened the colour picker for it, with nothing on screen to
 * suggest it would. The click target was right; it was invisible.
 *
 * The fix is not to shrink the target but to draw it. The whole tile is
 * bordered, has a hover state, and shows the value it holds — so a large hit
 * area reads as generous rather than as a trap. Staged tiles keep the accent
 * border after the pointer leaves, which is the only thing on screen that says
 * what Save is about to write.
 */
function SwatchTile({
  label,
  name,
  value,
  staged,
  disabled,
  onPick,
}: {
  label: string;
  name: string;
  value: string;
  staged: boolean;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  return (
    <label
      title={`${name}: ${value}`}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-[var(--radius-md)] border px-2 py-1.5 transition-colors",
        disabled
          ? "cursor-default opacity-50"
          : "cursor-pointer hover:border-[var(--blue-500)] hover:bg-[var(--space-overlay)]",
        staged
          ? "border-[var(--blue-500)] bg-[var(--space-overlay)]"
          : "border-[var(--silver-200)]",
      )}
    >
      {/* The native picker is the right control here: it is the one widget
          users already know, and it only ever emits #rrggbb — exactly the form
          the server will accept. The pseudo-element rules strip the chrome
          browsers wrap it in so it reads as a swatch, not as an input. */}
      <input
        type="color"
        value={toPickerValue(value)}
        disabled={disabled}
        onChange={(e) => onPick(e.target.value)}
        aria-label={label}
        className="size-5 shrink-0 cursor-[inherit] rounded-[var(--radius-sm)] border border-[var(--silver-200)] bg-transparent p-0 [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[3px] [&::-webkit-color-swatch]:border-0"
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[11px] text-[var(--silver-900)]">
          {label}
        </span>
        <span
          className={cn(
            "truncate font-mono text-[10px]",
            staged ? "text-[var(--blue-500)]" : "text-[var(--silver-600)]",
          )}
        >
          {value}
        </span>
      </span>
    </label>
  );
}

/** `<input type="color">` only accepts `#rrggbb`. */
function toPickerValue(value: string | undefined): string {
  if (!value) return "#000000";
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/.exec(value.trim());
  if (!m?.[1]) return "#000000";
  const hex = m[1];
  return hex.length === 3
    ? `#${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
    : `#${hex}`;
}

/**
 * Global theme editing — the one visual edit that isn't about an element.
 *
 * Change `--primary` once and every `bg-primary`, `text-primary` and
 * `ring-primary` in the app moves with it. That is why the style panel offers
 * theme tokens ahead of raw palette colours: an element styled `bg-primary`
 * follows this panel, an element styled `bg-red-500` never will.
 *
 * Light and dark are edited separately and deliberately never together — they
 * hold genuinely different values, so an "apply to both" convenience would
 * flatten light mode the first time anyone changed a background. The app ships
 * `<html class="dark">`, so dark is the default tab.
 */
export function VisualThemePanel({ onClose }: { onClose: () => void }) {
  const projectId = useProjectStore((s) => s.projectId);
  const theme = useProjectTheme(projectId ?? undefined);
  const themeEdit = useThemeEdit(projectId ?? undefined);

  const [scope, setScope] = useState<ThemeScope>("dark");

  /**
   * Values the user has picked, held here until they hit Save.
   *
   * Staged rather than written as they are chosen. `<input type="color">` fires
   * its change event on every frame of a drag, and each write is a file write,
   * an R2 write and a `USER_EDIT` message the agent reads on its next turn —
   * so an auto-committing panel turned choosing one colour into a commit
   * history nobody wanted, and choosing five into a race between their own
   * `baseHash` chains.
   *
   * The trade this makes: the preview no longer changes until Save. Nothing
   * here can push a value into the iframe without writing the file, so live
   * feedback and one-commit-per-intent cannot both be had until the runtime
   * learns to preview a theme (doc/VISUAL_EDIT_PROMPTING.md §7.7).
   */
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  /**
   * The hash of `src/index.css` as we last knew it.
   *
   * Not read from the query: after a successful edit the query's copy is stale
   * until its refetch lands, so sending it as `baseHash` would 409 every rapid
   * second edit. The response carries the new hash, so track that instead — the
   * stale-file guard stays on, and it guards against the agent rather than
   * against us.
   */
  const hashRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (theme.data) hashRef.current = theme.data.contentHash;
  }, [theme.data]);

  const palette = theme.data
    ? scope === "dark"
      ? theme.data.dark
      : theme.data.root
    : {};
  // `--radius` is declared once, in `:root`, because both themes share it.
  const radius =
    pending[pendingKey(scope, "--radius")] ??
    theme.data?.root["--radius"] ??
    theme.data?.dark["--radius"];

  const dirtyKeys = Object.keys(pending);
  const dirty = dirtyKeys.length;

  /** Stage a value. Nothing leaves the browser until Save. */
  const stage = (name: string, value: string) => {
    setPending((p) => ({ ...p, [pendingKey(scope, name)]: value }));
  };

  /**
   * Write every staged value, one request each.
   *
   * Sequential, deliberately. The endpoint takes one token at a time and each
   * response carries the new `contentHash`, so the requests form a chain —
   * firing them together would have every one but the first sent with a
   * `baseHash` that stopped being current, and the stale-file guard would
   * reject them against us rather than against the agent it exists to catch.
   *
   * A failure stops the run and keeps whatever is left staged, so the panel
   * still shows what has not landed. Partial success is reported honestly:
   * some of these are already in the file and undoing them is a separate act.
   */
  const save = async () => {
    if (!dirty || saving) return;
    setSaving(true);

    let applied = 0;
    for (const key of dirtyKeys) {
      const value = pending[key]!;
      const sep = key.indexOf("|");
      const entryScope = key.slice(0, sep) as ThemeScope;
      const name = key.slice(sep + 1);

      try {
        const data = await themeEdit.mutateAsync({
          name,
          value,
          scope: entryScope,
          baseHash: hashRef.current,
        });

        if (!data.applied) {
          setPending((p) => dropKey(p, key));
          toast.error(
            data.reason === "token_not_found"
              ? "This app's theme doesn't define that colour."
              : data.reason === "no_theme_block"
                ? "This app's theme has been rewritten — edit src/index.css directly."
                : "That value isn't supported.",
          );
          break;
        }

        hashRef.current = data.contentHash;
        setPending((p) => dropKey(p, key));
        applied++;
      } catch (err) {
        const status = err instanceof ApiError ? err.status : 0;
        if (status === 409) {
          toast.error(
            err instanceof ApiError && err.message === "generation in progress"
              ? "Can't save while tau is building."
              : "The theme changed underneath — reloading it.",
          );
          void theme.refetch();
        } else {
          toast.error("Couldn't save the theme.");
        }
        break;
      }
    }

    setSaving(false);
    if (applied === dirty) toast.success("Theme saved.");
    else if (applied > 0) toast(`Saved ${applied} of ${dirty} changes.`);
  };

  const discard = () => {
    if (saving) return;
    setPending({});
  };

  const close = () => {
    if (dirty) toast(`Discarded ${dirty} unsaved theme change${dirty === 1 ? "" : "s"}.`);
    onClose();
  };

  return (
    // Taller than the old flat list needed, but capped against the preview's
    // own height — a panel that covers the app you are recolouring is worse
    // than one you have to scroll.
    <div className="absolute inset-x-0 bottom-0 max-h-[min(26rem,70%)] overflow-y-auto border-t border-[var(--silver-200)] bg-[var(--space-surface)] px-3 pb-2">
      {/* Sticky, because the body scrolls and the palette you are editing has
          to stay visible — with both palettes holding different values, an
          off-screen Dark/Light toggle is how you edit the wrong one. */}
      <div className="sticky top-0 z-10 -mx-3 flex items-center gap-2 border-b border-[var(--silver-200)] bg-[var(--space-surface)] px-3 py-2">
        <SwatchBookIcon className="size-3.5 shrink-0 text-[var(--silver-600)]" />
        <span className="text-xs font-semibold text-[var(--silver-900)]">
          Theme
        </span>
        <div className="flex items-center gap-0.5 rounded-[var(--radius-md)] bg-[var(--space-overlay)] p-0.5">
          {(["dark", "root"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              aria-pressed={scope === s}
              className={cn(
                "flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] transition-colors",
                scope === s
                  ? "bg-[var(--space-surface)] text-[var(--silver-900)] shadow-sm"
                  : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
              )}
            >
              {s === "dark" ? (
                <MoonIcon className="size-3" />
              ) : (
                <SunIcon className="size-3" />
              )}
              {s === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={close}
          title={dirty ? "Discard changes and close" : "Close theme"}
          className="ml-auto rounded-[var(--radius-md)] p-1 text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)]"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      {theme.isPending && (
        <p className="py-2 text-[11px] text-[var(--silver-600)]">
          Reading the theme…
        </p>
      )}
      {theme.isError && (
        <p className="py-2 text-[11px] text-[var(--silver-600)]">
          This project has no theme file to edit.
        </p>
      )}

      {theme.data && (
        <>
          <p className="pt-2 text-[11px] text-[var(--silver-600)]">
            Applies to every element using these colours, across the whole app.
          </p>

          {GROUPS.map((group) => {
            const tiles = group.tokens
              .map((t) => ({
                ...t,
                value: pending[pendingKey(scope, t.name)] ?? palette[t.name],
              }))
              // A theme the agent rewrote may not declare all of these, and a
              // swatch with no value would render as black and write one.
              .filter((t) => Boolean(t.value));
            if (tiles.length === 0) return null;

            return (
              <section key={group.title} className="pt-2">
                <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--silver-600)]">
                  {group.title}
                </h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {tiles.map((t) => (
                    <SwatchTile
                      key={t.name}
                      name={t.name}
                      label={t.label}
                      value={t.value!}
                      staged={pendingKey(scope, t.name) in pending}
                      disabled={saving}
                      onPick={(v) => stage(t.name, v)}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {radius && (
            <section className="pt-3">
              <h3 className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--silver-600)]">
                Corners
                {pendingKey(scope, "--radius") in pending && (
                  <span className="ml-1 font-normal normal-case tracking-normal text-[var(--blue-500)]">
                    · edited
                  </span>
                )}
              </h3>
              <div className="flex flex-wrap gap-1">
                {RADIUS_STEPS.map((step) => (
                  <button
                    key={step.value}
                    type="button"
                    disabled={saving}
                    onClick={() => stage("--radius", step.value)}
                    aria-pressed={radius === step.value}
                    title={step.value}
                    className={cn(
                      "rounded-[var(--radius-md)] border px-1.5 py-0.5 text-[11px] transition-colors disabled:cursor-default disabled:opacity-50",
                      radius === step.value
                        ? "border-[var(--blue-500)] text-[var(--silver-900)]"
                        : "border-[var(--silver-200)] text-[var(--silver-600)] hover:text-[var(--silver-900)]",
                    )}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </section>
          )}

          {/* Sticky so Save is reachable without scrolling a panel that is
              routinely taller than its own max height. */}
          <div className="sticky bottom-0 -mx-3 mt-3 flex items-center gap-2 border-t border-[var(--silver-200)] bg-[var(--space-surface)] px-3 py-2">
            <span
              className={cn(
                "flex items-center gap-1.5 text-[11px]",
                dirty
                  ? "text-[var(--silver-900)]"
                  : "text-[var(--silver-600)]",
              )}
            >
              {dirty > 0 && (
                <span className="size-1.5 shrink-0 rounded-full bg-[var(--blue-500)]" />
              )}
              {dirty === 0
                ? "No unsaved changes"
                : `${dirty} unsaved change${dirty === 1 ? "" : "s"}`}
            </span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={discard}
                disabled={!dirty || saving}
                className="rounded-[var(--radius-md)] px-2 py-1 text-xs font-medium text-[var(--silver-600)] transition-colors hover:bg-[var(--space-overlay)] hover:text-[var(--silver-900)] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="flex items-center gap-1.5 rounded-[var(--radius-md)] bg-brand px-3 py-1 text-xs font-medium text-primary-foreground transition-colors hover:bg-brand/90 disabled:opacity-40 disabled:hover:bg-brand"
              >
                {saving && (
                  <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                )}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
