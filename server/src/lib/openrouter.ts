import { env } from "@/lib/env";
import { Gate } from "@/lib/kimi";

/**
 * Image generation, through OpenRouter.
 *
 * tau's two text providers cannot make pictures: DeepSeek's API is text only,
 * and Kimi reads images but writes text. OpenRouter fronts the image models of
 * several makers behind one key and one request shape, so a model can be
 * changed with `IMAGE_MODEL` and nothing else.
 *
 * The default is ByteDance's Seedream 5.0 Flash. Measured on the same prompt
 * against Seedream 5.0 Lite: half the price ($0.018 a picture against $0.035),
 * about as fast (15 to 18 seconds), and it followed the prompt better — asked
 * for a teapot floating above a lake, Flash floated it and Lite stood it on the
 * water. A picture is 14,400 image tokens at 2560x1440 for 16:9 whatever size
 * is asked for, so the price is flat.
 *
 * The request is a chat completion that asks for an image back
 * (`modalities: ["image"]`), and the picture arrives as a data URI.
 */

/** Aspect ratios the models take. Anything else is asked for as 16:9. */
export const IMAGE_ASPECTS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
export type ImageAspect = (typeof IMAGE_ASPECTS)[number];

export function isImageAspect(value: unknown): value is ImageAspect {
  return typeof value === "string" && (IMAGE_ASPECTS as readonly string[]).includes(value);
}

/** Whether pictures can be made on this installation. */
export function imageGenerationAvailable(): boolean {
  return Boolean(env.OPEN_ROUTER_API_KEY);
}

/** Pictures being made at once, across every build in this process. */
const gate = new Gate(env.IMAGE_MAX_CONCURRENT);

const TIMEOUT_MS = 90_000;

export interface GeneratedImage {
  bytes: Uint8Array;
  mimeType: string;
  /** What the call used, in the shape `meterModelCall` takes. */
  usage: { model: string; inputTokens: number; outputTokens: number };
  /** What OpenRouter says it cost, in US dollars. For the log; billing uses the token counts. */
  costUsd: number | null;
}

/** Picture bytes out of a `data:` URI; null for anything else. */
export function readDataUri(uri: string): { bytes: Uint8Array; mimeType: string } | null {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(uri);
  if (!m) return null;
  const bytes = Buffer.from(m[2]!, "base64");
  return bytes.length > 0 ? { bytes, mimeType: m[1]!.toLowerCase() } : null;
}

/**
 * Make one picture. Throws a readable error when it cannot: no key, a refusal
 * from the model, a timeout, a reply with no picture in it.
 */
export async function generateImage(
  prompt: string,
  aspect: ImageAspect = "16:9",
  fetcher: typeof fetch = fetch,
): Promise<GeneratedImage> {
  const key = env.OPEN_ROUTER_API_KEY;
  if (!key) throw new Error("Image generation is not set up on this tau instance.");
  const model = env.IMAGE_MODEL;

  const res = await gate.run(() =>
    fetcher(`${env.OPEN_ROUTER_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        modalities: ["image"],
        messages: [{ role: "user", content: prompt }],
        image_config: { aspect_ratio: aspect },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  );

  const text = await res.text();
  let json: {
    choices?: { message?: { content?: unknown; images?: { image_url?: { url?: string } }[] } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
  };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`The image service answered ${res.status} with something unreadable.`);
  }
  if (!res.ok) {
    throw new Error(`The image service refused the request (${res.status}): ${json.error?.message ?? "no reason given"}`.slice(0, 300));
  }

  const picture = json.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  const read = picture ? readDataUri(picture) : null;
  if (!read) {
    const said = json.choices?.[0]?.message?.content;
    throw new Error(
      `The image service returned no picture${typeof said === "string" && said ? `: ${said.slice(0, 160)}` : "."} It may have declined the prompt; describe the picture differently.`,
    );
  }
  return {
    ...read,
    usage: {
      model,
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
    },
    costUsd: typeof json.usage?.cost === "number" ? json.usage.cost : null,
  };
}
