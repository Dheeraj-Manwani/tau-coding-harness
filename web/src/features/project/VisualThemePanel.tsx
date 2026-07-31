import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { XIcon } from "lucide-react";

import { cn } from "@/src/lib/utils";
import { ApiError } from "@/src/lib/api-client";
import {
  useProjectTheme,
  useThemeEdit,
  type ThemeScope,
} from "@/src/features/project/api";
import { useProjectStore } from "@/src/stores/useProjectStore";

/**
 * The theme variables the panel offers, in the order it shows them.
 *
 * Mirrors `THEME_TOKENS` in `api/src/lib/themeEdit.ts` — the server validates
 * against its own list, so a name only in one place is a control that always
 * fails. Kept short on purpose: these are the knobs that visibly change an app,
 * not every variable the shadcn palette defines.
 */
const TOKENS: { name: string; label: string }[] = [
  { name: "--primary", label: "Primary" },
  { name: "--primary-foreground", label: "On primary" },
  { name: "--background", label: "Background" },
  { name: "--foreground", label: "Text" },
  { name: "--card", label: "Card" },
  { name: "--muted", label: "Muted" },
  { name: "--muted-foreground", label: "Muted text" },
  { name: "--accent", label: "Accent" },
  { name: "--destructive", label: "Danger" },
  { name: "--border", label: "Border" },
  { name: "--ring", label: "Focus ring" },
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
   * Values the user has picked but that may not have reached the server yet.
   *
   * The swatch has to track the pointer while the native picker is being
   * dragged; the request must not. So the override drives the UI immediately and
   * the write is debounced behind it.
   */
  const [pending, setPending] = useState<Record<string, string>>({});

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

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(
    () => () => {
      for (const t of Object.values(timers.current)) clearTimeout(t);
      timers.current = {};
    },
    [],
  );

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

  const commit = (name: string, value: string) => {
    const key = pendingKey(scope, name);
    themeEdit.mutate(
      { name, value, scope, baseHash: hashRef.current },
      {
        onSuccess: (data) => {
          if (data.applied) {
            hashRef.current = data.contentHash;
            return;
          }
          setPending((p) => dropKey(p, key));
          toast.error(
            data.reason === "token_not_found"
              ? "This app's theme doesn't define that colour."
              : data.reason === "no_theme_block"
                ? "This app's theme has been rewritten — edit src/index.css directly."
                : "That value isn't supported.",
          );
        },
        onError: (err) => {
          const status = err instanceof ApiError ? err.status : 0;
          setPending((p) => dropKey(p, key));
          if (status === 409) {
            toast.error(
              err instanceof ApiError && err.message === "generation in progress"
                ? "Can't edit while tau is building."
                : "The theme changed — reloading it.",
            );
            void theme.refetch();
          } else {
            toast.error("Couldn't change that colour.");
          }
        },
      },
    );
  };

  /** Show it now, write it once the user stops moving. */
  const queueCommit = (name: string, value: string) => {
    const key = pendingKey(scope, name);
    setPending((p) => ({ ...p, [key]: value }));
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => commit(name, value), 300);
  };

  return (
    <div className="absolute inset-x-0 bottom-0 max-h-72 overflow-y-auto border-t border-[var(--silver-200)] bg-[var(--space-surface)] px-3 py-2">
      <div className="flex items-center gap-2 pb-2">
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
                "rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] transition-colors",
                scope === s
                  ? "bg-[var(--space-surface)] text-[var(--silver-900)]"
                  : "text-[var(--silver-600)] hover:text-[var(--silver-900)]",
              )}
            >
              {s === "dark" ? "Dark" : "Light"}
            </button>
          ))}
        </div>
        <span className="text-[11px] text-[var(--silver-600)]">
          Changes every element using these colours.
        </span>
        <button
          type="button"
          onClick={onClose}
          title="Close theme"
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
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            {TOKENS.map(({ name, label }) => {
              const value = pending[pendingKey(scope, name)] ?? palette[name];
              if (!value) return null;
              return (
                <label
                  key={name}
                  className="flex items-center gap-2 text-[11px] text-[var(--silver-600)]"
                  title={`${name}: ${value}`}
                >
                  {/* The native picker is the right control here: it is the one
                      widget users already know, and it only ever emits #rrggbb —
                      exactly the form the server will accept. */}
                  <input
                    type="color"
                    value={toPickerValue(value)}
                    onChange={(e) => queueCommit(name, e.target.value)}
                    aria-label={label}
                    className="size-5 shrink-0 cursor-pointer rounded-[var(--radius-sm)] border border-[var(--silver-200)] bg-transparent"
                  />
                  <span className="truncate">{label}</span>
                </label>
              );
            })}
          </div>

          {radius && (
            <div className="flex items-start gap-2 pt-2">
              <span className="w-20 shrink-0 pt-1 text-[11px] text-[var(--silver-600)]">
                Corners
              </span>
              <div className="flex flex-wrap gap-1">
                {RADIUS_STEPS.map((step) => (
                  <button
                    key={step.value}
                    type="button"
                    onClick={() => queueCommit("--radius", step.value)}
                    aria-pressed={radius === step.value}
                    title={step.value}
                    className={cn(
                      "rounded-[var(--radius-md)] border px-1.5 py-0.5 text-[11px] transition-colors",
                      radius === step.value
                        ? "border-[var(--blue-500)] text-[var(--silver-900)]"
                        : "border-[var(--silver-200)] text-[var(--silver-600)] hover:text-[var(--silver-900)]",
                    )}
                  >
                    {step.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
