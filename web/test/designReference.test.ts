import { describe, expect, test } from "bun:test";

import {
  compactConfig,
  countChoices,
  sameDesign,
  withoutImport,
  type DesignConfig,
} from "../src/features/design/api";

// A design read from a screenshot is sent as a design file together with the
// picture it was read from. The picture belongs to that file: it travels with
// it, and never without it.

const reference = { hash: "a".repeat(64), mimeType: "image/png" };
const fromShot: DesignConfig = { designMd: "# Design, read from a screenshot", reference };

describe("the picture a design was read from", () => {
  test("is sent with the design file", () => {
    expect(compactConfig(fromShot)).toEqual(fromShot);
    expect(compactConfig({ ...fromShot, accent: "#0e7490" })).toEqual({ ...fromShot, accent: "#0e7490" });
  });

  test("is not sent without it", () => {
    expect(compactConfig({ reference })).toBeNull();
    expect(compactConfig({ style: "soft", reference, designMd: "   " })).toEqual({ style: "soft" });
  });

  test("is one choice, not two", () => {
    expect(countChoices(fromShot)).toBe(1);
  });

  test("is never part of a default look", () => {
    expect(withoutImport({ ...fromShot, style: "soft" })).toEqual({ style: "soft" });
    expect(withoutImport(fromShot)).toBeNull();
  });

  test("makes two designs different when the pictures differ", () => {
    const other = { ...fromShot, reference: { hash: "b".repeat(64), mimeType: "image/png" } };
    expect(sameDesign(fromShot, fromShot)).toBe(true);
    expect(sameDesign(fromShot, other)).toBe(false);
  });
});
