/**
 * Tests must not depend on what is in a developer's `.env`. Bun loads that file
 * before this runs, so the settings that switch publishing, the edge and backend
 * hosting on are removed here: a test that needs one sets it itself.
 */
for (const key of Object.keys(process.env)) {
  if (/^(CLOUDFLARE_|AWS_APPS_)/.test(key)) delete process.env[key];
}
for (const key of ["SITES_DOMAIN", "SITES_PATH_MODE", "BACKEND_HOSTING_ENABLED"]) delete process.env[key];
// The lifecycle tests run against a stand-in for the tables that does not know
// the quota queries; the rules themselves are tested in deployQuota.test.ts.
process.env.PUBLISH_QUOTAS_ENFORCE = "false";
