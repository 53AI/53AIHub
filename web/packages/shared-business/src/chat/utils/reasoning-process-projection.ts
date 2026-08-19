import type { ProcessRecord } from "../types/message";

function readLlmDeltaData(record: ProcessRecord): { content: string; type: string } | null {
  if (record.step_code !== "llm_delta") return null;

  let data = record.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || typeof data !== "object") return null;

  const content = (data as { content?: unknown }).content;
  const type = (data as { type?: unknown }).type;
  return {
    content: typeof content === "string" ? content : "",
    // 历史 llm_delta 没有 type 时，本来就是按思考内容渲染。
    type: typeof type === "string" ? type : "reasoning",
  };
}

/**
 * Agent 消息的顶层 reasoning_content 主要用于模型历史兼容，不应再在答案区
 * 单独生成“已完成深度思考”。如果旧数据缺少对应 llm_delta，则补入执行过程，
 * 避免仅隐藏顶层字段后丢失可见思考记录。
 */
export function projectReasoningIntoProcessRecords(
  processRecords: ProcessRecord[] | undefined,
  reasoningContent: string | undefined,
  streaming: boolean,
): ProcessRecord[] | undefined {
  if (!processRecords?.length || !reasoningContent?.trim()) return processRecords;

  const recordedReasoning = processRecords
    .map(readLlmDeltaData)
    .filter((item): item is { content: string; type: string } => Boolean(item))
    .filter((item) => item.type === "reasoning")
    .map((item) => item.content)
    .join("");

  const completedReasoning = reasoningContent.trim();
  const existingReasoning = recordedReasoning.trim();
  if (existingReasoning.includes(completedReasoning)) return processRecords;

  const missingReasoning = completedReasoning.startsWith(existingReasoning)
    ? completedReasoning.slice(existingReasoning.length)
    : completedReasoning;
  if (!missingReasoning.trim()) return processRecords;

  return [
    ...processRecords,
    {
      step_code: "llm_delta",
      status: streaming ? "streaming" : "completed",
      message: "",
      data: JSON.stringify({ content: missingReasoning, type: "reasoning" }),
    },
  ];
}
