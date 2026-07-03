import { env } from "@/lib/env";
import { asString } from "./utils";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const TIMEOUT_MS = 15_000;

interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

interface TavilyResponse {
  answer?: string;
  results: TavilyResult[];
}

export async function webSearch(input: unknown) {
  const { query, max_results: rawMaxResults } = input as {
    query?: unknown;
    max_results?: unknown;
  };
  const q = asString(query, "query");
  const maxResults =
    typeof rawMaxResults === "number" && rawMaxResults > 0
      ? Math.min(rawMaxResults, 10)
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
        max_results: maxResults,
        include_answer: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { error: `Tavily search failed (${res.status}): ${body}` };
    }

    const data = (await res.json()) as TavilyResponse;
    return {
      answer: data.answer ?? null,
      results: data.results.map((r) => ({
        title: r.title,
        url: r.url,
        content: r.content,
      })),
    };
  } catch (err) {
    const message =
      err instanceof Error && err.name === "AbortError"
        ? `Search timed out after ${TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    return { error: message };
  } finally {
    clearTimeout(timeout);
  }
}
