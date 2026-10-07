# Theme guide — what is in `src/index.css`, and how to change it

`src/index.css` is the app's whole look in one file. tau writes it from `.tau/DESIGN.md` when the app is created. Change the look here, and only here.

## The four parts of the file

1. **The palette** — `:root { … }` is the light palette, `.dark { … }` the dark one. Flat `--name: value;` lines, every colour a hex value. Whether the app opens dark is decided in `index.html`: `<html class="dark">` or no class.
2. **Theme tokens** — `@theme inline { … }` holds the fonts (`--font-sans`, `--font-heading`, `--font-mono`), the radius scale, the spacing unit (`--spacing`), the shadow scale (`--shadow-xs` … `--shadow-xl`) and any type-scale overrides. Tailwind's utilities read these, so `shadow-md` or `p-4` already mean what this style means by them.
3. **Base rules** — `@layer base`: the body font, and how headings are set.
4. **The skin** — `@layer skin`: rules that reshape the shadcn components by their `data-slot` attribute. It is declared after Tailwind's layers, so it wins over the classes written on the components.

## Rules that keep the theme panel working
The user can change colours from tau's theme panel, which finds each token by the shape of this file.
- Keep both palette blocks, `:root` first.
- One flat `--name: value;` per line. No nesting inside those two blocks.
- Colours as hex (`#1a1a1a`), not `oklch()` or `hsl()`.

## The colour tokens
- `background` / `foreground` — the page and the text on it.
- `card`, `popover`, each with a `-foreground` — raised surfaces and their text.
- `primary` / `primary-foreground` — the accent, and text on it.
- `secondary`, `muted`, `accent`, each with a `-foreground` — quiet fills; `accent` is the faint tint used for hover.
- `destructive` — delete and error.
- `border`, `input`, `ring` — lines, field outlines, the focus ring.
- `chart-1` … `chart-5` — data series; `chart-1` is the accent.
- `sidebar-*` — a sidebar, when the app has one.

Use them as classes: `bg-card`, `text-muted-foreground`, `border-border`, `bg-primary/10`. Never a literal colour in a component.

## Changing things

**A colour.** Edit the hex value in **both** palette blocks. Check that every `x-foreground` is still easy to read on `x` — aim for a contrast ratio of 4.5:1. Then update the colour named in `.tau/DESIGN.md`.

**The accent.** Change `--primary`, `--ring`, `--chart-1`, `--sidebar-primary` and `--sidebar-ring` together, in both blocks, and re-check `--primary-foreground` against the new colour.

**Light or dark by default.** Add or remove `class="dark"` on `<html>` in `index.html`. For a switch, toggle that class on `document.documentElement`, save the choice in `localStorage`, and apply the saved choice before the app renders so the page does not flash.

**Roundness.** `--radius` in `:root` drives the `rounded-*` utilities. The components take their corners from the skin variables at the top of `@layer skin` (`--control-radius`, `--card-radius`, `--field-radius`); change those to change the components.

**Density.** `--spacing` scales every padding, gap and size utility at once. Raise it for an airier app, lower it for a tighter one; stay between `0.22rem` and `0.29rem`.

**How a component looks.** Change its rule in `@layer skin` — `[data-slot="button"]`, `[data-slot="card"]`, `[data-slot="input"]`, `[data-slot="badge"]`, `[data-slot="tabs-trigger"]`, `[data-slot="dialog-content"]`. Classes added where the component is used will not override the skin for the properties it sets, by design: one place decides how a button looks.

**A new colour the design needs.** Declare it in both palette blocks, then map it in `@theme inline` as `--color-<name>: var(--<name>);`. Only do this for something the existing tokens cannot express, and add a line saying what it is for under `## Notes for this app` in `.tau/DESIGN.md`.

**A different typeface.** Install it with `bun add @fontsource-variable/<name>`, add `@import "@fontsource-variable/<name>";` beside the other font imports, and set it in `--font-sans` or `--font-heading`. Then update the typeface lines of `.tau/DESIGN.md`. For an extra typeface used in one place, give it a token of its own (`--font-<name>` in `@theme inline`) and name it under `## Notes for this app` instead.

**Icons.** `--icon-size` at the top of `@layer skin` is the size of an icon nothing else sizes, and the `.lucide` rule beside it sets the stroke width. A size class on an icon (`size-8`) still wins.

## An app with no `.tau/DESIGN.md`
An older app may have only the palette blocks, in neutral grey. Give it a real palette: pick one accent that suits the subject, tint the neutrals slightly toward it, and write both blocks. Everything else in this guide applies.
