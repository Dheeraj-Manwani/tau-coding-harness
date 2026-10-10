import { describe, expect, test } from "bun:test";

import {
  NEARLY_FULL_PERCENT,
  canPreview,
  formatSize,
  splitKey,
  typeLabel,
  usagePercent,
} from "@/src/features/project/storage";

describe("formatSize", () => {
  test("picks the unit and drops a trailing .0", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(-5)).toBe("0 B");
    expect(formatSize(Number.NaN)).toBe("0 B");
    expect(formatSize(840)).toBe("840 B");
    expect(formatSize(1024)).toBe("1 KB");
    expect(formatSize(12.44 * 1024)).toBe("12.4 KB");
    expect(formatSize(10 * 1024 * 1024)).toBe("10 MB");
    expect(formatSize(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});

describe("splitKey", () => {
  test("separates the folder from the file name", () => {
    expect(splitKey("users/42/avatar.png")).toEqual({ folder: "users/42/", name: "avatar.png" });
    expect(splitKey("plain.txt")).toEqual({ folder: "", name: "plain.txt" });
    expect(splitKey("a/b/")).toEqual({ folder: "a/b/", name: "" });
  });
});

describe("usagePercent", () => {
  test("is a whole percent, clamped", () => {
    expect(usagePercent(50, 100)).toBe(50);
    expect(usagePercent(1, 3)).toBe(33);
    expect(usagePercent(500, 100)).toBe(100);
    expect(usagePercent(-1, 100)).toBe(0);
    expect(usagePercent(10, 0)).toBe(0);
  });
  test("the warning starts at four fifths", () => {
    expect(NEARLY_FULL_PERCENT).toBe(80);
  });
});

describe("canPreview", () => {
  test("pictures, PDF, text and media open; HTML and SVG never do", () => {
    for (const t of ["image/png", "image/jpeg", "application/pdf", "text/plain; charset=utf-8", "audio/mpeg", "video/mp4"]) {
      expect(canPreview(t)).toBe(true);
    }
    for (const t of ["text/html", "image/svg+xml", "application/zip", "application/octet-stream", "text/javascript"]) {
      expect(canPreview(t)).toBe(false);
    }
  });
});

describe("typeLabel", () => {
  test("uses the extension when there is a short one, else the subtype", () => {
    expect(typeLabel("image/png", "a.png")).toBe("PNG");
    expect(typeLabel("application/pdf", "report")).toBe("PDF");
    expect(typeLabel("image/svg+xml", "logo")).toBe("SVG");
    expect(typeLabel("application/octet-stream", "x.verylongext")).toBe("OCTET-ST");
  });
});
