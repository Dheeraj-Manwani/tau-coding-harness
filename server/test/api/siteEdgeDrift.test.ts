import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { env } from "@/lib/env";
import * as server from "@/lib/sites";
import { badgeScript, injectBeforeBodyEnd, siteBadgeTag } from "@/lib/badge";
import { recordJson, type RoutingRecord } from "@/lib/edgeRegistry";
import * as edge from "../../../edge/src/sites";
import * as edgeBadge from "../../../edge/src/badge";
import { BADGE_SOURCE } from "../../../edge/src/badgeSource";

// The edge router and the server serve the same sites by the same rules, and
// the router cannot import the server's code (it reads the server's
// environment). So the rules exist twice, and this is the one thing that keeps
// them from drifting: a table of inputs run through both. Change a rule in
// both places, or this fails.

const PATHS = [
  "",
  "/",
  "/index.html",
  "/assets/index-a1b2c3d4.js",
  "/assets/",
  "/settings/profile",
  "/settings/profile/",
  "/a/./b/../c.png",
  "/../secret",
  "/%2e%2e/secret",
  "/..%2f..%2fx",
  "/a%20b.txt",
  "/%E0%A4%A",
  "//double//slash//",
  "/trailing.dot.",
  "/dir.with.dot/",
  "/UPPER.JS",
  "/no-extension",
  "/.well-known/security.txt",
  "/file.tar.gz",
];

describe("the edge's serving rules are the server's", () => {
  test("normalizeSitePath", () => {
    for (const path of PATHS) expect(edge.normalizeSitePath(path)).toBe(server.normalizeSitePath(path));
  });

  test("siteObjectKey", () => {
    for (const path of PATHS) {
      expect(edge.siteObjectKey("tau/sites/u/p/d", path)).toBe(server.siteObjectKey("tau/sites/u/p/d", path));
    }
  });

  test("isValidSlug", () => {
    for (const slug of ["abc", "ab", "a-b", "-ab", "ab-", "a--b", "a_b", "A-b", "x".repeat(40), "x".repeat(41), "a.b", "ünï", "", "123", "my-app-ab12cd"]) {
      expect(edge.isValidSlug(slug)).toBe(server.isValidSlug(slug));
    }
  });

  test("slugFromHost", () => {
    const hosts = [
      "my-app.bytauai.pro",
      "MY-APP.bytauai.pro",
      "my-app.bytauai.pro:8080",
      "my-app.bytauai.pro.",
      "a.b.bytauai.pro",
      "bytauai.pro",
      ".bytauai.pro",
      "my-app.other.com",
      "xx.bytauai.pro",
      "my_app.bytauai.pro",
      "localhost:8080",
      undefined,
    ];
    for (const domain of ["bytauai.pro", undefined]) {
      for (const host of hosts) {
        expect(edge.slugFromHost(host, domain)).toBe(server.slugFromHost(host, domain));
      }
    }
  });

  test("contentTypeFor", () => {
    for (const path of ["index.html", "a.JS", "x.css", "m.wasm", "f.woff2", "noext", "weird.xyz", "a.b.svg", "/", ".gitignore", "image.WEBP", "site.webmanifest"]) {
      expect(edge.contentTypeFor(path)).toBe(server.contentTypeFor(path));
    }
  });

  test("cacheControlFor", () => {
    for (const path of ["index.html", "assets/index-a1b2c3d4.js", "assets/logo.svg", "assets/a-b.css", "assets/sub/index-AbCdEfGh.js", "other/index-a1b2c3d4.js", "assets/x-short.js"]) {
      expect(edge.cacheControlFor(path)).toBe(server.cacheControlFor(path));
    }
  });

  test("the prefix every deployment lives under", () => {
    expect(edge.SITE_PREFIX).toBe(server.SITE_PREFIX);
  });
});

describe("the edge's badge is the server's", () => {
  const PAGE = "<html><body><div id=root></div></body></html>";

  test("the script is the same bytes, so its hash is too", async () => {
    expect(BADGE_SOURCE).toBe(badgeScript().source);
    expect(await edgeBadge.badgeHash()).toBe(badgeScript().hash);
  });

  test("the tag that goes into a page", async () => {
    for (const slug of ["my-app", "a-b-c-123456"]) {
      expect(await edgeBadge.siteBadgeTag(slug, { LANDING_URL: env.LANDING_URL, APP_URL: env.APP_URL })).toBe(siteBadgeTag(slug));
    }
  });

  test("where it is inserted", () => {
    const tag = "<script src=x></script>";
    for (const html of [PAGE, "no body at all", "<BODY></BODY><body></body>", ""]) {
      expect(edgeBadge.injectBeforeBodyEnd(html, tag)).toBe(injectBeforeBodyEnd(html, tag));
    }
  });

  // A page the router badges must carry the same ETag as one the server badges,
  // or a cache holding one would revalidate against the other forever.
  test("the ETag variant", async () => {
    const tag = siteBadgeTag("my-app");
    const suffix = createHash("sha256").update(tag).digest("hex").slice(0, 8);
    expect(await edgeBadge.withVariant('"abc"', tag)).toBe(`"abc-tb${suffix}"`);
    expect(await edgeBadge.withVariant("W/abc", tag)).toBe(`W/abc-tb${suffix}`);
  });
});

describe("the routing record", () => {
  // The server writes a record and the router reads it; a field one side adds
  // and the other does not know is a field that silently does nothing.
  test("the router's type has exactly the fields the server writes", () => {
    const sample: RoutingRecord = { projectId: "p", slug: "s", prefix: "x", showBadge: true, suspended: false, redirectTo: null, api: null };
    const written = Object.keys(JSON.parse(recordJson(sample))).sort();

    const source = readFileSync(join(import.meta.dir, "../../../edge/src/serve.ts"), "utf8");
    const body = /export interface RoutingRecord \{([\s\S]*?)\n\}/.exec(source)![1]!;
    const declared = [...body.matchAll(/^\s+([a-zA-Z]+):/gm)].map((m) => m[1]!).sort();

    expect(declared).toEqual(written);
  });
});
