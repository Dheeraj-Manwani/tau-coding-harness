# Theme guide — colors, radius, light and dark

Every color in the app is a CSS variable in `src/index.css`. Components never name a color; they use the token.

## How `src/index.css` is laid out
- `:root { … }` holds the **light** palette, and `--radius`.
- `.dark { … }` holds the **dark** palette. The app is dark by default because `index.html` has `<html class="dark">`.
- `@theme inline { … }` maps each variable to a Tailwind color (`--color-primary: var(--primary)`). That mapping is what makes `bg-primary` exist. Leave it alone unless you add a token.

Keep that shape: both blocks, one flat `--name: value;` per line, every color a **hex** value (`#1a1a1a`). The user can change colors from tau's theme panel, which finds a token by this shape and writes hex. Nested rules, a renamed block or a second color system break it.

## The tokens
- `background` / `foreground` — the page and the text on it.
- `card`, `popover`, each with a `-foreground` — raised surfaces and their text.
- `primary` / `primary-foreground` — the main action and the app's own color. One per app.
- `secondary`, `muted`, `accent`, each with a `-foreground` — quieter fills: secondary buttons, subdued areas and captions, hover states.
- `destructive` — delete and error.
- `border`, `input`, `ring` — lines, field outlines, the focus ring.
- `chart-1` … `chart-5` — data series.
- `sidebar-*` — a sidebar, when the app has one.

## Choosing a palette
The palette the app starts with is neutral grayscale. It is a blank, not a design: an app left on it looks unfinished.

On the first build, before any UI:
1. Decide what the app is and who it is for, and pick colors that suit that — not the first blue that comes to mind.
2. Pick **one** primary. Build the surfaces from a neutral tinted slightly toward it, unless the app calls for pure gray.
3. Write **both** blocks, light and dark, so a theme switch works later without rework.
4. Check each pair: text in an `x-foreground` color must be easy to read on `x` (aim for a contrast ratio of 4.5:1), and `muted-foreground` must stay readable on `background`.
5. Make the five chart colors clearly different from each other and at home next to the primary.
6. Set `--radius` to match the feel: `0` is sharp, `0.5rem` moderate, `1rem` soft. Every component's roundness follows from it.

## In components
- Use the token classes: `bg-background`, `text-foreground`, `bg-card`, `bg-primary`, `text-primary-foreground`, `text-muted-foreground`, `border-border`, and so on.
- Never hardcode a color in a component: no hex, no `bg-[#1db954]`, no `text-blue-500`. Those do not follow a theme change and do not switch between light and dark.
- Opacity variants of a token are fine: `bg-primary/10`, `border-border/50`.
- If a color the design needs has no token, add one: declare it in both `:root` and `.dark`, then map it in `@theme inline` as `--color-<name>: var(--<name>);`.

## Light and dark
- For a light app, remove `class="dark"` from `<html>` in `index.html`.
- A theme switch toggles the `dark` class on `document.documentElement` and saves the choice in `localStorage`. Apply the saved choice before the app renders, or the page flashes the wrong theme on load.

## Changing the look later
Change the values in `src/index.css`. Do not restyle components one at a time to change a color — that is what the tokens are for.
