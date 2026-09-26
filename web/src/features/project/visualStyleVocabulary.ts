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
 *     coherent: restyle the theme later and the element follows. `bg-red-500`
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
  variant = "",
): StyleOption | undefined {
  const present = new Set(className.split(/\s+/).filter(Boolean));
  return group.options.find((o) => present.has(variant + o.className));
}

// ── Responsive variants (doc/VISUAL_EDIT_PLAN.md §6 Phase 6) ─────────────────

/**
 * The Tailwind variant each preview frame writes.
 *
 * The frames in `PreviewPane` are 375 / 768 / unconstrained, and these three
 * variants partition exactly that: `max-md:` is `< 768px`, `md:` is `>= 768px`,
 * and an unprefixed class applies everywhere.
 *
 * Desktop maps to the *base* class rather than `lg:` deliberately. The device
 * toggle defaults to desktop, so anything else would silently turn every
 * ordinary styling click into a breakpoint-scoped one: an element restyled at
 * the default view would then look unstyled on a phone. Base is also what the
 * panel wrote before this existed, so the common path is unchanged.
 *
 * One consequence worth stating in the UI: because `md:` has no upper bound,
 * editing the tablet frame also changes desktop. That is Tailwind's mobile-first
 * model, not a quirk of this mapping.
 */
export const DEVICE_VARIANT: Record<string, string> = {
  mobile: "max-md:",
  tablet: "md:",
  desktop: "",
};

/** How each frame's variant is described to the user. */
export const VARIANT_SCOPE: Record<string, string> = {
  "max-md:": "phone widths only (under 768px)",
  "md:": "768px and up: tablet and desktop",
};

export interface ResolvedOption {
  option: StyleOption | undefined;
  /**
   * True when the shown option comes from the base class rather than a class
   * written for this breakpoint.
   *
   * The distinction is the whole feature. At `md:` an element with only `p-4`
   * really is padded 4: but that is inherited, and changing it must add
   * `md:p-6` rather than rewrite `p-4` and silently move the phone layout too.
   */
  inherited: boolean;
}

/**
 * What the panel should show for a group at the current breakpoint.
 *
 * The breakpoint's own class wins if there is one; otherwise the base class
 * shows through, flagged as inherited. On mobile (no variant) nothing can be
 * inherited, because the base class *is* the value being edited.
 */
export function resolveOption(
  group: StyleGroup,
  className: string,
  variant: string,
): ResolvedOption {
  if (!variant) {
    return { option: activeOption(group, className), inherited: false };
  }
  const own = activeOption(group, className, variant);
  if (own) return { option: own, inherited: false };
  return { option: activeOption(group, className), inherited: true };
}
