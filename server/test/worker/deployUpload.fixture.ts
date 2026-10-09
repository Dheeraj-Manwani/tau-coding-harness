import { beforeEach, describe, expect, mock, test } from "bun:test";

// The mechanical half of a publish: run the build, find what it wrote, copy it
// to R2. Driven against a stand-in sandbox that behaves like E2B in the one way
// that matters here: commands run in the directory they are given, while the
// files API has no working directory and resolves a relative path against the
// user's home. A publish that read `dist/…` relatively built fine and then
// failed on the first file, for every project.

const HOME = "/home/user";
const APP = "/home/user/app";

const disk = new Map<string, Uint8Array>();
const reads: string[] = [];
const text = (s: string) => new TextEncoder().encode(s);

const sandbox = {
  files: {
    read: async (path: string, opts?: { format?: string }) => {
      reads.push(path);
      const abs = path.startsWith("/") ? path : `${HOME}/${path}`;
      const bytes = disk.get(abs);
      if (!bytes) throw new Error(`path '${abs}' does not exist`);
      return opts?.format === "bytes" ? bytes : new TextDecoder().decode(bytes);
    },
  },
  commands: {
    run: async (command: string, opts: { cwd: string }) => {
      const ok = (stdout = "") => ({ exitCode: 0, stdout, stderr: "" });
      if (command === "bun run build") return ok("vite v7 building for production...\n✓ built");

      const exists = /^test -f (.+)$/.exec(command);
      if (exists) {
        if (disk.has(`${opts.cwd}/${exists[1]}`)) return ok();
        throw Object.assign(new Error("exit 1"), { exitCode: 1, stdout: "", stderr: "" });
      }

      const find = /^find (\S+) -type f -printf/.exec(command);
      if (find) {
        const root = `${opts.cwd}/${find[1]}/`;
        return ok(
          [...disk.entries()]
            .filter(([path]) => path.startsWith(root))
            .map(([path, bytes]) => `${bytes.byteLength}\t${path.slice(root.length)}`)
            .join("\n"),
        );
      }
      throw new Error(`unexpected command: ${command}`);
    },
  },
};

const uploaded = new Map<string, { bytes: Uint8Array; contentType: string }>();
const realS3 = await import("@/lib/s3");
mock.module("@/lib/s3", () => ({
  ...realS3,
  putSiteObject: async (key: string, bytes: Uint8Array, contentType: string) => {
    uploaded.set(key, { bytes, contentType });
  },
}));

const { buildAndUpload, DeployError } = await import("@/worker/lib/deploy");
type Sandbox = Parameters<typeof buildAndUpload>[0]["sandbox"];

const PREFIX = "tau/sites/u1/p1/d1";
const publish = () =>
  buildAndUpload({
    sandbox: sandbox as unknown as Sandbox,
    storagePrefix: PREFIX,
    jobId: "job",
    projectId: "p1",
  });

// Bytes that are not valid UTF-8, so a text round trip would show.
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xfe, 0x00, 0x80]);

beforeEach(() => {
  disk.clear();
  reads.length = 0;
  uploaded.clear();
  disk.set(`${APP}/package.json`, text('{"scripts":{"build":"tsc -b && vite build"}}'));
  disk.set(`${APP}/dist/index.html`, text("<h1>hello</h1>"));
  disk.set(`${APP}/dist/assets/index-a1b2c3d4.js`, text("console.log(1)"));
  disk.set(`${APP}/dist/hero.png`, PNG);
});

describe("buildAndUpload", () => {
  test("copies the build output from the app directory to the deployment's prefix", async () => {
    const outcome = await publish();

    expect(outcome.outputDir).toBe("dist");
    expect(outcome.fileCount).toBe(3);
    expect(outcome.sizeBytes).toBe(14 + 14 + PNG.byteLength);
    expect([...uploaded.keys()].sort()).toEqual([
      `${PREFIX}/assets/index-a1b2c3d4.js`,
      `${PREFIX}/hero.png`,
      `${PREFIX}/index.html`,
    ]);
    expect(new TextDecoder().decode(uploaded.get(`${PREFIX}/index.html`)!.bytes)).toBe("<h1>hello</h1>");
  });

  // The regression. Every read has to name the app directory itself.
  test("reads every file by its absolute path under the app directory", async () => {
    await publish();

    expect(reads.length).toBeGreaterThan(0);
    for (const path of reads) expect(path).toStartWith(`${APP}/`);
  });

  test("binary files arrive byte for byte, with their content type", async () => {
    await publish();

    const png = uploaded.get(`${PREFIX}/hero.png`)!;
    expect([...png.bytes]).toEqual([...PNG]);
    expect(png.contentType).toBe("image/png");
  });

  test("leaves out what a build should never ship", async () => {
    disk.set(`${APP}/dist/.env`, text("SECRET=1"));
    disk.set(`${APP}/dist/node_modules/x/index.js`, text("x"));

    const outcome = await publish();
    expect(outcome.fileCount).toBe(3);
    expect([...uploaded.keys()].some((k) => k.includes(".env") || k.includes("node_modules"))).toBe(false);
  });

  // The log is kept to its last 4000 characters. A coloured code frame is
  // mostly escape codes, which would push the error out of what is kept.
  test("the build log is stored without terminal colour codes", async () => {
    const real = sandbox.commands.run;
    sandbox.commands.run = async (command, opts) =>
      command === "bun run build"
        ? { exitCode: 0, stdout: "\u001b[32m✓\u001b[0m built in \u001b[1m1.2s\u001b[22m", stderr: "" }
        : real(command, opts);
    try {
      expect((await publish()).buildLog).toBe("✓ built in 1.2s");
    } finally {
      sandbox.commands.run = real;
    }
  });

  test("a build with no index.html is the user's to fix, not an outage", async () => {
    disk.delete(`${APP}/dist/index.html`);

    await expect(publish()).rejects.toBeInstanceOf(DeployError);
    expect(uploaded.size).toBe(0);
  });
});
