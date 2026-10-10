import { describe, expect, test } from "bun:test";
import {
  dispositionFor,
  nameOf,
  normalizeContentType,
  normalizeObjectKey,
  normalizePrefix,
} from "@/api/lib/storagePaths";
import { roomFor } from "@/lib/storageQuota";
import { STORAGE_MAX_FILE_BYTES, STORAGE_PREVIEW_QUOTA_BYTES, STORAGE_QUOTA_BYTES } from "@/lib/pricing";
import { redactSecrets } from "@/worker/lib/redact";

describe("normalizeObjectKey", () => {
  test("accepts ordinary names, including spaces and unicode", () => {
    for (const k of ["a", "users/42/avatar.png", "my file (1).pdf", "日本語/ファイル.txt"]) {
      expect(normalizeObjectKey(k)).toEqual({ ok: true, key: k });
    }
  });

  test("normalises to NFC", () => {
    const result = normalizeObjectKey("café.txt");
    expect(result).toEqual({ ok: true, key: "café.txt" });
  });

  test("rejects each rule", () => {
    const bad: unknown[] = [
      undefined, 42, "", "/leading", "a//b", "trailing/", ".", "..", "a/./b", "a/../b",
      "a\u0000b", "a\nb", "a\u007fb", "x".repeat(513), `${"x".repeat(256)}/y`,
    ];
    for (const k of bad) expect(normalizeObjectKey(k).ok).toBe(false);
  });

  test("accepts the limits exactly", () => {
    expect(normalizeObjectKey("x".repeat(255)).ok).toBe(true);
    expect(normalizeObjectKey(`${"x".repeat(255)}/${"y".repeat(256)}`).ok).toBe(false);
    expect(normalizeObjectKey(`${"a".repeat(255)}/`.repeat(2).slice(0, 512)).ok).toBe(false);
  });
});

describe("normalizePrefix and nameOf", () => {
  test("empty prefix is allowed; a trailing slash is kept", () => {
    expect(normalizePrefix(undefined)).toEqual({ ok: true, key: "" });
    expect(normalizePrefix("users/1/")).toEqual({ ok: true, key: "users/1/" });
    expect(normalizePrefix("../x").ok).toBe(false);
    expect(normalizePrefix("/").ok).toBe(false);
  });
  test("nameOf is the last segment", () => {
    expect(nameOf("a/b/c.png")).toBe("c.png");
    expect(nameOf("plain")).toBe("plain");
  });
});

describe("dispositionFor", () => {
  test("HTML and SVG are always attachments of opaque bytes", () => {
    for (const type of ["text/html", "text/html; charset=utf-8", "image/svg+xml", "application/xhtml+xml", "text/javascript"]) {
      for (const download of [false, true]) {
        const d = dispositionFor(type, "x", download);
        expect(d.header.startsWith("attachment")).toBe(true);
        expect(d.contentType).toBe("application/octet-stream");
      }
    }
  });

  test("a picture is inline unless a download is asked for", () => {
    expect(dispositionFor("image/png", "a.png", false).header.startsWith("inline")).toBe(true);
    expect(dispositionFor("image/png", "a.png", false).contentType).toBe("image/png");
    expect(dispositionFor("image/png", "a.png", true).header.startsWith("attachment")).toBe(true);
    expect(dispositionFor("application/pdf", "a.pdf", false).header.startsWith("inline")).toBe(true);
    expect(dispositionFor("text/plain", "a.txt", false).header.startsWith("inline")).toBe(true);
  });

  test("the file name cannot break out of the header", () => {
    const d = dispositionFor("image/png", 'a"; filename=evil.html\r\nX: y', false).header;
    expect(d).not.toMatch(/[\r\n]/);
    expect(d.match(/"/g)).toHaveLength(2); // the quote in the name was replaced, so it stays one quoted string
  });
});

describe("normalizeContentType", () => {
  test("accepts media types and rejects junk", () => {
    expect(normalizeContentType("Image/PNG")).toBe("image/png");
    expect(normalizeContentType("text/plain; charset=utf-8")).toBe("text/plain; charset=utf-8");
    for (const bad of ["", "png", "a/b\r\nX: y", 7, "a/b;"]) expect(normalizeContentType(bad)).toBeNull();
  });
});

describe("roomFor", () => {
  const base = { plan: "FREE" as const, usedBytes: 0, previewUsedBytes: 0, env: "LIVE" as const, size: 1 };
  const maxFile = STORAGE_MAX_FILE_BYTES.FREE;
  const quota = STORAGE_QUOTA_BYTES.FREE;

  test("under, at and over the largest file", () => {
    expect(roomFor({ ...base, size: maxFile }).ok).toBe(true);
    expect(roomFor({ ...base, size: maxFile + 1 })).toMatchObject({ ok: false, code: "file_too_large" });
    expect(roomFor({ ...base, plan: "PRO", size: maxFile + 1 }).ok).toBe(true);
  });

  test("under, at and over the allowance", () => {
    expect(roomFor({ ...base, usedBytes: quota - 5, size: 5 }).ok).toBe(true);
    expect(roomFor({ ...base, usedBytes: quota - 5, size: 6 })).toMatchObject({ ok: false, code: "storage_full" });
  });

  test("the preview cap applies to preview only", () => {
    const preview = { ...base, previewUsedBytes: STORAGE_PREVIEW_QUOTA_BYTES, size: 1 };
    expect(roomFor({ ...preview, env: "PREVIEW" })).toMatchObject({ ok: false, code: "storage_full" });
    expect(roomFor({ ...preview, env: "LIVE" }).ok).toBe(true);
  });

  test("replacing a file frees its bytes", () => {
    expect(roomFor({ ...base, usedBytes: quota, size: 5 }).ok).toBe(false);
    expect(roomFor({ ...base, usedBytes: quota, size: 5, replacingBytes: 5 }).ok).toBe(true);
  });

  test("a downgrade over the allowance refuses uploads and nothing else changes", () => {
    expect(roomFor({ ...base, plan: "FREE", usedBytes: quota * 3, size: 1 })).toMatchObject({ code: "storage_full" });
  });
});

describe("key redaction", () => {
  test("a storage key is masked wherever it appears, including a dash", () => {
    const key = "tau_st_ab-cdEF12_3456789012345678901234567890123";
    expect(redactSecrets(`TAU_STORAGE_KEY=${key} and ${key}`)).not.toContain("ab-cd");
    expect(redactSecrets({ nested: [key] })).toEqual({ nested: ["tau_st_***redacted***"] });
  });
  test("an AI key with a dash is masked whole", () => {
    expect(redactSecrets("tau_sk_live_ab-cdEF12_345678")).toBe("tau_sk_***redacted***");
  });
});
