import { describe, expect, test } from "bun:test";
import { checkGatewayReachability } from "@/worker/lib/aiEnv.ts";

// The address a generated app is handed is checked as a *string*, before any key
// is minted, because the failure it prevents is silent and expensive: an E2B
// sandbox is a remote VM, so a loopback or RFC1918 URL connect-refuses from
// inside the app, hours after the build, with nothing pointing back at the
// config that caused it.
//
// Background: doc/AI_FOR_GENERATED_APPS.md §4 and §9 Phase A.

const PUBLIC = "https://api.tau.example.com/ai";

function check(aiUrl?: string, apiUrl = PUBLIC) {
  return checkGatewayReachability({ aiUrl, apiUrl });
}

describe("checkGatewayReachability", () => {
  test("accepts a publicly reachable origin", () => {
    const v = check(PUBLIC, "https://api.tau.example.com/v1");
    expect(v.ok).toBe(true);
  });

  test("accepts a tunnel hostname — the intended dev setup", () => {
    expect(check("https://tau-dev.trycloudflare.com/ai").ok).toBe(true);
    expect(check("https://a1b2c3.ngrok-free.app/ai").ok).toBe(true);
  });

  test("rejects an unset URL", () => {
    const v = check(undefined);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("unset");

    const w = checkGatewayReachability({ aiUrl: PUBLIC, apiUrl: undefined });
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.reason).toBe("unset");
  });

  test("rejects every flavour of loopback", () => {
    for (const url of [
      "http://localhost:8080/ai",
      "http://LOCALHOST:8080/ai",
      "http://api.localhost:8080/ai",
      "http://127.0.0.1:8080/ai",
      "http://127.1.2.3:8080/ai",
      "http://0.0.0.0:8080/ai",
      "http://[::1]:8080/ai",
    ]) {
      const v = check(url);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe("loopback");
    }
  });

  test("rejects private and link-local ranges", () => {
    for (const url of [
      "http://10.0.0.5:8080/ai",
      "http://192.168.1.10:8080/ai",
      "http://172.16.0.1:8080/ai",
      "http://172.31.255.254:8080/ai",
      "http://169.254.1.1:8080/ai",
      "http://[fd00::1]:8080/ai",
      "http://[fe80::1]:8080/ai",
      "http://tau.local:8080/ai",
      "http://gateway.internal:8080/ai",
    ]) {
      const v = check(url);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe("private");
    }
  });

  test("does not over-reach: public IPs and lookalike hostnames pass", () => {
    // 172.15/172.32 sit just outside the private block, and a hostname merely
    // *containing* "localhost" or "10." is not itself private.
    for (const url of [
      "http://172.15.0.1/ai",
      "http://172.32.0.1/ai",
      "http://8.8.8.8/ai",
      "https://not-localhost.example.com/ai",
      "https://10.example.com/ai",
      "https://local.example.com/ai",
    ]) {
      expect(check(url).ok).toBe(true);
    }
  });

  test("checks BOTH urls, not just the fetch one", () => {
    const v = checkGatewayReachability({
      aiUrl: PUBLIC,
      apiUrl: "http://localhost:8080/v1",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("loopback");
      expect(v.detail).toContain("TAU_API_URL");
    }
  });

  test("names the offending variable so the fix is obvious", () => {
    const v = check("http://localhost:8080/ai");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.detail).toContain("TAU_AI_URL");
  });

  test("reports a malformed URL rather than throwing", () => {
    const v = check("not a url");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("malformed");
  });
});
