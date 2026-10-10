// Throwaway S0 measurement for doc/TAU_CLOUD_STORAGE.md. Run from server/:
//   bun run scripts/measure-storage-bucket.ts
// Uses the main R2 credentials against R2_STORAGE_BUCKET (default tau-app-storage).
// Leaves nothing behind: every object is under measure/ and deleted at the end.
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.R2_STORAGE_BUCKET ?? "tau-app-storage";
const client = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const made: string[] = [];
const key = (n: string) => {
  const k = `measure/${Date.now()}-${n}`;
  made.push(k);
  return k;
};
const log = (q: string, a: string) => console.log(`${q}\n   -> ${a}\n`);

async function main() {
  // 1. Browser-style PUT from an arbitrary origin: preflight + PUT.
  {
    const k = key("cors");
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: BUCKET, Key: k }), { expiresIn: 300 });
    const origin = "https://abc123.preview.example.dev";
    const pre = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "PUT",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    const put = await fetch(url, {
      method: "PUT",
      headers: { Origin: origin, "Content-Type": "text/plain" },
      body: "hello",
    });
    log(
      "CORS: preflight + PUT from an arbitrary origin",
      `preflight ${pre.status} allow-origin=${pre.headers.get("access-control-allow-origin")} allow-methods=${pre.headers.get("access-control-allow-methods")}; PUT ${put.status} allow-origin=${put.headers.get("access-control-allow-origin")} etag-exposed=${put.headers.get("access-control-expose-headers")}`,
    );
  }

  // 2. Pin Content-Length.
  {
    const k = key("len");
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: BUCKET, Key: k, ContentLength: 5 }),
      { expiresIn: 300, signableHeaders: new Set(["content-length"]) },
    );
    const big = await fetch(url, { method: "PUT", body: "x".repeat(50) });
    const exact = await fetch(url, { method: "PUT", body: "x".repeat(5) });
    log("Signed PUT pins Content-Length?", `50 bytes against 5 signed -> ${big.status}; exactly 5 -> ${exact.status}`);
  }

  // 3. Pin Content-Type.
  {
    const k = key("type");
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: BUCKET, Key: k, ContentType: "image/png" }),
      { expiresIn: 300, signableHeaders: new Set(["content-type"]) },
    );
    const wrong = await fetch(url, { method: "PUT", headers: { "Content-Type": "text/html" }, body: "x" });
    const right = await fetch(url, { method: "PUT", headers: { "Content-Type": "image/png" }, body: "x" });
    const head = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k }));
    log("Signed PUT pins Content-Type?", `wrong type -> ${wrong.status}; right type -> ${right.status}; stored type=${head.ContentType}`);
  }

  // 4. Response overrides on GET.
  {
    const k = key("resp");
    await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: k, Body: "<h1>x</h1>", ContentType: "text/html" }));
    const url = await getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: BUCKET,
        Key: k,
        ResponseContentType: "application/octet-stream",
        ResponseContentDisposition: 'attachment; filename="a.html"',
      }),
      { expiresIn: 300 },
    );
    const res = await fetch(url);
    log(
      "Do ResponseContentType / ResponseContentDisposition take effect?",
      `${res.status} type=${res.headers.get("content-type")} disposition=${res.headers.get("content-disposition")}`,
    );
  }

  // 5. HEAD right after PUT, and the real size.
  {
    let ok = 0;
    for (let i = 0; i < 10; i++) {
      const k = key(`head${i}`);
      const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: BUCKET, Key: k }), { expiresIn: 300 });
      await fetch(url, { method: "PUT", body: "y".repeat(100 + i) });
      const h = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: k })).catch(() => null);
      if (h?.ContentLength === 100 + i) ok++;
    }
    log("HEAD immediately consistent after PUT?", `${ok}/10 returned the right size straight away`);
  }

  // 6. Longest expiry.
  {
    const results: string[] = [];
    for (const secs of [604800, 604801]) {
      try {
        const k = key(`exp${secs}`);
        const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: BUCKET, Key: k }), { expiresIn: secs });
        const r = await fetch(url, { method: "PUT", body: "z" });
        results.push(`${secs}s -> ${r.status}`);
      } catch (e) {
        results.push(`${secs}s -> SDK threw: ${(e as Error).message}`);
      }
    }
    log("Longest signed expiry", results.join("; "));
  }
}

try {
  await main();
} finally {
  await client.send(
    new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: made.map((Key) => ({ Key })), Quiet: true } }),
  ).catch((e) => console.error("cleanup failed", e));
  console.log(`cleaned ${made.length} objects`);
}
