import { describe, expect, it } from "vitest";

import { projectReasoningIntoProcessRecords } from "./reasoning-process-projection";

describe("projectReasoningIntoProcessRecords", () => {
  it("keeps standalone reasoning unchanged for non-Agent messages", () => {
    expect(projectReasoningIntoProcessRecords([], "普通对话思考", false)).toEqual([]);
  });

  it("does not duplicate reasoning already present in llm_delta records", () => {
    const records = [
      {
        step_code: "llm_delta",
        status: "completed" as const,
        message: "",
        data: JSON.stringify({ content: "先检查资料。", type: "reasoning" }),
      },
    ];

    expect(projectReasoningIntoProcessRecords(records, "先检查资料。", false)).toBe(records);
  });

  it("appends only a missing reasoning suffix to the Agent process", () => {
    const records = [
      {
        step_code: "tool_execution",
        status: "completed" as const,
        message: "执行搜索",
        data: {},
      },
      {
        step_code: "llm_delta",
        status: "completed" as const,
        message: "",
        data: { content: "先检查资料。", type: "reasoning" },
      },
    ];

    const projected = projectReasoningIntoProcessRecords(
      records,
      "先检查资料。然后整理答案。",
      false,
    );

    expect(projected).toHaveLength(3);
    expect(JSON.parse(String(projected?.[2]?.data))).toEqual({
      content: "然后整理答案。",
      type: "reasoning",
    });
    expect(projected?.[2]?.status).toBe("completed");
  });

  it("restores legacy top-level reasoning inside a running Agent process", () => {
    const records = [
      {
        step_code: "tool_execution",
        status: "completed" as const,
        message: "执行工具",
        data: {},
      },
    ];

    const projected = projectReasoningIntoProcessRecords(records, "补回历史思考", true);

    expect(projected).toHaveLength(2);
    expect(projected?.[1]?.status).toBe("streaming");
    expect(JSON.parse(String(projected?.[1]?.data))).toMatchObject({
      content: "补回历史思考",
      type: "reasoning",
    });
  });
});
