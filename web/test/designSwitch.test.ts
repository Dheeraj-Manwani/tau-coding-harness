import { describe, expect, test } from "bun:test";

import {
  compactConfig,
  countChoices,
  describeChoice,
  sameDesign,
  withoutImport,
} from "../src/features/design/api";

// A light and dark switch, and where the greys lean, are choices like any
// other: sent when made, counted, kept in a default look. A switch turned off
// is different from one never asked for: on a restyle it takes the switch out.

describe("the switch and the greys in a choice", () => {
  test("are sent when chosen", () => {
    expect(compactConfig({ switch: true, neutral: "warm" })).toEqual({ switch: true, neutral: "warm" });
  });

  test("a switch turned off is still sent: that is how a restyle takes one out", () => {
    expect(compactConfig({ switch: false })).toEqual({ switch: false });
    expect(compactConfig({})).toBeNull();
  });

  test("are counted as choices and make two looks different", () => {
    expect(countChoices({ switch: true, neutral: "cool" })).toBe(2);
    expect(countChoices({ switch: false })).toBe(0);
    expect(sameDesign({ neutral: "warm" }, { neutral: "cool" })).toBe(false);
    expect(sameDesign({ switch: true }, {})).toBe(false);
    expect(sameDesign({ neutral: "warm" }, { neutral: "warm" })).toBe(true);
  });

  test("stay in a default look, which is for new projects", () => {
    expect(withoutImport({ style: "soft", switch: true, neutral: "grey" })).toEqual({
      style: "soft",
      switch: true,
      neutral: "grey",
    });
  });

  test("are said in words where a choice is summarised", () => {
    expect(describeChoice({ switch: true, neutral: "warm" }, undefined)).toEqual(["Light and dark switch", "Warm greys"]);
    // Going back to the style's own is not a lean.
    expect(describeChoice({ neutral: "style" }, undefined)).toEqual([]);
  });
});
