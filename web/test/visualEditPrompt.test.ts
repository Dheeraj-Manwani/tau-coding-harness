/**
 * Restating a refused deterministic edit as a request the user can send.
 *
 * The element's own description is not built here any more — the API writes it
 * (`server/src/api/lib/visualContext.ts`, pinned by
 * `server/test/api/visualContext.test.ts`). What is left is the sentence that
 * lands in the inspector's prompt box, which has to read as a standalone
 * request because the user is about to edit and send it.
 */
import { describe, expect, test } from "bun:test";

import {
  computedValueFor,
  describeRefusedEdit,
} from "@/src/features/project/visualEditPrompt";
import {
  parseElementBlock,
  type VisualEditOpInput,
} from "@/src/stores/useProjectStore";

/**
 * Byte-identical to what `visualContextBlock` emits for the same element, and
 * asserted as such by `server/test/api/visualContext.test.ts`.
 *
 * The writer is in `server/`, the reader is here, and neither package can
 * import the other — so this literal is the only thing keeping them honest.
 * Change the tag's shape on one side without the other and one of the two
 * suites fails.
 */
const FIXTURE_OPEN_TAG =
  '<selected-element file="src/App.tsx" line="42" tag="button">';

describe("describeRefusedEdit", () => {
  test("text", () => {
    expect(describeRefusedEdit({ kind: "text", value: "Sign up free" })).toBe(
      'Change this element\'s text to "Sign up free".',
    );
  });

  test("attribute", () => {
    expect(
      describeRefusedEdit({ kind: "attr", name: "src", value: "/hero.png" }),
    ).toBe('Set this element\'s `src` to "/hero.png".');
  });

  test("classes, both directions", () => {
    expect(
      describeRefusedEdit({
        kind: "classes",
        add: ["bg-red-500"],
        remove: ["bg-blue-500"],
      }),
    ).toBe("Apply `bg-red-500` and remove `bg-blue-500` on this element.");
  });

  test("classes, add only", () => {
    expect(describeRefusedEdit({ kind: "classes", add: ["p-6"] })).toBe(
      "Apply `p-6` on this element.",
    );
  });

  test("classes, remove only", () => {
    expect(describeRefusedEdit({ kind: "classes", remove: ["p-6"] })).toBe(
      "Remove `p-6` on this element.",
    );
  });

  test("classes with nothing to say still reads as a request", () => {
    // The prompt box is about to show this to a user, so "" is not an option.
    expect(describeRefusedEdit({ kind: "classes" })).toBe(
      "Adjust this element's styling.",
    );
  });

  test("every shape is a complete sentence", () => {
    const ops: VisualEditOpInput[] = [
      { kind: "text", value: "hi" },
      { kind: "attr", name: "alt", value: "a cat" },
      { kind: "classes", add: ["p-6"] },
      { kind: "classes" },
    ];
    for (const op of ops) {
      const s = describeRefusedEdit(op);
      expect(s[0]).toBe(s[0]!.toUpperCase());
      expect(s).toEndWith(".");
    }
  });
});

describe("parseElementBlock", () => {
  test("recovers the chip from what the API actually writes", () => {
    const block = `${FIXTURE_OPEN_TAG}\nThe user selected this element in the live preview: the \`<button>\` at src/App.tsx line 42.\n</selected-element>`;
    expect(parseElementBlock(block)).toEqual({
      path: "src/App.tsx",
      line: "42",
      tagName: "button",
    });
  });

  test("undoes the attribute escaping", () => {
    const block =
      '<selected-element file="src/a&amp;b/App.tsx" line="7" tag="div">x</selected-element>';
    expect(parseElementBlock(block)?.path).toBe("src/a&b/App.tsx");
  });

  test("keeps a path containing colons", () => {
    const block =
      '<selected-element file="src/a:b/App.tsx" line="9" tag="span">x</selected-element>';
    expect(parseElementBlock(block)?.path).toBe("src/a:b/App.tsx");
  });

  test("ignores blocks that aren't one", () => {
    expect(parseElementBlock("")).toBeUndefined();
    expect(parseElementBlock("make it red")).toBeUndefined();
    expect(
      parseElementBlock('<attachment id="1" name="a.pdf" kind="file">x'),
    ).toBeUndefined();
  });

  test("declines a tag missing any of the three attributes", () => {
    // Better no chip than one that says `<undefined>`.
    expect(
      parseElementBlock('<selected-element file="a.tsx" line="1">x'),
    ).toBeUndefined();
    expect(
      parseElementBlock('<selected-element line="1" tag="div">x'),
    ).toBeUndefined();
  });
});

describe("computedValueFor", () => {
  test("maps each op to the value the server declined to rewrite", () => {
    expect(computedValueFor({ kind: "text", value: "hi" })).toBe("text");
    expect(computedValueFor({ kind: "classes", add: ["p-6"] })).toBe(
      "className",
    );
    expect(computedValueFor({ kind: "attr", name: "src", value: "/a.png" })).toBe(
      "attribute",
    );
  });
});
