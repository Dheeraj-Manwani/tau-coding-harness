import { describe, expect, test } from "bun:test";
import {
  applyIdentity,
  isPng,
  logoFileProblem,
  readIdentity,
  LOGO_MAX_BYTES,
} from "@/api/lib/appIdentity";
import { APP_ICON_LINK_TAG } from "@/worker/templates/shared";

// What a published app calls itself. Pure edits of index.html, so the Publish
// panel's "Name and logo" step needs no model and no sandbox to be tested.

const SCAFFOLD = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>vite-react-ts</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

const WITH_ICON = SCAFFOLD.replace("</head>", `    ${APP_ICON_LINK_TAG}\n  </head>`);

const EVERYTHING = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Old name</title>
<meta content="Old words" name="description">
<meta property="og:title" content="Old name">
<meta property="og:description" content="Old words">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/old.png">
</head>
<body></body>
</html>
`;

const count = (html: string, needle: RegExp) => (html.match(needle) ?? []).length;

describe("readIdentity", () => {
  test("reads the scaffold: a title, nothing else", () => {
    expect(readIdentity(SCAFFOLD)).toEqual({ title: "vite-react-ts", description: null, icon: null });
  });

  test("reads tags whatever order their attributes are in", () => {
    expect(readIdentity(EVERYTHING)).toEqual({ title: "Old name", description: "Old words", icon: "default" });
  });

  test("tells tau's icon from a custom logo from someone else's", () => {
    expect(readIdentity(WITH_ICON).icon).toBe("default");
    expect(readIdentity(SCAFFOLD.replace("</head>", `<link rel="icon" href="/favicon.png"></head>`)).icon).toBe("custom");
    expect(readIdentity(SCAFFOLD.replace("</head>", `<link rel="icon" href="/x.ico"></head>`)).icon).toBe("other");
  });

  test("gives back what was typed, not its escaped form", () => {
    const html = applyIdentity(SCAFFOLD, { title: `Tom & "Jerry" <3` });
    expect(readIdentity(html).title).toBe(`Tom & "Jerry" <3`);
  });
});

describe("applyIdentity", () => {
  test("sets the title, description and the share tags on the scaffold", () => {
    const out = applyIdentity(SCAFFOLD, { title: "Kurinji Leaf", description: "Loose-leaf tea." });

    expect(out).toContain("<title>Kurinji Leaf</title>");
    expect(out).toContain(`<meta name="description" content="Loose-leaf tea." />`);
    expect(out).toContain(`<meta property="og:title" content="Kurinji Leaf" />`);
    expect(out).toContain(`<meta property="og:description" content="Loose-leaf tea." />`);
    expect(out).toContain(`<meta property="og:type" content="website" />`);
    expect(out).toContain(`<meta name="twitter:card" content="summary" />`);
    // The rest of the page is exactly as it was.
    expect(out).toContain(`<meta name="viewport" content="width=device-width, initial-scale=1.0" />`);
    expect(out).toContain(`<div id="root"></div>`);
    expect(count(out, /<title>/g)).toBe(1);
  });

  test("replaces every tag that already exists instead of adding a second", () => {
    const out = applyIdentity(EVERYTHING, { title: "New name", description: "New words" });

    for (const needle of [/<title>/g, /name="description"/g, /og:title/g, /og:description/g, /og:type/g, /twitter:card/g]) {
      expect(count(out, needle)).toBe(1);
    }
    expect(out).toContain("<title>New name</title>");
    expect(out).toContain(`content="New words"`);
    expect(out).not.toContain("Old");
    expect(out).toContain(`<meta property="og:type" content="website" />`);
  });

  test("is idempotent on its own output", () => {
    const change = { title: "Kurinji Leaf", description: "Loose-leaf tea." };
    for (const input of [SCAFFOLD, WITH_ICON, EVERYTHING]) {
      const once = applyIdentity(input, change);
      expect(applyIdentity(once, change)).toBe(once);
    }
    const logo = { title: "A", icon: "custom" as const, siteUrl: "https://a.example" };
    const once = applyIdentity(EVERYTHING, logo);
    expect(applyIdentity(once, logo)).toBe(once);
  });

  test("escapes what the owner typed, so it cannot close a tag", () => {
    const out = applyIdentity(SCAFFOLD, {
      title: `</title><script>alert(1)</script>`,
      description: `"><img src=x onerror=alert(1)> & more`,
    });

    expect(out).not.toContain("<script>");
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;/title&gt;&lt;script&gt;");
    expect(out).toContain(`content="&quot;&gt;&lt;img src=x onerror=alert(1)&gt; &amp; more"`);
    expect(count(out, /<title>/g)).toBe(1);
  });

  test("leaves a page with no </head> alone", () => {
    const html = "<html><body>hi</body></html>";
    expect(applyIdentity(html, { title: "x", description: "y", icon: "custom" })).toBe(html);
  });

  test("changes only what it was asked to", () => {
    const out = applyIdentity(EVERYTHING, { description: "Only this." });
    expect(out).toContain("<title>Old name</title>");
    expect(out).toContain(`<meta property="og:title" content="Old name">`);
    expect(out).toContain(`content="Only this."`);
    expect(out).toContain("/old.png");
  });

  test("an empty description is kept as empty, with no empty share tag", () => {
    const out = applyIdentity(SCAFFOLD, { title: "A", description: "" });
    expect(out).toContain(`<meta name="description" content="" />`);
    expect(out).not.toContain("og:description");
  });

  describe("icons", () => {
    test("a custom logo swaps the icon links and drops the old touch icon", () => {
      const out = applyIdentity(EVERYTHING, { icon: "custom" });

      expect(out).toContain(`<link rel="icon" type="image/png" href="/favicon.png" />`);
      expect(out).toContain(`<link rel="apple-touch-icon" href="/icon-512.png" />`);
      expect(out).not.toContain("favicon.svg");
      expect(out).not.toContain("old.png");
      expect(count(out, /rel="icon"/g)).toBe(1);
      expect(count(out, /apple-touch-icon/g)).toBe(1);
      expect(readIdentity(out).icon).toBe("custom");
    });

    test("a page with no icon gets one", () => {
      expect(applyIdentity(SCAFFOLD, { icon: "default" })).toContain(APP_ICON_LINK_TAG);
      expect(applyIdentity(SCAFFOLD, { icon: "custom" })).toContain("/favicon.png");
    });

    test("going back to the default removes the custom links", () => {
      const custom = applyIdentity(WITH_ICON, { icon: "custom" });
      const back = applyIdentity(custom, { icon: "default" });
      expect(back).toContain(APP_ICON_LINK_TAG);
      expect(back).not.toContain("favicon.png");
      expect(back).not.toContain("apple-touch-icon");
    });

    test("og:image is written only for a custom logo, and only with an address", () => {
      expect(applyIdentity(SCAFFOLD, { icon: "custom" })).not.toContain("og:image");
      expect(applyIdentity(SCAFFOLD, { icon: "default", siteUrl: "https://a.example" })).not.toContain("og:image");

      const out = applyIdentity(SCAFFOLD, { icon: "custom", siteUrl: "https://a.example/" });
      expect(out).toContain(`<meta property="og:image" content="https://a.example/icon-512.png" />`);

      // Dropping the logo drops the share picture with it.
      expect(applyIdentity(out, { icon: "default" })).not.toContain("og:image");
    });
  });
});

describe("logo files", () => {
  const png = (n = 16) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n).fill(1)]);

  test("a PNG is recognised by its signature, not its name", () => {
    expect(isPng(png())).toBe(true);
    expect(isPng(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(false);
    expect(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(isPng(new Uint8Array())).toBe(false);
  });

  test("refuses an empty, oversized or non-PNG file, and says which", () => {
    expect(logoFileProblem(png(), "icon")).toBeNull();
    expect(logoFileProblem(new Uint8Array(), "icon")).toContain("empty");
    expect(logoFileProblem(png(LOGO_MAX_BYTES), "icon")).toContain("300 KB");
    expect(logoFileProblem(new TextEncoder().encode("<svg/>"), "icon")).toContain("not a PNG");
  });

  test("the limit is inclusive", () => {
    expect(logoFileProblem(png(LOGO_MAX_BYTES - 8), "icon")).toBeNull();
  });
});
