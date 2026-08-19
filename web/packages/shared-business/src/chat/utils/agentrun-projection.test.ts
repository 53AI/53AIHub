import { describe, expect, it } from "vitest";
import type { AgentRunReplayEvent, Message } from "../types";
import {
  applyAgentRunProjectionEvents,
  mergeAgentRunProjectionIntoMessage,
} from "./agentrun-projection";

const formatRagStats = () => undefined;

function event(seq: number, type: string, payload: Record<string, unknown> = {}): AgentRunReplayEvent {
  return { seq, type, payload };
}

describe("AgentRun incremental message projection", () => {
  it("applies only events after the projection cursor", () => {
    const firstEvents = [
      event(1, "message.delta", { choices: [{ delta: { content: "A" } }] }),
      event(2, "message.delta", { choices: [{ delta: { content: "B" } }] }),
    ];
    const first = applyAgentRunProjectionEvents(null, firstEvents, "message-1", formatRagStats);
    const second = applyAgentRunProjectionEvents(
      first,
      [...firstEvents, event(3, "message.delta", { choices: [{ delta: { content: "C" } }] })],
      "message-1",
      formatRagStats,
    );

    expect(first.message.answer).toBe("AB");
    expect(second.message.answer).toBe("ABC");
    expect(second.lastSeq).toBe(3);
  });

  it("keeps a direct SSE answer when the AgentRun projection is behind", () => {
    const current = { id: "message-1", role: "assistant", answer: "ABC", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [event(1, "message.delta", { choices: [{ delta: { content: "AB" } }] })],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message);
    expect(merged.answer).toBe("ABC");
  });

  it("does not let a still-running projection get ahead of the direct SSE writer", () => {
    const current = { id: "message-1", role: "assistant", answer: "AB", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [event(1, "message.delta", { choices: [{ delta: { content: "ABC" } }] })],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message);
    expect(merged.answer).toBe("AB");
  });

  it("does not start the answer from a live projection while direct SSE owns it", () => {
    const current = { id: "message-1", role: "assistant", answer: "", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [event(1, "message.delta", { choices: [{ delta: { content: "A" } }] })],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message);
    expect(merged.answer).toBeUndefined();
  });

  it("streams projection text when recovering without a direct SSE connection", () => {
    const current = { id: "message-1", role: "assistant", answer: "", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [event(1, "message.delta", { choices: [{ delta: { content: "A" } }] })],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message, {
      projectionOwnsLiveState: true,
    });
    expect(merged.answer).toBe("A");
  });

  it("allows a terminal projection to recover a missing direct SSE suffix", () => {
    const current = { id: "message-1", role: "assistant", answer: "AB", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [
        event(1, "message.delta", { choices: [{ delta: { content: "ABC" } }] }),
        event(2, "run.completed"),
      ],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message);
    expect(merged.answer).toBe("ABC");
    expect(merged.loading).toBe(false);
  });

  it("never replaces rendered content with a mismatching completed snapshot", () => {
    const current = { id: "message-1", role: "assistant", answer: "streamed answer", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [event(1, "message.completed", { answer: "different snapshot" })],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message);
    expect(merged.answer).toBe("streamed answer");
    expect(merged.loading).toBe(false);
  });

  it("metadata-only completion ends loading without clearing the answer", () => {
    const current = { id: "message-1", role: "assistant", answer: "streamed", loading: true } as Message;
    const projection = applyAgentRunProjectionEvents(
      null,
      [event(1, "message.completed", { answer_bytes: 8, answer_sha256: "hash" })],
      "message-1",
      formatRagStats,
    );

    const merged = mergeAgentRunProjectionIntoMessage(current, projection.message);
    expect(merged.answer).toBe("streamed");
    expect(merged.loading).toBe(false);
  });

  it("preserves every llm_delta fragment in the process projection", () => {
    const projection = applyAgentRunProjectionEvents(
      null,
      [
        event(1, "process.step", {
          object: "process.step",
          process_step: { step_code: "llm_delta", status: "streaming", data: { content: "think" } },
        }),
        event(2, "process.step", {
          object: "process.step",
          process_step: { step_code: "llm_delta", status: "streaming", data: { content: " again" } },
        }),
      ],
      "message-1",
      formatRagStats,
    );

    expect(projection.message.process_records).toHaveLength(2);
  });

  it("projects a completed llm_delta snapshot restored from durable history", () => {
    const projection = applyAgentRunProjectionEvents(
      null,
      [
        event(1, "process.step", {
          object: "process.step",
          process_step: {
            step_code: "llm_delta",
            status: "completed",
            data: { content: "persisted reasoning", type: "reasoning" },
          },
        }),
      ],
      "message-1",
      formatRagStats,
    );

    expect(projection.message.skillRunItems).toEqual([
      expect.objectContaining({
        type: "llm",
        title: "思考完成",
        content: "persisted reasoning",
        status: "completed",
      }),
    ]);
  });

  it("does not erase direct SSE reasoning when a terminal projection has more non-reasoning steps", () => {
    const directProcessRecords = [
      {
        step_code: "llm_delta",
        status: "streaming",
        message: "",
        data: JSON.stringify({ content: "I should inspect the workspace.", type: "reasoning" }),
      },
      {
        step_code: "tool_execution",
        status: "completed",
        message: "list_files completed",
        data: JSON.stringify({ skill_name: "list_files" }),
      },
    ];
    const current = {
      id: "message-1",
      role: "assistant",
      answer: "final answer",
      loading: true,
      process_records: directProcessRecords,
    } as Message;
    const projected = {
      id: "message-1",
      role: "assistant",
      answer: "final answer",
      loading: false,
      process_records: Array.from({ length: 6 }, (_, index) => ({
        step_code: "tool_result",
        status: "completed",
        message: `tool ${index} completed`,
        data: JSON.stringify({ tool_call_id: `call-${index}` }),
      })),
    } as Message;

    const merged = mergeAgentRunProjectionIntoMessage(current, projected);

    expect(merged.process_records).toBe(directProcessRecords);
    expect(merged.process_records?.some((record) => record.step_code === "llm_delta")).toBe(true);
    expect(merged.loading).toBe(false);
  });

  it("lets AgentRun own process state during reconnect recovery", () => {
    const current = {
      id: "message-1",
      role: "assistant",
      loading: true,
      process_records: [
        { step_code: "intent_classification", status: "completed", message: "old", data: "{}" },
      ],
    } as Message;
    const projectedRecords = [
      { step_code: "llm_delta", status: "streaming", message: "", data: "{\"content\":\"replayed\"}" },
      { step_code: "tool_result", status: "completed", message: "done", data: "{}" },
    ];
    const projected = {
      id: "message-1",
      role: "assistant",
      loading: true,
      process_records: projectedRecords,
    } as Message;

    const merged = mergeAgentRunProjectionIntoMessage(current, projected, {
      projectionOwnsLiveState: true,
    });

    expect(merged.process_records).toBe(projectedRecords);
  });
});
