# Images and assets guide

When the app needs real imagery — product photos, hero and background images, brand logos, textures — get it with the asset tools. Do not guess at image URLs, and do not hotlink links found through `web_search`: guessed URLs are usually dead, and a hotlinked image can vanish or be blocked at any time.

## The four steps
1. **Search.** `search_images("<precise query>")` returns candidate image URLs, each with a description of what the image actually shows. Write the query for the use: the subject, plus what matters — `transparent PNG`, `front view`, `wide`, the exact product name. For example `"Diet Coke can transparent PNG front view"`.
2. **Choose by description.** Read the descriptions and pick the right one: the correct subject, a photograph rather than a vector logo (or the reverse), and a transparent background when you need a cut-out. Discard anything that does not match. If nothing matches, search again with a better query.
3. **Check the size.** `image_dimensions("<url>")` returns the width, height and format without downloading the file. A full-width hero or a background needs a large image; a thumbnail does not.
4. **Save it into the project.** `download_asset(url, "public/<name>.<ext>")`, then use it by its local path: a file saved as `public/hero.jpg` is `/hero.jpg` in the app.

## Rules
- **Use `download_asset`, never `curl`, for anything you want to keep.** A file fetched with `curl` exists only in the sandbox and is gone the next time it is rebuilt. `download_asset` saves it with the project: it survives reloads, shows in the file tree and is included when the project is pushed to GitHub.
- `search_images` and `image_dimensions` need no sandbox. `download_asset` writes into the project, so it needs one.
- Keep downloaded files under `public/`, named for what they show (`hero-mountains.jpg`, not `image1.jpg`).
- Give every `<img>` an `alt` that describes it, or `alt=""` if it is purely decorative.
- Give an image a fixed aspect ratio or explicit width and height, so the page does not jump when it loads. Use `object-cover` when it has to fill a box.
- For interface icons — arrows, menus, checkmarks — use `lucide-react`, which is installed. The asset tools are for pictures and brand marks.

## When nothing suitable turns up
Do not use a mismatched or low-resolution image, and do not leave a broken one. Build that spot from the theme instead — a block of color, a gradient made from the theme tokens, a pattern — and tell the user which image they may want to supply.
