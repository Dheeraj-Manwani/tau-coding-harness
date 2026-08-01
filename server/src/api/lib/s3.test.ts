import { describe, expect, test } from "bun:test";

import { attachmentKey, blobKey, presignPut, presignGet } from "@/lib/s3";

describe("attachmentKey", () => {
  test("is scoped to the user, not a project", () => {
    expect(attachmentKey("u1", "abc")).toBe("tau/attachments/u1/abc");
  });

  test("does not collide with the project-file namespace", () => {
    expect(attachmentKey("u1", "abc")).not.toBe(blobKey("u1", "p1", "abc"));
  });
});

describe("presignPut", () => {
  // Regression guard. AWS SDK >= 3.729 defaults requestChecksumCalculation to
  // "WHEN_SUPPORTED", which signs a CRC32 of the *absent* body into the URL
  // (x-amz-checksum-crc32 = AAAAAA==, the checksum of zero bytes). The browser
  // then PUTs real bytes and R2 rejects the mismatch with a 403. Nothing in the
  // type system catches this — only the shape of the generated URL does.
  test("bakes no checksum into the signed query", async () => {
    const url = new URL(await presignPut("tau/attachments/u1/abc"));
    const checksumParams = [...url.searchParams.keys()].filter((k) =>
      k.toLowerCase().includes("checksum"),
    );
    expect(checksumParams).toEqual([]);
  });

  test("signs only host, so the client may set its own Content-Type", async () => {
    const url = new URL(await presignPut("tau/attachments/u1/abc"));
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
  });

  test("carries an expiry and a signature", async () => {
    const url = new URL(await presignPut("tau/attachments/u1/abc", 900));
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
});

describe("presignGet", () => {
  test("produces a signed URL for the requested key", async () => {
    const url = new URL(await presignGet("tau/attachments/u1/abc", 600));
    expect(url.pathname).toContain("tau/attachments/u1/abc");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });
});
