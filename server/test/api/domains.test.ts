import { describe, expect, test } from "bun:test";
import {
  checkCustomHostname,
  checkDns,
  checkIntervalMs,
  checkIsDue,
  dnsRecords,
  kindOf,
  newVerificationToken,
  normalizeHostname,
  txtProves,
  verificationValue,
  type Resolver,
} from "@/lib/domains";

// What an owner types, what they are told to add, and how tau reads their DNS.

describe("normalizeHostname", () => {
  test("takes what people paste", () => {
    for (const input of [
      "www.example.com",
      "WWW.Example.COM",
      "  www.example.com  ",
      "https://www.example.com",
      "http://www.example.com/",
      "https://www.example.com/path/to/page?x=1#top",
      "www.example.com.",
      "www.example.com:8443",
      "https://user:pw@www.example.com:8443/x",
    ]) {
      expect(normalizeHostname(input)).toBe("www.example.com");
    }
  });

  test("turns an international name into the ASCII form DNS holds", () => {
    expect(normalizeHostname("münchen.example")).toBe("xn--mnchen-3ya.example");
    expect(normalizeHostname("https://Bücher.example/")).toBe("xn--bcher-kva.example");
    expect(normalizeHostname("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
  });

  test("gives up on nothing, or something too long", () => {
    expect(normalizeHostname("")).toBeNull();
    expect(normalizeHostname("   ")).toBeNull();
    expect(normalizeHostname("https://")).toBeNull();
    expect(normalizeHostname(`${"a".repeat(250)}.com`)).toBeNull();
  });
});

describe("checkCustomHostname", () => {
  const problem = (input: string, sitesDomain?: string) => {
    const r = checkCustomHostname(input, { sitesDomain });
    return r.ok ? null : r.problem;
  };

  test("accepts roots and subdomains, however deep", () => {
    expect(checkCustomHostname("example.com")).toEqual({ ok: true, hostname: "example.com" });
    expect(checkCustomHostname("https://www.Example.com/")).toEqual({ ok: true, hostname: "www.example.com" });
    expect(checkCustomHostname("a.b.c.example.co.uk")).toEqual({ ok: true, hostname: "a.b.c.example.co.uk" });
    expect(checkCustomHostname("bücher.de")).toEqual({ ok: true, hostname: "xn--bcher-kva.de" });
    expect(checkCustomHostname("my-shop.example.org")).toMatchObject({ ok: true });
  });

  test("refuses anything under tau's own domains, and the sites domain, root or not", () => {
    for (const bad of ["bytauai.pro", "my-app.bytauai.pro", "cname.bytauai.pro", "tauai.pro", "api.tauai.pro", "BYTAUAI.PRO", "https://app.tauai.pro/x"]) {
      expect(problem(bad)).toBe("own_domain");
    }
    expect(problem("sites.example.dev", "sites.example.dev")).toBe("own_domain");
    expect(problem("a.sites.example.dev", "sites.example.dev")).toBe("own_domain");
  });

  test("a lookalike is not tau's", () => {
    expect(problem("notbytauai.pro")).toBeNull();
    expect(problem("bytauai.pro.example.com")).toBeNull();
    expect(problem("mytauai.pro")).toBeNull();
  });

  test("refuses IP addresses in any form", () => {
    for (const ip of ["127.0.0.1", "10.0.0.1", "192.168.1.10", "8.8.8.8", "http://1.2.3.4/", "[::1]", "2001:db8::1", "1.2", "2130706433"]) {
      expect(problem(ip)).not.toBeNull();
    }
    expect(problem("8.8.8.8")).toBe("ip");
  });

  test("refuses a single label, and localhost", () => {
    expect(problem("localhost")).toBe("single_label");
    expect(problem("example")).toBe("single_label");
    expect(problem("intranet")).toBe("single_label");
    expect(problem("localhost.localdomain")).not.toBeNull();
  });

  test("refuses wildcards", () => {
    expect(problem("*.example.com")).toBe("wildcard");
    expect(problem("shop.*.com")).toBe("wildcard");
  });

  test("refuses what is not a domain at all", () => {
    for (const bad of ["", "exa mple.com", "example..com", "-example.com", "example-.com", "exa_mple.com", "example.c", "example.123", "http://", "a@b", `${"a".repeat(64)}.com`, ".com"]) {
      expect(problem(bad)).not.toBeNull();
    }
  });

  test("refuses a public suffix, which nobody can own", () => {
    expect(problem("com")).toBe("single_label");
    expect(problem("co.uk")).toBe("not_registrable");
    expect(problem("example.co.uk")).toBeNull();
  });

  test("every refusal has a plain message", () => {
    const r = checkCustomHostname("*.example.com");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("Wildcard");
  });
});

describe("root or subdomain", () => {
  test("by the public-suffix list, not by counting dots", () => {
    expect(kindOf("example.com")).toBe("root");
    expect(kindOf("www.example.com")).toBe("subdomain");
    expect(kindOf("a.b.example.com")).toBe("subdomain");
    expect(kindOf("example.co.uk")).toBe("root");
    expect(kindOf("www.example.co.uk")).toBe("subdomain");
    expect(kindOf("example.com.au")).toBe("root");
  });
});

describe("the records to add", () => {
  const TARGET = "cname.bytauai.pro";

  test("a subdomain takes a CNAME and a TXT record at _tau.{name}", () => {
    expect(dnsRecords("www.example.com", "tok", TARGET)).toEqual([
      { type: "CNAME", name: "www", fullName: "www.example.com", value: TARGET, purpose: "route" },
      { type: "TXT", name: "_tau.www", fullName: "_tau.www.example.com", value: "tau-verify=tok", purpose: "verify" },
    ]);
  });

  test("a root takes an ALIAS on @ and a TXT record at _tau", () => {
    expect(dnsRecords("example.com", "tok", TARGET)).toEqual([
      { type: "ALIAS", name: "@", fullName: "example.com", value: TARGET, purpose: "route" },
      { type: "TXT", name: "_tau", fullName: "_tau.example.com", value: "tau-verify=tok", purpose: "verify" },
    ]);
  });

  test("a deep subdomain keeps every label, and a two-part suffix is not the name", () => {
    const [route, txt] = dnsRecords("shop.eu.example.co.uk", "t", TARGET);
    expect(route!.name).toBe("shop.eu");
    expect(txt!.name).toBe("_tau.shop.eu");
    expect(dnsRecords("example.co.uk", "t", TARGET)[0]!.name).toBe("@");
  });

  test("tokens are long, random and different every time", () => {
    const a = newVerificationToken();
    expect(a).toMatch(/^[0-9a-f]{36}$/);
    expect(newVerificationToken()).not.toBe(a);
    expect(verificationValue(a)).toBe(`tau-verify=${a}`);
  });
});

describe("the ownership record", () => {
  test("must be exactly the value", () => {
    expect(txtProves([["tau-verify=abc"]], "abc")).toBe(true);
    expect(txtProves([["v=spf1 -all"], ["tau-verify=abc"]], "abc")).toBe(true);
    expect(txtProves([["tau-verify=abcd"]], "abc")).toBe(false);
    expect(txtProves([["tau-verify=ab"]], "abc")).toBe(false);
    expect(txtProves([["xtau-verify=abc"]], "abc")).toBe(false);
    expect(txtProves([["tau-verify=ABC"]], "abc")).toBe(false);
    expect(txtProves([], "abc")).toBe(false);
  });

  test("a value a resolver split into chunks is put back together", () => {
    expect(txtProves([["tau-verify=", "abc"]], "abc")).toBe(true);
  });

  // The attack this exists for: the old owner's record, or someone else's token.
  test("another project's token does not prove this one", () => {
    expect(txtProves([[verificationValue("first-projects-token")]], "second-projects-token")).toBe(false);
  });
});

describe("looking at DNS", () => {
  const TARGET = "cname.bytauai.pro";

  function resolver(answers: {
    txt?: Record<string, string[][]>;
    cname?: Record<string, string[]>;
    a?: Record<string, string[]>;
    aaaa?: Record<string, string[]>;
  }): Resolver & { asked: string[] } {
    const asked: string[] = [];
    const get = <T>(table: Record<string, T> | undefined, name: string): Promise<T> => {
      asked.push(name);
      const v = table?.[name];
      return v === undefined ? Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" })) : Promise.resolve(v);
    };
    return {
      asked,
      resolveTxt: (n) => get(answers.txt, n),
      resolveCname: (n) => get(answers.cname, n),
      resolve4: (n) => get(answers.a, n),
      resolve6: (n) => get(answers.aaaa, n),
    };
  }

  test("a subdomain with both records in place", async () => {
    const r = resolver({
      txt: { "_tau.www.example.com": [["tau-verify=tok"]] },
      cname: { "www.example.com": ["cname.bytauai.pro."] },
    });
    expect(await checkDns("www.example.com", "tok", TARGET, r)).toEqual({ txt: true, pointsAtTau: true });
    expect(r.asked).toContain("_tau.www.example.com");
  });

  test("nothing added yet", async () => {
    expect(await checkDns("www.example.com", "tok", TARGET, resolver({}))).toEqual({ txt: false, pointsAtTau: null });
  });

  test("the ownership record without the route, and the route without the ownership record", async () => {
    expect(
      await checkDns("www.example.com", "tok", TARGET, resolver({ txt: { "_tau.www.example.com": [["tau-verify=tok"]] }, cname: { "www.example.com": ["elsewhere.net"] } })),
    ).toEqual({ txt: true, pointsAtTau: false });
    expect(
      await checkDns("www.example.com", "tok", TARGET, resolver({ cname: { "www.example.com": ["cname.bytauai.pro"] } })),
    ).toEqual({ txt: false, pointsAtTau: true });
  });

  test("a root, whose ALIAS shows as addresses, is found by sharing one with the target", async () => {
    const r = resolver({
      txt: { "_tau.example.com": [["tau-verify=tok"]] },
      a: { "example.com": ["104.21.0.1", "104.21.0.2"], [TARGET]: ["104.21.0.2", "104.21.0.9"] },
    });
    expect(await checkDns("example.com", "tok", TARGET, r)).toEqual({ txt: true, pointsAtTau: true });

    const apart = resolver({ a: { "example.com": ["93.184.216.34"], [TARGET]: ["104.21.0.2"] } });
    expect((await checkDns("example.com", "tok", TARGET, apart)).pointsAtTau).toBe(false);
  });

  test("a wrong token is not a match", async () => {
    const r = resolver({ txt: { "_tau.www.example.com": [["tau-verify=someone-elses"]] } });
    expect((await checkDns("www.example.com", "tok", TARGET, r)).txt).toBe(false);
  });

  test("a lookup that fails is an answer of nothing, not an error", async () => {
    const broken: Resolver = {
      resolveTxt: () => Promise.reject(new Error("SERVFAIL")),
      resolveCname: () => Promise.reject(new Error("SERVFAIL")),
      resolve4: () => Promise.reject(new Error("SERVFAIL")),
      resolve6: () => Promise.reject(new Error("SERVFAIL")),
    };
    expect(await checkDns("www.example.com", "tok", TARGET, broken)).toEqual({ txt: false, pointsAtTau: null });
  });
});

describe("when to look again", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;

  test("often at first, then less and less", () => {
    expect(checkIntervalMs(0)).toBe(MIN);
    expect(checkIntervalMs(14 * MIN)).toBe(MIN);
    expect(checkIntervalMs(15 * MIN)).toBe(5 * MIN);
    expect(checkIntervalMs(HOUR)).toBe(5 * MIN);
    expect(checkIntervalMs(2 * HOUR)).toBe(30 * MIN);
    expect(checkIntervalMs(24 * HOUR)).toBe(2 * HOUR);
    expect(checkIntervalMs(70 * HOUR)).toBe(2 * HOUR);
  });

  test("a domain never checked is due; one checked a moment ago is not", () => {
    const now = Date.now();
    const created = new Date(now - 5 * MIN);
    expect(checkIsDue({ createdAt: created, lastCheckedAt: null }, now)).toBe(true);
    expect(checkIsDue({ createdAt: created, lastCheckedAt: new Date(now - 30_000) }, now)).toBe(false);
    expect(checkIsDue({ createdAt: created, lastCheckedAt: new Date(now - 61_000) }, now)).toBe(true);
  });

  test("an old domain waits longer between checks", () => {
    const now = Date.now();
    const created = new Date(now - 30 * HOUR);
    expect(checkIsDue({ createdAt: created, lastCheckedAt: new Date(now - HOUR) }, now)).toBe(false);
    expect(checkIsDue({ createdAt: created, lastCheckedAt: new Date(now - 2.1 * HOUR) }, now)).toBe(true);
  });
});
