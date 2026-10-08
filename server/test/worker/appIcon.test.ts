import { describe, expect, test } from "bun:test";
import type { TemplateBuilder } from "e2b";
import { isBinaryPath as apiIsBinaryPath } from "@/api/lib/projectFiles";
import { isBinaryPath } from "@/worker/agent/tools/functions/utils";
import {
  APP_ICON_LINK_TAG,
  APP_ICON_PATH,
  APP_ICON_SVG,
  writeAppIcon,
} from "@/worker/templates/shared";

// Every generation-2 app starts with the tau mark as its icon
// (doc/PUBLISHING.md D7). It is baked into the image, so a mistake here is only
// seen after a rebuild: these pin what the build step will write.

/** The shell commands a build step asks for, in order. */
function commandsOf(step: (t: TemplateBuilder) => TemplateBuilder): string[] {
  const commands: string[] = [];
  const builder = {
    runCmd(command: string) {
      commands.push(command);
      return builder;
    },
  } as unknown as TemplateBuilder;
  step(builder);
  return commands;
}

describe("the app icon", () => {
  test("is a text file, so the template seed cannot corrupt it", () => {
    // `seedTemplateFiles` reads every file in the image as a string. A PNG or
    // an ICO would reach the manifest, and then every rebuilt sandbox, mangled.
    expect(isBinaryPath(APP_ICON_PATH)).toBe(false);
    expect(apiIsBinaryPath(APP_ICON_PATH)).toBe(false);
  });

  test("is one self-contained SVG: no embedded picture, no script, no outside reference", () => {
    expect(APP_ICON_SVG.startsWith("<svg ")).toBe(true);
    expect(APP_ICON_SVG.trimEnd().endsWith("</svg>")).toBe(true);
    expect(APP_ICON_SVG).not.toMatch(/<image|<script|href=|data:/i);
    // The heredoc that writes it ends at a line reading `EOF`.
    expect(APP_ICON_SVG.endsWith("\n")).toBe(true);
    expect(APP_ICON_SVG).not.toMatch(/^EOF$/m);
  });

  test("is linked from index.html at the path Vite serves public/ files from", () => {
    expect(APP_ICON_PATH).toBe("public/favicon.svg");
    expect(APP_ICON_LINK_TAG).toContain('href="/favicon.svg"');
    expect(APP_ICON_LINK_TAG).toContain('type="image/svg+xml"');
  });
});

describe("writeAppIcon", () => {
  const commands = commandsOf(writeAppIcon);

  test("writes the file, then leaves index.html with exactly one icon link", () => {
    expect(commands).toHaveLength(3);
    const [write, drop, link] = commands as [string, string, string];

    expect(write).toContain(`cat > ${APP_ICON_PATH} <<'EOF'\n${APP_ICON_SVG}EOF`);
    // The scaffold's own link goes first, whichever file it names, so the page
    // never carries two icons or one pointing at a file that is not there.
    expect(drop).toBe(`sed -i '/rel="icon"/d' index.html`);
    expect(link).toContain(APP_ICON_LINK_TAG);
    expect(link).toContain("</head>");
  });

  test("the link survives the sed that inserts it", () => {
    // `#` delimits that sed expression and `&` means "the match" in a
    // replacement: either one in the tag would silently change what is written.
    expect(APP_ICON_LINK_TAG).not.toMatch(/[#&']/);
  });
});
