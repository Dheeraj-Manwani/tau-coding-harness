import { describe, expect, test } from "bun:test";
import { redactUrl } from "./logger.middleware";

describe("redactUrl", () => {
  test("strips the SSE access token", () => {
    expect(redactUrl("/jobs/j1/stream?token=eyJhbGci.x.y&lastEventIndex=4")).toBe(
      "/jobs/j1/stream?token=[redacted]&lastEventIndex=4",
    );
  });

  test("strips OAuth code and state", () => {
    expect(redactUrl("/auth/github/callback?code=abc123&state=s.i.g")).toBe(
      "/auth/github/callback?code=[redacted]&state=[redacted]",
    );
  });

  test("leaves ordinary params alone", () => {
    expect(redactUrl("/admin/jobs?status=RUNNING&limit=20")).toBe(
      "/admin/jobs?status=RUNNING&limit=20",
    );
    expect(redactUrl("/project/p1")).toBe("/project/p1");
  });

  test("does not match a param that merely ends in a secret name", () => {
    expect(redactUrl("/x?zipcode=12345")).toBe("/x?zipcode=12345");
  });
});
