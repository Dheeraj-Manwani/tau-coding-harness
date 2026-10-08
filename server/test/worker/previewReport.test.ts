import { describe, expect, test } from "bun:test";
import {
  MAX_CONSOLE,
  MAX_EXCEPTIONS,
  MAX_FAILED_REQUESTS,
  MAX_REPORT_CHARS,
  buildReport,
  fitReport,
  formatConsoleArgs,
  classify,
  compactStack,
  describeFindings,
  isBroken,
  shortUrl,
  type RawDom,
  type RawInspection,
} from "@/worker/lib/previewReport";
import { blockedUrlPatterns, normalizePath } from "@/worker/lib/previewInspect";

// What tau's browser saw while an app loaded, turned into a verdict and the few
// lines that explain it (doc/PREVIEW_DIAGNOSTICS_PLAN.md §3.1). The judgement
// is all here, with no browser involved, so it can be pinned.

const ORIGIN = "https://5173-abc123.e2b.app";

const dom = (over: Partial<RawDom> = {}): RawDom => ({
  title: "Corner Bakery",
  rootEmpty: false,
  visibleText: "Opening hours Monday to Friday",
  headings: ["Opening hours"],
  overlay: null,
  ...over,
});

const raw = (over: Partial<RawInspection> = {}): RawInspection => ({
  origin: ORIGIN,
  path: "/",
  httpStatus: 200,
  exceptions: [],
  console: [],
  requests: [{ method: "GET", url: `${ORIGIN}/`, type: "Document", status: 200 }],
  dom: dom(),
  stepsFailed: [],
  ...over,
});

const thrown = (message: string, file = "src/pages/Home.tsx") => ({
  message,
  frames: [
    { fn: "Home", url: `${ORIGIN}/${file}?t=1759900000000`, line: 42, col: 18 },
    { fn: "renderWithHooks", url: `${ORIGIN}/node_modules/.vite/deps/react-dom_client.js?v=9f2c`, line: 4200, col: 3 },
    { fn: "updateFunctionComponent", url: `${ORIGIN}/node_modules/.vite/deps/react-dom_client.js?v=9f2c`, line: 5100, col: 9 },
    { fn: "App", url: `${ORIGIN}/src/App.tsx?t=1759900000000`, line: 12, col: 5 },
  ],
});

describe("the verdict", () => {
  test("an app that drew something and logged nothing has rendered", () => {
    expect(classify(raw())).toBe("rendered");
  });

  test("an empty root with an error thrown is a crash; without one it is blank", () => {
    const empty = dom({ rootEmpty: true, visibleText: "", headings: [] });
    expect(classify(raw({ dom: empty, exceptions: [thrown("TypeError: x is undefined")] }))).toBe("crashed");
    expect(classify(raw({ dom: empty }))).toBe("blank");
  });

  test("Vite's overlay is a build error, whatever else happened", () => {
    const overlay = { message: "Unexpected token (12:4)", file: "/home/user/app/src/App.tsx:12:4", frame: "> 12 | <div" };
    const report = buildReport(raw({ dom: dom({ rootEmpty: true, overlay }), exceptions: [thrown("SyntaxError")] }));
    expect(report.status).toBe("build_error");
    // The path the agent's file tools take, not the sandbox's.
    expect(report.buildError?.file).toBe("src/App.tsx");
    expect(report.buildError?.frame).toContain("> 12 |");
  });

  test("a module the dev server answers 500 for is a build error, with its body as the message", () => {
    const report = buildReport(
      raw({
        dom: dom({ rootEmpty: true }),
        requests: [
          { method: "GET", url: `${ORIGIN}/`, type: "Document", status: 200 },
          {
            method: "GET",
            url: `${ORIGIN}/src/pages/Menu.tsx?t=1`,
            type: "Script",
            status: 500,
            body: 'Failed to resolve import "./missing" from "src/pages/Menu.tsx". Does the file exist?',
          },
        ],
      }),
    );
    expect(report.status).toBe("build_error");
    expect(report.buildError).toEqual({
      message: 'Failed to resolve import "./missing" from "src/pages/Menu.tsx". Does the file exist?',
      file: "src/pages/Menu.tsx",
    });
  });

  test("a screen that is up but threw, or whose own request failed, has rendered with errors", () => {
    expect(classify(raw({ exceptions: [thrown("Error: sign in is not wired")] }))).toBe("rendered_with_errors");
    const apiDown = { method: "GET", url: `${ORIGIN}/api/items`, type: "Fetch", status: 500 };
    expect(classify(raw({ requests: [apiDown] }))).toBe("rendered_with_errors");
  });

  test("somebody else's server failing does not make the app broken, but is still listed", () => {
    const theirs = { method: "GET", url: "https://images.example.com/a.jpg?w=800", type: "Image", status: 404 };
    const report = buildReport(raw({ requests: [theirs] }));
    expect(report.status).toBe("rendered");
    expect(report.network?.failed).toEqual([{ method: "GET", url: "https://images.example.com/a.jpg", status: 404 }]);
  });

  test("a page that never answered, or answered with a gateway error, was not reached", () => {
    expect(classify(raw({ httpStatus: undefined, navigationError: "net::ERR_CONNECTION_REFUSED", dom: null }))).toBe("unreachable");
    const gateway = buildReport(raw({ httpStatus: 502, dom: dom({ rootEmpty: true }) }));
    expect(gateway.status).toBe("unreachable");
    expect(gateway.summary).toContain("502");
  });

  test("running out of time on an empty page is not proof that it is blank", () => {
    const empty = dom({ rootEmpty: true });
    expect(classify(raw({ dom: empty, timedOut: true }))).toBe("unreachable");
    // An error seen before time ran out is still an error.
    expect(classify(raw({ dom: empty, timedOut: true, exceptions: [thrown("TypeError")] }))).toBe("crashed");
  });

  test("only the states where the user sees nothing count as broken", () => {
    expect((["blank", "crashed", "build_error"] as const).every(isBroken)).toBe(true);
    expect((["rendered", "rendered_with_errors", "unreachable"] as const).some(isBroken)).toBe(false);
  });
});

describe("what the agent is shown", () => {
  test("a clean result is small: no empty lists, no advice", () => {
    const report = buildReport(raw());
    expect(Object.keys(report).sort()).toEqual(["document", "path", "rendered", "status", "summary"]);
    expect(JSON.stringify(report).length).toBeLessThan(400);
  });

  test("sandbox URLs become the paths the agent's own tools take", () => {
    expect(shortUrl(`${ORIGIN}/src/App.tsx?t=1759900000000`, ORIGIN)).toBe("src/App.tsx");
    expect(shortUrl(`${ORIGIN}/node_modules/.vite/deps/react.js?v=ab12`, ORIGIN)).toBe("node_modules/.vite/deps/react.js");
    expect(shortUrl(`${ORIGIN}/@fs/home/user/app/src/lib/utils.ts`, ORIGIN)).toBe("src/lib/utils.ts");
    // A route keeps its slash and the query that is part of the request.
    expect(shortUrl(`${ORIGIN}/api/items?page=2`, ORIGIN)).toBe("/api/items?page=2");
    expect(shortUrl("https://cdn.example.com/lib.js?token=abc", ORIGIN)).toBe("https://cdn.example.com/lib.js");
  });

  test("a stack keeps the app's frames and folds each run of library frames into one line", () => {
    const stack = compactStack(thrown("x").frames, ORIGIN);
    expect(stack).toEqual([
      "Home (src/pages/Home.tsx:42:18)",
      "… 2 frames in libraries",
      "App (src/App.tsx:12:5)",
    ]);
  });

  test("an exception names where in the app it was thrown", () => {
    const report = buildReport(raw({ dom: dom({ rootEmpty: true }), exceptions: [thrown("TypeError: Cannot read properties of undefined (reading 'map')")] }));
    expect(report.exceptions).toEqual([
      {
        message: "TypeError: Cannot read properties of undefined (reading 'map')",
        at: "src/pages/Home.tsx:42:18",
        stack: ["Home (src/pages/Home.tsx:42:18)", "… 2 frames in libraries", "App (src/App.tsx:12:5)"],
        count: 1,
      },
    ]);
    expect(report.next).toContain("first exception");
    expect(report.note).toContain("a few off");
  });

  test("the same fault seen many times is one entry with a count", () => {
    const report = buildReport(raw({ exceptions: Array.from({ length: 40 }, () => thrown("Error: again")) }));
    expect(report.exceptions).toHaveLength(1);
    expect(report.exceptions![0]!.count).toBe(40);
  });

  test("every list is capped, and says how much it left out", () => {
    const report = buildReport(
      raw({
        exceptions: Array.from({ length: 9 }, (_, i) => thrown(`Error: number ${i}`)),
        console: Array.from({ length: 30 }, (_, i) => ({ level: "error" as const, text: `problem ${i}` })),
        requests: Array.from({ length: 25 }, (_, i) => ({ method: "GET", url: `${ORIGIN}/img/${i}.png`, type: "Image", status: 404 })),
      }),
    );
    expect(report.exceptions).toHaveLength(MAX_EXCEPTIONS);
    expect(report.console).toHaveLength(MAX_CONSOLE);
    expect(report.network?.failed).toHaveLength(MAX_FAILED_REQUESTS);
    expect(report.omitted).toEqual({ exceptions: 4, console: 15, failedRequests: 15 });
  });

  test("errors and warnings are kept; logs only when asked, and never the dev server's chatter", () => {
    const logged = [
      { level: "log" as const, text: "loaded 3 items" },
      { level: "warning" as const, text: "Each child in a list should have a unique key" },
      { level: "debug" as const, text: "[vite] connecting..." },
      { level: "info" as const, text: "Download the React DevTools for a better development experience" },
      { level: "error" as const, text: `Failed to fetch ${ORIGIN}/src/data.ts?t=17` },
    ];
    const quiet = buildReport(raw({ console: logged }));
    expect(quiet.console?.map((c) => c.level)).toEqual(["error", "warning"]);
    // The origin is cut out of free text as well.
    expect(quiet.console![0]!.text).toBe("Failed to fetch src/data.ts");
    const verbose = buildReport(raw({ console: logged }), { verbose: true });
    expect(verbose.console?.map((c) => c.text)).toContain("loaded 3 items");
    expect(JSON.stringify(verbose)).not.toContain("[vite]");
    expect(JSON.stringify(verbose)).not.toContain("DevTools");
  });

  test("a console call reads as the console would print it", () => {
    expect(formatConsoleArgs(["%s %s An error occurred in the <%s> component.", "Warning:", "Error: boom", "Home"])).toBe(
      "Warning: Error: boom An error occurred in the <Home> component.",
    );
    // A style is not text, and what was not asked for by a specifier still follows.
    expect(formatConsoleArgs(["%cready", "color: green", "in 20ms"])).toBe("ready in 20ms");
    expect(formatConsoleArgs(["loaded", "3", "items"])).toBe("loaded 3 items");
    expect(formatConsoleArgs(["100%% done"])).toBe("100%% done");
    expect(formatConsoleArgs([])).toBe("");
  });

  test("a compiler's message loses its drawing and the line Vite gets wrong", () => {
    const overlay = {
      message:
        "Transform failed with 1 error:\n[PARSE_ERROR] Expected `,` or `>` but found `Identifier`\n    ╭─[ /home/user/app/src/App.tsx:23:14 ]\n 23 │         <Route path=\"/\" />\n    │              ──┬─\n    │                ╰─── `,` or `>` expected\n────╯",
      // The overlay's own position is from Vite's bundle, not the source.
      file: "/home/user/app/src/App.tsx:7581:23",
    };
    const report = buildReport(raw({ dom: dom({ rootEmpty: true, overlay }) }));
    expect(report.buildError?.file).toBe("src/App.tsx");
    expect(report.buildError?.message).not.toMatch(/[─-╿]/);
    // The true position, which is in the message, survives.
    expect(report.buildError?.message).toContain("[ src/App.tsx:23:14 ]");
    expect(report.buildError?.message).toContain("`,` or `>` expected");
  });

  test("a failed API call carries the start of the server's answer", () => {
    const body = JSON.stringify({ error: 'relation "items" does not exist' }) + "x".repeat(2_000);
    const report = buildReport(raw({ requests: [{ method: "POST", url: `${ORIGIN}/api/items`, type: "Fetch", status: 500, body }] }));
    const failed = report.network!.failed[0]!;
    expect(failed.body).toContain('relation \\"items\\" does not exist');
    expect(failed.body!.length).toBeLessThanOrEqual(501);
  });

  test("requests the page gave up on, the favicon and the dev socket are not faults", () => {
    const report = buildReport(
      raw({
        requests: [
          { method: "GET", url: `${ORIGIN}/favicon.ico`, type: "Other", status: 404 },
          { method: "GET", url: `${ORIGIN}/src/old.tsx`, type: "Script", errorText: "net::ERR_ABORTED" },
          { method: "GET", url: `${ORIGIN}/?token=x`, type: "WebSocket", errorText: "net::ERR_FAILED" },
        ],
      }),
    );
    expect(report.status).toBe("rendered");
    expect(report.network).toBeUndefined();
  });

  test("the whole of a busy broken result still fits in a few thousand characters", () => {
    const long = "x".repeat(5_000);
    const report = buildReport(
      raw({
        dom: dom({ rootEmpty: true }),
        exceptions: Array.from({ length: 20 }, (_, i) => thrown(`Error ${i}: ${long}`)),
        console: Array.from({ length: 50 }, (_, i) => ({ level: "error" as const, text: `${i} ${long}` })),
        requests: Array.from({ length: 50 }, (_, i) => ({ method: "GET", url: `${ORIGIN}/api/x${i}`, type: "Fetch", status: 500, body: long })),
      }),
    );
    expect(JSON.stringify(report).length).toBeLessThanOrEqual(MAX_REPORT_CHARS);
    // What is cut first is what matters least: the errors are all still there.
    expect(report.status).toBe("crashed");
    expect(report.exceptions!.length).toBeGreaterThanOrEqual(3);
    expect(report.exceptions![0]!.at).toBe("src/pages/Home.tsx:42:18");
    expect(report.network!.failed[0]!.url).toBe("/api/x0");
    expect(report.omitted!.exceptions).toBeGreaterThan(0);
  });

  test("a report that already fits is left exactly as it is", () => {
    const report = buildReport(raw({ exceptions: [thrown("TypeError: nope")], console: [{ level: "warning", text: "careful" }] }));
    expect(fitReport(report)).toBe(report);
  });
});

describe("the findings in words, for a run that is sent back", () => {
  test("say what was thrown and where, what failed, and what the build error is", () => {
    const crashed = buildReport(
      raw({
        dom: dom({ rootEmpty: true }),
        exceptions: [thrown("TypeError: items.map is not a function")],
        requests: [{ method: "GET", url: `${ORIGIN}/api/items`, type: "Fetch", status: 500, body: '{"error":"no table"}' }],
      }),
    );
    const text = describeFindings(crashed);
    expect(text).toContain("- Error thrown at `src/pages/Home.tsx:42:18`: TypeError: items.map is not a function");
    expect(text).toContain('- Request failed: GET /api/items → 500 — {"error":"no table"}');

    const overlay = { message: "Unexpected token (12:4)", file: "/home/user/app/src/App.tsx:12:4", frame: "> 12 | <div" };
    expect(describeFindings(buildReport(raw({ dom: dom({ rootEmpty: true, overlay }) })))).toContain(
      "- Build error in `src/App.tsx`: Unexpected token (12:4)",
    );
  });

  test("a blank page with nothing to report says that, rather than nothing", () => {
    const blank = buildReport(raw({ dom: dom({ rootEmpty: true }) }));
    expect(describeFindings(blank)).toBe("- Nothing was thrown, logged as an error, or failed to load.");
  });
});

describe("where the browser may go", () => {
  test("a route is a path on the preview, never another host", () => {
    expect(normalizePath(undefined)).toBe("/");
    expect(normalizePath("pricing")).toBe("/pricing");
    expect(normalizePath(" /menu?tab=2 ")).toBe("/menu?tab=2");
    // A full URL is not followed: only its path is kept.
    expect(normalizePath("https://internal.example/admin?x=1")).toBe("/admin?x=1");
  });

  test("a page under inspection is fenced off from this machine and the private network", () => {
    const blocked = blockedUrlPatterns(ORIGIN);
    for (const pattern of ["*://localhost*", "*://127.*", "*://10.*", "*://192.168.*", "*://169.254.*", "*://172.16.*", "*://172.31.*"]) {
      expect(blocked).toContain(pattern);
    }
  });

  test("but not from itself, when the app under test is on this machine", () => {
    const local = blockedUrlPatterns("http://localhost:5173");
    expect(local).not.toContain("*://localhost*");
    expect(local).toContain("*://10.*");
  });
});
