import { describe, expect, it } from "bun:test";

import {
  applyVisualEdit,
  escapeJsxText,
  mergeClasses,
  parseLoc,
  type VisualEditOp,
  type VisualEditResult,
} from "@/api/lib/visualEdit";

/** The fixture mirrors what the Phase 0 spike renders, so the line/column
 *  numbers here are the same ones the real tagger emits. */
const APP = `import { useState } from 'react'

const CARDS = ['alpha', 'beta', 'gamma']

export default function App() {
  const [clicks, setClicks] = useState(0)
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Visual edit spike</h1>
      <button
        id="target"
        onClick={() => setClicks((c) => c + 1)}
      >
        Click me
      </button>
      <p id="click-count">{clicks}</p>
      <img src="/a.png" />
      <span>Hello <b>world</b></span>
      <ul>
        {CARDS.map((c) => (
          <li key={c} className="spike-card">{c}</li>
        ))}
      </ul>
    </div>
  )
}
`;

/** Locate a tag in the fixture the way the tagger does: 1-based line, 1-based
 *  column of the `<`. Keeps the tests honest if the fixture is edited. */
function locOf(tag: string): { line: number; column: number } {
  const lines = APP.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith(`<${tag}`));
  if (i === -1) throw new Error(`no <${tag}> in fixture`);
  return { line: i + 1, column: (lines[i] as string).indexOf("<") + 1 };
}

function edit(
  tag: string,
  value: string,
  overrides: Partial<{ expectTag: string; line: number; column: number }> = {},
): VisualEditResult {
  const { line, column } = locOf(tag);
  return applyVisualEdit({
    content: APP,
    fileName: "src/App.tsx",
    line: overrides.line ?? line,
    column: overrides.column ?? column,
    expectTag: overrides.expectTag ?? tag,
    op: { kind: "text", value },
  });
}

/** Class-op variant of `edit`, against a fixture with varied className shapes. */
const STYLED = `export function Styled() {
  const on = true
  return (
    <div className="p-8 bg-blue-500">
      <h1 className="text-2xl font-bold">Title</h1>
      <button className={"rounded px-4"}>Go</button>
      <a className={cn("underline", on && "text-red-500")}>Link</a>
      <section className={\`grid \${on}\`}>x</section>
      <img src="/a.png" className="w-4" />
      <span id="bare">plain</span>
      <input className="border" />
    </div>
  )
}
`;

function classEdit(
  tag: string,
  op: { add?: string[]; remove?: string[] },
  overrides: Partial<{ expectTag: string }> = {},
): VisualEditResult {
  const lines = STYLED.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith(`<${tag}`));
  if (i === -1) throw new Error(`no <${tag}> in fixture`);
  return applyVisualEdit({
    content: STYLED,
    fileName: "src/Styled.tsx",
    line: i + 1,
    column: (lines[i] as string).indexOf("<") + 1,
    expectTag: overrides.expectTag ?? tag,
    op: { kind: "classes", ...op } as VisualEditOp,
  });
}

describe("mergeClasses", () => {
  it("resolves Tailwind conflicts", () => {
    expect(mergeClasses("p-8 bg-blue-500", ["bg-red-500"])).toBe(
      "p-8 bg-red-500",
    );
  });

  it("leaves non-Tailwind classes alone", () => {
    expect(mergeClasses("spike-card rounded bg-blue-500", ["bg-primary"])).toBe(
      "spike-card rounded bg-primary",
    );
  });

  it("preserves the original order and appends new classes", () => {
    // twMerge on its own returns "font-bold text-sm" — reordering an attribute
    // the user didn't touch would bloat the diff.
    expect(mergeClasses("text-2xl font-bold", ["text-sm"])).toBe(
      "font-bold text-sm",
    );
    expect(mergeClasses("a-x rounded border", ["p-2"])).toBe(
      "a-x rounded border p-2",
    );
  });

  it("removes explicitly", () => {
    expect(mergeClasses("rounded border p-2", [], ["border"])).toBe(
      "rounded p-2",
    );
  });

  it("collapses shorthand conflicts", () => {
    expect(mergeClasses("px-4 py-2", ["p-6"])).toBe("p-6");
  });

  it("de-duplicates", () => {
    expect(mergeClasses("rounded", ["rounded"])).toBe("rounded");
  });

  it("handles an empty starting point", () => {
    expect(mergeClasses("", ["bg-primary"])).toBe("bg-primary");
  });

  /**
   * The style panel offers shadcn theme tokens first, and relies on
   * tailwind-merge recognising them as colours. If a version bump ever broke
   * this, edits would silently accumulate dead classes
   * (`text-foreground text-primary`) instead of replacing them — visible only
   * as the element not changing colour. Pinning the behaviour we depend on.
   */
  it("treats shadcn theme tokens as conflicting colours", () => {
    expect(mergeClasses("text-foreground", ["text-primary"])).toBe(
      "text-primary",
    );
    expect(mergeClasses("bg-card", ["bg-primary"])).toBe("bg-primary");
    // Including tokens the panel never offers, which can still be in the source.
    expect(mergeClasses("text-accent-foreground", ["text-destructive"])).toBe(
      "text-destructive",
    );
  });

  it("keeps text colour and text size independent", () => {
    // Both start with `text-`; conflating them would drop the user's colour
    // every time they changed the size.
    expect(mergeClasses("text-foreground", ["text-2xl"])).toBe(
      "text-foreground text-2xl",
    );
    expect(mergeClasses("text-2xl text-primary", ["text-sm"])).toBe(
      "text-primary text-sm",
    );
  });
});

describe("applyVisualEdit — classes", () => {
  it("rewrites a plain string className", () => {
    const res = classEdit("div", { add: ["bg-red-500"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(`<div className="p-8 bg-red-500">`);
  });

  it("rewrites a className wrapped in an expression", () => {
    const res = classEdit("button", { add: ["bg-primary"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(`className={"rounded px-4 bg-primary"}`);
  });

  it("adds a className to an element that has none", () => {
    const res = classEdit("span", { add: ["text-center"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(`<span className="text-center" id="bare">`);
  });

  it("works on self-closing elements", () => {
    const res = classEdit("img", { add: ["w-8"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(`<img src="/a.png" className="w-8" />`);
  });

  it("drops the attribute when the last class is removed", () => {
    const res = classEdit("input", { remove: ["border"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No empty className="" left behind, and no double space.
    expect(res.content).toContain(`<input />`);
    expect(res.content).not.toContain(`className=""`);
  });

  it("changes only the one line", () => {
    const res = classEdit("h1", { add: ["text-sm"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const before = STYLED.split("\n");
    const after = res.content.split("\n");
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
  });

  it("is a no-op when nothing changes", () => {
    for (const op of [{ add: ["p-8"] }, {}]) {
      const res = classEdit("div", op);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.content).toBe(STYLED);
      // Still reports the class list, so the client can reconcile even when
      // its optimistic guess and the file already agreed.
      expect(res.className).toBe("p-8 bg-blue-500");
    }
  });

  it("reports the merged class list back to the caller", () => {
    // px-4 py-2 both lose to p-6 — a client can't know that without shipping
    // tailwind-merge itself, which is why the server returns the answer.
    const res = applyVisualEdit({
      content: `<div className="px-4 py-2" />`,
      fileName: "x.tsx",
      line: 1,
      column: 1,
      expectTag: "div",
      op: { kind: "classes", add: ["p-6"] },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.className).toBe("p-6");
    expect(res.content).toBe(`<div className="p-6" />`);
  });

  it("reports an empty class list when the attribute is dropped", () => {
    const res = classEdit("input", { remove: ["border"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.className).toBe("");
  });

  it("refuses a cn() className", () => {
    expect(classEdit("a", { add: ["p-2"] })).toEqual({
      ok: false,
      reason: "dynamic_classname",
    });
  });

  it("refuses a template literal className", () => {
    expect(classEdit("section", { add: ["p-2"] })).toEqual({
      ok: false,
      reason: "dynamic_classname",
    });
  });

  it("still enforces the tag guard", () => {
    expect(classEdit("div", { add: ["p-2"] }, { expectTag: "h1" })).toEqual({
      ok: false,
      reason: "tag_mismatch",
    });
  });

  it("rejects class names that could break out of the string", () => {
    for (const bad of ['a" onClick="x', "a b", "a`b", "a{b}", 'a"']) {
      expect(classEdit("div", { add: [bad] })).toEqual({
        ok: false,
        reason: "invalid_class",
      });
    }
  });

  it("accepts variants and arbitrary values", () => {
    const res = classEdit("div", { add: ["md:w-[32px]", "hover:bg-[#fff]"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("md:w-[32px]");
    expect(res.content).toContain("hover:bg-[#fff]");
  });
});

describe("parseLoc", () => {
  it("splits a normal location", () => {
    expect(parseLoc("src/App.tsx:42:7")).toEqual({
      path: "src/App.tsx",
      line: 42,
      column: 7,
    });
  });

  it("keeps colons that belong to the path", () => {
    expect(parseLoc("src/we:ird.tsx:1:2")?.path).toBe("src/we:ird.tsx");
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "src/App.tsx", "src/App.tsx:0:1", "src/App.tsx:a:b", "1:2"]) {
      expect(parseLoc(bad)).toBeNull();
    }
  });
});

describe("escapeJsxText", () => {
  it("neutralises every character that could change the file's structure", () => {
    expect(escapeJsxText("a < b > c { d } e")).toBe(
      "a &lt; b &gt; c &#123; d &#125; e",
    );
  });

  it("escapes ampersands first so entities aren't double-escaped", () => {
    expect(escapeJsxText("a & <b>")).toBe("a &amp; &lt;b&gt;");
  });
});

describe("applyVisualEdit — the happy path", () => {
  it("replaces static text", () => {
    const res = edit("button", "Sign up free");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("Sign up free");
    expect(res.content).not.toContain("Click me");
  });

  it("preserves the element's indentation exactly", () => {
    const res = edit("button", "Sign up free");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The original is `>\n        Click me\n      <` — the whitespace is the
    // JsxText node's own content and must survive untouched.
    expect(res.content).toContain(">\n        Sign up free\n      <");
  });

  it("changes only the one line", () => {
    const res = edit("h1", "New heading");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const before = APP.split("\n");
    const after = res.content.split("\n");
    expect(after.length).toBe(before.length);
    const changed = after.filter((l, i) => l !== before[i]);
    expect(changed).toHaveLength(1);
  });

  it("edits a single-line element without disturbing its siblings", () => {
    const res = edit("h1", "Renamed");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(
      `<h1 className="text-2xl font-bold">Renamed</h1>`,
    );
  });

  it("escapes user text rather than letting it become markup", () => {
    const res = edit("h1", "5 > 3 && {x}");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain("5 &gt; 3 &amp;&amp; &#123;x&#125;");
    // The element count must not change — nothing new was opened.
    expect(res.content.match(/<h1/g)).toHaveLength(1);
  });

  it("is a no-op when the text is unchanged", () => {
    const res = edit("button", "Click me");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toBe(APP);
  });
});

describe("applyVisualEdit — refusals", () => {
  it("refuses an expression child", () => {
    // <p id="click-count">{clicks}</p>
    const res = edit("p", "hello");
    expect(res).toEqual({ ok: false, reason: "dynamic_children" });
  });

  it("refuses mixed text and markup", () => {
    // <span>Hello <b>world</b></span>
    const res = edit("span", "hi");
    expect(res).toEqual({ ok: false, reason: "dynamic_children" });
  });

  it("refuses a self-closing element", () => {
    const res = edit("img", "hello");
    expect(res).toEqual({ ok: false, reason: "dynamic_children" });
  });

  it("refuses an element whose children are markup", () => {
    // <div> wraps other elements
    const res = edit("div", "hello");
    expect(res).toEqual({ ok: false, reason: "dynamic_children" });
  });

  it("refuses an empty or whitespace-only value", () => {
    expect(edit("button", "")).toEqual({ ok: false, reason: "empty_value" });
    expect(edit("button", "   ")).toEqual({ ok: false, reason: "empty_value" });
  });

  it("refuses newlines", () => {
    expect(edit("button", "a\nb")).toEqual({
      ok: false,
      reason: "multiline_value",
    });
  });

  it("refuses when the tag doesn't match what was clicked", () => {
    // The classic stale-selection case: the agent rewrote the file and line 10
    // is now a different element.
    const res = edit("button", "x", { expectTag: "a" });
    expect(res).toEqual({ ok: false, reason: "tag_mismatch" });
  });

  it("refuses when no element starts at the position", () => {
    const res = edit("button", "x", { column: 3 });
    expect(res).toEqual({ ok: false, reason: "not_found" });
  });

  it("refuses a location past the end of the file", () => {
    const res = edit("button", "x", { line: 9_999 });
    expect(res).toEqual({ ok: false, reason: "bad_loc" });
  });

  it("refuses a column that runs past the end of its line", () => {
    const res = edit("button", "x", { column: 500 });
    expect(res).toEqual({ ok: false, reason: "bad_loc" });
  });
});

describe("applyVisualEdit — mapped elements", () => {
  it("edits the single source line behind a .map()", () => {
    // <li key={c} className="spike-card">{c}</li> — the child is `{c}`, an
    // expression, so this must refuse. Three cards on screen, one source line:
    // silently rewriting it would change all three.
    const res = edit("li", "static");
    expect(res).toEqual({ ok: false, reason: "dynamic_children" });
  });
});

/**
 * The one integration risk in this feature: the tagger computes positions with
 * Babel (0-based columns, +1 on the wire) and this module resolves them with the
 * TypeScript AST. An off-by-one between the two would edit the wrong node, and
 * neither side's own tests would notice.
 *
 * This fixture is byte-identical to the one in scripts/spike-visual-edit.ts,
 * which asserts against a *real* sandbox that the real tagger emits
 * `src/App.tsx:10:7` for its button. So: that suite pins what the tagger
 * produces, this one pins what the API resolves, and they share a coordinate.
 * Change one fixture without the other and this fails.
 */
describe("coordinates agree with the tagger", () => {
  const SPIKE_APP = `import { useState } from 'react'

const CARDS = ['alpha', 'beta', 'gamma']

export default function App() {
  const [clicks, setClicks] = useState(0)
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold">Visual edit spike</h1>
      <button
        id="target"
        className="mt-4 rounded bg-blue-500 px-4 py-2 text-white"
        onClick={() => setClicks((c) => c + 1)}
      >
        Click me
      </button>
      <p id="click-count">{clicks}</p>
      <ul>
        {CARDS.map((c) => (
          <li key={c} className="spike-card">{c}</li>
        ))}
      </ul>
    </div>
  )
}
`;

  /** The exact string the real tagger emits for the spike's button. */
  const TAGGER_LOC = "src/App.tsx:10:7";

  it("resolves the tagger's own output to the right element", () => {
    const parsed = parseLoc(TAGGER_LOC);
    expect(parsed).not.toBeNull();
    if (!parsed) return;

    const res = applyVisualEdit({
      content: SPIKE_APP,
      fileName: parsed.path,
      line: parsed.line,
      column: parsed.column,
      expectTag: "button",
      op: { kind: "text", value: "Sign up free" },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(">\n        Sign up free\n      <");
    expect(res.content).not.toContain("Click me");
  });

  it("still points at <button> and nothing else", () => {
    const parsed = parseLoc(TAGGER_LOC)!;
    // If the coordinate had drifted by even one line it would land on <h1> or
    // an attribute, and the tag guard is what would catch it in production.
    const wrong = applyVisualEdit({
      content: SPIKE_APP,
      fileName: parsed.path,
      line: parsed.line,
      column: parsed.column,
      expectTag: "h1",
      op: { kind: "text", value: "x" },
    });
    expect(wrong).toEqual({ ok: false, reason: "tag_mismatch" });
  });
});

describe("applyVisualEdit — the result still parses", () => {
  it("produces a file whose element structure is unchanged", () => {
    const hostile = `"><script>alert(1)</script><div class="`;
    const res = edit("h1", hostile);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // No new tags: everything was escaped into text.
    expect(res.content).not.toContain("<script>");
    expect(res.content.match(/<div/g)).toEqual(APP.match(/<div/g));
  });
});

// ── Attribute edits (image swap, plan §6 Phase 6) ────────────────────────────
// The op that makes "click the picture, change the picture" work. Its whole
// safety story is the allow-list plus `SRC_VALUE`: `src` and `alt` are inert
// data, and everything that could turn a value into markup or a scheme is
// refused rather than escaped.

function attrEdit(
  tag: string,
  name: "src" | "alt",
  value: string,
  overrides: Partial<{ expectTag: string; content: string }> = {},
): VisualEditResult {
  const content = overrides.content ?? STYLED;
  const lines = content.split("\n");
  const i = lines.findIndex((l) => l.trim().startsWith(`<${tag}`));
  if (i === -1) throw new Error(`no <${tag}> in fixture`);
  return applyVisualEdit({
    content,
    fileName: "src/Styled.tsx",
    line: i + 1,
    column: (lines[i] as string).indexOf("<") + 1,
    expectTag: overrides.expectTag ?? tag,
    op: { kind: "attr", name, value },
  });
}

describe("applyVisualEdit — attr op", () => {
  it("swaps an image src in place", () => {
    const res = attrEdit("img", "src", "/hero-ab12cd34.png");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain('<img src="/hero-ab12cd34.png"');
    // Everything else on the element survives — this is a splice, not a rewrite.
    expect(res.content).toContain('className="w-4"');
  });

  it("changes exactly one line", () => {
    // The same invariant the text and class ops hold: the diff goes to the
    // user's GitHub commit and to the agent as a USER_EDIT.
    const res = attrEdit("img", "src", "https://cdn.example.com/a.png");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const before = STYLED.split("\n");
    const after = res.content.split("\n");
    expect(after.length).toBe(before.length);
    expect(after.filter((l, i) => l !== before[i])).toHaveLength(1);
  });

  it("accepts absolute https and root-relative paths", () => {
    for (const src of [
      "https://cdn.example.com/a.png?v=2&w=800",
      "http://example.com/a.png",
      "/logo.svg",
    ]) {
      expect(attrEdit("img", "src", src).ok).toBe(true);
    }
  });

  it("refuses schemes and shapes that aren't an image path", () => {
    // `javascript:` is the reason this is an allow-list of shapes rather than a
    // deny-list of characters — it matters the moment `href` is ever added.
    for (const src of [
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "//evil.example.com/a.png",
      "a.png",
      "/a.png onerror=alert(1)",
      '/a.png" onerror="alert(1)',
      "",
    ]) {
      expect(attrEdit("img", "src", src)).toEqual({
        ok: false,
        reason: "invalid_attr_value",
      });
    }
  });

  it("escapes alt text instead of letting it close the attribute", () => {
    const res = attrEdit("img", "alt", 'A "quoted" <thing> & more');
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain(
      'alt="A &quot;quoted&quot; &lt;thing&gt; &amp; more"',
    );
    // The element still has exactly the attributes it started with, plus alt.
    expect(res.content).toContain('src="/a.png"');
    expect(res.content.match(/<img/g)).toHaveLength(1);
  });

  it("inserts the attribute when the element has none", () => {
    const res = attrEdit("img", "alt", "A landscape");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toContain('<img alt="A landscape" src="/a.png"');
  });

  it("allows an empty alt but never an empty src", () => {
    // `alt=""` marks a decorative image; `src=""` is just broken.
    expect(attrEdit("img", "alt", "").ok).toBe(true);
    expect(attrEdit("img", "src", "")).toEqual({
      ok: false,
      reason: "invalid_attr_value",
    });
  });

  it("refuses a computed src rather than guessing where it is built", () => {
    const dynamic = `export function D() {
  return (
    <div>
      <img src={hero} />
      <img src={\`/img/\${id}.png\`} className="x" />
    </div>
  )
}
`;
    expect(attrEdit("img", "src", "/a.png", { content: dynamic })).toEqual({
      ok: false,
      reason: "dynamic_attribute",
    });
  });

  it("is a no-op when the value is already set", () => {
    const res = attrEdit("img", "src", "/a.png");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.content).toBe(STYLED);
  });

  it("still honours the tag guard", () => {
    expect(attrEdit("img", "src", "/a.png", { expectTag: "div" })).toEqual({
      ok: false,
      reason: "tag_mismatch",
    });
  });

  it("rejects newlines in either attribute", () => {
    expect(attrEdit("img", "alt", "one\ntwo").ok).toBe(false);
  });
});

// ── Responsive variants (plan §6 Phase 6) ───────────────────────────────────
// The whole feature is a class prefix, so it needs no server change at all —
// which is exactly why it needs tests here. It rests entirely on tailwind-merge
// treating `max-md:`, `md:` and unprefixed as three independent conflict groups.
// If an upgrade collapsed any two of them, editing one breakpoint would silently
// wipe another and the only symptom would be "my phone layout changed by itself".

describe("mergeClasses — responsive variants", () => {
  it("keeps a breakpoint class alongside the base it overrides", () => {
    expect(mergeClasses("p-4", ["md:p-8"])).toBe("p-4 md:p-8");
    expect(mergeClasses("p-8", ["max-md:p-2"])).toBe("p-8 max-md:p-2");
  });

  it("treats the three widths as independent", () => {
    expect(mergeClasses("text-3xl", ["max-md:text-lg", "md:text-2xl"])).toBe(
      "text-3xl max-md:text-lg md:text-2xl",
    );
  });

  it("resolves conflicts within one breakpoint only", () => {
    // `md:p-8` supersedes `md:p-6` and leaves the base `p-4` untouched — the
    // property that lets the panel edit tablet without moving the phone layout.
    expect(mergeClasses("p-4 md:p-6", ["md:p-8"], ["md:p-6"])).toBe(
      "p-4 md:p-8",
    );
  });

  it("collapses shorthand within a breakpoint, as it does at base", () => {
    expect(mergeClasses("md:px-4 md:py-2", ["md:p-6"])).toBe("md:p-6");
  });

  it("dropping a breakpoint class lets the base show through again", () => {
    // What clicking the active option does at a breakpoint: remove the variant,
    // never the base.
    expect(mergeClasses("p-4 md:p-6", [], ["md:p-6"])).toBe("p-4");
  });

  it("still changes only one line, with untouched classes in place", () => {
    expect(
      mergeClasses("spike-card p-4 md:p-6 font-bold", ["md:p-8"], ["md:p-6"]),
    ).toBe("spike-card p-4 font-bold md:p-8");
  });

  it("accepts variant class names through the character guard", () => {
    // CLASS_TOKEN has to permit `:` and `-` for any of the above to reach the
    // file. A refusal here would surface as "that style isn't supported".
    const res = classEdit("h1", { add: ["md:text-4xl", "max-md:text-base"] });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.className).toBe("text-2xl font-bold md:text-4xl max-md:text-base");
  });
});
