import { describe, expect, it } from "vitest";
import {
  applyProcessStep,
  serializeSkillRunItems,
  type ProcessStep,
  type SkillRunItem,
} from "./useChatStream";

function llmDelta(content: string): ProcessStep {
  return {
    step_code: "llm_delta",
    status: "streaming",
    message: "",
    data: { content },
  };
}

describe("console Agent llm_delta rendering", () => {
  it("accumulates planning fragments in one running process item", () => {
    const first = applyProcessStep(llmDelta("plan"), []).items;
    const second = applyProcessStep(llmDelta(" next"), first).items;

    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      type: "llm",
      content: "plan next",
      status: "running",
    });
  });

  it("marks planning complete when the next process step arrives", () => {
    const running = applyProcessStep(llmDelta("plan"), []).items;
    const nextStep: ProcessStep = {
      step_code: "intent_classification",
      status: "completed",
      message: "done",
      data: {},
    };
    const completed = applyProcessStep(nextStep, running).items;

    expect(completed[0]).toMatchObject({
      type: "llm",
      title: "思考完成",
      status: "completed",
    });
  });

  it("serializes an llm-only process so it remains inside the execution block", () => {
    const items: SkillRunItem[] = [
      { type: "llm", title: "思考中...", content: "plan", status: "running" },
    ];

    expect(serializeSkillRunItems(items)).toContain("```skill-run");
  });

  it("renders a completed llm_delta snapshot loaded from message history", () => {
    const completedSnapshot: ProcessStep = {
      step_code: "llm_delta",
      status: "completed",
      message: "",
      data: { content: "persisted reasoning", type: "reasoning" },
    };

    const items = applyProcessStep(completedSnapshot, []).items;

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "llm",
      title: "思考完成",
      content: "persisted reasoning",
      status: "completed",
    });
  });
});
