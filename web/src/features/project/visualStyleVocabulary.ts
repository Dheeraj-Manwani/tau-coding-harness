/**
 * The curated Tailwind vocabulary the visual-edit style panel can apply.
 *
 * Deliberately small. A full CSS panel is the wrong target: the goal is the ten
 * things people actually tweak, done well, with every result still a legal
 * Tailwind class that reads naturally in the source afterwards.
 *
 * Two rules:
 *
 *  1. **Theme tokens before raw colours.** `bg-primary` keeps the generated app
 *     coherent — restyle the theme later and the element follows. `bg-red-500`
 *     is a one-off that quietly breaks that. Tokens are offered first and are
 *     what the UI shows by default.
 *  2. **One choice per group.** Applying an option just adds its class; the
 *     server's `tailwind-merge` pass drops whatever it conflicts with. So the
 *     groups don't need to know about each other, and `text-xl` vs
 *     `text-red-500` resolve independently even though both start with `text-`.
 *
 * See doc/VISUAL_EDIT_PLAN.md §6 Phase 3.
 */

export interface StyleOption {
  /** Shown in the UI. */
  label: string;
  /** The Tailwind class applied. */
  className: string;
  /** CSS colour for a swatch, when the option is a literal colour. */
  swatch?: string;
}

export interface StyleGroup {
  id: string;
  label: string;
  /** Render as colour swatches rather than text chips. */
  swatches?: boolean;
  options: StyleOption[];
}

/** Theme tokens come from the shadcn palette every template scaffolds. */
export const STYLE_GROUPS: StyleGroup[] = [
  {
    id: "text-color",
    label: "Text",
    swatches: true,
    options: [
      { label: "Default", className: "text-foreground" },
      { label: "Muted", className: "text-muted-foreground" },
      { label: "Primary", className: "text-primary" },
      { label: "Danger", className: "text-destructive" },
      { label: "White", className: "text-white", swatch: "#ffffff" },
      { label: "Black", className: "text-black", swatch: "#000000" },
      { label: "Red", className: "text-red-500", swatch: "#ef4444" },
      { label: "Amber", className: "text-amber-500", swatch: "#f59e0b" },
      { label: "Green", className: "text-green-500", swatch: "#22c55e" },
      { label: "Blue", className: "text-blue-500", swatch: "#3b82f6" },
    ],
  },
  {
    id: "bg-color",
    label: "Background",
    swatches: true,
    options: [
      { label: "None", className: "bg-transparent" },
      { label: "Card", className: "bg-card" },
      { label: "Muted", className: "bg-muted" },
      { label: "Primary", className: "bg-primary" },
      { label: "Danger", className: "bg-destructive" },
      { label: "White", className: "bg-white", swatch: "#ffffff" },
      { label: "Black", className: "bg-black", swatch: "#000000" },
      { label: "Red", className: "bg-red-500", swatch: "#ef4444" },
      { label: "Amber", className: "bg-amber-500", swatch: "#f59e0b" },
      { label: "Green", className: "bg-green-500", swatch: "#22c55e" },
      { label: "Blue", className: "bg-blue-500", swatch: "#3b82f6" },
    ],
  },
  {
    id: "font-size",
    label: "Size",
    options: [
      { label: "XS", className: "text-xs" },
      { label: "SM", className: "text-sm" },
      { label: "Base", className: "text-base" },
      { label: "LG", className: "text-lg" },
      { label: "XL", className: "text-xl" },
      { label: "2XL", className: "text-2xl" },
      { label: "3XL", className: "text-3xl" },
      { label: "4XL", className: "text-4xl" },
    ],
  },
  {
    id: "font-weight",
    label: "Weight",
    options: [
      { label: "Normal", className: "font-normal" },
      { label: "Medium", className: "font-medium" },
      { label: "Semibold", className: "font-semibold" },
      { label: "Bold", className: "font-bold" },
    ],
  },
  {
    id: "text-align",
    label: "Align",
    options: [
      { label: "Left", className: "text-left" },
      { label: "Center", className: "text-center" },
      { label: "Right", className: "text-right" },
    ],
  },
  {
    id: "padding",
    label: "Padding",
    options: [
      { label: "0", className: "p-0" },
      { label: "1", className: "p-1" },
      { label: "2", className: "p-2" },
      { label: "4", className: "p-4" },
      { label: "6", className: "p-6" },
      { label: "8", className: "p-8" },
      { label: "12", className: "p-12" },
    ],
  },
  {
    id: "radius",
    label: "Corners",
    options: [
      { label: "None", className: "rounded-none" },
      { label: "SM", className: "rounded-sm" },
      { label: "MD", className: "rounded-md" },
      { label: "LG", className: "rounded-lg" },
      { label: "Full", className: "rounded-full" },
    ],
  },
];

/**
 * Which option in a group is currently on the element, if any.
 *
 * Matched against the group's own options rather than by prefix, so `text-xl`
 * (size) and `text-red-500` (colour) can't be mistaken for one another even
 * though both live under `text-`.
 */
export function activeOption(
  group: StyleGroup,
  className: string,
): StyleOption | undefined {
  const present = new Set(className.split(/\s+/).filter(Boolean));
  return group.options.find((o) => present.has(o.className));
}
