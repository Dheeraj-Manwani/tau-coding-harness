import { describe, expect, test } from "bun:test";
import { normalizeProjectName } from "./project.service";

describe("normalizeProjectName", () => {
  test("removes labels, quotes, and punctuation", () => {
    expect(normalizeProjectName('Project title: "Dentist Appointment Scheduler."')).toBe(
      "Dentist Appointment Scheduler",
    );
  });

  test("keeps only the first line and four words", () => {
    expect(
      normalizeProjectName("Modern Dental Clinic Appointment Booking Platform\nHope this helps"),
    ).toBe("Modern Dental Clinic Appointment");
  });

  test("rejects formatting-only responses", () => {
    expect(normalizeProjectName("### ---")).toBe("");
  });

  test("strips markdown that isn't only at the edges", () => {
    // The image-only-attachment path names off a markdown-formatted
    // extraction (see IMAGE_SYSTEM_PROMPT), so a title echoing a fragment of
    // it must not carry the formatting through.
    expect(normalizeProjectName("Login **Dashboard** App")).toBe(
      "Login Dashboard App",
    );
    expect(normalizeProjectName("A `Kanban` Board for Teams")).toBe(
      "A Kanban Board for",
    );
    expect(normalizeProjectName("## Admin Panel\n\nSome body text")).toBe(
      "Admin Panel",
    );
  });

  test("keeps a letter-adjacent # (e.g. a language name)", () => {
    expect(normalizeProjectName("C# Snippet Manager")).toBe(
      "C# Snippet Manager",
    );
  });
});
