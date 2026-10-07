/**
 * Render the style library's preview thumbnails.
 *
 *   bun run scripts/design-previews.ts            # every style
 *   bun run scripts/design-previews.ts neon craft # just these
 *
 * The composer shows each style as a small picture. Those pictures are made
 * here rather than drawn by hand, so they are the style as it really renders:
 * one sandbox on the base image, one sample page, and for each style the same
 * steps a new app goes through (`applyDesignTo`) followed by a screenshot.
 * Output goes to `web/public/design/<key>.jpg`.
 *
 * Run it again whenever a style's tokens, skin or fonts change, or a style is
 * added — a thumbnail that no longer matches its style is worse than none.
 *
 * Needs E2B credentials and a local Chromium (the same as the design review).
 * Uses no model and touches no project.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Sandbox } from "e2b";
import { applyDesignTo, type DesignTarget } from "@/worker/design/apply";
import { SAMPLE_ACCENTS } from "@/worker/design/catalog";
import { STYLES } from "@/worker/design/styles";
import { STYLE_KEYS, isStyleKey, type StyleKey } from "@/worker/design/types";
import { capturePageView } from "@/worker/lib/screenshot";
import { BASE_TEMPLATE_KEY, TEMPLATES } from "@/worker/templates/registry";

const WORK_DIR = "/home/user/app";
const OUT_DIR = resolve(import.meta.dir, "..", "..", "web", "public", "design");

/** The thumbnail: small enough to be a card, large enough to read a button label. */
const VIEW = { width: 760, height: 475, mobile: false, maxHeight: 475, scale: 1 };

/**
 * One page that shows what a style changes: display and body type, a filled
 * and an outlined button, a badge, tabs, a card with a field in it. Written
 * with tokens only, like any app.
 */
const SAMPLE_PAGE = `import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"

export function App() {
  return (
    <div className="min-h-screen bg-background px-10 py-9 text-foreground">
      <div className="grid grid-cols-[1.2fr_1fr] items-start gap-9">
        <div>
          <Badge>New this week</Badge>
          <h1 className="mt-4 text-5xl">Saturday market</h1>
          <p className="mt-4 max-w-sm text-muted-foreground">
            Forty stalls, fresh bread from seven, and music in the square until late.
          </p>
          <div className="mt-6 flex gap-3">
            <Button>See the stalls</Button>
            <Button variant="outline">Opening hours</Button>
          </div>
          <Tabs defaultValue="today" className="mt-8">
            <TabsList>
              <TabsTrigger value="today">Today</TabsTrigger>
              <TabsTrigger value="week">This week</TabsTrigger>
              <TabsTrigger value="map">Map</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Reserve a table</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Input placeholder="Your name" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Party of four</span>
              <span className="font-mono">£48.00</span>
            </div>
            <Button className="w-full">Reserve</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

export default App
`;

const wanted = process.argv.slice(2).filter(isStyleKey);
const keys: readonly StyleKey[] = wanted.length > 0 ? wanted : STYLE_KEYS;

const sandbox = await Sandbox.create(TEMPLATES[BASE_TEMPLATE_KEY].e2bName, { timeoutMs: 15 * 60_000 });
console.log(`sandbox ${sandbox.sandboxId}`);

/** The sandbox alone: nothing here is a project, so nothing is stored. */
const target: DesignTarget = {
  installsNow: true,
  read: (path) => sandbox.files.read(`${WORK_DIR}/${path}`).catch(() => null),
  write: async (path, content) => {
    await sandbox.files.write(`${WORK_DIR}/${path}`, content);
  },
  addPackages: async (packages) => {
    try {
      await sandbox.commands.run(`bun add ${packages.join(" ")}`, { cwd: WORK_DIR, timeoutMs: 180_000 });
      return { ok: true };
    } catch (err) {
      return { ok: false, detail: String(err).slice(-300) };
    }
  },
};

try {
  await mkdir(OUT_DIR, { recursive: true });
  await target.write("src/App.tsx", SAMPLE_PAGE);
  const url = `https://${sandbox.getHost(5173)}`;

  for (const key of keys) {
    const style = STYLES[key];
    const result = await applyDesignTo(target, {
      style: key,
      accent: SAMPLE_ACCENTS[key],
      accentExact: false,
      mode: style.defaultMode,
      dials: style.dials,
      read: "Reading this as: a sample page for previews.",
      source: "director",
    });
    if (!result.applied || !result.fontsInstalled) {
      console.log(`${key}: not rendered — ${result.skipped.join("; ")}`);
      continue;
    }
    // The dev server reloads on the stylesheet write; fonts take a moment more.
    await Bun.sleep(2_500);
    const shot = await capturePageView(url, VIEW);
    const file = resolve(OUT_DIR, `${key}.jpg`);
    await writeFile(file, shot.sections[0]!.jpeg);
    console.log(`${key}: ${Math.round(shot.sections[0]!.jpeg.length / 1024)} KB → ${file}`);
  }
} finally {
  await sandbox.kill().catch(() => undefined);
}
process.exit(0);
