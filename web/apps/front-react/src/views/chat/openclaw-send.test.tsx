import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  mergeOpenClawActiveMessageIntoList,
  mergeOpenClawTimelineEventsIntoMessage,
  processStreamDataItem,
  replaceOpenClawTurnWithTimelineEvents,
  useChatSend,
} from "@km/shared-business/chat";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function ledgerEvent(overrides: Record<string, any> = {}) {
  const sessionId = overrides.session_id || overrides.conversation_id || "agent:main:main";
  const turnId = overrides.turn_id || `${sessionId}:turn:test`;
  const seq = overrides.seq ?? 1;
  const partType = overrides.part_type || "answer";
  const eventType = overrides.event_type || (partType === "status" ? "turn.started" : "part.replace");
  return {
    protocol_version: "openclaw.ledger.v1",
    seq,
    session_id: sessionId,
    conversation_id: sessionId,
    turn_id: turnId,
    active_request_id: overrides.active_request_id || `${turnId}:request`,
    part_id: overrides.part_id || `${turnId}:${partType}:0`,
    part_type: partType,
    event_type: eventType,
    operation: overrides.operation || (eventType.startsWith("turn.") ? "close" : "replace"),
    visibility: overrides.visibility || (partType === "status" ? "hidden" : "final"),
    text: overrides.text || "",
    payload: overrides.payload || {},
    created_at: overrides.created_at || "2026-06-11T12:00:00.000Z",
    raw_event_ref: overrides.raw_event_ref || `${sessionId}:ledger:${seq}`,
    ...(overrides.terminal_status ? { terminal_status: overrides.terminal_status } : {}),
    ...overrides,
  };
}

describe("OpenClaw send flow", () => {
  it("binds live Codex ledger UUIDs to the active optimistic message", () => {
    const sessionId = "agenthub_u1";
    const turnId = "codex-turn-1";
    const message = {
      id: "optimistic-message",
      _openclawClientMessageId: "client-message-1",
      _openclawActiveRequestId: "client-message-1",
      _openclawTurnStartSeq: 0,
      question: "只回复 ok",
      answer: "",
      loading: true,
      conversation_id: sessionId,
    } as any;
    const formatRagStats = vi.fn();

    processStreamDataItem(
      {
        kind: "run.started",
        session_id: sessionId,
        payload: {
          openclaw_ledger: ledgerEvent({
            seq: 1,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            run_id: turnId,
            active_request_id: "runtime-request-uuid",
            part_type: "status",
            event_type: "turn.started",
            operation: "noop",
            visibility: "hidden",
          }),
        },
      },
      message,
      formatRagStats,
      { openclaw: true, canonicalOnly: true }
    );
    processStreamDataItem(
      {
        kind: "assistant.delta",
        session_id: sessionId,
        choices: [{ delta: { content: "ok" } }],
        payload: {
          content: "ok",
          openclaw_ledger: ledgerEvent({
            seq: 2,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            run_id: turnId,
            active_request_id: "runtime-request-uuid",
            part_type: "answer",
            event_type: "part.delta",
            operation: "append",
            visibility: "stream",
            text: "ok",
          }),
        },
      },
      message,
      formatRagStats,
      { openclaw: true, canonicalOnly: true }
    );
    processStreamDataItem(
      {
        kind: "run.completed",
        session_id: sessionId,
        payload: {
          openclaw_ledger: ledgerEvent({
            seq: 3,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            run_id: turnId,
            active_request_id: "runtime-request-uuid",
            part_type: "status",
            event_type: "turn.completed",
            operation: "close",
            visibility: "hidden",
            terminal_status: "completed",
          }),
        },
      },
      message,
      formatRagStats,
      { openclaw: true, canonicalOnly: true }
    );

    expect(message._openclawActiveRequestId).toBe("runtime-request-uuid");
    expect(message.answer).toBe("ok");
    expect(message.loading).toBe(false);
    expect(message.openclawTurn?.status).toBe("completed");

    const snapshotEvents = [
      {
        id: "snapshot-started",
        sessionId,
        seq: 1,
        kind: "run.started",
        payload: {
          openclaw_ledger: ledgerEvent({
            seq: 1,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            run_id: turnId,
            active_request_id: "runtime-request-uuid",
            part_type: "status",
            event_type: "turn.started",
            operation: "noop",
            visibility: "hidden",
          }),
        },
        createdAt: "2026-06-11T12:00:00.000Z",
      },
      {
        id: "snapshot-answer",
        sessionId,
        seq: 2,
        kind: "assistant.delta",
        payload: {
          content: "ok",
          openclaw_ledger: ledgerEvent({
            seq: 2,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            run_id: turnId,
            active_request_id: "runtime-request-uuid",
            part_type: "answer",
            event_type: "part.delta",
            operation: "append",
            visibility: "stream",
            text: "ok",
          }),
        },
        createdAt: "2026-06-11T12:00:01.000Z",
      },
      {
        id: "snapshot-completed",
        sessionId,
        seq: 3,
        kind: "run.completed",
        payload: {
          openclaw_ledger: ledgerEvent({
            seq: 3,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            run_id: turnId,
            active_request_id: "runtime-request-uuid",
            part_type: "status",
            event_type: "turn.completed",
            operation: "close",
            visibility: "hidden",
            terminal_status: "completed",
          }),
        },
        createdAt: "2026-06-11T12:00:02.000Z",
      },
    ];

    mergeOpenClawTimelineEventsIntoMessage(message, { events: snapshotEvents }, { canonicalOnly: true });
    expect(message.answer).toBe("ok");
    expect(message.openclawTimelineItems?.filter((item: any) => item.type === "answer")).toHaveLength(1);

    replaceOpenClawTurnWithTimelineEvents(message, { events: snapshotEvents }, { canonicalOnly: true });
    expect(message.answer).toBe("ok");
    expect(message.openclawTimelineItems?.filter((item: any) => item.type === "answer")).toHaveLength(1);
  });

  it("keeps non-ledger Codex reasoning deltas visible during canonical streaming", () => {
    const message = {
      id: "optimistic-thinking-message",
      _openclawClientMessageId: "client-thinking-1",
      _openclawActiveRequestId: "client-thinking-1",
      question: "解释一下",
      answer: "",
      loading: true,
      conversation_id: "agenthub_u1",
    } as any;

    processStreamDataItem(
      {
        event_kind: "assistant.thinking",
        status: "thinking",
        session_id: "agenthub_u1",
        payload: {
          content: "正在分析问题",
        },
        choices: [{ delta: { reasoning_content: "正在分析问题" } }],
      },
      message,
      vi.fn(),
      { openclaw: true, canonicalOnly: true }
    );

    expect(message.reasoning_content).toContain("正在分析问题");
    expect(message.loading).toBe(true);

    processStreamDataItem(
      {
        kind: "run.started",
        session_id: "agenthub_u1",
        payload: {
          openclaw_ledger: ledgerEvent({
            seq: 1,
            session_id: "agenthub_u1",
            conversation_id: "agenthub_u1",
            turn_id: "codex-thinking-turn",
            run_id: "codex-thinking-turn",
            active_request_id: "runtime-thinking-request",
            part_type: "status",
            event_type: "turn.started",
            operation: "noop",
            visibility: "hidden",
          }),
        },
      },
      message,
      vi.fn(),
      { openclaw: true, canonicalOnly: true }
    );

    expect(message.openclawActivities?.some((item: any) => item.kind === "assistant.thinking")).toBe(true);
    expect(message.loading).toBe(true);
  });

  it("logs OpenClaw stream projection summaries without raw thinking text when debug is enabled", () => {
    const previousUrl = window.location.href;
    window.history.replaceState(null, "", "/chat?openclaw_debug=1");
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const message = {
        id: "debug-message",
        _openclawClientMessageId: "client-debug",
        _openclawActiveRequestId: "client-debug",
        question: "debug",
        answer: "",
        loading: true,
        conversation_id: "agenthub_u1",
      } as any;

      processStreamDataItem(
        {
          event_kind: "assistant.thinking",
          status: "thinking",
          session_id: "agenthub_u1",
          payload: {
            content: "secret thinking text",
          },
          choices: [{ delta: { reasoning_content: "secret thinking text" } }],
        },
        message,
        vi.fn(),
        { openclaw: true, canonicalOnly: true }
      );

      const logs = infoSpy.mock.calls.map((call) => String(call[0]));
      expect(logs.some((line) => line.includes("[openclaw-ui:stream.chunk.in]"))).toBe(true);
      expect(logs.some((line) => line.includes("[openclaw-ui:stream.chunk.projected]"))).toBe(true);
      expect(logs.join("\n")).toContain('"reasoning_length":20');
      expect(logs.join("\n")).not.toContain("secret thinking text");
    } finally {
      window.history.replaceState(null, "", previousUrl);
    }
  });

  it("keeps regenerated OpenClaw turns separate when the question text is the same", () => {
    const next = mergeOpenClawActiveMessageIntoList(
      [
        {
          id: "old-message",
          _openclawClientMessageId: "old-client-message",
          question: "测试",
          answer: "旧回答",
          conversation_id: "agent:main:main",
        } as any,
      ],
      {
        id: "new-message",
        _openclawClientMessageId: "new-client-message",
        question: "测试",
        answer: "新回答",
        loading: false,
        conversation_id: "agent:main:main",
      } as any,
      "agent:main:main"
    );

    expect(next).toHaveLength(2);
    expect(next.map((item: any) => item.id)).toEqual(["old-message", "new-message"]);
  });

  it("does not merge an identity-less loading snapshot into an older answer with the same question", () => {
    const next = mergeOpenClawActiveMessageIntoList(
      [
        {
          id: "old-test",
          question: "测试",
          answer: "✅ 收到！",
          loading: false,
          conversation_id: "agent:main:dashboard:test",
        } as any,
      ],
      {
        question: "测试",
        answer: "",
        loading: true,
        conversation_id: "agent:main:dashboard:test",
      } as any,
      "agent:main:dashboard:test"
    );

    expect(next).toHaveLength(2);
    expect(next[0].answer).toBe("✅ 收到！");
    expect(next[1].loading).toBe(true);
  });

  it("merges a running active OpenClaw snapshot into the persisted user row after switching back", () => {
    const next = mergeOpenClawActiveMessageIntoList(
      [
        {
          id: "persisted-user-row",
          question: "切换回来后继续生成",
          answer: "",
          loading: false,
          conversation_id: "agent:main:dashboard:test",
          openclawTurn: {
            turnKey: "agent:main:dashboard:test:history:persisted-user-row",
            sessionId: "agent:main:dashboard:test",
            status: "completed",
            maxSeq: 0,
            events: [],
          },
        } as any,
      ],
      {
        id: "optimistic-running-row",
        _openclawClientMessageId: "client-running-row",
        _openclawTurnStartSeq: 200,
        question: "切换回来后继续生成",
        answer: "",
        loading: true,
        conversation_id: "agent:main:dashboard:test",
        openclawTurn: {
          turnKey: "agent:main:dashboard:test:turn:client-running-row",
          sessionId: "agent:main:dashboard:test",
          status: "streaming",
          maxSeq: 205,
          events: [],
        },
      } as any,
      "agent:main:dashboard:test"
    );

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("persisted-user-row");
    expect(next[0]._openclawClientMessageId).toBe("client-running-row");
    expect(next[0].loading).toBe(true);
  });

  it("binds canonical ledger events to an unhydrated persisted user row after refresh", () => {
    const sessionId = "agent:main:dashboard:test";
    const turnId = `${sessionId}:turn:refresh-running`;
    const message = {
      id: "persisted-refresh-row",
      question: "刷新后继续生成",
      answer: "",
      loading: false,
      conversation_id: sessionId,
      openclawTurn: {
        turnKey: `${sessionId}:history:persisted-refresh-row`,
        sessionId,
        status: "completed",
        maxSeq: 0,
        events: [],
      },
    } as any;

    const changed = mergeOpenClawTimelineEventsIntoMessage(
      message,
      {
        events: [
          {
            id: `${sessionId}:ledger:205`,
            sessionId,
            seq: 205,
            kind: "assistant.message.delta",
            payload: {
              content: "正在继续生成",
              openclaw_ledger: ledgerEvent({
                seq: 205,
                session_id: sessionId,
                conversation_id: sessionId,
                turn_id: turnId,
                active_request_id: "request-refresh-running",
                part_id: `${turnId}:answer:0`,
                part_type: "answer",
                event_type: "part.delta",
                operation: "append",
                visibility: "stream",
                terminal_status: "running",
                text: "正在继续生成",
              }),
            },
          },
        ],
      },
      { canonicalOnly: true }
    );

    expect(changed).toBe(true);
    expect(message.loading).toBe(true);
    expect(message._openclawClientMessageId).toBe("request-refresh-running");
    expect(message.openclawTurn?.turnKey).toBe(turnId);
    expect(message.openclawTurn?.status).toBe("streaming");
  });

  it("preserves realtime thinking and tool events when final OpenClaw replacement only carries the answer", () => {
    const sessionId = "agent:main:dashboard:test";
    const runId = "run-53ai-products";
    const message = {
      id: "active-products",
      _openclawClientMessageId: "client-products",
      _openclawTurnStartSeq: 3110,
      question: "介绍一下53AI的产品",
      answer: "",
      loading: true,
      conversation_id: sessionId,
    } as any;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-products",
          sessionId,
          seq: 3116,
          kind: "assistant.thinking",
          payload: {
            content: "The user is asking me to introduce 53AI's products.",
            runId,
          },
          createdAt: "2026-06-10T10:00:00.000Z",
        },
        {
          id: "tool-call-products",
          sessionId,
          seq: 3120,
          kind: "tool.call",
          payload: {
            runId,
            data: {
              name: "read",
              input: "~/Library/Application Support/QClaw/openclaw/config/skills/online-search/SKILL.md",
            },
          },
          createdAt: "2026-06-10T10:00:01.000Z",
        },
        {
          id: "tool-result-products",
          sessionId,
          seq: 3121,
          kind: "tool.result",
          payload: {
            runId,
            data: {
              name: "read",
              result: {
                output: "online-search skill content",
              },
            },
          },
          createdAt: "2026-06-10T10:00:02.000Z",
        },
      ],
    });

    replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "answer-products",
          sessionId,
          seq: 3180,
          kind: "assistant.message",
          payload: {
            content: "53AI 提供智能体、知识库和 AI 工具等产品能力。",
            runId,
          },
          createdAt: "2026-06-10T10:00:10.000Z",
        },
        {
          id: "completed-products",
          sessionId,
          seq: 3181,
          kind: "run.completed",
          payload: { runId },
          createdAt: "2026-06-10T10:00:11.000Z",
        },
      ],
    });

    expect(message.answer).toContain("53AI 提供智能体");
    expect(message.openclawActivities.some((item: any) => item.kind === "assistant.thinking")).toBe(true);
    expect(message.openclawActivities.some((item: any) => item.kind === "tool.call")).toBe(true);
    expect(message.openclawActivities.some((item: any) => item.kind === "tool.result")).toBe(true);
    expect(message.openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "answer",
    ]);
  });

  it("does not merge recovery events from an older ledger turn into the current OpenClaw message", () => {
    const sessionId = "agent:main:dashboard:test";
    const message = {
      id: "current-ledger-message",
      question: "new prompt",
      answer: "",
      loading: true,
      conversation_id: sessionId,
    } as any;

    const newTurnId = `${sessionId}:turn:new`;
    const oldTurnId = `${sessionId}:turn:old`;
    const ledger = (turnId: string, seq: number, text: string) => ({
      protocol_version: "openclaw.ledger.v1",
      seq,
      session_id: sessionId,
      conversation_id: sessionId,
      turn_id: turnId,
      active_request_id: `${turnId}:request`,
      part_id: `${turnId}:answer:0`,
      part_type: "answer",
      event_type: "part.replace",
      operation: "replace",
      visibility: "final",
      text,
      created_at: "2026-06-11T12:00:00.000Z",
      raw_event_ref: `${sessionId}:message:${seq}`,
    });

    const firstChanged = mergeOpenClawTimelineEventsIntoMessage(message, {
      recent_events: [ledger(newTurnId, 159, "new final answer")],
    });
    const secondChanged = mergeOpenClawTimelineEventsIntoMessage(message, {
      recent_events: [ledger(oldTurnId, 93, "old final answer")],
    });

    expect(firstChanged).toBe(true);
    expect(secondChanged).toBe(false);
    expect(message.answer).toBe("new final answer");
    expect(message.openclawTimelineItems?.map((item: any) => item.content || "")).not.toContain("old final answer");
  });

  it("rejects raw timeline history in canonical-only OpenClaw recovery", () => {
    const sessionId = "agent:main:dashboard:test";
    const message = {
      id: "current-canonical-message",
      _openclawClientMessageId: "client-current",
      question: "current prompt",
      answer: "",
      loading: true,
      conversation_id: sessionId,
    } as any;

    const rawChanged = mergeOpenClawTimelineEventsIntoMessage(
      message,
      {
        events: [
          {
            id: "old-thinking",
            sessionId,
            seq: 90,
            kind: "assistant.thinking",
            payload: { content: "old turn thinking" },
            createdAt: "2026-06-11T12:00:00.000Z",
          },
          {
            id: "old-answer",
            sessionId,
            seq: 91,
            kind: "assistant.message",
            payload: { content: "old turn answer" },
            createdAt: "2026-06-11T12:00:01.000Z",
          },
        ],
      },
      { canonicalOnly: true }
    );
    const ledgerChanged = mergeOpenClawTimelineEventsIntoMessage(
      message,
      {
        ledger_events: [
          ledgerEvent({
            seq: 120,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: `${sessionId}:turn:client-current`,
            active_request_id: "client-current",
            part_id: `${sessionId}:turn:client-current:answer:0`,
            text: "current canonical answer",
          }),
        ],
      },
      { canonicalOnly: true }
    );

    expect(rawChanged).toBe(false);
    expect(ledgerChanged).toBe(true);
    expect(message.answer).toBe("current canonical answer");
    expect(message.openclawActivities || []).toHaveLength(0);
    expect(message.openclawTimelineItems?.map((item: any) => item.content || "")).not.toContain("old turn answer");
  });

  it("merges a completed active OpenClaw snapshot back into the hydrated row for the same turn", () => {
    const next = mergeOpenClawActiveMessageIntoList(
      [
        {
          id: "history-weather",
          question: "今天天气如何",
          answer: "我来查询今天的天气情况。",
          loading: false,
          conversation_id: "agent:main:dashboard:test",
          openclawTurn: {
            turnKey: "agent:main:dashboard:test:history-weather:120",
            sessionId: "agent:main:dashboard:test",
            status: "completed",
            maxSeq: 128,
            events: [
              {
                eventId: "answer-intro",
                sessionId: "agent:main:dashboard:test",
                seq: 128,
                kind: "assistant.message",
                payload: { content: "我来查询今天的天气情况。" },
                source: "events",
              },
            ],
          },
          openclawTimelineItems: [
            {
              key: "history-answer-intro",
              type: "answer",
              seq: 128,
              sessionId: "agent:main:dashboard:test",
              content: "我来查询今天的天气情况。",
            },
          ],
        } as any,
      ],
      {
        id: "active-weather",
        _openclawClientMessageId: "client-weather",
        _openclawTurnStartSeq: 120,
        question: "今天天气如何",
        answer: "上海今天晴，气温约 31°C，全天无雨，建议注意防晒和补水。",
        loading: false,
        conversation_id: "agent:main:dashboard:test",
        openclawTurn: {
          turnKey: "agent:main:dashboard:test:client-weather:120",
          sessionId: "agent:main:dashboard:test",
          status: "completed",
          maxSeq: 135,
          events: [
            {
              eventId: "answer-final",
              sessionId: "agent:main:dashboard:test",
              seq: 135,
              kind: "assistant.message",
              payload: {
                content: "上海今天晴，气温约 31°C，全天无雨，建议注意防晒和补水。",
              },
              source: "events",
            },
          ],
        },
        openclawTimelineItems: [
          {
            key: "active-thinking",
            type: "thinking",
            seq: 125,
            sessionId: "agent:main:dashboard:test",
            content: "The user is asking about weather.",
            title: "已完成深度思考",
          },
          {
            key: "active-answer-final",
            type: "answer",
            seq: 135,
            sessionId: "agent:main:dashboard:test",
            content: "上海今天晴，气温约 31°C，全天无雨，建议注意防晒和补水。",
          },
        ],
      } as any,
      "agent:main:dashboard:test"
    );

    expect(next).toHaveLength(1);
    expect(next[0].id).toBe("history-weather");
    expect(next[0]._openclawClientMessageId).toBe("client-weather");
    expect(next[0].answer).toContain("上海今天晴");
    expect(next[0].openclawTimelineItems.filter((item: any) => item.type === "answer")).toHaveLength(1);
    expect(next[0].openclawTimelineItems.at(-1).content).toContain("建议注意防晒和补水");
  });

  it("does not merge a new OpenClaw turn into an older hydrated row with the same question", () => {
    const next = mergeOpenClawActiveMessageIntoList(
      [
        {
          id: "old-history-weather",
          question: "今天天气如何",
          answer: "旧天气回答",
          loading: false,
          conversation_id: "agent:main:dashboard:test",
          openclawTurn: {
            turnKey: "agent:main:dashboard:test:old-history-weather:80",
            sessionId: "agent:main:dashboard:test",
            status: "completed",
            maxSeq: 100,
            events: [
              {
                eventId: "old-answer",
                sessionId: "agent:main:dashboard:test",
                seq: 100,
                kind: "assistant.message",
                payload: { content: "旧天气回答" },
                source: "history",
              },
            ],
          },
          openclawTimelineItems: [
            {
              key: "old-answer",
              type: "answer",
              seq: 100,
              sessionId: "agent:main:dashboard:test",
              content: "旧天气回答",
            },
          ],
        } as any,
      ],
      {
        id: "new-active-weather",
        _openclawClientMessageId: "new-client-weather",
        _openclawTurnStartSeq: 120,
        question: "今天天气如何",
        answer: "新天气回答",
        loading: false,
        conversation_id: "agent:main:dashboard:test",
        openclawTimelineItems: [
          {
            key: "new-answer",
            type: "answer",
            seq: 130,
            sessionId: "agent:main:dashboard:test",
            content: "新天气回答",
          },
        ],
      } as any,
      "agent:main:dashboard:test"
    );

    expect(next).toHaveLength(2);
    expect(next.map((item: any) => item.id)).toEqual(["old-history-weather", "new-active-weather"]);
  });

  it("sends completions when a message list baseline is provided", async () => {
    const completions = vi.fn().mockResolvedValue(undefined);
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({ data: { events: [] } }),
      completions,
    };
    let renderedMessages: any[] = [
      {
        id: "previous",
        question: "上一条",
        answer: "上一条回复",
        process_records: [{ key: "thinking-7", seq: 7 }],
      },
    ];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    await act(async () => {
      await result.current.sendMessage({
        question: "测试",
        agent_id: "2",
        conversation_id: "",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        openclawConversationTitle: "53AI Hub-Y65NG：测试",
        type: "agent",
        onMessageListChange,
      });
    });

    expect(completions).toHaveBeenCalledTimes(1);
    expect(completions.mock.calls[0][0]).toMatchObject({
      conversation_id: "",
      model: "agent-2",
      metadata: {
        openclaw_conversation_title: "53AI Hub-Y65NG：测试",
        openclaw_client_message_id: expect.any(String),
      },
      stream: true,
    });
    expect(renderedMessages.at(-1)).toMatchObject({
      question: "测试",
      loading: false,
      conversation_id: "",
    });
  });

  it("filters stale OpenClaw timeline events from the current send turn", async () => {
    const clientMessageId = "1718100000000";
    vi.spyOn(Date, "now").mockReturnValue(Number(clientMessageId));
    const completions = vi.fn().mockResolvedValue(undefined);
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({
        data: {
          ledger_events: [
            ledgerEvent({
              seq: 7,
              turn_id: "agent:main:main:turn:old",
              part_id: "agent:main:main:turn:old:thinking:0",
              part_type: "thinking",
              event_type: "part.replace",
              operation: "replace",
              visibility: "stream",
              text: "旧回复的思考过程",
              active_request_id: "old-client-message",
              payload: { source_kind: "assistant.thinking" },
            }),
            ledgerEvent({
              seq: 12,
              turn_id: "agent:main:main:turn:new",
              part_id: "agent:main:main:turn:new:thinking:0",
              part_type: "thinking",
              event_type: "part.replace",
              operation: "replace",
              visibility: "stream",
              text: "本轮回复的思考过程",
              active_request_id: clientMessageId,
              payload: { source_kind: "assistant.thinking" },
            }),
          ],
        },
      }),
      completions,
    };
    let renderedMessages: any[] = [
      {
        id: "other-conversation",
        question: "另一个会话",
        answer: "另一个回复",
        conversation_id: "agent:main:other",
        openclawActivities: [{ key: "thinking-80", seq: 80, kind: "assistant.thinking" }],
      },
      {
        id: "previous",
        question: "上一条",
        answer: "上一条回复",
        conversation_id: "agent:main:main",
        openclawActivities: [{ key: "thinking-10", seq: 10, kind: "assistant.thinking" }],
      },
    ];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    await act(async () => {
      await result.current.sendMessage({
        question: "测试",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    expect(conversationApi.events).toHaveBeenCalledWith("agent:main:main", {
      limit: 100,
      after_seq: 10,
    });
    const currentActivities = renderedMessages.at(-1)?.openclawActivities || [];
    expect(currentActivities.map((item: any) => item.summary)).toContain("本轮回复的思考过程");
    expect(currentActivities.map((item: any) => item.summary)).not.toContain("旧回复的思考过程");
  });

  it("does not bind older OpenClaw ledger turns to the latest sent message without identity match", async () => {
    const clientMessageId = "1718100000100";
    vi.spyOn(Date, "now").mockReturnValue(Number(clientMessageId));
    const completions = vi.fn().mockResolvedValue(undefined);
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({
        data: {
          ledger_events: [
            ledgerEvent({
              seq: 31,
              turn_id: "agent:main:main:turn:weather",
              part_id: "agent:main:main:turn:weather:thinking:0",
              part_type: "thinking",
              event_type: "part.replace",
              operation: "replace",
              visibility: "stream",
              text: "旧天气问题的思考过程",
              active_request_id: "weather-client-message",
              payload: { source_kind: "assistant.thinking" },
            }),
            ledgerEvent({
              seq: 32,
              turn_id: "agent:main:main:turn:test",
              part_id: "agent:main:main:turn:test:answer:0",
              part_type: "answer",
              event_type: "part.replace",
              operation: "replace",
              visibility: "final",
              text: "收到测试消息！我在这里，一切正常运行。",
              active_request_id: "test-client-message",
              payload: { source_kind: "assistant.message" },
            }),
          ],
        },
      }),
      completions,
    };
    let renderedMessages: any[] = [
      {
        id: "previous-test",
        question: "测试",
        answer: "收到测试消息！我在这里，一切正常运行。",
        conversation_id: "agent:main:main",
      },
    ];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    await act(async () => {
      await result.current.sendMessage({
        question: "从网上搜索十部国产电影并总结",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(completions.mock.calls[0][0]).toMatchObject({
      metadata: {
        openclaw_client_message_id: clientMessageId,
      },
    });
    const currentMessage = renderedMessages.at(-1);
    expect(currentMessage?.question).toBe("从网上搜索十部国产电影并总结");
    expect(currentMessage?.answer || "").not.toContain("收到测试消息");
    expect(currentMessage?.reasoning_content || "").not.toContain("旧天气问题");
    expect(currentMessage?.openclawActivities || []).toEqual([]);
  });

  it("ignores snapshot recovery-window events at or below after_seq while polling the current OpenClaw send", async () => {
    vi.useFakeTimers();
    let resolveCompletion: (() => void) | null = null;
    const completions = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveCompletion = resolve;
        })
    );
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({
        data: {
          events: [
            {
              id: "old-thinking",
              sessionId: "agent:main:main",
              seq: 10,
              kind: "assistant.thinking",
              payload: { content: "旧回复的恢复窗口思考" },
            },
          ],
        },
      }),
      completions,
    };
    let renderedMessages: any[] = [
      {
        id: "previous",
        question: "上一条",
        answer: "上一条回复",
        conversation_id: "agent:main:main",
        openclawActivities: [{ key: "thinking-10", seq: 10, kind: "assistant.thinking" }],
      },
    ];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));
    let sendPromise: Promise<void> | undefined;

    act(() => {
      sendPromise = result.current.sendMessage({
        question: "测试",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", {
      after_seq: 10,
    });
    const currentMessage = renderedMessages.at(-1);
    expect(currentMessage?.question).toBe("测试");
    expect(currentMessage?.loading).toBe(true);
    expect(currentMessage?.openclawActivities || []).toEqual([]);

    await act(async () => {
      resolveCompletion?.();
      await sendPromise;
      await Promise.resolve();
    });
    vi.clearAllTimers();
  });

  it("keeps OpenClaw loading until a terminal ledger event even when an answer snapshot exists", async () => {
    vi.useFakeTimers();
    const sessionId = "agent:main:main";
    const clientMessageId = "1718100000200";
    vi.setSystemTime(Number(clientMessageId));
    const turnId = `${sessionId}:turn:no-terminal`;
    const completions = vi.fn().mockResolvedValue(undefined);
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      snapshot: vi.fn().mockResolvedValue({
        data: {
          ledger_events: [
            ledgerEvent({
              seq: 12,
              session_id: sessionId,
              conversation_id: sessionId,
              turn_id: turnId,
              part_id: `${turnId}:answer:0`,
              part_type: "answer",
              event_type: "part.replace",
              operation: "replace",
              visibility: "final",
              text: "已有答案片段，但还没有 terminal event。",
              active_request_id: clientMessageId,
              payload: { source_kind: "assistant.message" },
            }),
          ],
        },
      }),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    await act(async () => {
      await result.current.sendMessage({
        question: "测试 terminal 派生 loading",
        agent_id: "2",
        conversation_id: sessionId,
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const currentMessage = renderedMessages.at(-1);
    expect(currentMessage?.answer).toBe("已有答案片段，但还没有 terminal event。");
    expect(currentMessage?.openclawProjection?.visibleAnswer).toBe("已有答案片段，但还没有 terminal event。");
    expect(currentMessage?.openclawTurn?.status).toBe("streaming");
    expect(currentMessage?.loading).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000);
      await Promise.resolve();
    });

    expect(renderedMessages.at(-1)?.loading).toBe(true);
    expect(renderedMessages.at(-1)?.openclawTurn?.status).toBe("streaming");
    vi.clearAllTimers();
  });

  it("merges same-run history output files into an existing live ledger message after refresh", () => {
    const sessionId = "agent:main:dashboard:test";
    const runId = "run-generated-file";
    const clientMessageId = "client-generated-file";
    const liveTurnId = `${sessionId}:turn:${clientMessageId}`;
    const historyTurnId = `${sessionId}:turn:history:${runId}`;
    const message = {
      id: "assistant-live-file",
      question: "生成一个包含10个字的任意测试文档，纯文本就行",
      answer: "",
      role: "assistant",
      conversation_id: sessionId,
      _openclawClientMessageId: clientMessageId,
      _openclawActiveRequestId: clientMessageId,
      openclawActivities: [],
      loading: false,
    } as any;

    const liveChanged = mergeOpenClawTimelineEventsIntoMessage(
      message,
      {
        ledger_events: [
          ledgerEvent({
            seq: 460,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: liveTurnId,
            run_id: runId,
            active_request_id: clientMessageId,
            part_id: `${liveTurnId}:answer:0`,
            text: "已生成测试文档。",
            payload: { source_kind: "assistant.message" },
          }),
          ledgerEvent({
            seq: 461,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: liveTurnId,
            run_id: runId,
            active_request_id: clientMessageId,
            part_id: `${liveTurnId}:status`,
            part_type: "status",
            event_type: "turn.completed",
            operation: "close",
            visibility: "final",
            terminal_status: "completed",
            text: "",
            payload: { source_kind: "run.completed" },
          }),
        ],
      },
      { canonicalOnly: true }
    );

    expect(liveChanged).toBe(true);
    expect(message.answer).toBe("已生成测试文档。");
    expect(message.outputFiles || []).toEqual([]);
    expect(message.openclawTurn?.events.map((event: any) => event.payload?.openclaw_ledger?.turn_id)).toContain(liveTurnId);

    const recoveryChanged = mergeOpenClawTimelineEventsIntoMessage(
      message,
      {
        recent_events: [
          ledgerEvent({
            seq: 461,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: historyTurnId,
            run_id: runId,
            active_request_id: `history:${runId}`,
            part_id: `${historyTurnId}:output_files:test_document.txt`,
            part_type: "output_file",
            event_type: "part.replace",
            operation: "replace",
            visibility: "final",
            text: "",
            payload: {
              source_kind: "process.step",
              process_step: {
                step_code: "output_files",
                status: "completed",
                message: "生成了 1 个文件",
                data: {
                  files: [
                    {
                      id: "file-generated",
                      file_name: "test_document.txt",
                      signed_download_url: "https://example.com/test_document.txt",
                      mime_type: "text/plain",
                    },
                  ],
                },
              },
            },
          }),
          ledgerEvent({
            seq: 470,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: historyTurnId,
            run_id: runId,
            active_request_id: `history:${runId}`,
            part_id: `${historyTurnId}:thinking:0`,
            part_type: "thinking",
            event_type: "part.replace",
            operation: "replace",
            visibility: "final",
            text: "确认文件已经生成，并准备展示下载入口。",
            payload: { source_kind: "assistant.thinking" },
          }),
          ledgerEvent({
            seq: 471,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: historyTurnId,
            run_id: runId,
            active_request_id: `history:${runId}`,
            part_id: `${historyTurnId}:answer:0`,
            event_type: "part.replace",
            operation: "replace",
            visibility: "final",
            text: "最终回答：测试文档已生成。",
            payload: { source_kind: "assistant.message" },
          }),
        ],
      },
      { canonicalOnly: true }
    );

    expect(recoveryChanged).toBe(true);
    expect(message.answer).toBe("最终回答：测试文档已生成。");
    expect(message.loading).toBe(false);
    expect(message.outputFiles).toEqual([
      expect.objectContaining({
        file_name: "test_document.txt",
        signed_download_url: "https://example.com/test_document.txt",
      }),
    ]);
    expect(message.openclawTimelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "output_files",
          files: expect.arrayContaining([
            expect.objectContaining({ file_name: "test_document.txt" }),
          ]),
        }),
      ])
    );
    expect(message.reasoning_content).toContain("确认文件已经生成");
  });

  it("does not hydrate a canceled OpenClaw request after stop", async () => {
    let rejectFirst: ((reason?: any) => void) | null = null;
    const completions = vi.fn((_payload, options) => {
      options.signal?.addEventListener("abort", () => {
        rejectFirst?.(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
      });
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({ data: { events: [] } }),
      control: vi.fn().mockResolvedValue(undefined),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    void act(() => {
      void result.current.sendMessage({
        question: "测试",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    expect(completions).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.handleStop();
      await Promise.resolve();
    });

    await Promise.resolve();

    expect(conversationApi.control).toHaveBeenCalledWith("agent:main:main", { action: "stop" });
    expect(conversationApi.events).not.toHaveBeenCalled();
  });

  it("marks a stopped OpenClaw request even before the conversation id is ready", async () => {
    let rejectFirst: ((reason?: any) => void) | null = null;
    const completions = vi.fn((_payload, options) => {
      options.signal?.addEventListener("abort", () => {
        rejectFirst?.(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
      });
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({ data: { events: [] } }),
      control: vi.fn().mockResolvedValue(undefined),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    void act(() => {
      void result.current.sendMessage({
        question: "测试",
        agent_id: "2",
        conversation_id: "",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    await act(async () => {
      result.current.handleStop();
      await Promise.resolve();
    });

    expect(conversationApi.control).not.toHaveBeenCalled();
    expect(renderedMessages.at(-1)).toMatchObject({
      question: "测试",
      answer: "本次运行已中断",
      conversation_id: "",
      interrupted: true,
      error: false,
      loading: false,
    });
  });

  it("does not append or dispatch an OpenClaw message while stop control is pending", async () => {
    let rejectFirst: ((reason?: any) => void) | null = null;
    let resolveStop: (() => void) | null = null;
    const completions = vi
      .fn()
      .mockImplementationOnce((_payload, options) => {
        options.signal?.addEventListener("abort", () => {
          rejectFirst?.(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
        });
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      })
      .mockResolvedValueOnce(undefined);
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({ data: { events: [] } }),
      control: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveStop = resolve;
          })
      ),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    void act(() => {
      void result.current.sendMessage({
        question: "第一轮",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    await act(async () => {
      result.current.handleStop();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage({
        question: "第二轮",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    expect(completions).toHaveBeenCalledTimes(1);
    expect(result.current.isStopping).toBe(true);
    expect(renderedMessages).toHaveLength(1);
    expect(renderedMessages[0]).toMatchObject({
      question: "第一轮",
      answer: "本次运行已中断",
      interrupted: true,
      loading: false,
    });

    await act(async () => {
      resolveStop?.();
      await Promise.resolve();
    });

    expect(result.current.isStopping).toBe(false);

    await act(async () => {
      await result.current.sendMessage({
        question: "第二轮",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    expect(completions).toHaveBeenCalledTimes(2);
    expect(renderedMessages.at(-1)).toMatchObject({ question: "第二轮", loading: true });
  });

  it("keeps OpenClaw sends blocked if stop control never settles", async () => {
    vi.useFakeTimers();
    let rejectFirst: ((reason?: any) => void) | null = null;
    const completions = vi
      .fn()
      .mockImplementationOnce((_payload, options) => {
        options.signal?.addEventListener("abort", () => {
          rejectFirst?.(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
        });
        return new Promise((_resolve, reject) => {
          rejectFirst = reject;
        });
      })
      .mockResolvedValueOnce(undefined);
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({ data: { events: [] } }),
      control: vi.fn(() => new Promise<void>(() => undefined)),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    void act(() => {
      void result.current.sendMessage({
        question: "第一轮",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    await act(async () => {
      result.current.handleStop();
      await Promise.resolve();
    });

    await act(async () => {
      await result.current.sendMessage({
        question: "第二轮",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    expect(completions).toHaveBeenCalledTimes(1);
    expect(result.current.isStopping).toBe(true);
    expect(renderedMessages).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1200);
    });

    expect(result.current.isStopping).toBe(true);
    expect(completions).toHaveBeenCalledTimes(1);
    expect(renderedMessages).toHaveLength(1);
  });

  it("ignores repeated OpenClaw stop clicks while stop control is pending", async () => {
    vi.useFakeTimers();
    let rejectFirst: ((reason?: any) => void) | null = null;
    const completions = vi.fn((_payload, options) => {
      options.signal?.addEventListener("abort", () => {
        rejectFirst?.(Object.assign(new Error("canceled"), { code: "ERR_CANCELED" }));
      });
      return new Promise((_resolve, reject) => {
        rejectFirst = reject;
      });
    });
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockResolvedValue({ data: { events: [] } }),
      control: vi.fn(() => new Promise<void>(() => undefined)),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    void act(() => {
      void result.current.sendMessage({
        question: "第一轮",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    await act(async () => {
      result.current.handleStop();
      await Promise.resolve();
    });

    await act(async () => {
      result.current.handleStop();
      await Promise.resolve();
    });

    expect(result.current.isStopping).toBe(true);
    expect(conversationApi.control).toHaveBeenCalledTimes(1);
    expect(completions).toHaveBeenCalledTimes(1);
    expect(renderedMessages.at(-1)).toMatchObject({
      question: "第一轮",
      answer: "本次运行已中断",
      interrupted: true,
      loading: false,
    });
  });

  it("keeps final reconciliation for the previous OpenClaw turn after the next send starts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T12:00:00.000Z"));
    const firstClientMessageId = String(Date.now());

    let resolveFirstEvents: ((value: any) => void) | null = null;
    let resolveSecondCompletion: (() => void) | null = null;
    const firstEvents = new Promise((resolve) => {
      resolveFirstEvents = resolve;
    });
    const completions = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveSecondCompletion = resolve;
          })
      );
    const conversationApi = {
      create: vi.fn(),
      list: vi.fn(),
      messages: vi.fn(),
      edit: vi.fn(),
      del: vi.fn(),
      events: vi.fn().mockReturnValueOnce(firstEvents).mockResolvedValue({ data: { events: [] } }),
      completions,
    };
    let renderedMessages: any[] = [];
    const onMessageListChange = vi.fn((updater: (list: any[]) => any[]) => {
      renderedMessages = updater(renderedMessages);
    });

    const { result } = renderHook(() => useChatSend(conversationApi as any));

    await act(async () => {
      await result.current.sendMessage({
        question: "今天天气如何",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
      await Promise.resolve();
    });

    expect(conversationApi.events).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-06-11T12:00:01.000Z"));

    void act(() => {
      void result.current.sendMessage({
        question: "测试",
        agent_id: "2",
        conversation_id: "agent:main:main",
        messageList: renderedMessages as any,
        minimalParams: true,
        openclaw: true,
        type: "agent",
        onMessageListChange,
      });
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(completions).toHaveBeenCalledTimes(2);
    expect(renderedMessages.map((message) => message.question)).toEqual(["今天天气如何", "测试"]);

    await act(async () => {
      resolveFirstEvents?.({
        data: {
          ledger_events: [
            ledgerEvent({
              seq: 128,
              turn_id: "agent:main:main:turn:first-weather",
              part_id: "agent:main:main:turn:first-weather:answer:0",
              part_type: "answer",
              event_type: "part.replace",
              operation: "replace",
              visibility: "final",
              text: "上海今日天气完整结论：多云，建议注意补水。",
              active_request_id: firstClientMessageId,
              payload: { source_kind: "assistant.message" },
            }),
            ledgerEvent({
              seq: 129,
              turn_id: "agent:main:main:turn:first-weather",
              part_id: "agent:main:main:turn:first-weather:status",
              part_type: "status",
              event_type: "turn.completed",
              operation: "close",
              visibility: "final",
              terminal_status: "completed",
              active_request_id: firstClientMessageId,
              payload: { source_kind: "run.completed" },
            }),
          ],
        },
      });
      await Promise.resolve();
      await Promise.resolve();
    });

    const firstMessage = renderedMessages.find((message) => message.question === "今天天气如何");
    expect(firstMessage?.answer).toContain("完整结论");
    expect(renderedMessages.at(-1)?.question).toBe("测试");

    await act(async () => {
      resolveSecondCompletion?.();
      await Promise.resolve();
    });
    vi.clearAllTimers();
  });
});
