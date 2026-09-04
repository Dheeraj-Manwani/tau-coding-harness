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
});
