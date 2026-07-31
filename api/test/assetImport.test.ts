import { describe, expect, it } from "bun:test";

import {
  fetchImageAsset,
  isBlockedAddress,
  slugifyAssetName,
} from "../src/lib/assetImport";

// Importing an image is the one part of visual edit where the API fetches a URL
// a user typed. That makes it an SSRF primitive unless the address is checked,
// so these are the tests that matter most in this file — the rest of the feature
// only ever touches the project's own files.

describe("isBlockedAddress", () => {
  it("blocks the cloud metadata endpoint", () => {
    // The single most valuable target: on EC2 this hands out IAM credentials to
    // anything that can make it issue a GET.
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
  });

  it("blocks loopback, private and reserved IPv4", () => {
    for (const ip of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
  });

  it("allows ordinary public IPv4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "192.169.0.1"]) {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  });

  it("blocks IPv6 loopback and unique-local", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1"]) {
      expect(isBlockedAddress(ip)).toBe(true);
    }
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
  });

  it("blocks IPv4-mapped IPv6, which would otherwise skip the v4 rules", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("blocks anything that isn't an IP at all", () => {
    // Fail closed: an address we can't classify is not one we should connect to.
    expect(isBlockedAddress("localhost")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("fetchImageAsset", () => {
  it("refuses non-http schemes before any lookup", async () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com/a.png",
      "gopher://example.com/",
      "not a url",
    ]) {
      expect((await fetchImageAsset(url)).ok).toBe(false);
    }
  });

  it("refuses a literal internal address", async () => {
    const res = await fetchImageAsset("http://169.254.169.254/latest/meta-data/");
    expect(res).toEqual({ ok: false, reason: "blocked_host" });
  });

  it("refuses localhost by name, not just by address", async () => {
    // The point of resolving before fetching: a name blocklist is trivially
    // beaten by pointing your own domain at 127.0.0.1, so the check is on what
    // the name resolves to.
    const res = await fetchImageAsset("http://localhost:8080/a.png");
    expect(res).toEqual({ ok: false, reason: "blocked_host" });
  });
});

describe("slugifyAssetName", () => {
  it("takes the filename stem and makes it path-safe", () => {
    expect(slugifyAssetName("https://ex.com/photos/Hero Image.JPG")).toBe(
      "hero-image",
    );
    expect(slugifyAssetName("https://ex.com/a/b/logo.svg?v=2")).toBe("logo");
  });

  it("falls back rather than producing an empty name", () => {
    expect(slugifyAssetName("https://ex.com/")).toBe("image");
    expect(slugifyAssetName("https://ex.com/---.png")).toBe("image");
  });

  it("bounds the length", () => {
    const long = `https://ex.com/${"a".repeat(200)}.png`;
    expect(slugifyAssetName(long).length).toBeLessThanOrEqual(40);
  });
});
