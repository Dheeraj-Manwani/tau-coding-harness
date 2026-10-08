import { describe, expect, test } from "bun:test";
import { env } from "@/lib/env";
import { costMicro } from "@/lib/pricing";
import { IMAGE_ASPECTS, generateImage, imageGenerationAvailable, isImageAspect, readDataUri } from "@/lib/openrouter";
import { artDirection, fullPrompt, imagePath } from "@/worker/agent/tools/functions/generate-image";
import { BASE_APP_TOOLS } from "@/worker/agent/tools/tools";
import { designFiles, resolveDesign } from "@/worker/design";
import { STYLES } from "@/worker/design/styles";
import type { StyleKey } from "@/worker/design/types";

// Pictures come from an image model through OpenRouter (lib/openrouter.ts) and
// are saved into the project like a downloaded asset. Nothing here calls the
// real service.

const designOf = (style: StyleKey, accent = "#9b8cf0", mode: "light" | "dark" = "light") =>
  designFiles(
    resolveDesign({ style, accent, accentExact: false, mode, dials: STYLES[style].dials, read: "Reading this as: a page.", source: "director" }),
    { fontsInstalled: true },
  ).designMd;

const PNG = Buffer.from("iVBORw0KGgo=", "base64");
const reply = (over: object = {}) =>
  JSON.stringify({
    choices: [{ message: { content: null, images: [{ image_url: { url: `data:image/png;base64,${PNG.toString("base64")}` } }] } }],
    usage: { prompt_tokens: 54, completion_tokens: 14400, cost: 0.018 },
    ...over,
  });
const answering = (status: number, body: string) =>
  (async () => new Response(body, { status })) as unknown as typeof fetch;

describe("reading a picture out of a reply", () => {
  test("takes the bytes and the type from a data URI, and nothing else", () => {
    const got = readDataUri(`data:image/PNG;base64,${PNG.toString("base64")}`)!;
    expect(got.mimeType).toBe("image/png");
    expect([...got.bytes]).toEqual([...PNG]);
    expect(readDataUri("https://example.com/a.png")).toBeNull();
    expect(readDataUri("data:image/png;base64,")).toBeNull();
    expect(readDataUri("data:text/html,<b>x</b>")).toBeNull();
  });

  test("aspect ratios are a short list, and anything else is not one", () => {
    for (const a of IMAGE_ASPECTS) expect(isImageAspect(a)).toBe(true);
    expect(isImageAspect("5:7")).toBe(false);
    expect(isImageAspect(1)).toBe(false);
  });
});

describe("asking the service for a picture", () => {
  test("without a key there is nothing to ask, and it says so", async () => {
    if (env.OPEN_ROUTER_API_KEY) return; // this machine has one: the other tests cover the call
    expect(imageGenerationAvailable()).toBe(false);
    await expect(generateImage("a lake", "16:9", answering(200, reply()))).rejects.toThrow("not set up");
  });

  test("a good reply is a picture, its type, and what it used", async () => {
    if (!env.OPEN_ROUTER_API_KEY) return;
    let sent: { url: string; body: Record<string, unknown> } | null = null;
    const spy = (async (url: string, init: RequestInit) => {
      sent = { url, body: JSON.parse(String(init.body)) };
      return new Response(reply());
    }) as unknown as typeof fetch;
    const made = await generateImage("a lake at dusk", "4:3", spy);
    expect(made.mimeType).toBe("image/png");
    expect(made.usage).toEqual({ model: env.IMAGE_MODEL, inputTokens: 54, outputTokens: 14400 });
    expect(made.costUsd).toBe(0.018);
    expect(sent!.url).toBe(`${env.OPEN_ROUTER_BASE_URL.replace(/\/+$/, "")}/chat/completions`);
    expect(sent!.body.modalities).toEqual(["image"]);
    expect(sent!.body.image_config).toEqual({ aspect_ratio: "4:3" });
  });

  test("a refusal, an error and an empty reply are each an error that says what happened", async () => {
    if (!env.OPEN_ROUTER_API_KEY) return;
    await expect(generateImage("x", "16:9", answering(402, JSON.stringify({ error: { message: "Insufficient credits" } })))).rejects.toThrow("Insufficient credits");
    await expect(generateImage("x", "16:9", answering(200, "not json"))).rejects.toThrow("unreadable");
    await expect(
      generateImage("x", "16:9", answering(200, JSON.stringify({ choices: [{ message: { content: "I can't make that." } }] }))),
    ).rejects.toThrow("I can't make that.");
  });
});

describe("what a picture is told, and where it is kept", () => {
  test("a style made of artwork gives its direction and the app's colour; a plain one gives only the colour", () => {
    const sketch = artDirection(designOf("sketch", "#e4572e"));
    expect(sketch).toContain("pen-and-ink");
    expect(sketch).toContain("#e4572e");
    expect(artDirection(designOf("swiss", "#e2401c"))).toBe("A palette that suits #e2401c as the main colour");
    expect(artDirection(designOf("ethereal", "#9b8cf0", "dark"))).toContain("darker, moodier");
    expect(artDirection(null)).toBe("");
    expect(artDirection("# Somebody else's design")).toBe("");
  });

  test("the prompt is the direction, the description, and the rule against text in the picture", () => {
    const prompt = fullPrompt("A teapot above a lake.", "Surrealist oil painting");
    expect(prompt.startsWith("Art direction: Surrealist oil painting.")).toBe(true);
    expect(prompt).toContain("A teapot above a lake.");
    expect(prompt).toContain("No text, letters");
    expect(fullPrompt("A teapot.", "")).not.toContain("Art direction");
  });

  test("the file goes under public/, and its extension is the picture's, not the one asked for", () => {
    expect(imagePath("public/hero.png", "image/jpeg")).toBe("public/hero.jpg");
    expect(imagePath("public/hero.jpg", "image/png")).toBe("public/hero.png");
    expect(imagePath("/hero", "image/webp")).toBe("public/hero.webp");
    expect(imagePath("assets/deep/lake.jpeg", "image/jpeg")).toBe("public/lake.jpg");
    expect(imagePath("public/a/b.gif", "image/jpeg")).toBe("public/a/b.jpg");
  });
});

describe("pictures as a tool, and as a cost", () => {
  test("is a tool on new projects, told what it is for and what it is not", () => {
    const tool = BASE_APP_TOOLS.find((t) => t.function.name === "generate_image")!;
    expect(tool.function.description).toContain("`search_images` cannot find");
    expect(tool.function.description).toContain("Not for logos, text, charts");
    expect(Object.keys(tool.function.parameters.properties)).toEqual(["prompt", "path", "aspect_ratio"]);
    expect(tool.function.parameters.required).toEqual(["prompt", "path"]);
  });

  test("a picture costs about eighteen credits, near its price and a little over", () => {
    // 14,400 output tokens at $0.018. Credits run at roughly a thousand to the dollar.
    const micro = costMicro("bytedance-seed/seedream-5-0-flash", 54, 14_400);
    const credits = Number(micro) / 1_000_000;
    expect(credits).toBeGreaterThan(17);
    expect(credits).toBeLessThan(21);
  });

  test("the four styles that are made of artwork each say how it is drawn", () => {
    for (const key of ["surrealism", "maximalism", "ethereal", "sketch"] as const) {
      const style = STYLES[key];
      expect(style.art!.length).toBeGreaterThan(80);
      expect(style.reach).toBe("niche");
      expect(style.prose.dos.join(" ")).toContain("generate_image");
    }
    // The styles that find their pictures do not tell the agent to make them.
    for (const key of ["swiss", "craft", "scrapbook", "victorian"] as const) expect(STYLES[key].art).toBeUndefined();
  });
});
