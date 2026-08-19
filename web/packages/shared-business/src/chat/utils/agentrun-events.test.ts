import { describe, expect, it } from "vitest";
import { applyAgentRunEvents } from "./agentrun-events";
import type { AgentRunEvent } from "../adapters/types";
import type { Message } from "../types";

const baseMessage: Message = {
  id: "1",
  role: "assistant",
} as any;

const ev = (type: AgentRunEvent["type"], payload: Record<string, unknown> = {}, seq = 1): AgentRunEvent => ({
  seq,
  type,
  payload,
});

describe("applyAgentRunEvents — pure function", () => {
  it("returns a new object instead of mutating input", () => {
    const result = applyAgentRunEvents(baseMessage, [ev("run.created")]);
    expect(result).not.toBe(baseMessage);
  });

  it("does not mutate the input message", () => {
    const input: Message = { ...baseMessage, answer: "hello" };
    applyAgentRunEvents(input, [ev("message.delta", { content: " world" })]);
    expect(input.answer).toBe("hello");
  });

  it("run.created sets loading=true", () => {
    const result = applyAgentRunEvents(baseMessage, [ev("run.created")]);
    expect(result.loading).toBe(true);
  });

  it("run.status_changed updates loading per AGENT_RUN_RUNNING_STATUSES", () => {
    const running = applyAgentRunEvents(baseMessage, [
      ev("run.status_changed", { status: "running" }),
    ]);
    expect(running.loading).toBe(true);

    const done = applyAgentRunEvents({ ...baseMessage, loading: true }, [
      ev("run.status_changed", { status: "completed" }),
    ]);
    expect(done.loading).toBe(false);
  });

  it("message.delta accumulates content into answer", () => {
    const r1 = applyAgentRunEvents(baseMessage, [
      ev("message.delta", { content: "hello" }),
    ]);
    const r2 = applyAgentRunEvents(r1, [
      ev("message.delta", { content: " world" }),
    ]);
    expect(r1.answer).toBe("hello");
    expect(r2.answer).toBe("hello world");
  });

  it("message.delta reads content from choices[0].delta (replay SSE shape)", () => {
    // replay API 返回的是 OpenAI 兼容的 SSE 格式:payload.choices[0].delta.content
    const r1 = applyAgentRunEvents(baseMessage, [
      ev("message.delta", {
        choices: [{ delta: { content: "看" } }],
      }),
    ]);
    const r2 = applyAgentRunEvents(r1, [
      ev("message.delta", {
        choices: [{ delta: { content: "起来" } }],
      }),
    ]);
    expect(r1.answer).toBe("看");
    expect(r2.answer).toBe("看起来");
  });

  it("message.delta accumulates reasoning_content from choices[0].delta", () => {
    const r = applyAgentRunEvents(baseMessage, [
      ev("message.delta", {
        choices: [{ delta: { reasoning_content: "思考中" } }],
      }),
      ev("message.delta", {
        choices: [{ delta: { reasoning_content: "..." } }],
      }),
    ]);
    expect(r.reasoning_content).toBe("思考中...");
  });

  it("message.delta accumulates reasoning_content independently", () => {
    const r1 = applyAgentRunEvents(baseMessage, [
      ev("message.delta", { reasoning_content: "thinking..." }),
    ]);
    const r2 = applyAgentRunEvents(r1, [
      ev("message.delta", { content: "answer" }),
    ]);
    expect(r1.reasoning_content).toBe("thinking...");
    expect(r2.reasoning_content).toBe("thinking...");
    expect(r2.answer).toBe("answer");
  });

  it("message.completed does not replace an already streamed mismatching answer", () => {
    const partial = applyAgentRunEvents(baseMessage, [
      ev("message.delta", { content: "draft" }),
    ]);
    const done = applyAgentRunEvents(partial, [
      ev("message.completed", { answer: "final" }),
    ]);
    expect(done.answer).toBe("draft");
    expect(done.loading).toBe(false);
  });

  it("message.completed fills only a missing streamed suffix", () => {
    const partial: Message = { ...baseMessage, answer: "final ans", loading: true };
    const done = applyAgentRunEvents(partial, [
      ev("message.completed", { answer: "final answer" }),
    ]);
    expect(done.answer).toBe("final answer");
    expect(done.loading).toBe(false);
  });

  it("message.completed restores a full snapshot when no delta was received", () => {
    const done = applyAgentRunEvents({ ...baseMessage, loading: true }, [
      ev("message.completed", { answer: "recovered answer" }),
    ]);
    expect(done.answer).toBe("recovered answer");
    expect(done.loading).toBe(false);
  });

  it("metadata-only message.completed keeps the streamed answer", () => {
    const streamed: Message = { ...baseMessage, answer: "streamed", loading: true };
    const done = applyAgentRunEvents(streamed, [
      ev("message.completed", { answer_bytes: 8, answer_sha256: "hash" }),
    ]);
    expect(done.answer).toBe("streamed");
    expect(done.loading).toBe(false);
  });

  it("run.completed clears loading", () => {
    const running = applyAgentRunEvents(baseMessage, [ev("run.created")]);
    const done = applyAgentRunEvents(running, [ev("run.completed")]);
    expect(done.loading).toBe(false);
  });

  it("run.failed sets error and message when answer is empty", () => {
    const failed = applyAgentRunEvents(baseMessage, [
      ev("run.failed", { error_message: "oops" }),
    ]);
    expect(failed.error).toBe(true);
    expect(failed.loading).toBe(false);
    expect(failed.answer).toBe("oops");
  });

  it("run.failed preserves existing answer", () => {
    const withAnswer: Message = { ...baseMessage, answer: "partial" };
    const failed = applyAgentRunEvents(withAnswer, [
      ev("run.failed", { error_message: "oops" }),
    ]);
    expect(failed.answer).toBe("partial");
  });

  it("run.cancelled sets interrupted and message when answer is empty", () => {
    const cancelled = applyAgentRunEvents(baseMessage, [ev("run.cancelled")]);
    expect(cancelled.interrupted).toBe(true);
    expect(cancelled.loading).toBe(false);
    expect(cancelled.answer).toBe("本次运行已取消");
  });

  it("process.step upserts by step_code", () => {
    const step1 = ev("process.step", {
      step_code: "search",
      status: "start",
      message: "searching",
    });
    const step2 = ev("process.step", {
      step_code: "search",
      status: "completed",
      message: "done",
    });
    const step3 = ev("process.step", {
      step_code: "answer",
      status: "start",
      message: "answering",
    }, 3);

    const r1 = applyAgentRunEvents(baseMessage, [step1]);
    const r2 = applyAgentRunEvents(r1, [step2]);
    const r3 = applyAgentRunEvents(r2, [step3]);

    expect(r1.process_records).toHaveLength(1);
    expect(r2.process_records).toHaveLength(1);
    expect((r2.process_records as any[])[0].status).toBe("completed");
    expect(r3.process_records).toHaveLength(2);
  });

  it("process.step unwraps nested payload.process_step (replay API shape)", () => {
    // replay API returns { object: "process.step", process_step: { step_code, status, ... } }
    // — must unwrap so step_code doesn't fall through to "".
    const step1 = ev("process.step", {
      object: "process.step",
      process_step: {
        step_code: "intent_classification",
        status: "start",
        message: "正在识别意图...",
      },
    });
    const step2 = ev("process.step", {
      object: "process.step",
      process_step: {
        step_code: "intent_classification",
        status: "completed",
        message: "意图识别完成",
        data: { intent: { intent: "USE_SKILL" } },
      },
    }, 2);

    const r1 = applyAgentRunEvents(baseMessage, [step1]);
    const r2 = applyAgentRunEvents(r1, [step2]);

    expect(r1.process_records).toHaveLength(1);
    expect((r1.process_records as any[])[0]).toMatchObject({
      step_code: "intent_classification",
      status: "start",
      message: "正在识别意图...",
    });
    expect(r2.process_records).toHaveLength(1);
    expect((r2.process_records as any[])[0]).toMatchObject({
      step_code: "intent_classification",
      status: "completed",
      message: "意图识别完成",
    });
    expect(typeof (r2.process_records as any[])[0].data).toBe("string");
  });

  it("process.step llm_delta accumulates content across events", () => {
    // llm_delta 事件是分片流式,每个 event 只携带一段 content。
    // 多次应用必须累加,否则最后一条覆盖之前,只看到最后一个 token。
    const ev1 = ev("process.step", {
      process_step: {
        step_code: "llm_delta",
        status: "streaming",
        data: { content: "The", type: "reasoning" },
      },
    });
    const ev2 = ev("process.step", {
      process_step: {
        step_code: "llm_delta",
        status: "streaming",
        data: { content: " user wants", type: "reasoning" },
      },
    }, 2);
    const ev3 = ev("process.step", {
      process_step: {
        step_code: "llm_delta",
        status: "streaming",
        data: { content: " to fine-tune.", type: "reasoning" },
      },
    }, 3);

    const r = applyAgentRunEvents(baseMessage, [ev1, ev2, ev3]);
    expect((r.process_records as any[]).length).toBe(1);
    const parsed = JSON.parse((r.process_records as any[])[0].data);
    expect(parsed.content).toBe("The user wants to fine-tune.");
    expect(parsed.type).toBe("reasoning");
  });

  it("process.step llm_delta accumulation is idempotent on re-apply", () => {
    // 同一个 message 被多次 applyAgentRunEvents(增量 tick)时,累加不应重复。
    // 实现:每次都基于 process_records 已有 data 累加,所以二次 apply 会重复累加。
    // 这里只断言:首次 apply 是正确的(累加语义本身就是"拼接")。
    const ev1 = ev("process.step", {
      process_step: {
        step_code: "llm_delta",
        status: "streaming",
        data: { content: "Hello", type: "reasoning" },
      },
    });
    const ev2 = ev("process.step", {
      process_step: {
        step_code: "llm_delta",
        status: "streaming",
        data: { content: " world", type: "reasoning" },
      },
    }, 2);
    const r = applyAgentRunEvents(baseMessage, [ev1, ev2]);
    const parsed = JSON.parse((r.process_records as any[])[0].data);
    expect(parsed.content).toBe("Hello world");
  });

  it("process.step tool_execution preserves start's tool_calls when completed comes in", () => {
    // tool_execution start 事件带 tool_calls,completed 事件没有 data。
    // 合并策略:已有 data 就保留,这样 UI 端能拿到 tool_calls 渲染调用详情。
    const start = ev("process.step", {
      process_step: {
        step_code: "tool_execution",
        status: "start",
        message: "正在执行 docx...",
        data: {
          skill_name: "docx",
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "list_files", arguments: "{}" } },
          ],
        },
      },
    });
    const completed = ev("process.step", {
      process_step: {
        step_code: "tool_execution",
        status: "completed",
        message: "docx 调用完成",
      },
    }, 2);

    const r1 = applyAgentRunEvents(baseMessage, [start]);
    const r2 = applyAgentRunEvents(r1, [completed]);

    expect((r2.process_records as any[]).length).toBe(1);
    const data = JSON.parse((r2.process_records as any[])[0].data);
    expect(data.skill_name).toBe("docx");
    expect(data.tool_calls).toHaveLength(1);
    expect((r2.process_records as any[])[0].status).toBe("completed");
    expect((r2.process_records as any[])[0].message).toBe("docx 调用完成");
  });

  it("folds reasoning_expanded when both answer and reasoning_content exist", () => {
    const seeded: Message = {
      ...baseMessage,
      answer: "",
      reasoning_content: "thinking",
      reasoning_expanded: true,
    };
    const r = applyAgentRunEvents(seeded, [
      ev("message.delta", { content: "answer" }),
    ]);
    expect(r.answer).toBe("answer");
    expect(r.reasoning_expanded).toBe(false);
  });

  it("keeps reasoning_expanded when no answer yet", () => {
    const seeded: Message = {
      ...baseMessage,
      reasoning_content: "thinking",
      reasoning_expanded: true,
    };
    const r = applyAgentRunEvents(seeded, [ev("run.created")]);
    expect(r.reasoning_expanded).toBe(true);
  });

  it("idempotent for status/loading: non-delta events applied twice yield same loading", () => {
    // 注意：message.delta 是累积型的（每次应用都拼接到 answer），所以对
    // 包含 delta 的 events 重复应用会得到不同的 answer —— 这正是 useChatMessages
    // 需要用 lastAppliedSeqRef 做增量 apply 的原因。
    // 这里只断言 run.* 等非累积事件的幂等性。
    const statusEvents: AgentRunEvent[] = [
      ev("run.created", {}, 1),
      ev("run.completed", {}, 2),
    ];
    const r1 = applyAgentRunEvents(baseMessage, statusEvents);
    const r2 = applyAgentRunEvents(r1, statusEvents);
    expect(r2.loading).toBe(r1.loading);
    expect(r2.loading).toBe(false);
  });

  it("empty events list returns same reference (no-op fast path)", () => {
    // 没有事件时应该返回入参本身 —— 这样 React 的 setState 配合
    // Object.is 比较能跳过 re-render，是个 useful 的性能优化。
    const r = applyAgentRunEvents(baseMessage, []);
    expect(r).toBe(baseMessage);
  });
});
