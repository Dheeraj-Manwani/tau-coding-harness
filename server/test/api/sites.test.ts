import { describe, expect, test } from "bun:test";
import {
  RESERVED_SITE_NAMES,
  cacheControlFor,
  checkSiteName,
  contentTypeFor,
  isValidSlug,
  normalizeSitePath,
  pathFormRedirect,
  publicSiteUrl,
  siteObjectKey,
  sitePrefix,
  slugFromHost,
  slugWithSuffix,
  slugifyProjectName,
} from "@/lib/sites.ts";

// The naming and addressing rules for published sites. These are pure
// functions on purpose: they decide what a public URL looks like and which R2
// key a request reaches, and both are things you want pinned by a test rather
// than by whichever sandbox happens to be up.

describe("normalizeSitePath", () => {
  test("root becomes index.html", () => {
    expect(normalizeSitePath("")).toBe("index.html");
    expect(normalizeSitePath("/")).toBe("index.html");
  });

  test("an asset path passes through", () => {
    expect(normalizeSitePath("/assets/index-a1b2c3d4.js")).toBe(
      "assets/index-a1b2c3d4.js",
    );
  });

  test("a directory request gets index.html", () => {
    expect(normalizeSitePath("/about")).toBe("about/index.html");
    expect(normalizeSitePath("/docs/")).toBe("docs/index.html");
  });

  // The security boundary: whatever the browser sends becomes part of an R2
  // key, so no `..` may survive normalization in any encoding.
  test("traversal cannot escape the deployment prefix", () => {
    // No extension, so it resolves as a directory — but the point is that the
    // `..` segments are gone, leaving a key inside the deployment prefix.
    expect(normalizeSitePath("../../../etc/passwd")).toBe(
      "etc/passwd/index.html",
    );
    expect(normalizeSitePath("/a/../../b.js")).toBe("b.js");
    expect(normalizeSitePath("%2e%2e/%2e%2e/secret.js")).toBe("secret.js");
    expect(normalizeSitePath("/..")).toBe("index.html");
  });

  test("empty and dot segments collapse", () => {
    expect(normalizeSitePath("//a///./b.css")).toBe("a/b.css");
  });

  test("a malformed escape does not throw", () => {
    expect(() => normalizeSitePath("/%E0%A4%A.js")).not.toThrow();
  });
});

describe("siteObjectKey", () => {
  test("keys are scoped under the deployment, not the slug", () => {
    const prefix = sitePrefix("u1", "p1", "d1");
    expect(prefix).toBe("tau/sites/u1/p1/d1");
    expect(siteObjectKey(prefix, "/assets/app.js")).toBe(
      "tau/sites/u1/p1/d1/assets/app.js",
    );
  });

  test("a traversal in the request cannot reach another deployment", () => {
    const prefix = sitePrefix("u1", "p1", "d1");
    expect(siteObjectKey(prefix, "../../d2/index.html")).toBe(
      "tau/sites/u1/p1/d1/d2/index.html",
    );
  });
});

describe("slugifyProjectName", () => {
  test("ordinary names", () => {
    expect(slugifyProjectName("My Todo App")).toBe("my-todo-app");
    expect(slugifyProjectName("  Spaced  Out  ")).toBe("spaced-out");
  });

  test("accents fold rather than truncate", () => {
    expect(slugifyProjectName("Café Menu")).toBe("cafe-menu");
  });

  test("names with nothing usable fall back to a valid stem", () => {
    expect(slugifyProjectName("🚀🚀")).toBe("app");
    expect(slugifyProjectName("日本語")).toBe("app");
    expect(slugifyProjectName("!!")).toBe("app");
  });

  test("no leading or trailing hyphen survives", () => {
    expect(slugifyProjectName("--weird--")).toBe("weird");
  });

  test("every stem plus a suffix is a legal slug", () => {
    for (const name of ["My Todo App", "🚀🚀", "a".repeat(200), "!!"]) {
      const slug = slugWithSuffix(slugifyProjectName(name), "ab12cd");
      expect(isValidSlug(slug)).toBe(true);
    }
  });
});

describe("isValidSlug", () => {
  test("accepts DNS-legal labels", () => {
    expect(isValidSlug("my-app-ab12cd")).toBe(true);
    expect(isValidSlug("abc")).toBe(true);
  });

  test("rejects everything a DNS label cannot be", () => {
    expect(isValidSlug("ab")).toBe(false); // too short
    expect(isValidSlug("-lead")).toBe(false);
    expect(isValidSlug("trail-")).toBe(false);
    expect(isValidSlug("Upper")).toBe(false);
    expect(isValidSlug("has.dot")).toBe(false);
    expect(isValidSlug("has_underscore")).toBe(false);
    expect(isValidSlug("a".repeat(41))).toBe(false);
  });
});

describe("slugFromHost", () => {
  const domain = "usetau.app";

  test("a site subdomain resolves", () => {
    expect(slugFromHost("my-app-ab12cd.usetau.app", domain)).toBe(
      "my-app-ab12cd",
    );
  });

  test("the port is ignored and case is folded", () => {
    expect(slugFromHost("My-App.usetau.app:8080", domain)).toBe("my-app");
  });

  test("the apex itself is not a site", () => {
    expect(slugFromHost("usetau.app", domain)).toBeNull();
  });

  test("a nested label is not a site", () => {
    expect(slugFromHost("a.b.usetau.app", domain)).toBeNull();
  });

  test("another domain that merely ends similarly is not a site", () => {
    expect(slugFromHost("evil-usetau.app", domain)).toBeNull();
  });

  // Without this, every Host header would read as a slug and the API's own
  // routes would start resolving against published sites.
  test("no configured domain means no host ever matches", () => {
    expect(slugFromHost("anything.usetau.app", undefined)).toBeNull();
    expect(slugFromHost("localhost:8080", undefined)).toBeNull();
  });
});

describe("publicSiteUrl", () => {
  test("subdomain form when a domain is configured", () => {
    expect(publicSiteUrl("my-app", { domain: "usetau.app" })).toBe(
      "https://my-app.usetau.app",
    );
  });

  test("path form otherwise, so publishing works with no DNS", () => {
    expect(
      publicSiteUrl("my-app", { domain: undefined, origin: "http://localhost:8080" }),
    ).toBe("http://localhost:8080/sites/my-app/");
  });

  test("the URL a request would produce round-trips to the same slug", () => {
    const domain = "usetau.app";
    const url = new URL(publicSiteUrl("my-app-ab12cd", { domain }));
    expect(slugFromHost(url.host, domain)).toBe("my-app-ab12cd");
  });
});

describe("pathFormRedirect", () => {
  const on = { mode: "redirect", domain: "usetau.app" } as const;

  test("serve mode never redirects", () => {
    expect(
      pathFormRedirect("my-app", "/sites/my-app/", {
        mode: "serve",
        domain: "usetau.app",
      }),
    ).toBeNull();
  });

  // With no sites domain the path form is the only address a site has, so
  // there is nowhere to send anyone.
  test("redirect mode without a domain never redirects", () => {
    expect(
      pathFormRedirect("my-app", "/sites/my-app/", {
        mode: "redirect",
        domain: undefined,
      }),
    ).toBeNull();
  });

  test("the root goes to the subdomain root", () => {
    expect(pathFormRedirect("my-app", "/sites/my-app", on)).toBe(
      "https://my-app.usetau.app/",
    );
    expect(pathFormRedirect("my-app", "/sites/my-app/", on)).toBe(
      "https://my-app.usetau.app/",
    );
  });

  test("the path and query are carried over as sent", () => {
    expect(
      pathFormRedirect("my-app", "/sites/my-app/assets/a%20b.js?v=1&x=%2F", on),
    ).toBe("https://my-app.usetau.app/assets/a%20b.js?v=1&x=%2F");
    expect(pathFormRedirect("my-app", "/sites/my-app?ref=x", on)).toBe(
      "https://my-app.usetau.app/?ref=x",
    );
  });

  // The slug becomes a hostname, so anything that is not a DNS label must not
  // produce a redirect at all, and nothing in the path can change the host.
  test("the request cannot choose the host", () => {
    expect(pathFormRedirect("evil.com", "/sites/evil.com/", on)).toBeNull();
    expect(pathFormRedirect("a@b", "/sites/a@b/", on)).toBeNull();

    const url = new URL(
      pathFormRedirect("my-app", "/sites/my-app//evil.com/x", on)!,
    );
    expect(url.hostname).toBe("my-app.usetau.app");
  });
});

describe("contentTypeFor", () => {
  test("the types a Vite build actually emits", () => {
    expect(contentTypeFor("index.html")).toBe("text/html; charset=utf-8");
    expect(contentTypeFor("assets/app.js")).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(contentTypeFor("assets/app.css")).toBe("text/css; charset=utf-8");
    expect(contentTypeFor("logo.svg")).toBe("image/svg+xml");
    expect(contentTypeFor("font.woff2")).toBe("font/woff2");
  });

  // These bytes are user-generated and served from a domain we control, so an
  // unknown type must download rather than render.
  test("unknown extensions are not guessed at", () => {
    expect(contentTypeFor("weird.xyz")).toBe("application/octet-stream");
    expect(contentTypeFor("LICENSE")).toBe("application/octet-stream");
  });
});

describe("cacheControlFor", () => {
  test("fingerprinted assets are immutable", () => {
    expect(cacheControlFor("assets/index-a1b2c3d4.js")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  // index.html names the current hashed bundles, so caching it would make a
  // publish invisible until the cache expired.
  test("everything else revalidates", () => {
    expect(cacheControlFor("index.html")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect(cacheControlFor("assets/logo.svg")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });
});

describe("checkSiteName", () => {
  test("accepts a valid name and lowercases it", () => {
    expect(checkSiteName("My-App-2")).toEqual({ ok: true, name: "my-app-2" });
    expect(checkSiteName("  kurinji  ")).toEqual({ ok: true, name: "kurinji" });
  });

  test("refuses what is not a DNS label", () => {
    for (const bad of ["ab", "-abc", "abc-", "a_b_c", "a.b.c", "has space", "x".repeat(41), "", "ünï"]) {
      expect(checkSiteName(bad)).toEqual({ ok: false, problem: "invalid" });
    }
  });

  // The sites domain contains "tauai": these would read as tau's own pages.
  test("refuses every reserved name, in any case", () => {
    for (const name of ["www", "api", "app", "admin", "mail", "login", "auth", "account", "billing", "support", "secure", "status", "docs", "cname", "fallback"]) {
      expect(RESERVED_SITE_NAMES.has(name)).toBe(true);
      expect(checkSiteName(name)).toEqual({ ok: false, problem: "reserved" });
      expect(checkSiteName(name.toUpperCase())).toEqual({ ok: false, problem: "reserved" });
    }
  });

  test("a reserved name inside a longer one is fine", () => {
    expect(checkSiteName("login-helper").ok).toBe(true);
    expect(checkSiteName("my-api").ok).toBe(true);
  });

  test("too short is invalid before it is reserved", () => {
    expect(checkSiteName("ap")).toEqual({ ok: false, problem: "invalid" });
  });
});
