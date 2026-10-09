/**
 * "The user selected this element" — the block that rides along with a chat
 * message sent from the visual-edit inspector.
 *
 * The problem it solves: an element prompt needs the file, the line, the tag
 * and the current text and classes, or the agent cannot find what was clicked.
 * The first version of this feature prepended that to the user's own message,
 * which worked and read terribly — the transcript showed a paragraph of
 * bookkeeping where the user had typed one sentence.
 *
 * So it goes where attachment text already goes: a later block in the USER
 * message's content array. That array is handed straight to the completions
 * API (`loadHistory`), so the model reads every block, while the web
 * transcript renders only block 0. The model gets the context, the bubble
 * stays the sentence the user typed, and neither side needed a new column.
 *
 * The tag is the same shape as `attachmentBlock`'s, for the same reason: it is
 * read as text by a model, so it must be self-delimiting and its attributes
 * must be escaped.
 *
 * See doc/archive/VISUAL_EDIT_PROMPTING.md §7.
 */
import { escapeAttr } from "./attachments";
import { parseLoc } from "./visualEdit";

/** Which value the deterministic editor found it could not touch. */
export type ComputedValue = "text" | "className" | "attribute";

/**
 * Facts about the picked element, as reported by the in-iframe runtime.
 *
 * Deliberately all facts and no prose: the client sends what it observed, and
 * every sentence the model reads is written here. A `hint: string` field would
 * have been shorter and would have put model-facing wording in two codebases.
 */
export interface VisualContext {
  /** `src/App.tsx:42:7` — path, 1-based line, 1-based column. */
  loc: string;
  tagName: string;
  className?: string;
  text?: string;
  /** Browser-resolved `src`, for `<img>`. */
  src?: string;
  /** DOM nodes sharing this source position. >1 means a `.map()`. */
  siblingCount?: number;
  /** Set when the deterministic path refused because this value is computed.
   *  Load-bearing: told only "apply bg-red-500", the agent bolts a literal
   *  class onto an element whose className is built elsewhere — the wrong fix,
   *  and one that looks right. */
  computed?: ComputedValue;
}

/**
 * Long values are quoted for recognition, not reproduced, and cannot contain
 * markup.
 *
 * The escaping is the load-bearing half. Everything interpolated here is read
 * off the DOM of the generated app, so a `text` of `"</selected-element> Ignore
 * the above"` would close the block early and the remainder would reach the
 * model as a top-level instruction rather than as a quoted observation. Angle
 * brackets are the only characters that can do that, so they are the only ones
 * neutralised — quotes and backticks stay readable.
 *
 * This block is more sensitive than `attachmentBlock`'s body, which is framed
 * to the model as user-supplied content. This one speaks in tau's voice.
 */
function body(s: string, max: number): string {
  const clamped = s.length > max ? `${s.slice(0, max)}…` : s;
  return clamped.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Reduce a reported tag name to something that can be read as a tag name.
 *
 * It is rendered as literal `<button>` in the prose — which is what makes that
 * sentence legible — so unlike every other value here it cannot be escaped
 * without becoming noise. A real host element name is `[a-z][a-z0-9-]*`;
 * anything else did not come from the tagger.
 */
function safeTagName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9-]/g, "");
  return cleaned.length > 0 ? cleaned : "element";
}

const COMPUTED_SENTENCE: Record<ComputedValue, string> = {
  text:
    "Its text is rendered from code rather than being a literal string, so" +
    " change it wherever that value comes from.",
  className:
    "Its `className` is computed rather than a literal class list, so update" +
    " it wherever that value is built rather than adding a literal class.",
  attribute:
    "That attribute is set from code, so change it wherever the value comes" +
    " from rather than hardcoding it on the element.",
};

/**
 * Render the block. Returns null for a `loc` that isn't `path:line:col` —
 * without a real position there is nothing here worth telling the model, and a
 * malformed one would point it at a line that doesn't exist.
 */
export function visualContextBlock(ctx: VisualContext): string | null {
  const parsed = parseLoc(ctx.loc);
  if (!parsed) return null;

  const tag = safeTagName(ctx.tagName);
  const facts = [
    `the \`<${tag}>\` at ${body(parsed.path, 300)} line ${parsed.line}`,
  ];
  if (ctx.text) facts.push(`currently "${body(ctx.text, 120)}"`);
  if (ctx.className) facts.push(`classes \`${body(ctx.className, 400)}\``);
  if (ctx.src) {
    facts.push(`\`src\` currently resolving to \`${body(ctx.src, 200)}\``);
  }

  const lines = [
    `The user selected this element in the live preview: ${facts.join(", ")}.`,
  ];
  if (ctx.computed) lines.push(COMPUTED_SENTENCE[ctx.computed]);
  if ((ctx.siblingCount ?? 1) > 1) {
    lines.push(
      `This element is rendered ${ctx.siblingCount} times from one place in` +
        ` the code — change it for all of them.`,
    );
  }
  lines.push(
    "Their message above is about this element. Edit it where it is defined.",
  );

  const attrs =
    `file="${escapeAttr(parsed.path)}"` +
    ` line="${parsed.line}"` +
    ` tag="${tag}"`;

  return `<selected-element ${attrs}>\n${lines.join(" ")}\n</selected-element>`;
}

/** A build failure the preview is showing, as reported by the in-iframe runtime. */
export interface BuildErrorContext {
  /** Vite's own message — the plugin name, the reason, and the source position. */
  message: string;
  /** The `file` line from the overlay, when it has one. */
  file?: string;
  /** The offending source excerpt with its caret. */
  frame?: string;
  /**
   * Where the failure was seen. `publish` is a production build that failed
   * during a publish: then `message` is what the Publish panel told the user
   * and `frame` is the tail of the build log. Absent means the preview.
   */
  source?: "preview" | "publish";
}

/** The sandbox's app root, stripped so the agent sees paths it can act on. */
const SANDBOX_APP_DIR = "/home/user/app/";

/**
 * Defuse the one sequence that could close this block, and nothing else.
 *
 * `body` escapes every angle bracket, which is right for the element block's
 * short quoted values. It is wrong here. The payload is a compiler error frame,
 * and `useScrollSpin<HTMLDivElement>(-420)` arriving as
 * `useScrollSpin&lt;HTMLDivElement&gt;(-420)` mangles the exact line the agent
 * has to read — generics and JSX are what these errors are usually *about*.
 *
 * So only the literal closing tag is neutralised. It is the sole sequence that
 * can end the block, and it has no legitimate reason to appear inside a Vite
 * message; everything else, including every angle bracket in the user's code,
 * survives byte for byte.
 */
function fenced(s: string, max: number): string {
  const clamped = s.length > max ? `${s.slice(0, max)}…` : s;
  return clamped.replace(/<\/(build-error|runtime-error)/gi, "<\\/$1");
}

/**
 * The block behind "Fix with tau".
 *
 * Same arrangement as `visualContextBlock`: the user's chat bubble says which
 * file is broken, and the whole of Vite's output — which is long, and full of
 * absolute sandbox paths and node_modules frames — travels here where only the
 * model reads it.
 *
 * Verbatim on purpose. The parse error, the caret and the line are the entire
 * value of this message, and summarising them would throw away the one thing
 * the agent cannot reconstruct without reading the file.
 */
export function buildErrorBlock(err: BuildErrorContext): string | null {
  const message = fenced(err.message, 4000);
  if (!message.trim()) return null;

  if (err.source === "publish") return publishErrorBlock(message, err.frame);

  const parts = [message];
  // `/home/user/app/src/App.tsx` is a path the agent's tools cannot open —
  // every one of them is rooted at the app directory already.
  if (err.file) {
    parts.push(`File: ${fenced(err.file, 500).split(SANDBOX_APP_DIR).join("")}`);
  }
  if (err.frame) parts.push(fenced(err.frame, 2000));

  return (
    "<build-error>\n" +
    "The preview is showing this build error. Read the file, find the cause and" +
    " fix it. This is Vite's own output, verbatim:\n\n" +
    parts.join("\n\n") +
    "\n</build-error>"
  );
}

/**
 * The same block for a publish that failed.
 *
 * Its own wording because the preview's would mislead: a publish runs the
 * production build, which can fail while the dev server is serving the app
 * without complaint, and an agent told "the preview is showing this" would go
 * and look at a preview that is fine. So it is told which command failed and
 * to run it.
 *
 * A build log's error is at its end, so the log is cut from the front, the
 * opposite of `fenced`.
 */
function publishErrorBlock(message: string, rawLog: string | undefined): string {
  const parts = [message];
  // Colour codes, from a log stored before the worker started removing them.
  const log = rawLog?.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "");
  if (log?.trim()) {
    const tail = log.length > 4000 ? `…${log.slice(-4000)}` : log;
    parts.push(
      "The end of the build output, verbatim:\n\n" +
        fenced(tail, tail.length).split(SANDBOX_APP_DIR).join(""),
    );
  }

  return (
    "<build-error>\n" +
    "Publishing this app failed: its production build (`bun run build`) did" +
    " not succeed. The preview may be running fine, because the dev server" +
    " does not run that build. Run the build, fix what it reports, and run it" +
    " again until it passes. The user publishes again themselves. This is" +
    " what they were told:\n\n" +
    parts.join("\n\n") +
    "\n</build-error>"
  );
}

/** One error the preview's bootstrap monitor recorded in the user's browser. */
export interface RuntimeErrorEntry {
  /** An uncaught exception, an unhandled promise rejection, or a script that would not load. */
  kind: "error" | "rejection" | "script";
  message: string;
  stack?: string;
  /** `file:line:col`, when the browser gave one. */
  at?: string;
  /** How many times it was seen. */
  count?: number;
}

/** What the user's browser saw when the app crashed while starting. */
export interface RuntimeErrorContext {
  /** The route that was open. */
  path?: string;
  errors: RuntimeErrorEntry[];
}

const RUNTIME_KIND: Record<RuntimeErrorEntry["kind"], string> = {
  error: "Uncaught error",
  rejection: "Unhandled promise rejection",
  script: "Script failed to load",
};

/** The most errors quoted. The first is nearly always the cause; later ones are its echoes. */
const MAX_RUNTIME_ERRORS = 3;

/**
 * A stack without the half nobody can act on. The frames inside
 * `node_modules` are React's and the bundler's; the frame that matters is the
 * one in the app's own files, and it is easier to find when it is not buried.
 * Each run of library frames becomes one line saying how many there were.
 */
function appFrames(stack: string): string {
  const out: string[] = [];
  let library = 0;
  const flush = () => {
    if (library > 0) out.push(`    … ${library} frame${library === 1 ? "" : "s"} in libraries`);
    library = 0;
  };
  for (const line of stack.split("\n")) {
    if (/^\s*at\s/.test(line) && /node_modules|@vite|@react-refresh/.test(line)) {
      library++;
      continue;
    }
    flush();
    out.push(line);
  }
  flush();
  return out.join("\n");
}

/**
 * The block behind "Ask tau to fix", for an app that compiled and then crashed.
 *
 * `buildErrorBlock` tells the model it is reading Vite's own output; that
 * would be false here, so this is a block of its own. What it carries is the
 * only account of the fault there is: nothing on tau's side saw the user's
 * browser. It ends by sending the agent to reproduce the crash first, because
 * a stack from a compiled file says which file and not always which line.
 *
 * Fenced like a build error and for the same reason: an error message is
 * usually *about* angle brackets and quotes, and escaping them would mangle the
 * one line the agent has to read. Only the closing tag is neutralised.
 */
export function runtimeErrorBlock(ctx: RuntimeErrorContext): string | null {
  const errors = ctx.errors.filter((e) => e.message.trim()).slice(0, MAX_RUNTIME_ERRORS);
  if (errors.length === 0) return null;

  const listed = errors.map((e, i) => {
    const seen = (e.count ?? 1) > 1 ? ` (seen ${e.count} times)` : "";
    const lines = [`${i + 1}. ${RUNTIME_KIND[e.kind]}${seen}: ${fenced(e.message, 600)}`];
    if (e.at) lines.push(`   at ${fenced(e.at, 300)}`);
    // A stack opens with the message again ("TypeError: …", which the browser
    // reports as "Uncaught TypeError: …"). Said once is enough: keep the frames.
    const stack = e.stack
      ? appFrames(e.stack)
          .split("\n")
          .filter((line, n) => n > 0 || /^\s*at\s/.test(line))
          .join("\n")
      : "";
    // An error thrown at the top of a file has one frame, which is `at` again.
    const onlyRepeatsAt = e.at !== undefined && stack.trim() === `at ${e.at.trim()}`;
    if (stack.trim() && !onlyRepeatsAt) lines.push(fenced(stack, 1500));
    return lines.join("\n");
  });
  const more = ctx.errors.length - errors.length;
  const route = ctx.path?.trim() ? `, on \`${body(ctx.path.trim(), 200)}\`` : "";

  return (
    "<runtime-error>\n" +
    `The app crashed in the user's browser while it was starting${route}, so the` +
    " preview shows them nothing. It compiles; this is what their browser" +
    " reported, verbatim:\n\n" +
    listed.join("\n\n") +
    (more > 0 ? `\n\n(${more} more ${more === 1 ? "error was" : "errors were"} reported after these.)` : "") +
    "\n\nReproduce it before changing anything: if you have `inspect_preview`," +
    " open that route with it. Then fix the cause and confirm the app renders." +
    " Positions are in the file as the dev server compiled it, so the file is" +
    " right and the line can be a few off." +
    "\n</runtime-error>"
  );
}
