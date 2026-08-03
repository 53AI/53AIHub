import { describe, expect, it } from "vitest";
import { mergeOpenClawMessages } from "./useChatMessages";
import type { Message } from "../types";

const CONVERSATION_ID = "agent:main:main";

function makeOpenClawMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "agent:main:main:assistant:2",
    conversation_id: CONVERSATION_ID,
    role: "assistant",
    question: "帮我看下今天的销售数据",
    answer: "已查询，今天销售额 12,345 元。",
    _openclawTurnStartSeq: 1,
    openclawTurn: {
      turnKey: "agent:main:main:agent:main:main:assistant:2:1",
      sessionId: CONVERSATION_ID,
      status: "completed",
      maxSeq: 2,
      events: [],
    },
    openclawProjection: {
      timelineItems: [],
      visibleAnswer: "已查询，今天销售额 12,345 元。",
      outputFiles: [],
      activities: [],
      isStreaming: false,
    },
    ...overrides,
  } as Message;
}

describe("mergeOpenClawMessages — fresh=true append semantics", () => {
  it("preserves both messages when same seq but different ids and no optimistic/runtime identity on either side", () => {
    // 旧实现里有 seq 兜底：当 stableKey / logicalKey 都失败时，会按 seq 配对，
    // 导致 fresh=true 拉到的 "nihao" (seq=1) 把历史里同样 seq=1 的 row 吞掉。
    // 新行为：fresh=true 是追加，不是替换。stableKey / logicalKey 两层都不匹配时
    // （尤其是双方都缺 optimistic/runtime identity、logicalKey 不该被合并），两条独立保留。
    // Mirror-source: stale snapshot, different id format
    const mirrorMessage = makeOpenClawMessage({
      id: "turn:agent:main:main:legacy:1:assistant",
      _openclawTurnStartSeq: 1,
      openclawTurn: {
        turnKey: "agent:main:main:turn:agent:main:main:legacy:1:assistant:1",
        sessionId: CONVERSATION_ID,
        status: "completed",
        maxSeq: 2,
        events: [],
      },
    } as Partial<Message>);

    // Openclaw-source: fresh revalidation, same logical turn but completed (no optimistic)
    const openclawMessage = makeOpenClawMessage();

    const result = mergeOpenClawMessages([mirrorMessage], [openclawMessage]);

    // 两条独立保留：mirror 的 stale 快照不会因为 fresh 来了就被吞
    expect(result).toHaveLength(2);
    expect(result.map((m) => String(m.id))).toEqual([
      "turn:agent:main:main:legacy:1:assistant",
      "agent:main:main:assistant:2",
    ]);
  });

  it("preserves both messages when their seqs differ", () => {
    const turn1 = makeOpenClawMessage({
      id: "agent:main:main:assistant:1",
      _openclawTurnStartSeq: 1,
    } as Partial<Message>);
    const turn2 = makeOpenClawMessage({
      id: "agent:main:main:assistant:2",
      _openclawTurnStartSeq: 2,
    } as Partial<Message>);

    const result = mergeOpenClawMessages([turn1], [turn2]);

    expect(result).toHaveLength(2);
    expect(result.map((m) => String(m.id))).toEqual([
      "agent:main:main:assistant:1",
      "agent:main:main:assistant:2",
    ]);
  });

  it("preserves current when incoming is empty", () => {
    const current = makeOpenClawMessage();

    const result = mergeOpenClawMessages([current], []);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(current);
  });

  it("appends incoming messages whose seq does not exist in current", () => {
    const currentTurn1 = makeOpenClawMessage({
      id: "agent:main:main:assistant:1",
      _openclawTurnStartSeq: 1,
    } as Partial<Message>);
    const incomingTurn2 = makeOpenClawMessage({
      id: "agent:main:main:assistant:2",
      _openclawTurnStartSeq: 2,
    } as Partial<Message>);

    const result = mergeOpenClawMessages([currentTurn1], [incomingTurn2]);

    expect(result).toHaveLength(2);
  });

  it("keeps a single entry when current and incoming reference the same message", () => {
    const turn1 = makeOpenClawMessage({
      id: "agent:main:main:assistant:1",
      _openclawTurnStartSeq: 1,
    } as Partial<Message>);

    const result = mergeOpenClawMessages([turn1], [turn1]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("agent:main:main:assistant:1");
  });

  it("handles missing _openclawTurnStartSeq gracefully (legacy messages)", () => {
    const legacyA = makeOpenClawMessage({
      id: "legacy-a",
    } as Partial<Message>);
    // remove the seq field from the spread
    delete (legacyA as any)._openclawTurnStartSeq;

    const legacyB = makeOpenClawMessage({
      id: "legacy-b",
    } as Partial<Message>);
    delete (legacyB as any)._openclawTurnStartSeq;

    const result = mergeOpenClawMessages([legacyA], [legacyB]);

    // Without seq, fall back to id-based preservation → both kept
    expect(result).toHaveLength(2);
  });
});