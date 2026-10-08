# Restyle guide — bringing the screens in line with a new design

The app's style has been changed. tau has already rewritten `src/index.css` (the palette, the typefaces, the shapes of buttons, cards, fields, badges, tabs and dialogs) and `.tau/DESIGN.md`. **Neither is yours to redo.** What is left is the part only you can do: the screens' own layout and the places they ignore the design. The user has asked you to do it, so do it fully.

## 1. Read before you touch anything
- `.tau/DESIGN.md`: the style, the layouts it allows, the opening layout it names, the rules, and the notes section at the end.
- `src/index.css`: skim the `@layer skin` block, so you know what the components now do by themselves.
- The files of every screen. List them with `list_files src/pages src/components` and read each one, so you change what is there rather than what you remember.

## 2. Keep what the app is
Every feature, every piece of content, every route, every piece of data stays. This is a change of how things look and are arranged, not of what they do. If a screen cannot be arranged the new way without losing something, keep the content and say so afterwards.

## 3. What to change, in order
1. **Strip what fights the skin.** Search the screens for classes that set a radius, border, shadow, font, height or casing on a `Button`, `Card`, `Input`, `Badge`, `Tabs` or `Dialog`, and remove them: the skin decides those now. Remove hard-coded colours and Tailwind palette colours (`bg-blue-500`, `#fff`) for tokens.
2. **Open the first screen with the layout `DESIGN.md` names**, built as `layouts` describes. Arrange the other screens in other layouts from the allowed list, chosen for what each holds.
3. **Match the density and motion** the file asks for: spacing between sections, how much is on a screen, what moves.
4. **Fix the type.** Headings use the heading face by themselves; remove font-family overrides, and any size and weight choices that were made for the old typeface.
5. **Re-check images and icons.** Icons take the style's stroke and size by default; remove size classes that were there only to make them fit the old look.

## 4. What not to do
- Do not edit `src/index.css` to fit a screen. If something in it looks wrong, change the screen. The exception is something the app genuinely needs that the design does not provide, which is added in the way `theme` describes and noted under `## Notes for this app` in `.tau/DESIGN.md`.
- Do not change `.tau/DESIGN.md` except to add a note.
- Do not rewrite a screen that already fits. If it already follows the design, leave it.
- Do not install a component library, an icon set or a font to get closer to the old look.

## 5. Check your work
The checks tau runs on files you save will report anything that breaks the design. After the screens are done, call `dispatch_design_reviewer` for the main routes and fix what it marks `[broken]`. Finish with one sentence for the user on what changed.
