import { describe, expect, test } from "bun:test";
import {
  checkFile,
  checkIndexHtml,
  checkPackageJson,
  checkScreenSource,
  checkStylesheet,
  findingKey,
  formatFindings,
  isCheckedPath,
  isScreenSource,
  type Finding,
} from "@/worker/design/checks";
import {
  DESIGN_CHECK_TAIL,
  GATE_TIMEOUT_MS,
  createWorkLog,
  finishItems,
  gateMessage,
  isSubstantialWork,
  noteWork,
  outstandingFindings,
  reshapedScreens,
  type GateItem,
} from "@/worker/agent/finishGate";
import { designContextOf, designFiles, designProse, resolveDesign } from "@/worker/design";
import {
  MAX_LOOKS_PER_SCREEN,
  MAX_REVIEWS_PER_RUN,
  MAX_REVIEW_PATHS,
  QUESTIONS,
  composeReport,
  designForReview,
  nextStep,
  normalizeRoute,
  pageOverflowFault,
  parseAnswers,
  parseVerdict,
  planReview,
  refusal,
  reviewBrief,
  reviewRoutes,
  screenCaption,
  sectionsPerView,
} from "@/worker/design/review";
import { sectionBounds } from "@/worker/lib/screenshot";
import { ALL_STYLES, STYLES } from "@/worker/design/styles";
import { BASE_APP_TOOLS } from "@/worker/agent/tools/tools";
import { buildSystemPrompt } from "@/worker/agent/config";

// Two things keep a generated app inside its design after the design is
// written: checks a program can make on the source, and a review of the
// rendered result by a model that can see (doc/CONTEXT_AND_MEMORY_PLAN.md §5).
// These tests are mostly about the first, and mostly about it being *right*:
// a check that cries wolf costs a turn and teaches the agent to ignore it.
// The rules were also run over nine real apps built in the design system
// (no findings) and four built before it (findings on every one).

const rules = (findings: Finding[]) => findings.map((f) => f.rule);
const screen = (body: string) => checkScreenSource("src/pages/Home.tsx", body);

describe("which files are checked", () => {
  test("screens the agent writes, and the three files a design lives in", () => {
    for (const p of ["src/App.tsx", "src/pages/Home.tsx", "src/components/Header.tsx", "./src/pages/A.jsx", "/home/user/app/src/App.tsx"]) {
      expect(isScreenSource(p)).toBe(true);
      expect(isCheckedPath(p)).toBe(true);
    }
    for (const p of ["package.json", "src/index.css", "index.html"]) expect(isCheckedPath(p)).toBe(true);
  });

  test("not the stock components, logic, the server, or tau's own files", () => {
    for (const p of ["src/components/ui/button.tsx", "src/lib/data.ts", "server/index.ts", ".tau/CONTEXT.md", "vite.config.ts"]) {
      expect(isCheckedPath(p)).toBe(false);
      expect(checkFile(p, 'className="bg-[#ff0000] text-blue-500"')).toEqual([]);
    }
  });
});

describe("colour outside the theme", () => {
  test("a literal in a class", () => {
    for (const cls of ["bg-[#1a1a1a]", "text-[#fff]", "border-[rgb(0,0,0)]", "from-[oklch(0.7_0.2_30)]", "shadow-[#00000040]"]) {
      expect(rules(screen(`<div className="p-4 ${cls}" />`))).toContain("color-literal");
    }
  });

  test("a literal in a style prop", () => {
    expect(rules(screen(`<div style={{ color: "#333" }} />`))).toEqual(["color-literal"]);
    expect(rules(screen(`<div style={{ backgroundColor: 'rgba(0,0,0,0.5)' }} />`))).toEqual(["color-literal"]);
  });

  test("Tailwind's own palette", () => {
    for (const cls of ["bg-blue-500", "text-slate-400", "border-zinc-200", "from-purple-600", "ring-emerald-500/40", "hover:bg-red-50"]) {
      expect(rules(screen(`<div className="${cls}" />`))).toContain("palette-color");
    }
  });

  test("tokens, white and black, and colour held as data are all fine", () => {
    const fine = `
      const SWATCHES = ["#ff0000", "#00ff00"]
      <div className="bg-primary text-primary-foreground border-border bg-chart-2/40 text-white bg-black/50" />
      <div style={{ background: "var(--primary)", width: \`\${pct}%\` }} />
      <div style={{ backgroundColor: swatch }} />
      <div className="bg-[url('/hero.jpg')] bg-cover" />`;
    expect(screen(fine)).toEqual([]);
  });
});

describe("type and shape outside the design", () => {
  test("a typeface that is not one of the design's three", () => {
    expect(rules(screen(`<h1 className="font-serif text-4xl" />`))).toEqual(["font"]);
    expect(rules(screen(`<p style={{ fontFamily: "Georgia" }} />`))).toEqual(["font"]);
    expect(rules(screen(`<p className="font-['Inter']" />`))).toContain("shape-literal");
  });

  test("the design's own font classes, and a numeric weight, are fine", () => {
    expect(screen(`<h1 className="font-heading font-sans font-mono font-semibold font-[650]" />`)).toEqual([]);
  });

  test("a one-off radius or shadow", () => {
    expect(rules(screen(`<div className="rounded-[14px]" />`))).toEqual(["shape-literal"]);
    expect(rules(screen(`<div className="shadow-[0_8px_30px_rgba(0,0,0,0.12)]" />`))).toEqual(["shape-literal"]);
    expect(rules(screen(`<div style={{ borderRadius: 12 }} />`))).toEqual(["shape-literal"]);
    expect(rules(screen(`<div style={{ boxShadow: "0 1px 2px black" }} />`))).toEqual(["shape-literal"]);
  });

  test("the scale, and arbitrary values that are not shape, are fine", () => {
    expect(
      screen(`<div className="rounded-lg shadow-md max-w-[65ch] text-[clamp(3rem,12vw,11rem)] grid-cols-[15rem_1fr] ease-[cubic-bezier(0.34,1.56,0.64,1)]" />`),
    ).toEqual([]);
  });

  test("gradient-filled text", () => {
    expect(rules(screen(`<h1 className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent" />`))).toEqual(["gradient-text"]);
    expect(screen(`<div className="bg-gradient-to-b from-background to-muted" />`)).toEqual([]);
  });
});

describe("classes the skin overrides", () => {
  test("shape on a component whose shape the skin sets", () => {
    const found = screen(`
      <Button className="w-full rounded-full">Save</Button>
      <Card className="shadow-xl p-6">…</Card>
      <Input className="rounded-none" />
      <Badge className="font-mono">New</Badge>`);
    expect(rules(found)).toEqual(["skin-bypass", "skin-bypass", "skin-bypass", "skin-bypass"]);
    expect(found[0]!.message).toContain("`rounded-full` on <Button> has no effect");
    expect(found[0]!.line).toBe(2);
    expect(found[1]!.message).toContain("`shadow-xl` on <Card>");
  });

  test("only what the skin really sets for that component", () => {
    // The skin does not set a typeface on fields or cards, nor a shadow on fields.
    expect(screen(`<Input className="font-mono shadow-sm" />`)).toEqual([]);
    expect(screen(`<Card className="font-mono">…</Card>`)).toEqual([]);
    // Layout and spacing are the agent's to decide everywhere.
    expect(screen(`<Button className="w-full mt-4 col-span-2" size="lg">Go</Button>`)).toEqual([]);
    // The same classes on a plain element do something, and are allowed.
    expect(screen(`<div className="rounded-full shadow-lg" />`)).toEqual([]);
  });

  test("reads a tag that spans lines and holds arrow functions", () => {
    const found = screen(`
      <Button
        variant="outline"
        onClick={() => setCount((c) => (c > 3 ? 0 : c + 1))}
        className={"rounded-xl"}
      >
        Count
      </Button>`);
    expect(rules(found)).toEqual(["skin-bypass"]);
    expect(found[0]!.line).toBe(2);
  });

  test("a variant-conditional class is left to the reviewer", () => {
    expect(screen(`<Button className={cn("w-full", big && "rounded-full")} />`)).toEqual([]);
  });
});

describe("content", () => {
  test("placeholder names and text", () => {
    for (const text of ["Lorem ipsum dolor sit amet", "Jane Doe, CEO", "Acme Inc.", "Feature One", "Your Company Here", "Card Title"]) {
      expect(rules(screen(`<p>${text}</p>`))).toEqual(["placeholder"]);
    }
  });

  test("stock marketing filler", () => {
    for (const text of ["Elevate your workflow", "Works seamlessly", "Unleash your potential", "Supercharge your team", "Take it to the next level", "A cutting-edge platform"]) {
      expect(rules(screen(`<h1>${text}</h1>`))).toEqual(["filler-copy"]);
    }
  });

  test("ordinary words, identifiers and field hints are not mistaken for either", () => {
    const fine = `
      const seamlessLoop = true
      const elevated = card.elevation > 2
      <Input placeholder="you@example.com" />
      <p>The lift elevates the bike so you can reach the chain.</p>
      <p>Johnny Doerr set up the shop in 2019.</p>
      // TODO: Lorem ipsum is fine in a comment`;
    expect(screen(fine)).toEqual([]);
  });

  test("an emoji standing in for an icon, with a way out when it is content", () => {
    const found = screen(`<span className="text-2xl">🚀</span>`);
    expect(rules(found)).toEqual(["emoji-icon"]);
    expect(found[0]!.message).toContain("Ignore this if the emoji is the content itself");
    // The plain symbols a terminal style is told to use are not emoji.
    expect(screen(`<span>→ ✓ × ● [ok]</span>`)).toEqual([]);
  });

  test("an image that is not the project's own", () => {
    expect(rules(screen(`<img src="https://picsum.photos/800/600" alt="" />`))).toEqual(["hotlinked-image"]);
    expect(rules(screen(`<img src="https://images.unsplash.com/photo-1.jpg" alt="Loaf" />`))).toEqual(["hotlinked-image"]);
    expect(rules(screen(`<img src={"https://cdn.example.org/a.png"} />`))).toEqual(["hotlinked-image"]);
    expect(screen(`<img src="/hero-loaf.jpg" alt="A loaf" />\n<a href="https://example.org/menu.pdf">Menu</a>`)).toEqual([]);
  });
});

describe("dependencies", () => {
  const pkg = (deps: Record<string, string>) => JSON.stringify({ dependencies: deps });

  test("a second component library or icon set", () => {
    const found = checkPackageJson(pkg({ react: "^19", "@mui/material": "^6", "react-icons": "^5", "styled-components": "^6" }));
    expect(found.map((f) => f.excerpt)).toEqual(["@mui/material", "react-icons", "styled-components"]);
    expect(found[0]!.message).toContain("bun remove @mui/material");
    expect(found[1]!.message).toContain("lucide-react");
  });

  test("what the scaffold ships with, and ordinary libraries, are fine", () => {
    expect(
      checkPackageJson(
        pkg({ "@base-ui/react": "^1", "lucide-react": "^1", "@radix-ui/react-slot": "^1", recharts: "^3", motion: "^12", "@fontsource-variable/geist": "^5", sonner: "^2" }),
        { style: STYLES.editorial },
      ),
    ).toEqual([]);
  });

  test("a typeface the design does not use — only when the design is one tau knows", () => {
    const deps = pkg({ "@fontsource-variable/fraunces": "^5", "@fontsource-variable/instrument-sans": "^5", "@fontsource/roboto": "^5" });
    const found = checkPackageJson(deps, { style: STYLES.editorial });
    expect(found.map((f) => f.excerpt)).toEqual(["@fontsource/roboto"]);
    expect(found[0]!.rule).toBe("font");
    // An imported design: tau cannot say which fonts are its.
    expect(checkPackageJson(deps, {})).toEqual([]);
  });

  test("every style's own fonts pass under that style", () => {
    for (const style of ALL_STYLES) {
      const deps: Record<string, string> = {};
      for (const font of Object.values(style.fonts)) if (font.pkg) deps[font.pkg] = "^5";
      expect(checkPackageJson(pkg(deps), { style })).toEqual([]);
    }
  });

  test("a file that is not JSON is somebody else's problem", () => {
    expect(checkPackageJson("{ not json")).toEqual([]);
  });
});

describe("the stylesheet and index.html", () => {
  const css = designFiles(
    resolveDesign({
      style: "soft", accent: "#7c9a6d", accentExact: false, mode: "light",
      dials: STYLES.soft.dials, read: "Reading this as: a test.", source: "director",
    }),
    { fontsInstalled: true },
  ).css;

  test("every stylesheet tau generates passes its own check", () => {
    for (const style of ALL_STYLES) {
      const generated = designFiles(
        resolveDesign({
          style: style.key, accent: "#c2410c", accentExact: false, mode: style.defaultMode,
          dials: style.dials, read: "Reading this as: a test.", source: "director",
        }),
        { fontsInstalled: true },
      ).css;
      expect(checkStylesheet(generated)).toEqual([]);
    }
  });

  test("each part that everything else depends on is noticed when it goes", () => {
    expect(checkStylesheet(css.replace("@layer skin {", "@layer other {")).map((f) => f.excerpt)).toEqual(["@layer skin"]);
    expect(checkStylesheet(css.replace(/prefers-reduced-motion/g, "prefers-contrast")).map((f) => f.excerpt)).toEqual(["prefers-reduced-motion"]);
    expect(checkStylesheet(css.replace('@import "shadcn/tailwind.css";\n', "")).map((f) => f.excerpt)).toEqual(["shadcn/tailwind.css"]);
    expect(checkStylesheet(css.replace(".dark {", ".night {")).map((f) => f.excerpt)).toEqual([":root / .dark"]);
  });

  test("a palette colour the theme panel could not edit", () => {
    const rewritten = css.replace(/--primary: #[0-9a-f]{6};/, "--primary: oklch(0.6 0.15 140);");
    const found = checkStylesheet(rewritten);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain("as hex");
    // Colour functions elsewhere in the file — the shadows — are not the palette.
    expect(css).toContain("color-mix(");
  });

  test("a typeface pulled from a font CDN", () => {
    const html = `<!doctype html>\n<html>\n<head>\n<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet" />\n</head></html>`;
    const found = checkIndexHtml(html);
    expect(found).toHaveLength(1);
    expect(found[0]!.line).toBe(4);
    expect(checkIndexHtml(`<html lang="en" class="dark"><head></head></html>`)).toEqual([]);
  });
});

describe("reporting", () => {
  const sample: Finding[] = Array.from({ length: 15 }, (_, i) => ({
    rule: "palette-color", path: "src/pages/Home.tsx", line: i + 1,
    message: "Use a token class.", excerpt: `bg-blue-${i}`,
  }));

  test("says where, what and what to do, and stops before it becomes a wall", () => {
    const text = formatFindings(sample, 12);
    expect(text.split("\n")).toHaveLength(13);
    expect(text).toContain("- src/pages/Home.tsx:1 — `bg-blue-0` — Use a token class.");
    expect(text).toContain("…and 3 more of the same kinds");
  });

  test("a whole-file finding has no line number", () => {
    expect(formatFindings([{ rule: "dependency", path: "package.json", line: 0, message: "Remove it.", excerpt: "antd" }]))
      .toBe("- package.json — `antd` — Remove it.");
  });

  test("the same fault is the same finding wherever its line moves", () => {
    expect(findingKey(sample[0]!)).toBe(findingKey({ ...sample[0]!, line: 99 }));
    expect(findingKey(sample[0]!)).not.toBe(findingKey(sample[1]!));
  });

  test("an app with no design is not checked; an imported design is, without the style rules", () => {
    expect(designContextOf(null)).toBeNull();
    expect(designContextOf("")).toBeNull();
    expect(designContextOf("---\nname: Imported\n---\n# Overview\nRed.")).toEqual({});
    const tauWritten = designFiles(
      resolveDesign({
        style: "luxe", accent: "#c8a45c", accentExact: false, mode: "dark",
        dials: STYLES.luxe.dials, read: "Reading this as: a test.", source: "director",
      }),
      { fontsInstalled: true },
    ).designMd;
    expect(designContextOf(tauWritten)).toEqual({ style: STYLES.luxe });
  });
});

// ── When a run is allowed to finish ──────────────────────────────────────────

describe("when the result is worth looking at", () => {
  const ok = { success: true };

  test("a new page or component is; one edited file is not", () => {
    const built = createWorkLog();
    noteWork(built, "create_file", { path: "src/pages/Pricing.tsx" }, ok);
    expect(reshapedScreens(built)).toBe(true);

    const tweaked = createWorkLog();
    noteWork(tweaked, "edit_file", { path: "src/pages/Home.tsx" }, ok);
    noteWork(tweaked, "edit_file", { path: "src/index.css" }, ok);
    expect(reshapedScreens(tweaked)).toBe(false);
  });

  test("edits across three screens are; new logic or server files are not", () => {
    const spread = createWorkLog();
    for (const p of ["src/App.tsx", "src/pages/Home.tsx", "src/components/Header.tsx"]) {
      noteWork(spread, "edit_file", { path: p }, ok);
    }
    expect(reshapedScreens(spread)).toBe(true);

    const backend = createWorkLog();
    noteWork(backend, "create_file", { path: "server/routes/orders.ts" }, ok);
    noteWork(backend, "create_file", { path: "src/lib/orders.ts" }, ok);
    expect(reshapedScreens(backend)).toBe(false);
    // …though it is still work the memory should record.
    expect(isSubstantialWork(backend)).toBe(true);
  });
});

describe("the message sent back in place of finishing", () => {
  const item = (kind: GateItem["kind"], text: string): GateItem => ({ kind, reason: "test", text });

  test("one thing owed is stated plainly", () => {
    const text = gateMessage([item("memory", "**Update the app's memory.** It is stale.")]);
    expect(text.startsWith("Before you finish, one thing is still owed.\n\n**Update the app's memory.**")).toBe(true);
    expect(text).toContain("Do not repeat the summary you already gave");
  });

  test("several are numbered in the order given, in one message", () => {
    const text = gateMessage([
      item("design_check", "**Fix these design faults**:\n- a\n- b"),
      item("design_review", "**Have the result looked at.**"),
      item("memory", "**Update the app's memory.**"),
    ]);
    expect(text).toContain("3 things are still owed. Do them in this order.");
    expect(text.indexOf("1. **Fix these design faults**")).toBeLessThan(text.indexOf("2. **Have the result looked at.**"));
    expect(text.indexOf("2. **Have the result looked at.**")).toBeLessThan(text.indexOf("3. **Update the app's memory.**"));
    expect(text.match(/Then close with one short sentence/g)).toHaveLength(1);
  });
});

// In a real run the agent gave its final answer and the run then sat
// unfinished for nine minutes: working out what was owed meant reading files
// from the sandbox, and one read never came back.
describe("the end-of-run checks may not hold a run open", () => {
  const input = (sandbox: { files: { read(path: string): Promise<string> } }) => {
    const work = createWorkLog();
    noteWork(work, "edit_file", { path: "src/pages/Home.tsx" }, { success: true });
    return {
      generation: 2 as const, effort: "HIGH" as const, work, filesChanged: true,
      verifierRan: false, reviewerRan: false, design: {}, reported: new Set<string>(),
      sandbox, projectId: "p", userId: "u",
    };
  };
  const drifted = {
    files: {
      read: async (path: string) => {
        if (path.endsWith("src/pages/Home.tsx")) return '<p className="text-blue-500">Opening hours</p>';
        throw new Error("no such file");
      },
    },
  };

  test("a sandbox that never answers costs the checks, not the run", async () => {
    const stalled = { files: { read: () => new Promise<string>(() => {}) } };
    const state = new Set<GateItem["kind"]>();
    const started = Date.now();
    expect(await finishItems(input(stalled), state, 40)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(2_000);
    // Nothing was asked for, so nothing counts as having been asked.
    expect(state.size).toBe(0);
    expect(GATE_TIMEOUT_MS).toBeLessThanOrEqual(30_000);
  });

  test("what is owed is asked for once, and not again", async () => {
    const state = new Set<GateItem["kind"]>();
    const first = await finishItems(input(drifted), state);
    expect(first.map((item) => item.kind)).toEqual(["design_check"]);
    expect(first[0]!.text).toContain("`text-blue-500`");
    expect(first[0]!.text).toContain("If the user asked for one of these in so many words");
    expect(await finishItems(input(drifted), state)).toEqual([]);
  });
});

describe("the design reviewer", () => {
  test("routes are tidied and de-duplicated, and default to the home page", () => {
    expect(reviewRoutes(undefined)).toEqual(["/"]);
    expect(reviewRoutes([])).toEqual(["/"]);
    expect(reviewRoutes(["/", "about", "/about", " /pricing?plan=pro#top ", "https://x.e2b.app/contact", 7, ""])).toEqual(["/", "/about", "/pricing", "/contact"]);
    expect(normalizeRoute("//docs//intro")).toBe("/docs/intro");
  });

  test("a report with something broken needs fixing, whatever its first line says", () => {
    expect(parseVerdict("VERDICT: fix\n\n1. [broken] `/` phone — the table is cut off.")).toBe("fix");
    expect(parseVerdict("VERDICT: pass\n\n1. [Broken] `/` phone — the table is cut off.")).toBe("fix");
  });

  test("a report with only polish passes, whatever its first line says", () => {
    expect(parseVerdict("VERDICT: fix\n\n1. [polish] `/` desktop — every section is built the same way.")).toBe("pass");
    expect(parseVerdict("VERDICT: pass")).toBe("pass");
  });

  test("with no marks, the first line decides", () => {
    expect(parseVerdict("VERDICT: fix\n\n1. The table is cut off.")).toBe("fix");
    expect(parseVerdict("Verdict: PASS")).toBe("pass");
    expect(parseVerdict("Looks mostly fine to me.")).toBe("unknown");
  });

  test("is a tool on new projects, described as the thing that can see", () => {
    const tool = BASE_APP_TOOLS.find((t) => t.function.name === "dispatch_design_reviewer")!;
    expect(tool.function.description).toContain("never see it rendered");
    expect(tool.function.description).toContain("two looks in a run and no more");
    expect(JSON.stringify(tool.function.parameters.properties)).toContain(`At most ${MAX_REVIEW_PATHS} in one call`);
    expect(Object.keys(tool.function.parameters.properties)).toEqual(["paths", "focus"]);
  });

  test("the prompt says what it is for and when to use it, and that files are checked", () => {
    const prompt = buildSystemPrompt({ templateKey: "v2-frontend" });
    expect(prompt).toContain("`dispatch_design_reviewer` — you never see what you build; this does.");
    expect(prompt).toContain("tau will not look at it a third time");
    expect(prompt).toContain("comes back in that tool's result as `designCheck`");
  });
});

// A reviewer asked what is wrong will always find something, and a builder
// that acts on every answer rebuilds the screen each time. The first real run
// reviewed the same three pages four times, the later reports undoing the
// earlier ones. So how many looks a screen gets is tau's decision.
describe("how many looks a screen gets", () => {
  const first = { routes: ["/", "/classes"], review: "VERDICT: fix\n\n1. [broken] `/classes` phone — two columns are missing." };
  const second = { routes: ["/classes"], review: "VERDICT: pass" };

  test("the first look at a screen is a review, with nothing to compare against", () => {
    const plan = planReview(["/", "/classes"], []);
    expect(plan.fresh).toEqual(["/", "/classes"]);
    expect(plan.recheck).toEqual([]);
    expect(plan.earlier).toEqual([]);
    expect(refusal(plan)).toBeNull();
  });

  test("the second is a re-check against what was said the first time", () => {
    const plan = planReview(["/classes", "/visit"], [first]);
    expect(plan.recheck).toEqual(["/classes"]);
    // A screen not seen before gets its review in the same call.
    expect(plan.fresh).toEqual(["/visit"]);
    expect(plan.earlier).toEqual([first.review]);
    expect(refusal(plan)).toBeNull();
  });

  test("there is no third", () => {
    const plan = planReview(["/classes"], [first, second]);
    expect(plan.closed).toEqual(["/classes"]);
    expect(plan.fresh.length + plan.recheck.length).toBe(0);
    expect(refusal(plan)).toContain("`/classes` has had both");
    expect(refusal(plan)).toContain("Do not call this again");
  });

  test("a closed screen does not stop the others in the same request being looked at", () => {
    const plan = planReview(["/classes", "/"], [first, second]);
    expect(plan.closed).toEqual(["/classes"]);
    expect(plan.recheck).toEqual(["/"]);
    // Only reports that covered a re-check screen are shown again.
    expect(plan.earlier).toEqual([first.review]);
    expect(refusal(plan)).toBeNull();
  });

  test("what does not fit in one review is said to be left over, not dropped", () => {
    const plan = planReview(["/a", "/b", "/c", "/d", "/e"], []);
    expect(plan.fresh).toHaveLength(MAX_REVIEW_PATHS);
    expect(plan.overLimit).toEqual(["/e"]);
  });

  test("a run has a fixed number of reviews, however many screens it has", () => {
    const past = Array.from({ length: MAX_REVIEWS_PER_RUN }, (_, i) => ({ routes: [`/p${i}`], review: "VERDICT: pass" }));
    const plan = planReview(["/new"], past);
    expect(plan.exhausted).toBe(true);
    expect(refusal(plan)).toContain("all its design reviews");
    expect(MAX_LOOKS_PER_SCREEN).toBe(2);
  });
});

describe("what the builder is told to do with a report", () => {
  test("after a first look with faults: fix what is broken, one more look allowed", () => {
    const text = nextStep({ fresh: ["/", "/classes"], recheck: [] }, "fix");
    expect(text).toContain("Fix every [broken] finding with the smallest change");
    expect(text).toContain("A [polish] finding is optional");
    expect(text).toContain("once more for `/`, `/classes`");
    expect(text).toContain("the last look they get");
  });

  test("after a re-check with faults: these screens are closed", () => {
    const text = nextStep({ fresh: [], recheck: ["/classes"] }, "fix");
    expect(text).toContain("`/classes` has now had both looks and will not be reviewed again");
    expect(text).not.toContain("once more");
  });

  test("a pass asks for nothing, and says not to look again", () => {
    const text = nextStep({ fresh: ["/"], recheck: [] }, "pass");
    expect(text).toContain("need no second look");
    expect(text).not.toContain("Fix every");
  });
});

describe("what the reviewer is told before the pictures", () => {
  test("a first review carries the design and nothing about earlier reports", () => {
    const brief = reviewBrief({ designProse: "Square corners. No shadows.", recheck: [], earlier: [] });
    expect(brief).toContain("Square corners. No shadows.");
    expect(brief).not.toContain("re-check");
    expect(brief.endsWith("The screenshots follow.")).toBe(true);
  });

  test("a re-check carries the earlier report and the rule against new opinions", () => {
    const brief = reviewBrief({
      designProse: "Square corners.",
      focus: "the timetable on a phone",
      recheck: ["/classes"],
      earlier: ["VERDICT: fix\n\n1. [broken] `/classes` phone — two columns are missing."],
    });
    expect(brief).toContain('marked "re-check": `/classes`');
    expect(brief).toContain("<earlier_report>\nVERDICT: fix");
    expect(brief).toContain("A change made to fix an earlier finding is not itself a fault");
    expect(brief).toContain('Answer "no" to the last question for a re-check screen');
    expect(brief).toContain("look in particular at: the timetable on a phone");
  });

  test("an app with no written design is not asked about style", () => {
    expect(reviewBrief({ designProse: null, recheck: [], earlier: [] })).toContain("no written design");
  });

  // A DESIGN.md is written for the builder. Given all of it, the reviewer
  // found a "violation" for every line it could loosely attach to a picture.
  test("of a design tau wrote, it gets what shows and none of the building instructions", () => {
    for (const style of ALL_STYLES) {
      const prose = designProse(
        designFiles(
          resolveDesign({
            style: style.key, accent: "#3b6ea5", accentExact: false, mode: "light",
            dials: style.dials, read: "Reading this as: a test.", source: "director",
          }),
          { fontsInstalled: true },
        ).designMd,
      );
      const seen = designForReview(prose);
      for (const kept of ["## Overview", "## Colors", "## Typography", "## Elevation & Depth", "## Shapes"]) {
        expect(seen).toContain(kept);
      }
      for (const dropped of ["## Layout", "## Components", "## Do's and Don'ts", "Variance", "Density", "Colour only through tokens"]) {
        expect(seen).not.toContain(dropped);
      }
      // The typefaces are named; nothing is said about their size in pixels.
      expect(seen).toContain("`font-sans`");
      expect(seen).not.toMatch(/\d+px body/);
      expect(seen).toContain("Reading this as: a test.");
      expect(seen.length).toBeLessThan(prose.length / 2);
    }
  });

  test("a design from somewhere else, with its own headings, is passed whole", () => {
    const imported = "# Brand\n\n## Palette\nRed and black.\n\n## Voice\nShort sentences.";
    expect(designForReview(imported)).toBe(imported);
  });
});

// A still picture cannot show that an area scrolls. Without being told, the
// reviewer reported a table that scrolls sideways as cut off, the builder
// stacked it, and the next review called the stack too sparse.
describe("what a picture is captioned with", () => {
  const screen = { path: "/pricing", view: "phone" as const, pageHeight: 1300, capturedHeight: 1300, overflowX: 0 };

  test("which screen, at what width, and how much of it", () => {
    expect(screenCaption({ ...screen, width: 390, sideScrollers: [] }, false)).toBe(
      "Screen `/pricing` — phone, 390px wide, the whole page.",
    );
    expect(screenCaption({ ...screen, pageHeight: 2400, capturedHeight: 1500, width: 390, sideScrollers: [] }, true)).toBe(
      "Screen `/pricing` (re-check) — phone, 390px wide, the top 1500px of a page 2400px tall.",
    );
  });

  // A one-page site is five or eight thousand pixels tall. Shown only its
  // top, the reviewer never saw the timetable or the prices — the parts that
  // had broken on a phone in the run before.
  test("a long page is cut into equal pictures, top to bottom, and the rest is said to be unseen", () => {
    expect(sectionBounds(900, 2000, 4)).toEqual([{ from: 0, to: 900 }]);
    // A little over one picture: two halves, not a picture and a sliver.
    expect(sectionBounds(2100, 2000, 4)).toEqual([{ from: 0, to: 1050 }, { from: 1050, to: 2100 }]);
    expect(sectionBounds(5228, 2000, 4)).toEqual([
      { from: 0, to: 1743 },
      { from: 1743, to: 3486 },
      { from: 3486, to: 5228 },
    ]);
    // Longer than the pictures allowed: they cover the top, in full-size pieces.
    expect(sectionBounds(8215, 1500, 4).map((b) => b.to)).toEqual([1500, 3000, 4500, 6000]);
    expect(sectionBounds(8215, 1500, 1)).toEqual([{ from: 0, to: 1500 }]);
  });

  test("the fewer screens in a review, the further down each one it goes", () => {
    expect([1, 2, 3, 4].map(sectionsPerView)).toEqual([4, 3, 2, 1]);
    for (const screens of [1, 2, 3, MAX_REVIEW_PATHS]) {
      expect(sectionsPerView(screens) * screens * 2).toBeLessThanOrEqual(12);
    }
  });

  test("each picture of a long page says which part of it this is", () => {
    const long = { ...screen, pageHeight: 8215, capturedHeight: 6000, width: 390, sideScrollers: ["Mon Tue Wed"] };
    const first = screenCaption(long, false, { index: 0, count: 4, from: 0, to: 1500 });
    expect(first.split("\n")[0]).toBe(
      "Screen `/pricing` — phone, 390px wide, part 1 of 4: from 0px to 1500px down a page 8215px tall.",
    );
    // What was measured is about the whole screen, and is said once.
    expect(first).toContain("Measured: one area on this screen scrolls sideways");
    const last = screenCaption(long, false, { index: 3, count: 4, from: 4500, to: 6000 });
    expect(last).toBe(
      "Screen `/pricing` — phone, 390px wide, part 4 of 4: from 4500px to 6000px down a page 8215px tall. The page goes on below this picture.",
    );
    // A page the pictures reach the bottom of does not say so.
    const whole = screenCaption({ ...long, pageHeight: 6000 }, false, { index: 3, count: 4, from: 4500, to: 6000 });
    expect(whole).not.toContain("goes on below");
    // One picture is captioned as it always was.
    expect(screenCaption({ ...screen, width: 390, sideScrollers: [] }, false, { index: 0, count: 1, from: 0, to: 1300 })).toBe(
      "Screen `/pricing` — phone, 390px wide, the whole page.",
    );
  });

  test("an area that scrolls sideways is said to, so its edge is not read as a cut", () => {
    const caption = screenCaption({ ...screen, width: 390, sideScrollers: ["What you get Boulder Pass"] }, false);
    expect(caption).toContain('Measured: one area on this screen scrolls sideways, beginning "What you get Boulder Pass".');
    expect(caption).toContain("reached by scrolling");
  });

  test("a page wider than its window is said to be a fault, and reported by tau itself", () => {
    const wide = { ...screen, overflowX: 418 };
    expect(screenCaption({ ...wide, width: 390, sideScrollers: [] }, false)).toContain("418px wider than the window");
    expect(pageOverflowFault(wide)).toContain("[broken] Overflow — `/pricing` phone: tau measured the page as 418px wider");
    // A few pixels is rounding.
    expect(pageOverflowFault({ ...screen, overflowX: 3 })).toBeNull();
    expect(screenCaption({ ...screen, overflowX: 3, width: 390, sideScrollers: [] }, false)).not.toContain("Measured");
  });
});

// Asked "what is wrong with this?", the model found four things wrong with an
// app that had nothing wrong, different ones each run. Asked yes-or-no
// questions it answers "no", and the report is built here from the answers.
describe("the reviewer's answers", () => {
  const clean = QUESTIONS.map((_, i) => `Q${i + 1}: no`).join("\n");

  test("there are seven questions, the last the only matter of taste", () => {
    expect(QUESTIONS).toHaveLength(7);
    expect(QUESTIONS.map((q) => q.kind)).toEqual(["broken", "broken", "broken", "broken", "broken", "broken", "polish"]);
  });

  test("seven noes is a pass with nothing to do", () => {
    const answers = parseAnswers(clean);
    expect(answers).toHaveLength(7);
    expect(answers.every((a) => !a.yes)).toBe(true);
    expect(composeReport(answers)).toEqual({ review: "VERDICT: pass", verdict: "pass" });
  });

  test("a yes becomes a numbered finding, marked by what its question is about", () => {
    const answers = parseAnswers(
      clean
        .replace("Q1: no", "Q1: yes — `/pricing` phone, the table: the third column runs off the screen. Fix: wrap it in a scrolling container.")
        .replace("Q7: no", "Q7: yes — `/` desktop: a centred headline over three equal cards. Fix: vary the sections."),
    );
    const { review, verdict } = composeReport(answers);
    expect(verdict).toBe("fix");
    expect(review.split("\n")).toEqual([
      "VERDICT: fix",
      "1. [broken] Overflow — `/pricing` phone, the table: the third column runs off the screen. Fix: wrap it in a scrolling container.",
      "2. [polish] Template — `/` desktop: a centred headline over three equal cards. Fix: vary the sections.",
    ]);
  });

  test("taste alone does not make a screen need fixing", () => {
    const answers = parseAnswers(clean.replace("Q7: no", "Q7: yes — `/` desktop: looks like a template."));
    expect(composeReport(answers).verdict).toBe("pass");
    expect(composeReport(answers).review).toContain("1. [polish] Template");
  });

  test("on a re-check, taste is not reported at all", () => {
    const answers = parseAnswers(clean.replace("Q7: no", "Q7: yes — `/` desktop: looks like a template."));
    expect(composeReport(answers, [], false)).toEqual({ review: "VERDICT: pass", verdict: "pass" });
  });

  test("what tau measured comes first, and is a fault whatever the answers say", () => {
    const fault = pageOverflowFault({ path: "/", view: "phone", overflowX: 120 })!;
    const { review, verdict } = composeReport(parseAnswers(clean), [fault]);
    expect(verdict).toBe("fix");
    expect(review.split("\n")[1]).toBe(`1. ${fault}`);
  });

  test("answers are read whatever the model wraps them in, and anything else is ignored", () => {
    const answers = parseAnswers(
      "Here are my answers:\n**Q1:** No\nQ2. yes - `/` phone, the header: the logo sits on the menu button.\nQ3: NO\nQ9: yes — not a question\nQ2: yes — said twice\nThanks!",
    );
    expect(answers).toEqual([
      { question: 1, yes: false, detail: "" },
      { question: 2, yes: true, detail: "`/` phone, the header: the logo sits on the menu button." },
      { question: 3, yes: false, detail: "" },
    ]);
  });

  test("a reply that ignores the format has no answers to read", () => {
    expect(parseAnswers("The page looks mostly fine to me.")).toEqual([]);
  });
});

// The checks cannot tell drift from a request. In a real run the user asked for
// a rocket emoji and a script font; the agent kept both, as it should, and was
// then asked about them again at the end — which bought a second closing
// message saying "you asked for these, so I kept them".
describe("a fault the user asked for", () => {
  const ok = { success: true };
  const pkg = (deps: string[]) =>
    JSON.stringify({ dependencies: Object.fromEntries(deps.map((d) => [d, "^1.0.0"])) });
  /** A sandbox that holds these files and nothing else. */
  const sandboxWith = (files: Record<string, string>) => ({
    files: {
      read: async (path: string) => {
        const text = files[path.replace(/^\/home\/user\/app\//, "")];
        if (text === undefined) throw new Error(`no such file: ${path}`);
        return text;
      },
    },
  });
  const touched = (...paths: string[]) => {
    const work = createWorkLog();
    for (const p of paths) noteWork(work, "edit_file", { path: p }, ok);
    return work;
  };
  const banner = '<div className="bg-promo">\n  <span aria-hidden>🚀</span> Summer sale\n</div>';
  const emojiKey = findingKey(checkFile("src/pages/Home.tsx", banner)[0]!);

  test("is kept as part of the design rather than written into a screen", () => {
    expect(DESIGN_CHECK_TAIL.startsWith("Fix these now.")).toBe(true);
    expect(DESIGN_CHECK_TAIL).toContain("If the user asked for one of these in so many words");
    expect(DESIGN_CHECK_TAIL).toContain("`src/index.css`");
    expect(DESIGN_CHECK_TAIL).toContain("`.tau/DESIGN.md`");
  });

  test("a typeface the design names is part of the design", () => {
    const ctx = { style: STYLES.workbench };
    const deps = pkg(["@fontsource/pacifico", "@fontsource-variable/playfair-display"]);
    expect(checkPackageJson(deps, ctx).map((f) => f.excerpt)).toEqual([
      "@fontsource/pacifico",
      "@fontsource-variable/playfair-display",
    ]);
    const named = { ...ctx, designText: "- **Pacifico** — `font-fun`. The promo banner's headline only." };
    expect(checkPackageJson(deps, named).map((f) => f.excerpt)).toEqual(["@fontsource-variable/playfair-display"]);
    const both = { ...ctx, designText: "Headlines in Playfair Display, the banner in pacifico." };
    expect(checkPackageJson(deps, both)).toEqual([]);
  });

  test("at the end of a run, a font is judged against the design as it stands then", async () => {
    const ctx = { style: STYLES.workbench };
    const before = sandboxWith({ "package.json": pkg(["@fontsource/pacifico"]), ".tau/DESIGN.md": "# Design\nIBM Plex Sans." });
    expect((await outstandingFindings(ctx, createWorkLog(), before)).map((f) => f.rule)).toEqual(["font"]);
    const after = sandboxWith({ "package.json": pkg(["@fontsource/pacifico"]), ".tau/DESIGN.md": "# Design\nIBM Plex Sans. Pacifico on the banner." });
    expect(await outstandingFindings(ctx, createWorkLog(), after)).toEqual([]);
  });

  test("an emoji the agent was told about and kept is not raised a second time", async () => {
    const sandbox = sandboxWith({ "src/pages/Home.tsx": banner });
    const work = touched("src/pages/Home.tsx");
    // Never reported: the end of the run is the first it hears of it.
    expect((await outstandingFindings({}, work, sandbox)).map((f) => f.rule)).toEqual(["emoji-icon"]);
    // Reported when the file was written, and still there: its choice.
    expect(await outstandingFindings({}, work, sandbox, new Set([emojiKey]))).toEqual([]);
  });

  test("a fault nobody asks for is raised again however often it was reported", async () => {
    const page = '<p className="text-blue-500">Lorem ipsum dolor sit amet</p>';
    const sandbox = sandboxWith({ "src/pages/Home.tsx": page });
    const reported = new Set(checkFile("src/pages/Home.tsx", page).map(findingKey));
    const left = await outstandingFindings({}, touched("src/pages/Home.tsx"), sandbox, reported);
    expect(left.map((f) => f.rule).sort()).toEqual(["palette-color", "placeholder"]);
  });

  test("only files the run touched are looked at, plus its dependencies", async () => {
    const sandbox = sandboxWith({
      "src/pages/Home.tsx": banner,
      "src/pages/Old.tsx": '<p className="text-blue-500">x</p>',
      "package.json": pkg(["react-icons"]),
    });
    const left = await outstandingFindings({}, touched("src/pages/Home.tsx"), sandbox);
    expect(left.map((f) => `${f.path}:${f.rule}`).sort()).toEqual(["package.json:dependency", "src/pages/Home.tsx:emoji-icon"]);
  });
});
