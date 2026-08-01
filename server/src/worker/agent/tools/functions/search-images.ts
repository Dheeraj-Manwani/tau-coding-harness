import { env } from "@/lib/env";
import { asString } from "./utils";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 15_000;
const MAX_IMAGES = 10;

/**
 * Tavily's image results. With `include_image_descriptions` the `images` array
 * is objects `{ url, description }`; without it, it's a bare `string[]`. We
 * always request descriptions, but tolerate both shapes so a provider change
 * can't crash the tool.
 */
interface TavilyImage {
  url: string;
  description?: string;
}

interface TavilyImageSearchResponse {
  images?: Array<TavilyImage | string>;
}

/**
 * Find real image URLs for a query, each already described by Tavily's vision
 * pass — so the agent can tell a photo of a can from a vector logo, read the
 * brand, and check for a transparent background *without* downloading anything.
 * This is the asset-finding primitive: search here, pick by description, verify
 * resolution with `image_dimensions`, then `curl` the winner into the project.
 *
 * Modeled on {@link webSearch}; same fetch/timeout/error contract. Needs no
 * sandbox — it's a plain network call.
 */
export async function searchImages(input: unknown) {
  const { query, max_results: rawMaxResults } = input as {
    query?: unknown;
    max_results?: unknown;
  };
  const q = asString(query, "query");
  const maxResults =
    typeof rawMaxResults === "number" && rawMaxResults > 0
      ? Math.min(rawMaxResults, MAX_IMAGES)
      : 5;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.TAVILY_API_KEY,
        query: q,
        // We only want the image sidecar, so keep the (billed) text results
        // minimal — but Tavily requires a positive max_results.
        max_results: 1,
        include_images: true,
        include_image_descriptions: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `Tavily image search failed (${res.status}): ${body}` };
    }

    const data = (await res.json()) as TavilyImageSearchResponse;
    const images = (data.images ?? [])
      .map((img) =>
        typeof img === "string"
          ? { url: img, description: null }
          : { url: img.url, description: img.description ?? null },
      )
      .filter((img) => typeof img.url === "string" && img.url.length > 0)
      .slice(0, maxResults);

    if (images.length === 0) {
      return {
        images: [],
        note: "No images found. Try a more specific query, e.g. add 'transparent PNG', 'front view', or the exact product name.",
      };
    }

    return { images };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Image search timed out after ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return { error: message };
  } finally {
    clearTimeout(timeout);
  }
}
