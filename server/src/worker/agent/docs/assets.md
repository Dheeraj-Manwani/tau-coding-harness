# Images and assets guide

When the app needs real imagery — product photos, hero and background images, brand logos, textures — get it with the asset tools. Do not guess at image URLs, and do not hotlink links found through `web_search`: guessed URLs are usually dead, and a hotlinked image can vanish or be blocked at any time.

## The four steps
1. **Search.** `search_images("<precise query>")` returns candidate image URLs, each with a description of what the image actually shows. Write the query for the use: the subject, plus what matters — `transparent PNG`, `front view`, `wide`, the exact product name. For example `"Diet Coke can transparent PNG front view"`.
2. **Choose by description.** Read the descriptions and pick the right one: the correct subject, a photograph rather than a vector logo (or the reverse), and a transparent background when you need a cut-out. Discard anything that does not match, and anything whose description or URL suggests a watermark or a stock-site preview (`shutterstock`, `istockphoto`, `gettyimages`, `vecteezy`, `alamy`, `dreamstime`, `123rf`, `depositphotos`, "watermark", "preview"). If nothing matches, search again with a better query.
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

## Making a picture instead
`generate_image(prompt, "public/<name>.jpg", aspect_ratio)` makes one and saves it into the project. It costs money and a run has only a few, so it is for what search cannot give you:
- **Artwork for an app whose look is made of it.** If `.tau/DESIGN.md` says to generate the artwork (Surrealism, Maximalism, Ethereal, Conceptual sketch), make the hero picture and one or two more with it rather than searching. The style's art direction and the app's main colour are added for you, so the pictures match.
- **A hero for a subject with no good photographs**, after a search turned up nothing usable.

Not for logos, text, charts, screenshots, icons, or a photograph of a real product, place or person: search for those. Describe the subject, the setting, the light and the mood in a sentence or two; never ask for words in the picture. Use the `path` it returns, give the `<img>` an `alt`, and set `aspect-ratio` and `object-cover` as for any image. If it says the run has made its pictures, or is not available, carry on with search and the theme.
