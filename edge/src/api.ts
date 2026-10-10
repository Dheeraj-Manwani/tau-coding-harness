/**
 * `/api/*` on a published app: sign the request and stream it to the app's
 * Lambda function, and stream the answer back (doc/PUBLISHING.md C4, C9).
 *
 * The function URL uses IAM authentication, so the router is the only thing
 * that can reach it: this holds a credential that may do one thing, invoke the
 * `tau-app-*` function URLs. The backend address comes from the routing record
 * only, never from the request, and is checked to be a Lambda function URL
 * before anything is sent to it. Every header a visitor could use to pose as
 * the router or as AWS is removed first, and the response is never cached.
 */
import { AwsClient } from "aws4fetch";

/** Secrets set with `wrangler secret put`. The credential can only invoke published apps' function URLs. */
export interface ApiEnv {
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
}

/** Lambda caps a request body at 6 MB; the router refuses larger ones before reading them. */
export const MAX_API_BODY_BYTES = 6 * 1024 * 1024;

/** Longer than a function may run (it is capped well under this), so a hung backend ends as a 504, not a hang. */
export const API_TIMEOUT_MS = 30_000;

/** The AWS region of a function URL, or null when it is not one. */
const FUNCTION_URL = /^[a-z0-9]+\.lambda-url\.([a-z0-9-]+)\.on\.aws$/;

/**
 * Whether a record's backend address is a Lambda function URL, and its region.
 *
 * The record is tau's, but the router still refuses to send a signed request
 * anywhere that is not exactly what it expects: https, a function URL host, no
 * credentials, no path. A record that was tampered with cannot turn the router
 * into a way to reach another host with a valid AWS signature.
 */
export function parseApiUrl(raw: string | undefined | null): { origin: string; region: string } | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  const region = FUNCTION_URL.exec(url.hostname.toLowerCase())?.[1];
  return region ? { origin: url.origin, region } : null;
}

/** Whether a request path is the app's API. Everything under `/api/` and `/api` itself. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

/**
 * Headers that never reach the function from a visitor.
 *
 * `x-amz-*` and `x-tau-*` are how the router (and AWS) talk to the function, so
 * a visitor must not be able to set one. `x-forwarded-*` and `cf-*` are rebuilt
 * from what Cloudflare knows. The rest are connection-level.
 */
const STRIPPED = /^(?:x-amz-|x-amzn-|x-tau-|x-forwarded-|cf-|sec-fetch-|x-real-ip$|forwarded$|via$|true-client-ip$)/i;
const CONNECTION = new Set(["host", "connection", "keep-alive", "transfer-encoding", "te", "trailer", "upgrade", "proxy-authorization", "proxy-connection", "content-length", "expect"]);

/**
 * The headers to send to the function.
 *
 * The visitor's own `Authorization` (an app's bearer token, say) cannot travel
 * as itself, because IAM authentication uses that header for the AWS signature.
 * It goes as `x-tau-authorization`, and the function's entry file puts it back
 * (`lambdaEntry` in the server). Whatever a visitor sent as `x-tau-*` was
 * stripped first, so the only way that header is set is by this function.
 */
export function upstreamHeaders(incoming: Headers, hostname: string, ip: string | null): Headers {
  const out = new Headers();
  for (const [name, value] of incoming) {
    const lower = name.toLowerCase();
    if (STRIPPED.test(lower) || CONNECTION.has(lower) || lower === "authorization") continue;
    out.set(name, value);
  }
  const authorization = incoming.get("authorization");
  if (authorization !== null) out.set("x-tau-authorization", authorization);

  // What the app needs to build its own links, from what Cloudflare knows.
  out.set("x-forwarded-host", hostname);
  out.set("x-forwarded-proto", "https");
  if (ip) out.set("x-forwarded-for", ip);
  return out;
}

/** Headers from the function that are AWS's, not the app's. */
const RESPONSE_STRIPPED = /^(?:x-amz-|x-amzn-|connection$|keep-alive$|transfer-encoding$)/i;

export function downstreamHeaders(upstream: Headers): Headers {
  const out = new Headers();
  for (const [name, value] of upstream) {
    if (!RESPONSE_STRIPPED.test(name)) out.append(name, value);
  }
  // Never cached at the edge: an API answer is for one request. An app that
  // wants a browser to keep something says so itself with Cache-Control.
  if (!out.has("cache-control")) out.set("cache-control", "no-store");
  return out;
}

function plain(status: number, message: string, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...extra },
  });
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ForwardDeps {
  /** Where the signed request goes. The real `fetch`; tests pass their own. */
  fetcher: (input: Request, init?: RequestInit) => Promise<Response>;
}

/**
 * Forward one `/api/*` request to the function, signed, and stream the answer back.
 *
 * No `/api` entry in the record is the caller's 404; this is only called when
 * there is one. A missing credential, an unusable address or a backend that
 * cannot be reached are each a plain error that says nothing about the
 * infrastructure behind them.
 */
export async function forwardToBackend(
  request: Request,
  apiUrl: string | null | undefined,
  env: ApiEnv,
  deps: ForwardDeps = { fetcher: (input, init) => fetch(input, init) },
): Promise<Response> {
  const target = parseApiUrl(apiUrl);
  if (!target) return plain(404, "Not found");
  if (!env.AWS_ACCESS_KEY_ID || !env.AWS_SECRET_ACCESS_KEY) {
    return plain(503, "This app's backend is not available right now.", { "Retry-After": "30" });
  }

  const url = new URL(request.url);
  const method = request.method.toUpperCase();
  const hasBody = method !== "GET" && method !== "HEAD";

  let body: ArrayBuffer | undefined;
  if (hasBody) {
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_API_BODY_BYTES) return plain(413, "That request is too large.");
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_API_BODY_BYTES) return plain(413, "That request is too large.");
  }

  const headers = upstreamHeaders(request.headers, url.hostname, request.headers.get("cf-connecting-ip"));
  if (body !== undefined) headers.set("x-amz-content-sha256", await sha256Hex(body));

  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    service: "lambda",
    region: target.region,
  });

  try {
    // Only what must be signed is signed (the body hash and its content type);
    // the visitor's other headers travel unsigned. Cloudflare rewrites some of
    // them in flight (accept-encoding, for one), and a signed header that changes
    // after signing is an InvalidSignatureException.
    const toSign = new Headers();
    const contentType = headers.get("content-type");
    if (contentType) toSign.set("content-type", contentType);
    if (body !== undefined) toSign.set("x-amz-content-sha256", headers.get("x-amz-content-sha256")!);
    const target_url = `${target.origin}${url.pathname}${url.search}`;
    const signed = await aws.sign(target_url, { method, headers: toSign, body });
    for (const name of ["authorization", "x-amz-date", "x-amz-content-sha256", "x-amz-security-token"]) {
      const value = signed.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const upstream = await deps.fetcher(new Request(target_url, { method, headers, body }), { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
    // AWS refusing the request itself (a bad signature, a missing permission) is
    // not the app answering, and says things about tau's setup a visitor must
    // not read. It is marked with `x-amzn-errortype`; the app's own 401 or 403
    // never carries it.
    if ((upstream.status === 401 || upstream.status === 403) && upstream.headers.has("x-amzn-errortype")) {
      console.error(`api.refused status=${upstream.status} type=${upstream.headers.get("x-amzn-errortype")} host=${url.hostname}`);
      return plain(502, "The app's backend could not be reached.");
    }
    // Straight through: the body is a stream, so a streamed answer (an AI
    // response, say) reaches the browser as it is produced.
    return new Response(method === "HEAD" ? null : upstream.body, {
      status: upstream.status,
      headers: downstreamHeaders(upstream.headers),
    });
  } catch (err) {
    console.error(`api.failed name=${err instanceof Error ? err.name : "unknown"} message=${err instanceof Error ? err.message.slice(0, 200) : ""}`);
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return timedOut ? plain(504, "The app took too long to answer.") : plain(502, "The app's backend could not be reached.");
  }
}
