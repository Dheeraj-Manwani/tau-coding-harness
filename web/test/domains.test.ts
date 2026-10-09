import { describe, expect, test } from "bun:test";
import {
  domainStatusLabel,
  isWaiting,
  recordCheck,
  recordsInPlace,
  type DnsRecord,
  type DomainStatus,
} from "../src/features/project/domains";

// The words the Domains pane puts on a domain's state and on each DNS record.

const route: DnsRecord = { type: "CNAME", name: "www", fullName: "www.example.com", value: "cname.bytauai.pro", purpose: "route" };
const verify: DnsRecord = { type: "TXT", name: "_tau.www", fullName: "_tau.www.example.com", value: "tau-verify=x", purpose: "verify" };

describe("a domain's status", () => {
  test("has a short phrase for every state", () => {
    const all: DomainStatus[] = ["PENDING_DNS", "VERIFYING", "ISSUING", "ACTIVE", "FAILED"];
    expect(all.map(domainStatusLabel)).toEqual(["Waiting for DNS", "Verifying", "Issuing certificate", "Active", "Failed"]);
  });

  test("only the states that are still moving are polled", () => {
    expect(isWaiting("PENDING_DNS")).toBe(true);
    expect(isWaiting("VERIFYING")).toBe(true);
    expect(isWaiting("ISSUING")).toBe(true);
    expect(isWaiting("ACTIVE")).toBe(false);
    expect(isWaiting("FAILED")).toBe(false);
  });
});

describe("the line beside each record", () => {
  test("says nothing when there is no live answer, such as once active", () => {
    expect(recordCheck(route, null)).toBeNull();
    expect(recordCheck(verify, null)).toBeNull();
  });

  test("the ownership record is found or not found yet", () => {
    expect(recordCheck(verify, { txt: true, pointsAtTau: null })).toBe("found");
    expect(recordCheck(verify, { txt: false, pointsAtTau: true })).toBe("not found yet");
  });

  test("the route record is found, points elsewhere, or not found yet", () => {
    expect(recordCheck(route, { txt: false, pointsAtTau: true })).toBe("found");
    expect(recordCheck(route, { txt: true, pointsAtTau: false })).toBe("points elsewhere");
    expect(recordCheck(route, { txt: true, pointsAtTau: null })).toBe("not found yet");
  });

  test("both records in place is what the headline waits for", () => {
    expect(recordsInPlace({ txt: true, pointsAtTau: true })).toBe(true);
    expect(recordsInPlace({ txt: true, pointsAtTau: false })).toBe(false);
    expect(recordsInPlace({ txt: false, pointsAtTau: true })).toBe(false);
    expect(recordsInPlace(null)).toBe(false);
  });
});
