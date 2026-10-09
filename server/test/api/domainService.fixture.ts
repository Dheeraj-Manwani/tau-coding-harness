import { beforeEach, describe, expect, mock, test } from "bun:test";

// The life of a custom domain: adding it, tau reading the owner's DNS, asking
// Cloudflare only after the ownership record is seen, becoming active, primary
// and removal. The database, DNS, Cloudflare and the edge are stand-ins; the
// service and its state machine are the real ones.

type Row = Record<string, any>;
const domains: Row[] = [];
const projects: Row[] = [];
let idSeq = 0;

const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
const matches = (row: Row, where: Row = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in v) return v.in.includes(row[k]);
    return same(row[k], v);
  });

const db = {
  domain: {
    findUnique: async ({ where }: { where: Row }) => {
      const r = domains.find((d) => matches(d, where));
      return r ? { ...r } : null;
    },
    findFirst: async ({ where }: { where: Row }) => {
      const r = domains.find((d) => matches(d, where));
      return r ? { ...r } : null;
    },
    findMany: async ({ where, take }: { where?: Row; take?: number } = {}) =>
      domains
        .filter((d) => matches(d, where))
        .slice(0, take ?? 1000)
        .map((d) => ({ ...d })),
    count: async ({ where }: { where?: Row } = {}) => domains.filter((d) => matches(d, where)).length,
    create: async ({ data }: { data: Row }) => {
      if (domains.some((d) => d.hostname === data.hostname)) {
        throw Object.assign(new Error("unique"), { code: "P2002" });
      }
      const row = {
        id: `dom-${++idSeq}`,
        status: "PENDING_DNS",
        cloudflareHostnameId: null,
        isPrimary: false,
        lastCheckedAt: null,
        error: null,
        createdAt: new Date(now()),
        ...data,
      };
      domains.push(row);
      return { ...row };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      const r = domains.find((d) => matches(d, where));
      if (!r) throw new Error("not found");
      Object.assign(r, data);
      return { ...r };
    },
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = domains.filter((d) => matches(d, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
    delete: async ({ where }: { where: Row }) => {
      const i = domains.findIndex((d) => matches(d, where));
      if (i === -1) throw new Error("not found");
      return domains.splice(i, 1)[0];
    },
  },
};

mock.module("@/lib/prisma", () => ({
  prisma: { ...db, $transaction: async (run: (tx: typeof db) => Promise<unknown>) => run(db) },
}));
mock.module("@/api/repositories/project.repository", () => ({
  findProjectById: async (id: string) => projects.find((p) => p.id === id) ?? null,
}));

const synced: string[] = [];
const removedHostnames: string[] = [];
mock.module("@/lib/edgeRegistry", () => ({
  syncProject: async (id: string) => void synced.push(id),
  removeHostnames: async (h: string[]) => void removedHostnames.push(...h),
}));

const {
  addDomain,
  checkDomain,
  listDomains,
  recheckDomain,
  releaseProjectDomains,
  removeDomain,
  runDomainVerification,
  setDomainDepsForTests,
  setPrimary,
} = await import("@/api/services/domain.service");
const { CloudflareHostnameError } = await import("@/lib/cloudflareHostnames");
const { verificationValue, GIVE_UP_AFTER_MS } = await import("@/lib/domains");

// ── The world ────────────────────────────────────────────────────────────────

let clock = Date.UTC(2026, 9, 9, 12, 0, 0);
const now = () => clock;
const MIN = 60_000;
const HOUR = 60 * MIN;

/** What DNS says. Keys are names; a missing name is no answer. */
const dnsTxt = new Map<string, string[][]>();
const dnsCname = new Map<string, string[]>();
const dnsAddr = new Map<string, string[]>();
const resolver = {
  resolveTxt: async (n: string) => dnsTxt.get(n) ?? Promise.reject(new Error("ENODATA")),
  resolveCname: async (n: string) => dnsCname.get(n) ?? Promise.reject(new Error("ENODATA")),
  resolve4: async (n: string) => dnsAddr.get(n) ?? Promise.reject(new Error("ENODATA")),
  resolve6: async () => Promise.reject(new Error("ENODATA")),
};

/** Cloudflare: what it was asked, and what it answers about a hostname. */
const cf = {
  created: [] as string[],
  removed: [] as string[],
  gets: 0,
  answer: { status: "pending", ssl: { status: "pending_validation" } } as Row,
  existing: null as Row | null,
  failCreate: null as Error | null,
  failGet: false,
};
const client = {
  create: async (hostname: string) => {
    if (cf.failCreate) throw cf.failCreate;
    cf.created.push(hostname);
    return { id: `cf-${hostname}`, hostname, ...cf.answer };
  },
  get: async (id: string) => {
    cf.gets += 1;
    if (cf.failGet) throw new Error("Cloudflare is down");
    return { id, ...cf.answer };
  },
  findByName: async () => cf.existing,
  remove: async (id: string) => void cf.removed.push(id),
};
const cleanRemove = client.remove;
let configured = true;

function project(over: Row = {}) {
  const p = { id: "p1", userId: "u1", slug: "my-app", ...over };
  projects.push(p);
  return p;
}

/** The owner has added the ownership record. */
function proveOwnership(hostname: string, token?: string) {
  const d = domains.find((x) => x.hostname === hostname)!;
  dnsTxt.set(`_tau.${hostname}`, [[verificationValue(token ?? d.verificationToken)]]);
}

async function failure(run: () => Promise<unknown>): Promise<{ statusCode?: number; message: string }> {
  try {
    await run();
  } catch (err) {
    return err as { statusCode?: number; message: string };
  }
  throw new Error("expected it to be refused");
}
const row = (hostname: string): any => domains.find((d) => d.hostname === hostname)!;

beforeEach(() => {
  domains.length = 0;
  projects.length = 0;
  synced.length = 0;
  removedHostnames.length = 0;
  dnsTxt.clear();
  dnsCname.clear();
  dnsAddr.clear();
  Object.assign(cf, { created: [], removed: [], gets: 0, answer: { status: "pending", ssl: { status: "pending_validation" } }, existing: null, failCreate: null, failGet: false });
  clock = Date.UTC(2026, 9, 9, 12, 0, 0);
  configured = true;
  client.remove = cleanRemove;
  setDomainDepsForTests({ resolver, hostnames: () => (configured ? (client as never) : null), now });
  project();
});

describe("adding a domain", () => {
  test("is normalised, and comes back with the two records to add", async () => {
    const view = await addDomain("p1", "u1", "https://WWW.Example.com/");

    expect(view.hostname).toBe("www.example.com");
    expect(view.status).toBe("PENDING_DNS");
    expect(view.kind).toBe("subdomain");
    expect(view.records.map((r) => [r.type, r.name, r.value === "cname.bytauai.pro" ? "target" : "token"])).toEqual([
      ["CNAME", "www", "target"],
      ["TXT", "_tau.www", "token"],
    ]);
    expect(view.records[1]!.value).toBe(verificationValue(row("www.example.com").verificationToken));
    expect(view.checkUntil.getTime()).toBe(clock + GIVE_UP_AFTER_MS);
  });

  test("a root gets the ALIAS table", async () => {
    const view = await addDomain("p1", "u1", "example.com");
    expect(view.kind).toBe("root");
    expect(view.records.map((r) => [r.type, r.name])).toEqual([["ALIAS", "@"], ["TXT", "_tau"]]);
  });

  test("adding asks nothing of Cloudflare", async () => {
    await addDomain("p1", "u1", "www.example.com");
    expect(cf.created).toHaveLength(0);
  });

  test("tau's own domains, IP addresses, wildcards and single labels are refused with a reason", async () => {
    for (const bad of ["my-app.bytauai.pro", "api.tauai.pro", "127.0.0.1", "*.example.com", "localhost", "co.uk", "not a domain"]) {
      const err = await failure(() => addDomain("p1", "u1", bad));
      expect(err.statusCode).toBe(400);
      expect(err.message.length).toBeGreaterThan(20);
    }
    expect(domains).toHaveLength(0);
  });

  test("a project that has not been published has nothing to show on a domain", async () => {
    projects.length = 0;
    project({ slug: null });
    const err = await failure(() => addDomain("p1", "u1", "www.example.com"));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("Publish");
  });

  test("a project may have five", async () => {
    for (let i = 1; i <= 5; i++) await addDomain("p1", "u1", `site${i}.example.com`);
    const err = await failure(() => addDomain("p1", "u1", "site6.example.com"));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("5 domains");
  });

  test("a name another project holds is refused, and says nothing about whose", async () => {
    project({ id: "p2", userId: "u2" });
    await addDomain("p2", "u2", "www.example.com");

    const err = await failure(() => addDomain("p1", "u1", "WWW.example.com"));
    expect(err.statusCode).toBe(409);
    expect(err.message).toContain("another project");
    expect(domains).toHaveLength(1);
  });

  test("the same name twice in one project is refused", async () => {
    await addDomain("p1", "u1", "www.example.com");
    expect((await failure(() => addDomain("p1", "u1", "www.example.com"))).message).toContain("already connected to this project");
  });

  test("two projects racing for one name: exactly one gets it", async () => {
    project({ id: "p2", userId: "u2" });
    const results = await Promise.allSettled([addDomain("p1", "u1", "race.example.com"), addDomain("p2", "u2", "race.example.com")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(domains).toHaveLength(1);
  });

  test("only the owner can add", async () => {
    expect((await failure(() => addDomain("p1", "someone-else", "www.example.com"))).statusCode).toBe(403);
    expect(domains).toHaveLength(0);
  });
});

describe("tau checks ownership before it asks Cloudflare for anything", () => {
  test("with no ownership record, Cloudflare is never asked, and the domain waits", async () => {
    await addDomain("p1", "u1", "www.example.com");
    const after = await checkDomain(row("www.example.com"));

    expect(after.status).toBe("PENDING_DNS");
    expect(cf.created).toHaveLength(0);
    expect(cf.gets).toBe(0);
    expect(after.lastCheckedAt).not.toBeNull();
  });

  // The attack: Cloudflare would accept this hostname because its CNAME is already tau's.
  test("a CNAME that already points at tau is not enough", async () => {
    await addDomain("p1", "u1", "www.example.com");
    dnsCname.set("www.example.com", ["cname.bytauai.pro"]);

    const after = await checkDomain(row("www.example.com"));
    expect(after.status).toBe("PENDING_DNS");
    expect(cf.created).toHaveLength(0);
  });

  test("another project's token does not prove this domain", async () => {
    project({ id: "p2", userId: "u2" });
    await addDomain("p2", "u2", "other.example.com");
    await addDomain("p1", "u1", "www.example.com");
    // The owner of www has put p2's token (or any other) in their DNS.
    dnsTxt.set("_tau.www.example.com", [[verificationValue(row("other.example.com").verificationToken)]]);

    const after = await checkDomain(row("www.example.com"));
    expect(after.status).toBe("PENDING_DNS");
    expect(cf.created).toHaveLength(0);
  });

  test("a removed domain added again gets a new token, so the old record proves nothing", async () => {
    const first = await addDomain("p1", "u1", "www.example.com");
    const oldToken = row("www.example.com").verificationToken;
    proveOwnership("www.example.com");
    await removeDomain("p1", row("www.example.com").id, "u1");

    // A different project adds the name; the old owner's record is still in DNS.
    project({ id: "p2", userId: "u2" });
    await addDomain("p2", "u2", "www.example.com");
    expect(row("www.example.com").verificationToken).not.toBe(oldToken);
    expect(first.records[1]!.value).not.toBe((await listDomains("p2", "u2"))[0]!.records[1]!.value);

    const after = await checkDomain(row("www.example.com"));
    expect(after.status).toBe("PENDING_DNS");
    expect(cf.created).toHaveLength(0);
  });

  test("once the record is seen, the hostname is requested, and the id kept", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");

    const after = await checkDomain(row("www.example.com"));
    expect(cf.created).toEqual(["www.example.com"]);
    expect(after.cloudflareHostnameId).toBe("cf-www.example.com");
    expect(after.status).toBe("VERIFYING");
  });

  test("it is not requested twice on later checks", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
    await checkDomain(row("www.example.com"));
    await checkDomain(row("www.example.com"));

    expect(cf.created).toHaveLength(1);
    expect(cf.gets).toBeGreaterThanOrEqual(2);
  });

  test("a hostname left at Cloudflare by an earlier attempt is taken over, not an error", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    cf.failCreate = new CloudflareHostnameError("Duplicate custom hostname found", 409, 1406);
    cf.existing = { id: "cf-left-over", hostname: "www.example.com", status: "pending", ssl: { status: "pending_validation" } };

    const after = await checkDomain(row("www.example.com"));
    expect(after.cloudflareHostnameId).toBe("cf-left-over");
    expect(after.status).toBe("VERIFYING");
  });

  test("where Cloudflare is not configured the domain waits, with DNS still checked", async () => {
    configured = false;
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");

    const after = await checkDomain(row("www.example.com"));
    expect(after.status).toBe("PENDING_DNS");
    expect(cf.created).toHaveLength(0);
  });
});

describe("becoming active", () => {
  async function verifying() {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
  }

  test("follows what Cloudflare says, and is only routed once active", async () => {
    await verifying();
    expect(row("www.example.com").status).toBe("VERIFYING");

    cf.answer = { status: "pending", ssl: { status: "pending_issuance" } };
    await checkDomain(row("www.example.com"));
    expect(row("www.example.com").status).toBe("ISSUING");
    expect(synced).toHaveLength(0);

    cf.answer = { status: "active", ssl: { status: "active" } };
    await checkDomain(row("www.example.com"));
    expect(row("www.example.com").status).toBe("ACTIVE");
    expect(synced).toEqual(["p1"]);
  });

  test("an active domain is left alone", async () => {
    await verifying();
    cf.answer = { status: "active", ssl: { status: "active" } };
    await checkDomain(row("www.example.com"));
    const gets = cf.gets;
    synced.length = 0;

    await checkDomain(row("www.example.com"));
    expect(cf.gets).toBe(gets);
    expect(synced).toHaveLength(0);
  });

  test("a certificate that times out fails the domain with a reason the owner can act on", async () => {
    await verifying();
    cf.answer = { status: "pending", ssl: { status: "validation_timed_out" } };
    await checkDomain(row("www.example.com"));

    expect(row("www.example.com").status).toBe("FAILED");
    expect(row("www.example.com").error).toContain("exactly as shown");
    expect(synced).toHaveLength(0);
  });

  test("a hostname Cloudflare blocked fails with its own explanation", async () => {
    await verifying();
    cf.answer = { status: "blocked", verification_errors: ["This hostname is on a blocklist."], ssl: { status: "initializing" } };
    await checkDomain(row("www.example.com"));

    expect(row("www.example.com").status).toBe("FAILED");
    expect(row("www.example.com").error).toContain("blocklist");
  });

  test("a failed domain is not checked again by the background pass", async () => {
    await verifying();
    cf.answer = { status: "pending", ssl: { status: "validation_timed_out" } };
    await checkDomain(row("www.example.com"));
    const gets = cf.gets;
    clock += 3 * HOUR;

    expect(await runDomainVerification()).toBe(0);
    expect(cf.gets).toBe(gets);
  });
});

describe("giving up", () => {
  test("after 72 hours a domain that is still waiting fails, and its Cloudflare hostname is released", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
    clock += GIVE_UP_AFTER_MS + MIN;

    await checkDomain(row("www.example.com"));
    expect(row("www.example.com").status).toBe("FAILED");
    expect(row("www.example.com").error).toContain("72 hours");
    expect(cf.removed).toEqual(["cf-www.example.com"]);
  });

  test("before that it keeps waiting", async () => {
    await addDomain("p1", "u1", "www.example.com");
    clock += GIVE_UP_AFTER_MS - HOUR;
    expect((await checkDomain(row("www.example.com"))).status).toBe("PENDING_DNS");
  });

  test("Refresh on a failed domain starts over with a new 72 hours and a clean slate", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
    clock += GIVE_UP_AFTER_MS + MIN;
    await checkDomain(row("www.example.com"));
    expect(row("www.example.com").status).toBe("FAILED");
    cf.removed.length = 0;

    const view = await recheckDomain("p1", row("www.example.com").id, "u1");
    expect(view.status).toBe("VERIFYING");
    expect(view.error).toBeNull();
    expect(view.checkUntil.getTime()).toBe(clock + GIVE_UP_AFTER_MS);
    expect(cf.created).toHaveLength(2);
  });

  test("a Cloudflare outage on Refresh is a retry-later message and changes nothing", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
    cf.failGet = true;

    const err = await failure(() => recheckDomain("p1", row("www.example.com").id, "u1"));
    expect(err.statusCode).toBe(429);
    expect(row("www.example.com").status).toBe("VERIFYING");
  });

  test("Refresh by anyone but the owner, or on another project's domain, is not found", async () => {
    await addDomain("p1", "u1", "www.example.com");
    expect((await failure(() => recheckDomain("p1", row("www.example.com").id, "someone-else"))).statusCode).toBe(403);
    project({ id: "p2", userId: "u2" });
    expect((await failure(() => recheckDomain("p2", row("www.example.com").id, "u2"))).statusCode).toBe(404);
  });
});

describe("the background pass", () => {
  test("checks a waiting domain once it is due, and not before", async () => {
    await addDomain("p1", "u1", "www.example.com");
    expect(await runDomainVerification()).toBe(1);

    clock += 30_000;
    expect(await runDomainVerification()).toBe(0);
    clock += 31_000;
    expect(await runDomainVerification()).toBe(1);
  });

  test("backs off as a domain gets older", async () => {
    await addDomain("p1", "u1", "www.example.com");
    clock += 3 * HOUR;
    await runDomainVerification();

    clock += 20 * MIN;
    expect(await runDomainVerification()).toBe(0);
    clock += 15 * MIN;
    expect(await runDomainVerification()).toBe(1);
  });

  test("one domain that errors does not stop the rest, and still counts as checked", async () => {
    await addDomain("p1", "u1", "a.example.com");
    await addDomain("p1", "u1", "b.example.com");
    proveOwnership("a.example.com");
    cf.failCreate = new Error("Cloudflare is down");
    // a throws when asked for a hostname; b only waits.
    const checked = await runDomainVerification();

    expect(checked).toBe(1);
    expect(row("a.example.com").lastCheckedAt).not.toBeNull();
    expect(row("a.example.com").status).toBe("PENDING_DNS");
  });

  test("a domain that becomes active is routed from the pass", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await runDomainVerification();
    cf.answer = { status: "active", ssl: { status: "active" } };
    clock += 2 * MIN;
    await runDomainVerification();

    expect(row("www.example.com").status).toBe("ACTIVE");
    expect(synced).toEqual(["p1"]);
  });
});

describe("primary", () => {
  async function active(hostname: string) {
    await addDomain("p1", "u1", hostname);
    row(hostname).status = "ACTIVE";
  }

  test("only an active domain can be primary", async () => {
    await addDomain("p1", "u1", "www.example.com");
    const err = await failure(() => setPrimary("p1", row("www.example.com").id, "u1", true));
    expect(err.statusCode).toBe(409);
    expect(row("www.example.com").isPrimary).toBe(false);
    expect(synced).toHaveLength(0);
  });

  test("making one primary clears the others and pushes the redirect", async () => {
    await active("www.example.com");
    await active("example.com");
    await setPrimary("p1", row("www.example.com").id, "u1", true);
    expect(row("www.example.com").isPrimary).toBe(true);

    const list = await setPrimary("p1", row("example.com").id, "u1", true);
    expect(row("www.example.com").isPrimary).toBe(false);
    expect(list.filter((d) => d.isPrimary).map((d) => d.hostname)).toEqual(["example.com"]);
    expect(synced).toEqual(["p1", "p1"]);
  });

  test("it can be turned off again", async () => {
    await active("www.example.com");
    await setPrimary("p1", row("www.example.com").id, "u1", true);
    await setPrimary("p1", row("www.example.com").id, "u1", false);
    expect(row("www.example.com").isPrimary).toBe(false);
  });
});

describe("removing a domain", () => {
  test("releases it at Cloudflare and the edge, then deletes the row", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
    const id = row("www.example.com").id;

    const left = await removeDomain("p1", id, "u1");
    expect(cf.removed).toEqual(["cf-www.example.com"]);
    expect(removedHostnames).toEqual(["www.example.com"]);
    expect(domains).toHaveLength(0);
    expect(left).toEqual([]);
  });

  test("a domain that never got as far as Cloudflare is removed without calling it", async () => {
    await addDomain("p1", "u1", "www.example.com");
    await removeDomain("p1", row("www.example.com").id, "u1");
    expect(cf.removed).toHaveLength(0);
    expect(domains).toHaveLength(0);
  });

  test("removing the primary puts the default address back to serving", async () => {
    await addDomain("p1", "u1", "www.example.com");
    row("www.example.com").status = "ACTIVE";
    await setPrimary("p1", row("www.example.com").id, "u1", true);
    synced.length = 0;

    await removeDomain("p1", row("www.example.com").id, "u1");
    expect(synced).toEqual(["p1"]);
  });

  test("a Cloudflare failure does not keep the owner from removing it", async () => {
    await addDomain("p1", "u1", "www.example.com");
    proveOwnership("www.example.com");
    await checkDomain(row("www.example.com"));
    client.remove = async () => {
      throw new Error("Cloudflare is down");
    };
    await removeDomain("p1", row("www.example.com").id, "u1");
    expect(domains).toHaveLength(0);
  });

  test("another project's domain cannot be removed", async () => {
    await addDomain("p1", "u1", "www.example.com");
    project({ id: "p2", userId: "u2" });
    expect((await failure(() => removeDomain("p2", row("www.example.com").id, "u2"))).statusCode).toBe(404);
    expect(domains).toHaveLength(1);
  });

  test("deleting a project releases every one of its domains", async () => {
    await addDomain("p1", "u1", "a.example.com");
    await addDomain("p1", "u1", "b.example.com");
    row("a.example.com").cloudflareHostnameId = "cf-a";
    await releaseProjectDomains("p1");

    expect(removedHostnames.sort()).toEqual(["a.example.com", "b.example.com"]);
    expect(cf.removed).toEqual(["cf-a"]);
  });
});

describe("what the panel reads", () => {
  test("lists the records and the live DNS answer for a waiting domain", async () => {
    await addDomain("p1", "u1", "www.example.com");
    dnsCname.set("www.example.com", ["cname.bytauai.pro."]);

    const [view] = await listDomains("p1", "u1");
    expect(view!.dns).toEqual({ txt: false, pointsAtTau: true });
    proveOwnership("www.example.com");
    expect((await listDomains("p1", "u1"))[0]!.dns).toEqual({ txt: true, pointsAtTau: true });
  });

  test("an active domain is not looked up again", async () => {
    await addDomain("p1", "u1", "www.example.com");
    row("www.example.com").status = "ACTIVE";
    expect((await listDomains("p1", "u1"))[0]!.dns).toBeNull();
  });

  test("only the owner can list", async () => {
    expect((await failure(() => listDomains("p1", "someone-else"))).statusCode).toBe(403);
  });
});
