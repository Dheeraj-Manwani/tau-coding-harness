import { describe, expect, test } from "bun:test";
import JSZip from "jszip";
import { createProjectArchive } from "./projectArchive";

describe("project ZIP export", () => {
  test("preserves nested paths, hidden files, Unicode text and binary bytes", async () => {
    const blobs: Record<string, Uint8Array> = {
      source: Buffer.from("export default 'Hello 世界';"),
      config: Buffer.from("dist\n"),
      image: new Uint8Array([0, 255, 137, 80, 78, 71, 13, 10]),
    };
    const zip = await JSZip.loadAsync(await createProjectArchive([
      { path: "src/main.ts", contentHash: "source" },
      { path: ".gitignore", contentHash: "config" },
      { path: "public/image.png", contentHash: "image" },
    ], async (hash) => blobs[hash]!));
    expect(await zip.file("src/main.ts")!.async("string")).toBe("export default 'Hello 世界';");
    expect(await zip.file(".gitignore")!.async("string")).toBe("dist\n");
    expect(await zip.file("public/image.png")!.async("uint8array")).toEqual(blobs.image!);
  });

  test("rejects unsafe paths before reading their content", async () => {
    for (const path of ["../secret", "/absolute", "a/../b", "C:/file", "a\\b"]) {
      let read = false;
      await expect(createProjectArchive([{ path, contentHash: "hash" }], async () => {
        read = true;
        return new Uint8Array();
      })).rejects.toThrow("Invalid archive path");
      expect(read).toBe(false);
    }
  });

  test("fails the download when a blob is missing", async () => {
    await expect(createProjectArchive([{ path: "file.ts", contentHash: "missing" }], async () => {
      throw new Error("Missing blob");
    })).rejects.toThrow("Missing blob");
  });
});
