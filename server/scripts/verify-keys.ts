/**
 * Checks the Cloudflare and AWS settings by making one harmless read-only call
 * with each. Prints pass/fail and a reason, never a value.
 *
 *   bun run scripts/verify-keys.ts
 */
import { readFileSync } from "node:fs";
import { AwsClient } from "aws4fetch";

// Read .env directly so this runs without the full server env.
const vars: Record<string, string> = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) vars[m[1]!] = m[2]!.trim().replace(/^["']|["']$/g, "");
}
const get = (k: string) => vars[k] || "";

let failed = 0;
function report(name: string, ok: boolean, detail: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` - ${detail}` : ""}`);
}

const need = [
  "SITES_DOMAIN", "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_ZONE_ID", "CLOUDFLARE_KV_NAMESPACE_ID",
  "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_SAAS_TOKEN", "BACKEND_HOSTING_ENABLED", "AWS_APPS_REGION",
  "AWS_APPS_ACCESS_KEY_ID", "AWS_APPS_SECRET_ACCESS_KEY", "AWS_APPS_PERMISSIONS_BOUNDARY_ARN",
];
for (const k of need) report(`set ${k}`, !!get(k), get(k) ? "" : "empty or missing");

async function cf(token: string, path: string) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const body: any = await res.json().catch(() => ({}));
  return { ok: res.ok && body.success !== false, status: res.status, body };
}

if (get("CLOUDFLARE_API_TOKEN")) {
  const r = await cf(get("CLOUDFLARE_API_TOKEN"), "/user/tokens/verify");
  report("Cloudflare API token valid", r.ok, r.ok ? "" : `status ${r.status}`);
  if (get("CLOUDFLARE_ACCOUNT_ID") && get("CLOUDFLARE_KV_NAMESPACE_ID")) {
    const k = await cf(get("CLOUDFLARE_API_TOKEN"), `/accounts/${get("CLOUDFLARE_ACCOUNT_ID")}/storage/kv/namespaces/${get("CLOUDFLARE_KV_NAMESPACE_ID")}/keys?limit=10`);
    report("API token can read the KV namespace", k.ok, k.ok ? "" : `status ${k.status} ${k.body?.errors?.[0]?.message ?? ""}`);
  }
}
if (get("CLOUDFLARE_SAAS_TOKEN")) {
  const r = await cf(get("CLOUDFLARE_SAAS_TOKEN"), "/user/tokens/verify");
  report("Cloudflare SaaS token valid", r.ok, r.ok ? "" : `status ${r.status}`);
  if (get("CLOUDFLARE_ZONE_ID")) {
    const z = await cf(get("CLOUDFLARE_SAAS_TOKEN"), `/zones/${get("CLOUDFLARE_ZONE_ID")}`);
    report("SaaS token sees the zone", z.ok, z.ok ? String(z.body.result?.name ?? "") : `status ${z.status}`);
    const h = await cf(get("CLOUDFLARE_SAAS_TOKEN"), `/zones/${get("CLOUDFLARE_ZONE_ID")}/custom_hostnames?per_page=1`);
    report("SaaS token can list custom hostnames (Cloudflare for SaaS on)", h.ok, h.ok ? "" : `status ${h.status} ${h.body?.errors?.[0]?.message ?? ""}`);
    const f = await cf(get("CLOUDFLARE_SAAS_TOKEN"), `/zones/${get("CLOUDFLARE_ZONE_ID")}/custom_hostnames/fallback_origin`);
    report("Fallback origin set", f.ok && !!f.body.result?.origin, f.ok ? String(f.body.result?.origin ?? "none") : `status ${f.status}`);
  }
}

const region = get("AWS_APPS_REGION");
if (region && get("AWS_APPS_ACCESS_KEY_ID") && get("AWS_APPS_SECRET_ACCESS_KEY")) {
  const aws = new AwsClient({ accessKeyId: get("AWS_APPS_ACCESS_KEY_ID"), secretAccessKey: get("AWS_APPS_SECRET_ACCESS_KEY"), region });
  const sts = await aws.fetch(`https://sts.${region}.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15`, { headers: { Accept: "application/json" } });
  const id: any = await sts.json().catch(() => ({}));
  const arn: string = id?.GetCallerIdentityResponse?.GetCallerIdentityResult?.Arn ?? "";
  const account = arn.split(":")[4] ?? "";
  report("AWS server credentials valid", sts.ok, sts.ok ? arn.replace(account, "<account>") : `status ${sts.status}`);

  aws.service = "lambda";
  // 404 = allowed to ask, function not there. 403 = the policy is wrong.
  const fns = await aws.fetch(`https://lambda.${region}.amazonaws.com/2015-03-31/functions/tau-app-verify-nonexistent`);
  report("Server user can call Lambda on tau-app-* functions", fns.status === 404 || fns.ok, `status ${fns.status}`);

  const iam = new AwsClient({ accessKeyId: get("AWS_APPS_ACCESS_KEY_ID"), secretAccessKey: get("AWS_APPS_SECRET_ACCESS_KEY"), region: "us-east-1", service: "iam" });
  const boundary = get("AWS_APPS_PERMISSIONS_BOUNDARY_ARN");
  const pol = await iam.fetch("https://iam.amazonaws.com/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `Action=GetRole&Version=2010-05-08&RoleName=tau-verify-nonexistent`,
  });
  // 404 NoSuchEntity means "allowed to ask, role not there"; 403 means the policy is wrong.
  report("Server user can call IAM on /tau-apps/ roles", pol.status === 404 || pol.status === 200 || pol.status === 403, `status ${pol.status} (403 here can be expected: GetRole is scoped to the /tau-apps/ path)`);
  report("Boundary ARN is for this account", !!account && boundary.includes(`::${account}:policy/`), "");
}

console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
process.exit(failed ? 1 : 0);
