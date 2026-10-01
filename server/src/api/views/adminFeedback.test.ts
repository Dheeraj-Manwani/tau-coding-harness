import { expect, test } from "bun:test";
import { renderAdminFeedback } from "./adminFeedback";

test("feedback inbox ships valid JavaScript and renders user content as text", () => {
  const html = renderAdminFeedback();
  const script = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
  expect(script).toBeDefined();
  expect(() => new Function(script!)).not.toThrow();
  expect(script).toContain("el.textContent=text");
  expect(script).not.toContain("innerHTML");
  expect(script).toContain("/admin/feedback");
});
