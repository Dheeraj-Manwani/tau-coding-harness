/**
 * Does the design reviewer find faults that were put there, and leave a clean
 * page alone? Six small pages, two clean and four with one planted fault each,
 * reviewed with the model's reasoning off and on.
 *
 *   bun run scripts/planted-faults.ts [runs]
 *
 * Needs `KIMI_API_KEY` and a browser. Each run is a real review, so it costs
 * what a review costs; the Kimi gate (lib/kimi.ts) keeps them one at a time.
 * The result is what doc/CONTEXT_AND_MEMORY_PLAN.md §11, phase 4 reports.
 */
import { reviewDesign, designReviewAvailable } from "@/worker/design/review";

const css = `*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;color:#1c1917;background:#faf9f6}
.wrap{max-width:1100px;margin:0 auto;padding:32px 24px}nav{display:flex;justify-content:space-between;align-items:center;padding:16px 24px;border-bottom:1px solid #e7e5e4}
h1{font-size:44px;line-height:1.1;margin:24px 0 12px}.btn{background:#0f766e;color:#fff;padding:10px 18px;border-radius:8px;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:32px}.card{background:#fff;border:1px solid #e7e5e4;border-radius:12px;padding:24px}
.muted{color:#57534e}@media(max-width:700px){.grid{grid-template-columns:1fr}h1{font-size:32px}}`;

const page = (body: string, extra = "") => `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><style>${css}${extra}</style>${body}`;
const nav = `<nav><strong>Fernwood Strength</strong><span class=btn>Join</span></nav>`;

const PAGES: Record<string, { html: string; fault: string | null }> = {
  "/clean-pricing": {
    fault: null,
    html: page(`${nav}<div class=wrap><h1>Train with people who know your name</h1><p class=muted>A neighbourhood gym with coaches on the floor from six to ten.</p>
      <div class=grid><div class=card><h3>Drop-in</h3><p class=muted>One session, any class.</p><strong>$14</strong></div>
      <div class=card><h3>Monthly</h3><p class=muted>Unlimited classes and the open floor.</p><strong>$64</strong></div>
      <div class=card><h3>Student</h3><p class=muted>Monthly, for anyone with a student card.</p><strong>$44</strong></div></div></div>`),
  },
  "/clean-dashboard": {
    fault: null,
    html: page(`${nav}<div class=wrap><h1 style="font-size:32px">This week</h1>
      <div class=grid><div class=card><span class=muted>Check-ins</span><h2>1,286</h2></div><div class=card><span class=muted>Active members</span><h2>412</h2></div><div class=card><span class=muted>Class fill</span><h2>74%</h2></div></div>
      <div class=card style="margin-top:20px"><h3>Busiest classes</h3><p class=muted>Sunrise Strength 148 · HIIT 45 132 · Mobility 96</p></div></div>`),
  },
  "/cut-off": {
    fault: "Overflow",
    html: page(`${nav}<div class=wrap><h1>Plans</h1><div class=grid>
      <div class=card style="overflow:hidden;white-space:nowrap"><h3>Unlimited monthly membership with every class included</h3><p class=muted>Everything, always.</p></div>
      <div class=card><h3>Monthly</h3><p class=muted>Unlimited classes.</p></div><div class=card><h3>Student</h3><p class=muted>Half price.</p></div></div>
      <div style="width:200px;height:48px;overflow:hidden;background:#fff;border:1px solid #e7e5e4;margin-top:24px;padding:12px;white-space:nowrap">Book your first class today and bring a friend along for free</div></div>`),
  },
  "/overlap": {
    fault: "Overlap",
    html: page(`${nav}<div class=wrap style="position:relative;height:520px"><h1 style="position:relative;z-index:1">Train with people who know your name</h1>
      <div style="position:absolute;left:120px;top:50px;width:620px;height:280px;background:#0f766e;border-radius:16px;z-index:2;color:#fff;padding:24px">A photograph of the main floor will go here</div>
      <p class=muted style="position:absolute;left:140px;top:160px;z-index:3;color:#fff">Coaches on the floor from six to ten, every day of the week.</p></div>`),
  },
  "/unreadable": {
    fault: "Unreadable",
    html: page(`${nav}<div class=wrap><h1>Train with people who know your name</h1><p style="color:#e2e0dc;font-size:18px">A neighbourhood gym with coaches on the floor from six to ten, every day of the week, whatever you are training for.</p>
      <div class=grid><div class=card><h3 style="color:#e5e3df">Drop-in</h3><p style="color:#dedbd6;font-size:10px">One session, any class, no sign-up needed at all.</p></div>
      <div class=card><h3 style="color:#e5e3df">Monthly</h3><p style="color:#dedbd6;font-size:10px">Unlimited classes and the open floor, all month.</p></div>
      <div class=card><h3 style="color:#e5e3df">Student</h3><p style="color:#dedbd6;font-size:10px">Monthly, for anyone with a student card.</p></div></div></div>`),
  },
  "/placeholder": {
    fault: "Bad content",
    html: page(`${nav}<div class=wrap><h1>Lorem ipsum dolor sit amet</h1><p class=muted>Consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore.</p>
      <div class=grid><div class=card><h3>Feature one</h3><p class=muted>Lorem ipsum dolor sit amet.</p></div><div class=card><h3>Feature two</h3><p class=muted>Lorem ipsum dolor sit amet.</p></div>
      <div class=card><h3>Feature three</h3><p class=muted>— John Doe, CEO, Acme Inc.</p></div></div></div>`),
  },
};

if (!designReviewAvailable()) {
  console.error("Design review is not available here (needs KIMI_API_KEY and a browser).");
  process.exit(1);
}
const runs = Number(process.argv[2] ?? 1);
const server = Bun.serve({
  port: 8766,
  fetch: (req) => {
    const entry = PAGES[new URL(req.url).pathname];
    return entry ? new Response(entry.html, { headers: { "content-type": "text/html" } }) : new Response("not found", { status: 404 });
  },
});

interface Row { page: string; thinking: boolean; verdict: string; fault: string | null; found: boolean | null; ms: number; out: number; findings: string }
const rows: Row[] = [];
for (let run = 0; run < runs; run++) {
  for (const [path, { fault }] of Object.entries(PAGES)) {
    for (const thinking of [false, true]) {
      const started = Date.now();
      try {
        const result = await reviewDesign({ previewUrl: "http://localhost:8766", fresh: [path], designProse: null, thinking });
        const broken = result.review.split("\n").filter((l) => l.includes("[broken]"));
        rows.push({
          page: path,
          thinking,
          verdict: result.verdict,
          fault,
          // A planted fault is found when the report names its question; a clean
          // page is right when no [broken] finding is reported at all.
          found: fault ? broken.some((l) => l.includes(fault)) : broken.length === 0,
          ms: Date.now() - started,
          out: result.usage.outputTokens,
          findings: broken.map((l) => l.slice(0, 110)).join(" | "),
        });
      } catch (err) {
        rows.push({ page: path, thinking, verdict: "error", fault, found: null, ms: Date.now() - started, out: 0, findings: String(err).slice(0, 120) });
      }
      const last = rows.at(-1)!;
      console.log(`${last.page.padEnd(18)} thinking=${String(last.thinking).padEnd(5)} verdict=${last.verdict.padEnd(7)} right=${String(last.found).padEnd(5)} ${last.ms}ms out=${last.out}`);
    }
  }
}
server.stop();

for (const thinking of [false, true]) {
  const mine = rows.filter((r) => r.thinking === thinking && r.found !== null);
  const planted = mine.filter((r) => r.fault);
  const clean = mine.filter((r) => !r.fault);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
  console.log(
    `\nthinking=${thinking}: planted faults found ${planted.filter((r) => r.found).length}/${planted.length}; clean pages left alone ${clean.filter((r) => r.found).length}/${clean.length}; mean ${avg(mine.map((r) => r.ms))}ms, ${avg(mine.map((r) => r.out))} output tokens; errors ${rows.filter((r) => r.thinking === thinking && r.found === null).length}`,
  );
}
console.log("\n" + rows.filter((r) => r.found === false).map((r) => `WRONG ${r.page} thinking=${r.thinking}: ${r.findings || "(no broken finding)"}`).join("\n"));
process.exit(0);
