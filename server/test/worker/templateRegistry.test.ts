import { describe, expect, test } from "bun:test";
import {
  BASE_TEMPLATE_KEY,
  DEFAULT_TEMPLATE_KEY,
  IMAGE_KEYS,
  TEMPLATES,
  TEMPLATE_KEYS,
  imageKeyFor,
  isSelectableTemplateKey,
  resolveTemplateKey,
} from "@/worker/templates/registry";

// Two template generations live side by side (doc/CONTEXT_AND_MEMORY_PLAN.md
// §6): production projects boot from the three generation-1 images, new work
// goes onto the single generation-2 base image. Everything here is about
// keeping those two from bleeding into each other.

describe("the generation-2 base template", () => {
  test("is published under its own image name", () => {
    const base = TEMPLATES[BASE_TEMPLATE_KEY];
    expect(base.generation).toBe(2);

    // Building a template replaces the image under its name for every sandbox
    // created afterwards. Sharing a name with a generation-1 template would
    // overwrite an image existing projects boot from.
    const legacyNames = TEMPLATE_KEYS.filter(
      (k) => TEMPLATES[k].generation === 1,
    ).map((k) => TEMPLATES[k].e2bName);
    expect(legacyNames).not.toContain(base.e2bName);
  });

  test("starts frontend-only", () => {
    expect(TEMPLATES[BASE_TEMPLATE_KEY].hasServer).toBe(false);
    expect(TEMPLATES[BASE_TEMPLATE_KEY].hasDb).toBe(false);
  });

  test("leaves the generation-1 image names exactly as they were", () => {
    expect(TEMPLATES.frontend.e2bName).toBe("vite-spa-app");
    expect(TEMPLATES.fullstack.e2bName).toBe("vite-hono-app");
    expect(TEMPLATES["fullstack-db"].e2bName).toBe("vite-hono-db-app");
  });
});

describe("generation-2 stack levels", () => {
  const levels = ["v2-frontend", "v2-fullstack", "v2-fullstack-db"] as const;

  test("are one image, not three", () => {
    // A backend or a database is added inside the running sandbox. If the
    // levels named different images, moving up one would mean rebuilding the
    // app on another image — the thing generation 2 exists to avoid.
    const names = new Set(levels.map((k) => TEMPLATES[k].e2bName));
    expect([...names]).toEqual([TEMPLATES[BASE_TEMPLATE_KEY].e2bName]);
    for (const key of levels) expect(TEMPLATES[key].generation).toBe(2);
  });

  test("describe what the app has at each level", () => {
    expect(TEMPLATES["v2-frontend"]).toMatchObject({ hasServer: false, hasDb: false });
    expect(TEMPLATES["v2-fullstack"]).toMatchObject({ hasServer: true, hasDb: false });
    expect(TEMPLATES["v2-fullstack-db"]).toMatchObject({ hasServer: true, hasDb: true });
  });

  test("build and smoke-test once per image, against the image as published", () => {
    expect(IMAGE_KEYS).toEqual([
      "frontend",
      "fullstack",
      "fullstack-db",
      "v2-frontend",
    ]);
    // The published image is the bare frontend one: checking it against the
    // `v2-fullstack` flags would look for a server it deliberately lacks.
    for (const key of levels) expect(imageKeyFor(key)).toBe("v2-frontend");
    expect(imageKeyFor("fullstack-db")).toBe("fullstack-db");
  });

  test("none of them is the model's to pick", () => {
    for (const key of levels) expect(isSelectableTemplateKey(key)).toBe(false);
  });
});

describe("isSelectableTemplateKey", () => {
  test("accepts the three stacks the agent may choose between", () => {
    expect(isSelectableTemplateKey("frontend")).toBe(true);
    expect(isSelectableTemplateKey("fullstack")).toBe(true);
    expect(isSelectableTemplateKey("fullstack-db")).toBe(true);
  });

  test("rejects a generation-2 key — that is never the model's to pick", () => {
    expect(isSelectableTemplateKey(BASE_TEMPLATE_KEY)).toBe(false);
  });

  test("rejects junk", () => {
    expect(isSelectableTemplateKey("nextjs")).toBe(false);
    expect(isSelectableTemplateKey(undefined)).toBe(false);
  });
});

describe("resolveTemplateKey", () => {
  test("a locked project keeps its stored key whatever else is going on", () => {
    // The whole point of the lock: files were scaffolded against one image and
    // must never be rehydrated onto another. Neither the deployment's
    // generation nor the agent's request may move it.
    for (const newProjectGeneration of [1, 2] as const) {
      expect(
        resolveTemplateKey({
          storedKey: "fullstack-db",
          locked: true,
          newProjectGeneration,
          requested: "frontend",
        }),
      ).toBe("fullstack-db");
      expect(
        resolveTemplateKey({
          storedKey: BASE_TEMPLATE_KEY,
          locked: true,
          newProjectGeneration,
        }),
      ).toBe(BASE_TEMPLATE_KEY);
    }
  });

  test("generation 1: a new project gets what the agent asked for", () => {
    expect(
      resolveTemplateKey({
        storedKey: "fullstack",
        locked: false,
        newProjectGeneration: 1,
        requested: "frontend",
      }),
    ).toBe("frontend");
  });

  test("generation 1: with no request, falls back to the stored key", () => {
    expect(
      resolveTemplateKey({
        storedKey: "fullstack",
        locked: false,
        newProjectGeneration: 1,
      }),
    ).toBe("fullstack");
    expect(
      resolveTemplateKey({
        storedKey: "not-a-template",
        locked: false,
        newProjectGeneration: 1,
      }),
    ).toBe(DEFAULT_TEMPLATE_KEY);
  });

  test("generation 2: a new project gets the base template, request or not", () => {
    // `Project.templateKey` defaults to "fullstack" in the schema, so a brand
    // new row always arrives here with a generation-1 key stored.
    expect(
      resolveTemplateKey({
        storedKey: "fullstack",
        locked: false,
        newProjectGeneration: 2,
      }),
    ).toBe(BASE_TEMPLATE_KEY);
    expect(
      resolveTemplateKey({
        storedKey: "fullstack",
        locked: false,
        newProjectGeneration: 2,
        requested: "fullstack-db",
      }),
    ).toBe(BASE_TEMPLATE_KEY);
  });
});
