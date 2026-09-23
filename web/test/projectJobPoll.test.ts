import { describe, expect, test } from "bun:test";
import {
  jobStatusFromDetail,
  jobStatusNeedsResync,
} from "../src/features/project/projectJobPoll";
import type { ProjectDetail, ProjectJobStatusResponse } from "../src/features/project/types";

const working: ProjectJobStatusResponse = {
  activeJobId: "job-1",
  jobType: "GENERATION",
  pendingQuestionId: null,
};

const current = {
  currentJobId: "job-1",
  pendingQuestion: null,
  isAiTyping: true,
};

describe("lightweight job recovery poll", () => {
  test("does not load the transcript when the live stream agrees", () => {
    expect(jobStatusNeedsResync(working, current)).toBe(false);
    expect(jobStatusNeedsResync({
      activeJobId: "preview-1", jobType: "PREVIEW", pendingQuestionId: null,
    }, {
      currentJobId: "preview-1", pendingQuestion: null, isAiTyping: false,
    })).toBe(false);
  });

  test("loads the transcript for a missed end, new job, or unanswered question", () => {
    expect(jobStatusNeedsResync({ ...working, activeJobId: null }, current)).toBe(true);
    expect(jobStatusNeedsResync({ ...working, activeJobId: "job-2" }, current)).toBe(true);
    expect(jobStatusNeedsResync({ ...working, pendingQuestionId: "question-1" }, current)).toBe(true);
    expect(jobStatusNeedsResync(working, { ...current, isAiTyping: false })).toBe(true);
  });

  test("accepts an already displayed question", () => {
    expect(jobStatusNeedsResync({ ...working, pendingQuestionId: "question-1" }, {
      currentJobId: "job-1",
      pendingQuestion: { id: "question-1" },
      isAiTyping: false,
    })).toBe(false);
  });

  test("a recovered detail maps back to the same small status", () => {
    const detail = {
      activeJobId: "job-1",
      jobState: {
        type: "GENERATION",
        pendingQuestion: { id: "question-1", question: "Which?", options: [] },
      },
    } as ProjectDetail;
    expect(jobStatusFromDetail(detail)).toEqual({
      activeJobId: "job-1",
      jobType: "GENERATION",
      pendingQuestionId: "question-1",
    });
  });
});
