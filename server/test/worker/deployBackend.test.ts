import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync } from "fflate";
import {
  LAMBDA_SMOKE_HARNESS,
  blockersMessage,
  parseSmokeOutput,
} from "@/worker/lib/deployBackend";
import { lambdaEntry } from "@/worker/lib/deployTransforms";
import { HONO_SERVER_INDEX } from "@/worker/templates/shared";

// The backend bundle and the check that it starts the way a published app does.
// The pure parts are unit tested; the harness is proven by really bundling a
// scaffold the way a publish does (bun build, ESM, for Node) and running it
// under Node through the stand-in for Lambda's streaming handler.

describe("what the owner is told when the server cannot be published", () => {
  const issue = (message: string) => ({ code: "x", message });

  test("one blocker is just its sentence", () => {
    expect(blockersMessage([issue("Your server uses Bun-only features.")])).toBe("Your server uses Bun-only features.");
  });

  test("several are a list, in order", () => {
    expect(blockersMessage([issue("First."), issue("Second.")])).toBe("Your server can't be published yet:\n- First.\n- Second.");
  });
});

describe("reading the harness's answer", () => {
  test("a 200 is a pass, and the load time is kept", () => {
    expect(parseSmokeOutput('{"status":200,"body":"{\\"ok\\":true}","loadedMs":41}\n')).toMatchObject({ ok: true, status: 200, loadedMs: 41 });
  });

  test("it is found among whatever the app printed", () => {
    const out = 'listening...\nwarn: something\n{"status":200,"body":"ok","loadedMs":3}\n';
    expect(parseSmokeOutput(out).ok).toBe(true);
  });

  test("any other status fails, and says which", () => {
    expect(parseSmokeOutput('{"status":500,"body":"x","loadedMs":3}')).toMatchObject({ ok: false, status: 500 });
    expect(parseSmokeOutput('{"status":404,"body":"x","loadedMs":3}')).toMatchObject({ ok: false, status: 404 });
  });

  test("a crash before the answer fails with no status, keeping the output", () => {
    const out = "file:///x/index.mjs:3\nReferenceError: Bun is not defined\n";
    expect(parseSmokeOutput(out)).toEqual({ ok: false, status: null, loadedMs: null, output: out });
    expect(parseSmokeOutput("")).toMatchObject({ ok: false, status: null });
  });

  // The bug this guards: Hono answers "Internal Server Error" with the status
  // already sent, so a 200 can be the last thing a broken server says.
  test("a 200 with a handler error behind it is a failure", () => {
    const out = '{"status":200,"body":"Internal Server Error","loadedMs":3,"handlerError":"TypeError: x"}';
    expect(parseSmokeOutput(out)).toMatchObject({ ok: false, status: 200 });
    expect(parseSmokeOutput('{"status":200,"body":"ok","loadedMs":3,"handlerError":null}').ok).toBe(true);
  });

  test("a status of null in the answer is a failure", () => {
    expect(parseSmokeOutput('{"status":null,"body":"","loadedMs":1}').ok).toBe(false);
  });
});

// ── Really bundling and running it ───────────────────────────────────────────

const node = Bun.which("node");
const dir = mkdtempSync(join(tmpdir(), "tau-bundle-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A project directory with hono installed (linked from the server's own), and these server files. */
function project(name: string, files: Record<string, string>): string {
  const root = join(dir, name);
  mkdirSync(join(root, "server"), { recursive: true });
  mkdirSync(join(root, "node_modules"), { recursive: true });
  symlinkSync(join(import.meta.dir, "../../node_modules/hono"), join(root, "node_modules/hono"), "junction");
  writeFileSync(join(root, "server/lambda.ts"), lambdaEntry());
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

/** Run the already bundled app through the harness with a different request. */
function request(root: string, override: object): { status: number | null; body: string } {
  const ran = Bun.spawnSync([node!, "smoke.mjs", "./out/index.mjs", JSON.stringify(override)], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = `${ran.stdout}`.trim().split("\n").at(-1) ?? "{}";
  return JSON.parse(out);
}

async function bundleAndSmoke(root: string): Promise<{ bundled: boolean; buildOutput: string; ran?: ReturnType<typeof parseSmokeOutput> }> {
  const build = Bun.spawnSync(
    ["bun", "build", "server/lambda.ts", "--target=node", "--format=esm", "--outfile=out/index.mjs"],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const buildOutput = `${build.stdout}${build.stderr}`;
  if (build.exitCode !== 0) return { bundled: false, buildOutput };

  writeFileSync(join(root, "smoke.mjs"), LAMBDA_SMOKE_HARNESS);
  const ran = Bun.spawnSync([node!, "smoke.mjs", "./out/index.mjs"], {
    cwd: root,
    env: { ...process.env, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { bundled: true, buildOutput, ran: parseSmokeOutput(`${ran.stdout}${ran.stderr}`) };
}

describe.skipIf(!node)("the bundle, under Node", () => {
  // The first of Phase 4's proof questions that needs no cloud: does what
  // `bun build --target=node` makes boot, with the entry written beside the app?
  test("the scaffold bundles to one file and answers /api/health with 200", async () => {
    const root = project("scaffold", { "server/index.ts": HONO_SERVER_INDEX });
    const result = await bundleAndSmoke(root);

    expect(result.bundled).toBe(true);
    expect(result.ran).toMatchObject({ ok: true, status: 200 });
    expect(existsSync(join(root, "out/index.mjs"))).toBe(true);
  }, 60_000);

  // Second question: top-level await in the handler's module. The database
  // scaffold has `await initDb()` at the top of server/index.ts.
  test("a server with top-level await loads and answers", async () => {
    const root = project("tla", {
      "server/index.ts": `import { Hono } from 'hono'
const ready = await new Promise<string>((r) => setTimeout(() => r('ready'), 30))
const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true, ready }))
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.ran).toMatchObject({ ok: true, status: 200 });
  }, 60_000);

  test("what the app reads from process.env at load is there when the harness runs", async () => {
    const root = project("env", {
      "server/index.ts": `import { Hono } from 'hono'
const app = new Hono()
app.get('/api/health', (c) => c.json({ mode: process.env.NODE_ENV }))
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.ran!.ok).toBe(true);
  }, 60_000);

  // The same bug from the other side: a handler that throws while streaming its
  // body must fail the check even though a status was sent first.
  test("a handler that throws while it responds fails the check, though it sent 200", async () => {
    const root = project("stream-throws", {
      "server/index.ts": `import { Hono } from 'hono'
const app = new Hono()
app.get('/api/health', () => new Response(new ReadableStream({
  start(c) { c.enqueue(new TextEncoder().encode('half')); c.error(new Error('stream broke')) },
}), { status: 200 }))
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.ran!.ok).toBe(false);
  }, 60_000);

  test("a server that throws at load fails with no status, and the error is in the output", async () => {
    const root = project("throws", {
      "server/index.ts": `import { Hono } from 'hono'
throw new Error('missing STRIPE_KEY at startup')
const app = new Hono()
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.ran).toMatchObject({ ok: false, status: null });
    expect(result.ran!.output).toContain("missing STRIPE_KEY at startup");
  }, 60_000);

  // The reason the smoke test exists: preview runs on Bun, production on Node.
  test("a server that only works on Bun fails the smoke test, not on a live URL", async () => {
    const root = project("bun-only", {
      "server/index.ts": `import { Hono } from 'hono'
const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true, version: Bun.version }))
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.bundled).toBe(true);
    expect(result.ran!.ok).toBe(false);
    // Hono turns a handler's throw into a 500 rather than crashing the process.
    expect(result.ran!.status).toBe(500);
  }, 60_000);

  test("a server whose health route is missing answers 404, and that is a failure", async () => {
    const root = project("no-health", {
      "server/index.ts": `import { Hono } from 'hono'
const app = new Hono()
app.get('/api/other', (c) => c.json({ ok: true }))
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.ran).toMatchObject({ ok: false, status: 404 });
  }, 60_000);

  test("an import that does not resolve fails to bundle at all", async () => {
    const root = project("bad-import", {
      "server/index.ts": `import { Hono } from 'hono'
import nothing from './does-not-exist'
console.log(nothing)
const app = new Hono()
export default { port: 3000, fetch: app.fetch }
`,
    });
    const result = await bundleAndSmoke(root);
    expect(result.bundled).toBe(false);
    expect(result.buildOutput).toContain("does-not-exist");
  }, 60_000);

  test("the zip a publish uploads holds exactly one file, index.mjs, with the bundle in it", async () => {
    const { zipSync } = await import("fflate");
    const root = project("zip", { "server/index.ts": HONO_SERVER_INDEX });
    await bundleAndSmoke(root);
    const bytes = new Uint8Array(await Bun.file(join(root, "out/index.mjs")).arrayBuffer());
    const zip = zipSync({ "index.mjs": [bytes, { level: 6 }] });

    const files = unzipSync(zip);
    expect(Object.keys(files)).toEqual(["index.mjs"]);
    expect(files["index.mjs"]!.byteLength).toBe(bytes.byteLength);
    expect(zip.byteLength).toBeLessThan(bytes.byteLength);
  }, 60_000);

  // The router cannot send the visitor's Authorization as itself (IAM authentication
  // uses that header for the AWS signature), so it sends x-tau-authorization and the
  // entry file puts it back. This runs the real bundle to prove the app sees the
  // visitor's header and never the signature.
  describe("the visitor's Authorization header", () => {
    const echo = `import { Hono } from 'hono'
const app = new Hono()
app.get('/api/health', (c) => c.json({ ok: true }))
app.all('/api/whoami', async (c) => c.json({
  authorization: c.req.header('authorization') ?? null,
  tauAuthorization: c.req.header('x-tau-authorization') ?? null,
  method: c.req.method,
  body: c.req.method === 'GET' ? null : await c.req.text(),
  host: c.req.header('x-forwarded-host') ?? null,
}))
export default { port: 3000, fetch: app.fetch }
`;
    const SIGV4 = "AWS4-HMAC-SHA256 Credential=AKIA/20261009/eu-west-1/lambda/aws4_request, SignedHeaders=host, Signature=abc";

    test("the app sees the visitor's token, not the AWS signature, and x-tau-authorization is gone", async () => {
      const root = project("auth", { "server/index.ts": echo });
      await bundleAndSmoke(root);
      const res = request(root, {
        path: "/api/whoami",
        headers: { authorization: SIGV4, "x-tau-authorization": "Bearer visitor-token" },
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ authorization: "Bearer visitor-token", tauAuthorization: null });
    }, 60_000);

    test("a visitor who sent no Authorization gives the app none, and never the signature", async () => {
      const root = project("noauth", { "server/index.ts": echo });
      await bundleAndSmoke(root);
      const res = request(root, { path: "/api/whoami", headers: { authorization: SIGV4 } });

      expect(JSON.parse(res.body)).toMatchObject({ authorization: null, tauAuthorization: null });
    }, 60_000);

    test("other headers pass through untouched, and a POST body arrives whole", async () => {
      const root = project("post", { "server/index.ts": echo });
      await bundleAndSmoke(root);
      const res = request(root, {
        path: "/api/whoami",
        method: "POST",
        body: JSON.stringify({ title: "hello" }),
        headers: { authorization: SIGV4, "x-forwarded-host": "my-app.bytauai.pro", "content-type": "application/json" },
      });

      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toMatchObject({ method: "POST", body: '{"title":"hello"}', host: "my-app.bytauai.pro" });
    }, 60_000);
  });
});
