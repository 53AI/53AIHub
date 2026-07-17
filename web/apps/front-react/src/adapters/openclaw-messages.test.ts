import { describe, expect, it, vi } from "vitest";

import {
  buildOpenClawActivities,
  buildOpenClawMessages as buildSharedOpenClawMessages,
  buildOpenClawTimelineItemFromActivity,
  collapseDuplicateOpenClawIntermediateRows,
  createOpenClawConversationApiAdapter as createSharedOpenClawConversationApiAdapter,
  getOpenClawTimelineEventsFromLedgerPayload,
  mergeOpenClawTimelineEventsIntoMessage,
  mergeOpenClawTimelineItems,
  replaceOpenClawTurnWithTimelineEvents,
  type OpenClawLedgerEvent,
} from "@km/shared-business/chat";
import { buildOpenClawMessages } from "./chat-adapters";

function summarizeTimelineItems(items: any[] = []) {
  return items.map((item) => ({
    type: item.type,
    content: item.content || "",
    input: item.tool?.input || "",
    output: item.tool?.output || "",
    files: (item.files || []).map((file: any) => file.file_name || file.name || file.id),
  }));
}

const openClawMessageBuilders = [
  ["front", buildOpenClawMessages],
  ["shared", buildSharedOpenClawMessages],
] as const;

function senderMetadataEnvelope(prompt = "") {
  return [
    "Sender (untrusted metadata):",
    "```json",
    "{",
    '  "label": "Claw Control Center (gateway-client)",',
    '  "id": "gateway-client",',
    '  "name": "Claw Control Center",',
    '  "username": "Claw Control Center"',
    "}",
    "```",
    "",
    prompt ? `[Wed 2026-06-10 14:54 GMT+8] ${prompt}` : "",
  ].join("\n");
}

function ledgerEvent(overrides: Partial<OpenClawLedgerEvent> = {}): OpenClawLedgerEvent {
  const sessionId = overrides.session_id || "session-1";
  const turnId = overrides.turn_id || `${sessionId}:turn:req-1`;
  const event = {
    protocol_version: "openclaw.ledger.v1",
    seq: 1,
    session_id: sessionId,
    conversation_id: overrides.conversation_id || sessionId,
    turn_id: turnId,
    active_request_id: overrides.active_request_id || "req-1",
    part_id: overrides.part_id || `${turnId}:answer:0`,
    part_type: "answer",
    event_type: "part.replace",
    operation: "replace",
    visibility: "final",
    text: "",
    created_at: "2026-06-12T00:00:00.000Z",
    raw_event_ref: `${sessionId}:1:evt-1`,
    ...overrides,
  } as OpenClawLedgerEvent;

  return {
    ...event,
    raw_event_ref: overrides.raw_event_ref || `${event.session_id}:${event.seq}:evt-${event.seq}`,
  };
}

describe("OpenClaw message history mapping", () => {
  it.each(openClawMessageBuilders)(
    "keeps the latest persisted assistant message for canonical history in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:test";
      const turnId = `${sessionId}:turn:file-2`;
      const rows = builder(
        [
          {
            id: `${sessionId}:user:295`,
            sessionId,
            role: "user",
            content: "创建一个长度为2个字符的文件",
            createdAt: "2026-06-23T08:20:00.000Z",
          },
          {
            id: `${sessionId}:assistant:296`,
            sessionId,
            role: "assistant",
            content: "我来为您创建一个正好2个字符长度的文件。",
            createdAt: "2026-06-23T08:20:01.000Z",
          },
          {
            id: `${sessionId}:assistant:298`,
            sessionId,
            role: "assistant",
            content: "让我验证文件内容并更新输出产物清单。",
            createdAt: "2026-06-23T08:20:02.000Z",
          },
          {
            id: `${sessionId}:assistant:304`,
            sessionId,
            role: "assistant",
            content: [
              "**✅ 任务完成！**",
              "",
              "我已经成功创建了一个正好2个字符长度的文件。",
              "",
              "**📄 文件详情：**",
              "- **文件名**：`2chars.txt`",
            ].join("\n"),
            createdAt: "2026-06-23T08:20:08.000Z",
          },
          {
            id: `${sessionId}:user:305`,
            sessionId,
            role: "user",
            content: "创建一个长度为4个字符的文件",
            createdAt: "2026-06-23T08:21:00.000Z",
          },
          {
            id: `${sessionId}:assistant:306`,
            sessionId,
            role: "assistant",
            content: "我来为您创建一个正好4个字符长度的文件。",
            createdAt: "2026-06-23T08:21:01.000Z",
          },
        ] as any,
        sessionId,
        2,
        [
          {
            id: `${sessionId}:ledger:thinking:297`,
            sessionId,
            seq: 297,
            kind: "assistant.thinking",
            createdAt: "2026-06-23T08:20:01.500Z",
            payload: {
              content: "Need create a two-character file.",
              openclaw_ledger: ledgerEvent({
                seq: 297,
                session_id: sessionId,
                conversation_id: sessionId,
                turn_id: turnId,
                run_id: turnId,
                active_request_id: "1782202800000",
                part_id: `${turnId}:thinking:0`,
                part_type: "thinking",
                event_type: "part.replace",
                operation: "replace",
                visibility: "final",
                text: "Need create a two-character file.",
                created_at: "2026-06-23T08:20:01.500Z",
              }),
            },
          },
        ] as any,
        { canonicalOnly: true }
      );

      expect(rows).toHaveLength(2);
      expect(rows[0].question).toBe("创建一个长度为2个字符的文件");
      expect(rows[0].answer).toContain("2chars.txt");
      expect(rows[0].answer).not.toBe("我来为您创建一个正好2个字符长度的文件。");
    }
  );

  it.each(openClawMessageBuilders)(
    "uses the persisted assistant answer when a matched ledger answer belongs to another turn in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:test";
      const turnId = `${sessionId}:turn:file-2`;
      const rows = builder(
        [
          {
            id: `${sessionId}:user:295`,
            sessionId,
            role: "user",
            content: "创建一个长度为2个字符的文件",
            createdAt: "2026-06-23T08:20:00.000Z",
          },
          {
            id: `${sessionId}:assistant:304`,
            sessionId,
            role: "assistant",
            content: [
              "**✅ 任务完成！**",
              "我已经成功创建了一个正好2个字符长度的文件。",
              "- **文件名**：`2chars.txt`",
            ].join("\n\n"),
            createdAt: "2026-06-23T08:20:08.000Z",
          },
        ] as any,
        sessionId,
        2,
        [
          {
            id: `${sessionId}:ledger:answer:304`,
            sessionId,
            seq: 304,
            kind: "assistant.message",
            createdAt: "2026-06-23T08:20:08.000Z",
            payload: {
              content: [
                "**✅ 任务完成！**",
                "我已经成功创建了一个正好4个字符长度的文件。",
                "- **文件名**：`4chars.txt`",
                "2chars.txt - 2字符：ab",
              ].join("\n\n"),
              openclaw_ledger: ledgerEvent({
                seq: 304,
                session_id: sessionId,
                conversation_id: sessionId,
                turn_id: turnId,
                run_id: turnId,
                active_request_id: "1782202800000",
                part_id: `${turnId}:answer:0`,
                part_type: "answer",
                event_type: "part.replace",
                operation: "replace",
                visibility: "final",
                text: [
                  "**✅ 任务完成！**",
                  "我已经成功创建了一个正好4个字符长度的文件。",
                  "- **文件名**：`4chars.txt`",
                  "2chars.txt - 2字符：ab",
                ].join("\n\n"),
                created_at: "2026-06-23T08:20:08.000Z",
              }),
            },
          },
        ] as any,
        { canonicalOnly: true }
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].answer).toContain("2chars.txt");
      expect(rows[0].answer).not.toContain("4chars.txt");
      const answerItems = rows[0].openclawTimelineItems.filter((item: any) => item.type === "answer");
      expect(answerItems).toHaveLength(1);
      expect(answerItems[0].content).toContain("2chars.txt");
      expect(answerItems[0].content).not.toContain("4chars.txt");
    }
  );

  it.each(openClawMessageBuilders)(
    "projects historical Files prompt blocks as uploaded files in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:test";
      const previewUrl = "http://localhost:9001/api/preview/f7ab16610bc3971f816855b896db0d64.pdf";
      const rows = builder(
        [
          {
            id: "user-with-files",
            sessionId,
            role: "user",
            content: [
              "这个文件的内容是什么",
              "",
              "Files:",
              "/Users/y65ng/.qclaw/input-files/0947fbbd-1ed0-4fcc-95b0-f4b0d9d4642b/2.pdf",
              previewUrl,
            ].join("\n"),
            createdAt: "2026-06-18T08:20:00.000Z",
          },
          {
            id: "assistant-with-files",
            sessionId,
            role: "assistant",
            content: "我来帮您分析这个 PDF 文件内容。",
            createdAt: "2026-06-18T08:20:02.000Z",
          },
        ] as any,
        sessionId,
        2,
        []
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("这个文件的内容是什么");
      expect(rows[0].question).not.toContain("Files:");
      expect(rows[0].uploaded_files).toHaveLength(1);
      expect(rows[0].uploaded_files[0]).toMatchObject({
        name: "2.pdf",
        url: previewUrl,
        preview_url: previewUrl,
        file_path: "/Users/y65ng/.qclaw/input-files/0947fbbd-1ed0-4fcc-95b0-f4b0d9d4642b/2.pdf",
        mime_type: "application/pdf",
      });
    }
  );

  it.each(openClawMessageBuilders)(
    "strips polluted runtime skill and attachment prompt blocks in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:test";
      const previewUrl = "http://localhost:9001/api/preview/legacy-probe.pdf";
      const rows = builder(
        [
          {
            id: "user-polluted-skill-files",
            sessionId,
            role: "user",
            content: [
              "/openclaw_pdf_probe 测试技能效果",
              "",
              "Attached files:",
              "/Users/y65ng/.qclaw/input-files/req-1/probe.pdf",
              previewUrl,
              "",
              "Selected skill: /openclaw_pdf_probe",
              "",
              "53AIHub selected skill instructions for /openclaw_pdf_probe:",
              "When selected, inspect the attached document before answering.",
              "Follow these instructions for this turn even if the host skill index has not refreshed yet.",
            ].join("\n"),
            createdAt: "2026-06-18T08:30:00.000Z",
          },
          {
            id: "assistant-polluted-skill-files",
            sessionId,
            role: "assistant",
            content: "技能测试完成。",
            createdAt: "2026-06-18T08:30:02.000Z",
          },
        ] as any,
        sessionId,
        2,
        []
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("测试技能效果");
      expect(rows[0].question).not.toContain("Selected skill:");
      expect(rows[0].question).not.toContain("Attached files:");
      expect(rows[0].question).not.toContain("53AIHub selected skill instructions");
      expect(rows[0].uploaded_files).toEqual([
        expect.objectContaining({
          name: "probe.pdf",
          file_path: "/Users/y65ng/.qclaw/input-files/req-1/probe.pdf",
          preview_url: previewUrl,
        }),
      ]);
    }
  );

  it.each(openClawMessageBuilders)(
    "restores OpenClaw skill and input files from user message metadata in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:test";
      const localPath = "/Users/y65ng/.qclaw/input-files/req-2/probe.md";
      const previewUrl = "http://localhost:9001/api/preview/probe.md";
      const rows = builder(
        [
          {
            id: "user-metadata-skill-files",
            sessionId,
            role: "user",
            content: [
              "测试技能效果",
              "",
              "<53aihub-openclaw-runtime-context>",
              "Local input files:",
              `@${localPath}`,
              "Selected skill: /openclaw_pdf_probe",
              "</53aihub-openclaw-runtime-context>",
            ].join("\n"),
            metadata: {
              openclaw_skill: {
                skill_id: "skill-1",
                skill_name: "openclaw_pdf_probe",
                display_name: "PDF Probe",
              },
              openclaw_input_files: [
                {
                  id: "file-1",
                  file_name: "probe.md",
                  mime_type: "text/markdown",
                  local_path: localPath,
                  preview_url: previewUrl,
                  signed_download_url: previewUrl,
                },
              ],
            },
            createdAt: "2026-06-18T08:35:00.000Z",
          },
          {
            id: "assistant-metadata-skill-files",
            sessionId,
            role: "assistant",
            content: "技能测试完成。",
            createdAt: "2026-06-18T08:35:02.000Z",
          },
        ] as any,
        sessionId,
        2,
        []
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("测试技能效果");
      expect(rows[0].question).not.toContain("<53aihub-openclaw-runtime-context>");
      expect(rows[0].skill).toEqual(
        expect.objectContaining({
          skill_name: "openclaw_pdf_probe",
          display_name: "PDF Probe",
        })
      );
      expect(rows[0].uploaded_files).toEqual([
        expect.objectContaining({
          id: "file-1",
          file_name: "probe.md",
          file_path: localPath,
          preview_url: previewUrl,
          mime_type: "text/markdown",
        }),
      ]);
    }
  );

  it("defaults the OpenClaw shared adapter to canonical-only history projection", async () => {
    const adapter = createSharedOpenClawConversationApiAdapter({
      agentId: 2,
      completions: (() => Promise.resolve({})) as any,
      openclawApi: {
        conversations: async () => ({ sessions: [] }),
        messages: async () => ({
          messages: [
            {
              id: "user-1",
              sessionId: "session-1",
              role: "user",
              content: "old question",
              createdAt: "2026-06-12T00:00:00.000Z",
            },
            {
              id: "assistant-2",
              sessionId: "session-1",
              role: "assistant",
              content: "persisted old answer",
              createdAt: "2026-06-12T00:00:01.000Z",
            },
          ],
          events: [
            {
              id: "raw-thinking",
              sessionId: "session-1",
              seq: 2,
              kind: "assistant.thinking",
              payload: { content: "raw thinking should not reach UI" },
              createdAt: "2026-06-12T00:00:00.500Z",
            },
          ],
        }),
        events: async () => ({ events: [] }),
        control: async () => undefined,
      },
    });

    const response = await adapter.messages("session-1");
    const row = response.data.messages[0];

    expect(row.answer).toBe("persisted old answer");
    expect(row.openclawProjection.visibleAnswer).toBe("persisted old answer");
    expect(row.openclawTimelineItems).toEqual([]);
    expect(JSON.stringify(row)).not.toContain("raw thinking should not reach UI");
  });

  it.each(openClawMessageBuilders)(
    "keeps persisted assistant answers when canonical ledger has no visible answer in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:persisted-answer";
      const turnId = `${sessionId}:turn:req-1`;
      const rows = builder(
        [
          {
            id: "user-persisted",
            sessionId,
            role: "user",
            content: "总结这个文件",
            createdAt: "2026-06-22T02:00:00.000Z",
          },
          {
            id: "assistant-persisted",
            sessionId,
            role: "assistant",
            content: "这是从持久化历史恢复的回答。",
            createdAt: "2026-06-22T02:00:01.000Z",
          },
        ] as any,
        sessionId,
        2,
        [
          ledgerEvent({
            seq: 1,
            session_id: sessionId,
            conversation_id: sessionId,
            turn_id: turnId,
            part_id: `${turnId}:status`,
            part_type: "status",
            event_type: "part.replace",
            text: "正在处理",
          }),
        ],
        { canonicalOnly: true }
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].answer).toBe("这是从持久化历史恢复的回答。");
      expect(rows[0].openclawProjection.visibleAnswer).toBe("这是从持久化历史恢复的回答。");
    }
  );

  it("keeps cached mirror pages paginated instead of replacing them with the snapshot ledger", async () => {
    const conversationId = "agent:main:cached";
    const firstTurn = `${conversationId}:turn:first`;
    const secondTurn = `${conversationId}:turn:second`;
    const snapshot = {
      source: "mirror",
      stale: true,
      ledger_events: [
        ledgerEvent({
          seq: 1,
          session_id: conversationId,
          conversation_id: conversationId,
          turn_id: firstTurn,
          active_request_id: "first",
          part_id: `${firstTurn}:status`,
          part_type: "status",
          event_type: "turn.started",
          operation: "noop",
          visibility: "final",
          text: "第一轮问题",
          payload: { source_kind: "user.message", content: "第一轮问题" },
          created_at: "2026-06-18T08:00:00.000Z",
        }),
        ledgerEvent({
          seq: 2,
          session_id: conversationId,
          conversation_id: conversationId,
          turn_id: firstTurn,
          active_request_id: "first",
          part_id: `${firstTurn}:answer:0`,
          text: "第一轮回答",
          payload: { source_kind: "assistant.message" },
          created_at: "2026-06-18T08:00:01.000Z",
        }),
        ledgerEvent({
          seq: 3,
          session_id: conversationId,
          conversation_id: conversationId,
          turn_id: secondTurn,
          active_request_id: "second",
          part_id: `${secondTurn}:status`,
          part_type: "status",
          event_type: "turn.started",
          operation: "noop",
          visibility: "final",
          text: "第二轮问题",
          payload: { source_kind: "user.message", content: "第二轮问题" },
          created_at: "2026-06-18T08:01:00.000Z",
        }),
        ledgerEvent({
          seq: 4,
          session_id: conversationId,
          conversation_id: conversationId,
          turn_id: secondTurn,
          active_request_id: "second",
          part_id: `${secondTurn}:answer:0`,
          text: "第二轮回答",
          payload: { source_kind: "assistant.message" },
          created_at: "2026-06-18T08:01:01.000Z",
        }),
      ],
    };
    const snapshotSpy = vi.fn().mockResolvedValue(snapshot);
    const adapter = createSharedOpenClawConversationApiAdapter({
      agentId: 2,
      completions: (() => Promise.resolve({})) as any,
      openclawApi: {
        conversations: async () => ({ sessions: [] }),
        messages: async () => ({
          source: "mirror",
          stale: true,
          messages: [
            {
              id: "second-user",
              sessionId: conversationId,
              role: "user",
              content: "第二轮问题",
              createdAt: "2026-06-18T08:01:00.000Z",
            },
            {
              id: "second-assistant",
              sessionId: conversationId,
              role: "assistant",
              content: "第二轮回答",
              createdAt: "2026-06-18T08:01:01.000Z",
            },
          ],
          pagination: { limit: 30, offset: 0, hasMore: false, nextOffset: 2 },
        }),
        snapshot: snapshotSpy,
        events: async () => ({ events: [] }),
        control: async () => undefined,
      },
    });

    const response = await adapter.messages(conversationId);

    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(response.data.messages.map((row: any) => row.question)).toEqual(["第二轮问题"]);
    expect(response.data.messages.map((row: any) => row.answer)).toEqual(["第二轮回答"]);
    expect(response.data.pagination).toMatchObject({ hasMore: false, nextOffset: 2 });
  });

  it("paginates cached mirror ledger fallback instead of returning every mirrored turn", async () => {
    const conversationId = "agent:main:cached-ledger";
    const firstTurn = `${conversationId}:turn:first`;
    const secondTurn = `${conversationId}:turn:second`;
    const ledgerEvents = [
      ledgerEvent({
        seq: 1,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: firstTurn,
        active_request_id: "first",
        part_id: `${firstTurn}:status`,
        part_type: "status",
        event_type: "turn.started",
        operation: "noop",
        visibility: "final",
        text: "第一页问题",
        payload: { source_kind: "user.message", content: "第一页问题" },
      }),
      ledgerEvent({
        seq: 2,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: firstTurn,
        active_request_id: "first",
        part_id: `${firstTurn}:answer:0`,
        text: "第一页回答",
        payload: { source_kind: "assistant.message" },
      }),
      ledgerEvent({
        seq: 3,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: secondTurn,
        active_request_id: "second",
        part_id: `${secondTurn}:status`,
        part_type: "status",
        event_type: "turn.started",
        operation: "noop",
        visibility: "final",
        text: "第二页问题",
        payload: { source_kind: "user.message", content: "第二页问题" },
      }),
      ledgerEvent({
        seq: 4,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: secondTurn,
        active_request_id: "second",
        part_id: `${secondTurn}:answer:0`,
        text: "第二页回答",
        payload: { source_kind: "assistant.message" },
      }),
    ];
    const snapshotSpy = vi.fn();
    const adapter = createSharedOpenClawConversationApiAdapter({
      agentId: 2,
      completions: (() => Promise.resolve({})) as any,
      openclawApi: {
        conversations: async () => ({ sessions: [] }),
        messages: async () => ({
          source: "mirror",
          stale: true,
          messages: [],
          ledger_events: ledgerEvents,
          pagination: { limit: 1, offset: 1, total: 2, hasMore: false, nextOffset: 2 },
        }),
        snapshot: snapshotSpy,
        events: async () => ({ events: [] }),
        control: async () => undefined,
      },
    });

    const response = await adapter.messages(conversationId, { offset: 1, limit: 1 });

    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(response.data.messages.map((row: any) => row.question)).toEqual(["第二页问题"]);
    expect(response.data.messages.map((row: any) => row.answer)).toEqual(["第二页回答"]);
    expect(response.data.pagination).toMatchObject({ limit: 1, offset: 1, total: 2, hasMore: false, nextOffset: 2 });
  });

  it("restores uploaded files from cached mirror ledger-only pages", async () => {
    const conversationId = "agent:main:cached-ledger-files";
    const firstTurn = `${conversationId}:turn:first`;
    const secondTurn = `${conversationId}:turn:second`;
    const previewUrl = "http://localhost:9001/api/preview/cached-file.pdf";
    const filePrompt = [
      "这个文件的内容是什么",
      "",
      "Files:",
      "/Users/y65ng/.qclaw/input-files/cached/2.pdf",
      previewUrl,
    ].join("\n");
    const ledgerEvents = [
      ledgerEvent({
        seq: 1,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: firstTurn,
        active_request_id: "first",
        part_id: `${firstTurn}:status`,
        part_type: "status",
        event_type: "turn.started",
        operation: "noop",
        visibility: "final",
        text: "第一页问题",
        payload: { source_kind: "user.message", content: "第一页问题" },
      }),
      ledgerEvent({
        seq: 2,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: firstTurn,
        active_request_id: "first",
        part_id: `${firstTurn}:answer:0`,
        text: "第一页回答",
        payload: { source_kind: "assistant.message" },
      }),
      ledgerEvent({
        seq: 3,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: secondTurn,
        active_request_id: "second",
        part_id: `${secondTurn}:status`,
        part_type: "status",
        event_type: "turn.started",
        operation: "noop",
        visibility: "final",
        text: filePrompt,
        payload: { source_kind: "user.message", content: filePrompt },
      }),
      ledgerEvent({
        seq: 4,
        session_id: conversationId,
        conversation_id: conversationId,
        turn_id: secondTurn,
        active_request_id: "second",
        part_id: `${secondTurn}:answer:0`,
        text: "第二页回答",
        payload: { source_kind: "assistant.message" },
      }),
    ];
    const adapter = createSharedOpenClawConversationApiAdapter({
      agentId: 2,
      completions: (() => Promise.resolve({})) as any,
      openclawApi: {
        conversations: async () => ({ sessions: [] }),
        messages: async () => ({
          source: "mirror",
          stale: true,
          messages: [],
          ledger_events: ledgerEvents,
          pagination: { limit: 1, offset: 1, total: 2, hasMore: false, nextOffset: 2 },
        }),
        snapshot: vi.fn(),
        events: async () => ({ events: [] }),
        control: async () => undefined,
      },
    });

    const response = await adapter.messages(conversationId, { offset: 1, limit: 1 });

    expect(response.data.messages).toHaveLength(1);
    expect(response.data.messages[0].question).toBe("这个文件的内容是什么");
    expect(response.data.messages[0].question).not.toContain("Files:");
    expect(response.data.messages[0].uploaded_files).toEqual([
      expect.objectContaining({
        name: "2.pdf",
        file_path: "/Users/y65ng/.qclaw/input-files/cached/2.pdf",
        url: previewUrl,
        preview_url: previewUrl,
        mime_type: "application/pdf",
      }),
    ]);
    expect(response.data.pagination).toMatchObject({ limit: 1, offset: 1, total: 2, hasMore: false, nextOffset: 2 });
  });

  it("ensures OpenClaw skills by skill_name when the library item has no id", async () => {
    const ensureSkill = vi.fn().mockResolvedValue({ status: "installed" });
    const adapter = createSharedOpenClawConversationApiAdapter({
      agentId: 2,
      completions: (() => Promise.resolve({})) as any,
      openclawApi: {
        conversations: async () => ({ sessions: [] }),
        messages: async () => ({ messages: [] }),
        events: async () => ({ events: [] }),
        control: async () => undefined,
        ensureSkill,
      },
    });

    await adapter.ensureSkill?.({ skill_name: "openclaw_pdf_probe", display_name: "PDF Probe" } as any);

    expect(ensureSkill).toHaveBeenCalledWith(2, "openclaw_pdf_probe");
  });

  it("matches canonical ledger groups to visible message turns instead of using group index", () => {
    const conversationId = "session-1";
    const reqOne = String(Date.parse("2026-06-12T06:15:38.573Z"));
    const reqTwo = String(Date.parse("2026-06-12T06:16:51.476Z"));
    const events = getOpenClawTimelineEventsFromLedgerPayload({
      ledger_events: [
        ledgerEvent({
          seq: 1,
          turn_id: `${conversationId}:turn:history:old-weather`,
          run_id: "old-weather",
          active_request_id: "history:old-weather",
          part_id: `${conversationId}:turn:history:old-weather:answer:0`,
          text: "旧天气回答不应挂到当前用户消息",
          payload: { source_kind: "assistant.message" },
          created_at: "2026-06-09T03:00:01.000Z",
        }),
        ledgerEvent({
          seq: 2,
          turn_id: `${conversationId}:turn:${reqOne}`,
          run_id: "run-one",
          active_request_id: reqOne,
          part_id: `${conversationId}:turn:${reqOne}:answer:0`,
          text: "1 收到",
          payload: { source_kind: "assistant.message" },
          created_at: "2026-06-12T06:15:40.516Z",
        }),
        ledgerEvent({
          seq: 3,
          turn_id: `${conversationId}:turn:${reqOne}`,
          run_id: "run-one",
          active_request_id: reqOne,
          part_id: `${conversationId}:turn:${reqOne}:status`,
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          text: "",
          terminal_status: "completed",
          payload: { source_kind: "run.completed" },
          created_at: "2026-06-12T06:15:40.600Z",
        }),
        ledgerEvent({
          seq: 4,
          turn_id: `${conversationId}:turn:${reqTwo}`,
          run_id: "run-two",
          active_request_id: reqTwo,
          part_id: `${conversationId}:turn:${reqTwo}:answer:0`,
          text: "2 收到",
          payload: { source_kind: "assistant.message" },
          created_at: "2026-06-12T06:16:57.385Z",
        }),
        ledgerEvent({
          seq: 5,
          turn_id: `${conversationId}:turn:${reqTwo}`,
          run_id: "run-two",
          active_request_id: reqTwo,
          part_id: `${conversationId}:turn:${reqTwo}:status`,
          part_type: "status",
          event_type: "turn.completed",
          operation: "close",
          text: "",
          terminal_status: "completed",
          payload: { source_kind: "run.completed" },
          created_at: "2026-06-12T06:16:57.500Z",
        }),
      ],
    });

    const rows = buildSharedOpenClawMessages(
      [
        {
          id: "hub53ai-user-075729df",
          sessionId: conversationId,
          role: "user",
          content: "1",
          createdAt: "2026-06-12T06:15:39.127Z",
        },
        {
          id: "assistant-272",
          sessionId: conversationId,
          role: "assistant",
          content: "persisted answer should be replaced",
          createdAt: "2026-06-12T06:15:40.516Z",
        },
        {
          id: "hub53ai-user-cd585125",
          sessionId: conversationId,
          role: "user",
          content: "2",
          createdAt: "2026-06-12T06:16:52.116Z",
        },
        {
          id: "assistant-285",
          sessionId: conversationId,
          role: "assistant",
          content: "persisted answer should be replaced",
          createdAt: "2026-06-12T06:16:57.385Z",
        },
      ],
      conversationId,
      "agent-1",
      events,
      { canonicalOnly: true }
    );

    expect(rows.map((row: any) => row.question)).toEqual(["1", "2"]);
    expect(rows.map((row: any) => row.answer)).toEqual(["1 收到", "2 收到"]);
    expect(JSON.stringify(rows)).not.toContain("旧天气回答不应挂到当前用户消息");
  });

  it.each(openClawMessageBuilders)(
    "keeps canonical output files with same turn identity when run_id is absent in %s builder",
    (_name, builder) => {
      const conversationId = "agent:main:dashboard:file-card";
      const activeRequestId = String(Date.parse("2026-06-24T06:55:10.000Z"));
      const turnId = `${conversationId}:turn:${activeRequestId}`;
      const events = getOpenClawTimelineEventsFromLedgerPayload({
        ledger_events: [
          ledgerEvent({
            seq: 101,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: turnId,
            run_id: "history-page-file-card",
            active_request_id: activeRequestId,
            part_id: `${turnId}:answer:0`,
            part_type: "answer",
            event_type: "part.replace",
            operation: "replace",
            text: "已经创建 `test4.txt`。",
            payload: { source_kind: "assistant.message" },
            created_at: "2026-06-24T06:55:20.000Z",
          }),
          ledgerEvent({
            seq: 102,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: turnId,
            run_id: "history-page-file-card",
            active_request_id: activeRequestId,
            part_id: `${turnId}:status`,
            part_type: "status",
            event_type: "turn.completed",
            operation: "close",
            text: "",
            terminal_status: "completed",
            payload: { source_kind: "run.completed" },
            created_at: "2026-06-24T06:55:21.000Z",
          }),
          ledgerEvent({
            seq: 287971,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: turnId,
            active_request_id: activeRequestId,
            part_id: `${turnId}:output_file:test4`,
            part_type: "output_file",
            event_type: "part.replace",
            operation: "replace",
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
                      id: "artifact-test4",
                      file_name: "test4.txt",
                      mime_type: "text/plain",
                      size: 4,
                      preview_key: "preview-test4",
                      preview_url: "/api/preview/preview-test4",
                      download_url: "/api/openclaw/artifacts/artifact-test4/download",
                      signed_download_url: "/api/openclaw/artifacts/artifact-test4/signed-download",
                      artifact_id: "artifact-test4",
                      upload_file_id: "upload-test4",
                    },
                  ],
                },
              },
            },
            created_at: "2026-06-24T06:55:22.000Z",
          }),
        ],
      });

      const rows = builder(
        [
          {
            id: `${conversationId}:user:1`,
            sessionId: conversationId,
            role: "user",
            content: "创建一个长度为4个字符的文件",
            createdAt: "2026-06-24T06:55:10.000Z",
          } as any,
          {
            id: `${conversationId}:assistant:2`,
            sessionId: conversationId,
            role: "assistant",
            content: "persisted answer should be replaced",
            createdAt: "2026-06-24T06:55:20.000Z",
          } as any,
        ],
        conversationId,
        "agent-1",
        events,
        { canonicalOnly: true }
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].answer).toContain("test4.txt");
      expect(rows[0].openclawProjection.outputFiles).toEqual([
        expect.objectContaining({
          id: "artifact-test4",
          file_name: "test4.txt",
          preview_url: "/api/preview/preview-test4",
          download_url: "/api/openclaw/artifacts/artifact-test4/download",
          signed_download_url: "/api/openclaw/artifacts/artifact-test4/signed-download",
          artifact_id: "artifact-test4",
          upload_file_id: "upload-test4",
        }),
      ]);
      expect(rows[0].openclawTimelineItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "output_files",
            files: expect.arrayContaining([
              expect.objectContaining({
                file_name: "test4.txt",
                preview_url: "/api/preview/preview-test4",
              }),
            ]),
          }),
        ])
      );
    }
  );

  it.each(openClawMessageBuilders)(
    "renders persisted assistant answer when canonical ledger only has output files in %s builder",
    (_name, builder) => {
      const conversationId = "agent:main:dashboard:file-only-ledger";
      const activeRequestId = String(Date.parse("2026-06-24T07:20:10.000Z"));
      const turnId = `${conversationId}:turn:${activeRequestId}`;
      const events = getOpenClawTimelineEventsFromLedgerPayload({
        ledger_events: [
          ledgerEvent({
            seq: 287970,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: turnId,
            active_request_id: activeRequestId,
            part_id: `${turnId}:output_file:file4`,
            part_type: "output_file",
            event_type: "part.replace",
            operation: "replace",
            text: "",
            payload: {
              source_kind: "process.step",
              process_step: {
                step_code: "output_files",
                status: "completed",
                data: {
                  files: [
                    {
                      id: "artifact-file4",
                      file_name: "file4.txt",
                      preview_url: "/api/preview/preview-file4",
                    },
                  ],
                },
              },
            },
            created_at: "2026-06-24T07:20:22.000Z",
          }),
        ],
      });

      const rows = builder(
        [
          {
            id: `${conversationId}:user:1`,
            sessionId: conversationId,
            role: "user",
            content: "创建一个长度为4个字符的文件",
            createdAt: "2026-06-24T07:20:10.000Z",
          } as any,
          {
            id: `${conversationId}:assistant:2`,
            sessionId: conversationId,
            role: "assistant",
            content: "✅ 任务完成！我已经成功创建了另一个正好4个字符长度的文件。",
            createdAt: "2026-06-24T07:20:20.000Z",
          } as any,
        ],
        conversationId,
        "agent-1",
        events,
        { canonicalOnly: true }
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].answer).toContain("任务完成");
      expect(rows[0].openclawProjection.visibleAnswer).toContain("任务完成");
      expect(rows[0].openclawProjection.outputFiles).toEqual([
        expect.objectContaining({
          file_name: "file4.txt",
          preview_url: "/api/preview/preview-file4",
        }),
      ]);
      expect(rows[0].openclawProjection.timelineItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "answer",
            content: expect.stringContaining("任务完成"),
          }),
          expect.objectContaining({
            type: "output_files",
            files: expect.arrayContaining([
              expect.objectContaining({
                file_name: "file4.txt",
              }),
            ]),
          }),
        ])
      );
    }
  );

  it.each(openClawMessageBuilders)(
    "collapses a duplicate short intermediate answer when a later same-file final answer exists in %s builder",
    (_name, builder) => {
      const conversationId = "agent:main:dashboard:duplicate-file4";
      const firstRequestId = String(Date.parse("2026-06-24T07:18:00.000Z"));
      const intermediateRequestId = String(Date.parse("2026-06-24T07:19:00.000Z"));
      const finalRequestId = String(Date.parse("2026-06-24T07:19:25.000Z"));
      const firstTurnId = `${conversationId}:turn:${firstRequestId}`;
      const intermediateTurnId = `${conversationId}:turn:${intermediateRequestId}`;
      const finalTurnId = `${conversationId}:turn:${finalRequestId}`;
      const file4 = {
        id: "artifact-file4",
        file_name: "file4.txt",
        preview_url: "/api/preview/preview-file4",
      };
      const events = getOpenClawTimelineEventsFromLedgerPayload({
        ledger_events: [
          ledgerEvent({
            seq: 100,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: firstTurnId,
            active_request_id: firstRequestId,
            part_id: `${firstTurnId}:output_file:4chars`,
            part_type: "output_file",
            event_type: "part.replace",
            operation: "replace",
            text: "",
            payload: {
              source_kind: "process.step",
              process_step: {
                step_code: "output_files",
                status: "completed",
                data: {
                  files: [
                    {
                      id: "artifact-4chars",
                      file_name: "4chars.txt",
                      preview_url: "/api/preview/preview-4chars",
                    },
                  ],
                },
              },
            },
            created_at: "2026-06-24T07:18:08.000Z",
          }),
          ledgerEvent({
            seq: 110,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: intermediateTurnId,
            active_request_id: intermediateRequestId,
            part_id: `${intermediateTurnId}:output_file:file4`,
            part_type: "output_file",
            event_type: "part.replace",
            operation: "replace",
            text: "",
            payload: {
              source_kind: "process.step",
              process_step: {
                step_code: "output_files",
                status: "completed",
                data: { files: [file4] },
              },
            },
            created_at: "2026-06-24T07:19:08.000Z",
          }),
          ledgerEvent({
            seq: 120,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: finalTurnId,
            active_request_id: finalRequestId,
            part_id: `${finalTurnId}:answer:0`,
            part_type: "answer",
            event_type: "part.replace",
            operation: "replace",
            text: "✅ 任务完成！我已经成功创建了另一个正好4个字符长度的文件。\n\n文件名：`file4.txt`",
            payload: {
              source_kind: "assistant.message",
              content: "✅ 任务完成！我已经成功创建了另一个正好4个字符长度的文件。\n\n文件名：`file4.txt`",
            },
            created_at: "2026-06-24T07:19:32.000Z",
          }),
          ledgerEvent({
            seq: 121,
            session_id: conversationId,
            conversation_id: conversationId,
            turn_id: finalTurnId,
            active_request_id: finalRequestId,
            part_id: `${finalTurnId}:output_file:file4`,
            part_type: "output_file",
            event_type: "part.replace",
            operation: "replace",
            text: "",
            payload: {
              source_kind: "process.step",
              process_step: {
                step_code: "output_files",
                status: "completed",
                data: { files: [file4] },
              },
            },
            created_at: "2026-06-24T07:19:34.000Z",
          }),
        ],
      });

      const rows = builder(
        [
          {
            id: `${conversationId}:user:313`,
            sessionId: conversationId,
            role: "user",
            content: "创建一个长度为4个字符的文件",
            createdAt: "2026-06-24T07:18:00.000Z",
          } as any,
          {
            id: `${conversationId}:assistant:314`,
            sessionId: conversationId,
            role: "assistant",
            content: "✅ 任务完成！文件名：`4chars.txt`",
            createdAt: "2026-06-24T07:18:08.000Z",
          } as any,
          {
            id: `${conversationId}:user:317`,
            sessionId: conversationId,
            role: "user",
            content: "创建一个长度为4个字符的文件",
            createdAt: "2026-06-24T07:19:00.000Z",
          } as any,
          {
            id: `${conversationId}:assistant:318`,
            sessionId: conversationId,
            role: "assistant",
            content: "让我验证文件内容并更新输出产物清单。",
            createdAt: "2026-06-24T07:19:08.000Z",
          } as any,
          {
            id: `${conversationId}:user:323`,
            sessionId: conversationId,
            role: "user",
            content: "创建一个长度为4个字符的文件",
            createdAt: "2026-06-24T07:19:25.000Z",
          } as any,
          {
            id: `${conversationId}:assistant:324`,
            sessionId: conversationId,
            role: "assistant",
            content: "✅ 任务完成！我已经成功创建了另一个正好4个字符长度的文件。\n\n文件名：`file4.txt`",
            createdAt: "2026-06-24T07:19:32.000Z",
          } as any,
        ],
        conversationId,
        "agent-1",
        events,
        { canonicalOnly: true }
      );

      expect(rows.map((row: any) => row.id)).toEqual([
        `${conversationId}:assistant:314`,
        `${conversationId}:assistant:324`,
      ]);
      expect(rows[0].answer).toContain("4chars.txt");
      expect(rows[1].answer).toContain("file4.txt");
      expect(rows[1].answer).toContain("任务完成");
      expect(rows[1].answer).not.toBe("让我验证文件内容并更新输出产物清单。");
      expect(rows[1].openclawProjection.outputFiles).toEqual([
        expect.objectContaining({
          file_name: "file4.txt",
          preview_url: "/api/preview/preview-file4",
        }),
      ]);
    }
  );

  it("keeps repeated streaming tool calls separate when input and output arrive late", () => {
    const activities = buildOpenClawActivities([
      {
        id: "tool-call-newyork",
        sessionId: "agent:main:dashboard:test",
        seq: 1679,
        kind: "tool.call",
        payload: { data: { name: "exec" } },
        createdAt: "2026-06-09T13:24:05.000Z",
      },
      {
        id: "tool-call-new-york",
        sessionId: "agent:main:dashboard:test",
        seq: 1680,
        kind: "tool.call",
        payload: { data: { name: "exec" } },
        createdAt: "2026-06-09T13:24:16.000Z",
      },
      {
        id: "tool-call-nyc",
        sessionId: "agent:main:dashboard:test",
        seq: 1684,
        kind: "tool.call",
        payload: { data: { name: "exec", toolCallId: "call-nyc" } },
        createdAt: "2026-06-09T13:24:59.000Z",
      },
      {
        id: "tool-call-nyc-duplicate",
        sessionId: "agent:main:dashboard:test",
        seq: 1685,
        kind: "tool.call",
        payload: { data: { name: "exec", toolCallId: "call-nyc" } },
        createdAt: "2026-06-09T13:25:00.000Z",
      },
    ] as any);

    expect(activities.map((item: any) => item.key)).toEqual([
      "tool-call-newyork",
      "tool-call-new-york",
      "tool-call-nyc-duplicate",
    ]);

    const timelineItems = mergeOpenClawTimelineItems(
      [],
      activities.map((activity: any) => buildOpenClawTimelineItemFromActivity(activity))
    );
    expect(timelineItems.map((item: any) => item.key)).toEqual([
      "tool-call-newyork",
      "tool-call-new-york",
      "tool-call-nyc-duplicate",
    ]);
  });

  it("does not collapse different tool calls that accidentally share the same OpenClaw segment id", () => {
    const message = {
      id: "assistant-new-york-segments",
      question: "今天纽约天气怎么样？",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      openclawActivities: [],
    } as any;
    const turnId = "agent:main:dashboard:test:turn:new-york-weather";
    const sharedSegmentId = `${turnId}:tool_call:exec`;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "tool-call-newyork",
          sessionId: "agent:main:dashboard:test",
          seq: 1671,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              toolCallId: "chatcmpl-tool-newyork",
              args: { command: 'curl -s "wttr.in/NewYork?1"' },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: sharedSegmentId,
              segment_type: "tool_call",
              segment_index: 1,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T13:24:05.000Z",
        },
        {
          id: "tool-call-new-york",
          sessionId: "agent:main:dashboard:test",
          seq: 1680,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              toolCallId: "chatcmpl-tool-new-york",
              args: { command: 'curl -s "wttr.in/New_York?1"' },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: sharedSegmentId,
              segment_type: "tool_call",
              segment_index: 1,
              delta_index: 1,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T13:24:16.000Z",
        },
        {
          id: "tool-call-nyc",
          sessionId: "agent:main:dashboard:test",
          seq: 1685,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              toolCallId: "call-nyc",
              args: { command: 'curl -s "wttr.in/NYC?1"' },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: sharedSegmentId,
              segment_type: "tool_call",
              segment_index: 1,
              delta_index: 2,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T13:24:59.000Z",
        },
      ],
    });

    const toolCalls = message.openclawTimelineItems.filter((item: any) => item.type === "tool_call");
    expect(toolCalls.map((item: any) => item.tool.input)).toEqual([
      expect.stringContaining('wttr.in/NewYork?1'),
      expect.stringContaining('wttr.in/New_York?1'),
      expect.stringContaining('wttr.in/NYC?1'),
    ]);
  });

  it("folds protocol answer snapshots without segment ids into the primary answer segment", () => {
    const message = {
      id: "assistant-answer-snapshots",
      question: "请查询纽约天气",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      openclawActivities: [],
    } as any;
    const turnId = "agent:main:dashboard:test:turn:answer-snapshots";
    const answerSegmentId = `${turnId}:answer:0`;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-1",
          sessionId: "agent:main:dashboard:test",
          seq: 10,
          kind: "assistant.thinking",
          payload: {
            content: "Need to check the weather.",
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: `${turnId}:thinking:10`,
              segment_type: "thinking",
              segment_index: 0,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T15:47:00.000Z",
        },
        {
          id: "answer-intro",
          sessionId: "agent:main:dashboard:test",
          seq: 11,
          kind: "assistant.message",
          payload: {
            content: "我来查询纽约天气。",
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: answerSegmentId,
              segment_type: "answer",
              segment_index: 1,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T15:47:01.000Z",
        },
        {
          id: "tool-call-1",
          sessionId: "agent:main:dashboard:test",
          seq: 12,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              toolCallId: "call-nyc",
              args: { command: 'curl -s "wttr.in/NYC?1"' },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: `${turnId}:tool_call:call-nyc`,
              segment_type: "tool_call",
              segment_index: 2,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T15:47:02.000Z",
        },
        {
          id: "tool-result-1",
          sessionId: "agent:main:dashboard:test",
          seq: 13,
          kind: "tool.result",
          payload: {
            data: {
              name: "exec",
              toolCallId: "call-nyc",
              result: { output: "NYC: Sunny, 17C" },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: `${turnId}:tool_result:call-nyc`,
              segment_type: "tool_result",
              segment_index: 3,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T15:47:03.000Z",
        },
        {
          id: "answer-snapshot-without-segment",
          sessionId: "agent:main:dashboard:test",
          seq: 14,
          kind: "assistant.message",
          payload: {
            content: "纽约今天晴朗，约 17°C。",
          },
          createdAt: "2026-06-09T15:47:04.000Z",
        },
      ],
    });

    const answerItems = message.openclawTimelineItems.filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toBe("纽约今天晴朗，约 17°C。");
    expect(message.openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "answer",
    ]);
  });

  it("keeps every New York weather tool call in history replay", () => {
    const sessionId = "agent:main:dashboard:test";
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:test:user:82",
          sessionId,
          role: "user",
          content: "搜索十部电影并总结",
          createdAt: "2026-06-09T13:10:00.000Z",
          __openclaw: { seq: 82 },
        } as any,
        {
          id: "agent:main:dashboard:test:assistant:84",
          sessionId,
          role: "assistant",
          content: "这里是十部电影总结。",
          createdAt: "2026-06-09T13:10:20.000Z",
          __openclaw: { seq: 84 },
        } as any,
        {
          id: "agent:main:dashboard:test:user:118",
          sessionId,
          role: "user",
          content: "生成一个40字的文档",
          createdAt: "2026-06-09T13:20:00.000Z",
          __openclaw: { seq: 118 },
        } as any,
        {
          id: "agent:main:dashboard:test:assistant:120",
          sessionId,
          role: "assistant",
          content: "已生成40字文档。",
          createdAt: "2026-06-09T13:20:20.000Z",
          __openclaw: { seq: 120 },
        } as any,
        {
          id: "agent:main:dashboard:test:user:1666",
          sessionId,
          role: "user",
          content: "今天纽约天气怎么样？",
          createdAt: "2026-06-09T13:23:29.000Z",
          __openclaw: { seq: 160 },
        } as any,
        {
          id: "agent:main:dashboard:test:assistant:1671",
          sessionId,
          role: "assistant",
          content: "今天纽约市天气有雨，气温温暖。",
          createdAt: "2026-06-09T13:25:20.000Z",
          __openclaw: { seq: 167 },
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: `${sessionId}:history:161:thinking`,
          sessionId,
          seq: 1610,
          kind: "assistant.thinking",
          payload: { content: "First try NewYork, then verify whether it maps to New York City.", rawSeq: 161 },
          createdAt: "2026-06-09T13:24:04.000Z",
        } as any,
        {
          id: `${sessionId}:history:161:tool-call:chatcmpl-tool-newyork`,
          sessionId,
          seq: 1611,
          kind: "tool.call",
          payload: {
            rawSeq: 21,
            data: {
              name: "exec",
              toolCallId: "chatcmpl-tool-newyork",
              args: { command: 'curl -s "wttr.in/NewYork?1"' },
            },
          },
          createdAt: "2026-06-09T13:24:05.000Z",
        } as any,
        {
          id: `${sessionId}:history:162:tool-result:chatcmpl-tool-newyork`,
          sessionId,
          seq: 1620,
          kind: "tool.result",
          payload: {
            rawSeq: 25,
            data: {
              name: "exec",
              toolCallId: "chatcmpl-tool-newyork",
              result: { output: "NewYork: ambiguous place result" },
            },
          },
          createdAt: "2026-06-09T13:24:07.000Z",
        } as any,
        {
          id: `${sessionId}:history:163:thinking`,
          sessionId,
          seq: 1630,
          kind: "assistant.thinking",
          payload: { content: "NewYork is ambiguous, try New_York next.", rawSeq: 163 },
          createdAt: "2026-06-09T13:24:15.000Z",
        } as any,
        {
          id: `${sessionId}:history:163:tool-call:chatcmpl-tool-new-york`,
          sessionId,
          seq: 1631,
          kind: "tool.call",
          payload: {
            rawSeq: 83,
            data: {
              name: "exec",
              toolCallId: "chatcmpl-tool-new-york",
              args: { command: 'curl -s "wttr.in/New_York?1"' },
            },
          },
          createdAt: "2026-06-09T13:24:16.000Z",
        } as any,
        {
          id: `${sessionId}:history:164:tool-result:chatcmpl-tool-new-york`,
          sessionId,
          seq: 1640,
          kind: "tool.result",
          payload: {
            rawSeq: 87,
            data: {
              name: "exec",
              toolCallId: "chatcmpl-tool-new-york",
              result: { output: "New_York: New York City forecast" },
            },
          },
          createdAt: "2026-06-09T13:24:18.000Z",
        } as any,
        {
          id: `${sessionId}:history:165:thinking`,
          sessionId,
          seq: 1650,
          kind: "assistant.thinking",
          payload: { content: "New_York is still wrong, try NYC next.", rawSeq: 165 },
          createdAt: "2026-06-09T13:24:58.000Z",
        } as any,
        {
          id: `${sessionId}:history:165:tool-call:call-nyc`,
          sessionId,
          seq: 1651,
          kind: "tool.call",
          payload: {
            rawSeq: 119,
            data: {
              name: "exec",
              toolCallId: "call-nyc",
              args: { command: 'curl -s "wttr.in/NYC?1"' },
            },
          },
          createdAt: "2026-06-09T13:24:59.000Z",
        } as any,
        {
          id: `${sessionId}:history:166:tool-result:call-nyc`,
          sessionId,
          seq: 1660,
          kind: "tool.result",
          payload: {
            rawSeq: 123,
            data: {
              name: "exec",
              toolCallId: "call-nyc",
              result: { output: "NYC: final verified forecast" },
            },
          },
          createdAt: "2026-06-09T13:25:01.000Z",
        } as any,
        {
          id: `${sessionId}:thinking:1675`,
          sessionId,
          seq: 1675,
          kind: "assistant.thinking",
          payload: { content: "NewYork is ambiguous, try New_York next.", rawSeq: 163 },
          createdAt: "2026-06-09T13:25:10.000Z",
        } as any,
        {
          id: `${sessionId}:thinking:1682`,
          sessionId,
          seq: 1682,
          kind: "assistant.thinking",
          payload: { content: "New_York is still wrong, try NYC next.", rawSeq: 165 },
          createdAt: "2026-06-09T13:25:12.000Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(3);
    expect(rows[0].openclawTimelineItems.some((item: any) => String(item.tool?.input || "").includes("New_York"))).toBe(false);
    expect(rows[1].openclawTimelineItems.some((item: any) => String(item.tool?.input || "").includes("NYC"))).toBe(false);

    const weatherRow = rows[2];
    expect(weatherRow.question).toBe("今天纽约天气怎么样？");
    const toolCalls = weatherRow.openclawTimelineItems.filter((item: any) => item.type === "tool_call");
    const toolResults = weatherRow.openclawTimelineItems.filter((item: any) => item.type === "tool_result");
    expect(toolCalls.map((item: any) => item.tool.input)).toEqual([
      expect.stringContaining('wttr.in/NewYork?1'),
      expect.stringContaining('wttr.in/New_York?1'),
      expect.stringContaining('wttr.in/NYC?1'),
    ]);
    expect(toolResults.map((item: any) => item.tool.output)).toEqual([
      "NewYork: ambiguous place result",
      "New_York: New York City forecast",
      "NYC: final verified forecast",
    ]);
    expect(weatherRow.openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "thinking",
      "tool_call",
      "tool_result",
      "thinking",
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(
      weatherRow.openclawTimelineItems.filter(
        (item: any) => item.type === "thinking" && item.content === "NewYork is ambiguous, try New_York next."
      )
    ).toHaveLength(1);
  });

  it("matches realtime final replacement with Events API history replay for a multi-tool turn", () => {
    const sessionId = "agent:main:dashboard:test";
    const finalEvents = [
      {
        id: "thinking-newyork",
        sessionId,
        seq: 1610,
        kind: "assistant.thinking",
        payload: { content: "First try NewYork, then verify whether it maps to New York City.", rawSeq: 161 },
        createdAt: "2026-06-09T13:24:04.000Z",
      },
      {
        id: "tool-call-newyork",
        sessionId,
        seq: 1611,
        kind: "tool.call",
        payload: {
          rawSeq: 161,
          data: {
            name: "exec",
            toolCallId: "chatcmpl-tool-newyork",
            args: { command: 'curl -s "wttr.in/NewYork?1"' },
          },
        },
        createdAt: "2026-06-09T13:24:05.000Z",
      },
      {
        id: "tool-result-newyork",
        sessionId,
        seq: 1620,
        kind: "tool.result",
        payload: {
          rawSeq: 162,
          data: {
            name: "exec",
            toolCallId: "chatcmpl-tool-newyork",
            result: { output: "NewYork: ambiguous place result" },
          },
        },
        createdAt: "2026-06-09T13:24:07.000Z",
      },
      {
        id: "thinking-new-york",
        sessionId,
        seq: 1630,
        kind: "assistant.thinking",
        payload: { content: "NewYork is ambiguous, try New_York next.", rawSeq: 163 },
        createdAt: "2026-06-09T13:24:15.000Z",
      },
      {
        id: "tool-call-new-york",
        sessionId,
        seq: 1631,
        kind: "tool.call",
        payload: {
          rawSeq: 163,
          data: {
            name: "exec",
            toolCallId: "chatcmpl-tool-new-york",
            args: { command: 'curl -s "wttr.in/New_York?1"' },
          },
        },
        createdAt: "2026-06-09T13:24:16.000Z",
      },
      {
        id: "tool-result-new-york",
        sessionId,
        seq: 1640,
        kind: "tool.result",
        payload: {
          rawSeq: 164,
          data: {
            name: "exec",
            toolCallId: "chatcmpl-tool-new-york",
            result: { output: "New_York: New York City forecast" },
          },
        },
        createdAt: "2026-06-09T13:24:18.000Z",
      },
      {
        id: "tool-call-nyc",
        sessionId,
        seq: 1651,
        kind: "tool.call",
        payload: {
          rawSeq: 165,
          data: {
            name: "exec",
            toolCallId: "call-nyc",
            args: { command: 'curl -s "wttr.in/NYC?1"' },
          },
        },
        createdAt: "2026-06-09T13:24:59.000Z",
      },
      {
        id: "tool-result-nyc",
        sessionId,
        seq: 1660,
        kind: "tool.result",
        payload: {
          rawSeq: 166,
          data: {
            name: "exec",
            toolCallId: "call-nyc",
            result: { output: "NYC: final verified forecast" },
          },
        },
        createdAt: "2026-06-09T13:25:01.000Z",
      },
      {
        id: "answer-final",
        sessionId,
        seq: 1671,
        kind: "assistant.message",
        payload: { content: "今天纽约市天气有雨，气温温暖。" },
        createdAt: "2026-06-09T13:25:20.000Z",
      },
      {
        id: "output-files-final",
        sessionId,
        seq: 1672,
        kind: "process.step",
        payload: {
          process_step: {
            step_code: "output_files",
            status: "completed",
            message: "生成文件",
            data: {
              files: [
                {
                  id: "weather-report",
                  file_name: "nyc-weather.md",
                  signed_download_url: "https://example.com/nyc-weather.md?sig=1",
                  mime_type: "text/markdown",
                },
              ],
            },
          },
        },
        createdAt: "2026-06-09T13:25:21.000Z",
      },
    ];
    const realtimeMessage = {
      id: "assistant-live",
      question: "今天纽约天气怎么样？",
      answer: "",
      role: "assistant",
      conversation_id: sessionId,
      openclawActivities: [],
    } as any;

    mergeOpenClawTimelineEventsIntoMessage(realtimeMessage, {
      events: [
        {
          id: "stream-thinking-newyork",
          sessionId,
          seq: 1675,
          kind: "assistant.thinking",
          payload: { content: "First try NewYork, then verify whether it maps to New York City." },
          createdAt: "2026-06-09T13:24:04.500Z",
        },
        {
          id: "stream-tool-call-empty-1",
          sessionId,
          seq: 1679,
          kind: "tool.call",
          payload: { data: { name: "exec" } },
          createdAt: "2026-06-09T13:24:05.500Z",
        },
        {
          id: "stream-tool-call-empty-2",
          sessionId,
          seq: 1680,
          kind: "tool.call",
          payload: { data: { name: "exec" } },
          createdAt: "2026-06-09T13:24:16.500Z",
        },
      ],
    });
    replaceOpenClawTurnWithTimelineEvents(realtimeMessage, { events: finalEvents });

    const historyRows = buildOpenClawMessages(
      [
        {
          id: "user-newyork",
          sessionId,
          role: "user",
          content: "今天纽约天气怎么样？",
          createdAt: "2026-06-09T13:23:29.000Z",
          __openclaw: { seq: 160 },
        } as any,
        {
          id: "assistant-newyork",
          sessionId,
          role: "assistant",
          content: "今天纽约市天气有雨，气温温暖。",
          createdAt: "2026-06-09T13:25:20.000Z",
          __openclaw: { seq: 167 },
        } as any,
      ],
      sessionId,
      2,
      finalEvents as any
    );

    expect(historyRows).toHaveLength(1);
    expect(summarizeTimelineItems(realtimeMessage.openclawTimelineItems)).toEqual(
      summarizeTimelineItems(historyRows[0].openclawTimelineItems)
    );
  });

  it("keeps one assistant row per user turn and removes reasoning leakage from final history messages", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:1",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "从网上找10本书并总结",
          createdAt: "2026-05-26T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:2",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "好的，我来搜索10本值得一读的好书并为你总结。",
          createdAt: "2026-05-26T10:00:01.000Z",
        } as any,
        {
          id: "agent:main:dashboard:tool:3",
          sessionId: "agent:main:dashboard:test",
          role: "tool",
          content: "tool result",
          createdAt: "2026-05-26T10:00:02.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:9",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content:
            "The user wants me to find 10 books from the web and summarize them.Search failed. Let me try a different query.网络连接有些问题，我直接基于知识库为你推荐10本经典好书并总结：",
          createdAt: "2026-05-26T10:00:09.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "event-thinking-1",
          sessionId: "agent:main:dashboard:test",
          seq: 2,
          kind: "assistant.thinking",
          payload: {
            content: "The user wants me to find 10 books from the web and summarize them.",
          },
          createdAt: "2026-05-26T10:00:01.500Z",
        } as any,
        {
          id: "event-thinking-2",
          sessionId: "agent:main:dashboard:test",
          seq: 3,
          kind: "assistant.thinking",
          payload: {
            content: "Search failed. Let me try a different query.",
          },
          createdAt: "2026-05-26T10:00:02.500Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].raw_assistant_message.id).toBe("agent:main:dashboard:assistant:9");
    expect(rows[0].answer).toBe("网络连接有些问题，我直接基于知识库为你推荐10本经典好书并总结：");
    expect(rows[0].answer).not.toContain("The user wants me");
    expect(rows[0].answer).not.toContain("Search failed");
    expect(rows[0].reasoning_content).toBe("");
    expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
      "The user wants me to find 10 books from the web and summarize them.",
      "Search failed. Let me try a different query.",
    ]);
  });

  for (const [builderName, buildMessages] of openClawMessageBuilders) {
    it(`keeps QClaw sender metadata envelopes inside the preceding Hub user turn (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "hub53ai-user-1",
            sessionId,
            role: "user",
            content: "1 验证URL会话绑定",
            createdAt: "2026-06-10T06:57:53.854Z",
          } as any,
          {
            id: "user-2443",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("1 验证URL会话绑定"),
            createdAt: "2026-06-10T06:57:54.369Z",
          } as any,
          {
            id: "assistant-2447",
            sessionId,
            role: "assistant",
            content: "✅ 收到！系统运行正常。",
            createdAt: "2026-06-10T06:57:54.438Z",
          } as any,
          {
            id: "assistant-2450",
            sessionId,
            role: "assistant",
            content: "✅ 收到！URL会话绑定验证测试通过。",
            createdAt: "2026-06-10T06:58:04.249Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "thinking-2446",
            sessionId,
            seq: 2446,
            kind: "assistant.thinking",
            payload: {
              content: "用户正在验证 URL 会话绑定。",
            },
            createdAt: "2026-06-10T06:57:54.438Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("1 验证URL会话绑定");
      expect(rows[0].message).not.toContain("Sender (untrusted metadata)");
      expect(rows[0].raw_user_message.id).toBe("hub53ai-user-1");
      expect(rows[0].raw_assistant_message.id).toBe("assistant-2450");
      expect(rows[0].answer).toContain("URL会话绑定验证测试通过");
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
        "用户正在验证 URL 会话绑定。",
      ]);
    });

    it(`recovers the prompt if history pagination starts at a sender metadata envelope (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "user-2467",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("测试"),
            createdAt: "2026-06-10T07:01:06.287Z",
          } as any,
          {
            id: "assistant-2472",
            sessionId,
            role: "assistant",
            content: "✅ 收到！系统运行正常。",
            createdAt: "2026-06-10T07:01:13.856Z",
          } as any,
        ],
        sessionId,
        2,
        []
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("测试");
      expect(rows[0].message).not.toContain("Sender (untrusted metadata)");
      expect(rows[0].answer).toBe("✅ 收到！系统运行正常。");
    });

    it(`keeps an out-of-order final answer under its matching Hub user turn (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const prompt = "回归测试 1781102292462 请只回复收到";
      const runId = "5534d8b5-c51c-4efe-b492-54c9a48e6e3c";
      const rows = buildMessages(
        [
          {
            id: "assistant-3200",
            sessionId,
            role: "assistant",
            content: "收到",
            createdAt: "2026-06-10T14:39:08.451Z",
          } as any,
          {
            id: "hub53ai-user-current",
            sessionId,
            role: "user",
            content: prompt,
            createdAt: "2026-06-10T14:38:12.359Z",
          } as any,
          {
            id: "user-3195",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope(prompt),
            createdAt: "2026-06-10T14:38:13.112Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "event-user-3192",
            sessionId,
            seq: 3192,
            kind: "user.message",
            payload: { content: prompt },
            createdAt: "2026-06-10T14:38:12.359Z",
          } as any,
          {
            id: "event-run-started-3194",
            sessionId,
            seq: 3194,
            kind: "run.started",
            payload: { runId },
            createdAt: "2026-06-10T14:38:13.000Z",
          } as any,
          {
            id: "event-delta-3197",
            sessionId,
            seq: 3197,
            kind: "assistant.delta",
            payload: { content: "收到", runId },
            createdAt: "2026-06-10T14:39:06.000Z",
          } as any,
          {
            id: "event-thinking-3198",
            sessionId,
            seq: 3198,
            kind: "assistant.thinking",
            payload: { content: "用户发送测试消息，要求只回复收到。", runId },
            createdAt: "2026-06-10T14:39:07.000Z",
          } as any,
          {
            id: "event-message-3200",
            sessionId,
            seq: 3200,
            kind: "assistant.message",
            payload: { content: "收到", runId },
            createdAt: "2026-06-10T14:39:08.451Z",
          } as any,
          {
            id: "event-run-completed-3201",
            sessionId,
            seq: 3201,
            kind: "run.completed",
            payload: { runId },
            createdAt: "2026-06-10T14:39:08.600Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe(prompt);
      expect(rows[0].message).not.toContain("Sender (untrusted metadata)");
      expect(rows[0].raw_user_message.id).toBe("hub53ai-user-current");
      expect(rows[0].raw_assistant_message.id).toBe("assistant-3200");
      expect(rows[0].answer).toBe("收到");
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).toContain(
        "用户发送测试消息，要求只回复收到。"
      );
    });

    it(`does not create blank sender rows when a previous Hub user has no assistant answer (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "hub53ai-user-1",
            sessionId,
            role: "user",
            content: "1",
            createdAt: "2026-06-10T06:54:03.095Z",
          } as any,
          {
            id: "user-2438",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope(),
            createdAt: "2026-06-10T06:54:03.634Z",
          } as any,
          {
            id: "hub53ai-user-2",
            sessionId,
            role: "user",
            content: "1 验证URL会话绑定",
            createdAt: "2026-06-10T06:57:53.854Z",
          } as any,
          {
            id: "user-2443",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("1 验证URL会话绑定"),
            createdAt: "2026-06-10T06:57:54.369Z",
          } as any,
          {
            id: "assistant-2447",
            sessionId,
            role: "assistant",
            content: "✅ 收到！系统运行正常。",
            createdAt: "2026-06-10T06:57:54.438Z",
          } as any,
        ],
        sessionId,
        2,
        []
      );

      expect(rows.map((row: any) => row.question)).toEqual(["1", "1 验证URL会话绑定"]);
      expect(rows.every((row: any) => row.question.trim())).toBe(true);
      expect(rows.every((row: any) => !row.message.includes("Sender (untrusted metadata)"))).toBe(true);
      expect(rows[0].answer).toBe("");
      expect(rows[1].answer).toBe("✅ 收到！系统运行正常。");
    });

    it(`recovers the user turn when a history page starts at assistant messages (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "assistant-912",
            sessionId,
            role: "assistant",
            content: "根据搜索结果，我为您整理出世界公认的十大名著。",
            createdAt: "2026-06-09T07:48:32.911Z",
          } as any,
          {
            id: "assistant-915",
            sessionId,
            role: "assistant",
            content: "根据搜索结果，我为您整理出世界公认的十大名著并进行详细总结。",
            createdAt: "2026-06-09T07:48:53.803Z",
          } as any,
          {
            id: "hub53ai-user-next",
            sessionId,
            role: "user",
            content: "搜索十部小说并总结",
            createdAt: "2026-06-09T07:50:33.148Z",
          } as any,
          {
            id: "user-920",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("搜索十部小说并总结"),
            createdAt: "2026-06-09T07:50:33.616Z",
          } as any,
          {
            id: "assistant-964",
            sessionId,
            role: "assistant",
            content: "根据搜索结果，我为您整理出十部经典小说并进行详细总结。",
            createdAt: "2026-06-09T07:51:39.475Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "previous-thinking",
            sessionId,
            seq: 845,
            kind: "assistant.thinking",
            payload: { content: "上一轮测试正在处理。" },
            createdAt: "2026-06-09T07:34:29.000Z",
          } as any,
          {
            id: "user-message-real",
            sessionId,
            seq: 847,
            kind: "user.message",
            payload: { content: "搜索十部名著并总结" },
            createdAt: "2026-06-09T07:48:21.233Z",
          } as any,
          {
            id: "user-message-sender",
            sessionId,
            seq: 850,
            kind: "user.message",
            payload: { content: senderMetadataEnvelope("搜索十部名著并总结") },
            createdAt: "2026-06-09T07:48:21.812Z",
          } as any,
          {
            id: "current-thinking",
            sessionId,
            seq: 852,
            kind: "assistant.thinking",
            payload: { content: "用户想要搜索十部名著并总结。" },
            createdAt: "2026-06-09T07:48:21.913Z",
          } as any,
        ]
      );

      expect(rows.map((row: any) => row.question)).toEqual([
        "搜索十部名著并总结",
        "搜索十部小说并总结",
      ]);
      expect(rows[0].raw_assistant_message.id).toBe("assistant-915");
      expect(rows[0].answer).toContain("详细总结");
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
        "用户想要搜索十部名著并总结。",
      ]);
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).not.toContain(
        "上一轮测试正在处理。"
      );
    });

    it(`keeps derived assistant fragments from replacing the full assistant answer (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "hub53ai-user-weather",
            sessionId,
            role: "user",
            content: "今天天气如何",
            createdAt: "2026-06-09T05:42:50.904Z",
          } as any,
          {
            id: "user-456",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("今天天气如何"),
            createdAt: "2026-06-09T05:42:51.533Z",
          } as any,
          {
            id: "assistant-471",
            sessionId,
            role: "assistant",
            content: "我来帮您查询当前的天气情况！今天上海的天气情况：多云，适合外出活动。",
            createdAt: "2026-06-09T05:43:05.078Z",
          } as any,
          {
            id: "assistant-derived-467",
            sessionId,
            role: "assistant",
            content: "适合外出活动。",
            createdAt: "2026-06-09T05:43:05.046Z",
          } as any,
        ],
        sessionId,
        2,
        []
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].raw_assistant_message.id).toBe("assistant-471");
      expect(rows[0].answer).toBe("我来帮您查询当前的天气情况！今天上海的天气情况：多云，适合外出活动。");
    });

    it(`does not merge assistant messages across terminal run boundaries (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "hub53ai-user-test",
            sessionId,
            role: "user",
            content: "1",
            createdAt: "2026-06-09T05:05:06.424Z",
          } as any,
          {
            id: "user-232",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("1"),
            createdAt: "2026-06-09T05:05:08.442Z",
          } as any,
          {
            id: "assistant-240",
            sessionId,
            role: "assistant",
            content: "收到！系统运行正常。",
            createdAt: "2026-06-09T05:05:11.496Z",
          } as any,
          {
            id: "assistant-249",
            sessionId,
            role: "assistant",
            content: "好，我来查找并总结10本好书。",
            createdAt: "2026-06-09T05:05:23.595Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "terminal-241",
            sessionId,
            seq: 241,
            kind: "run.completed",
            payload: {},
            createdAt: "2026-06-09T05:05:11.495Z",
          } as any,
          {
            id: "book-thinking-248",
            sessionId,
            seq: 248,
            kind: "assistant.thinking",
            payload: { content: "The user wants me to search the web for 10 books and summarize them." },
            createdAt: "2026-06-09T05:05:23.595Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(2);
      expect(rows[0].question).toBe("1");
      expect(rows[0].answer).toBe("收到！系统运行正常。");
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).not.toContain(
        "The user wants me to search the web for 10 books and summarize them."
      );
      expect(rows[1].question).toBe("");
      expect(rows[1].answer).toBe("好，我来查找并总结10本好书。");
      expect(rows[1].openclawActivities.map((item: any) => item.summary)).toContain(
        "The user wants me to search the web for 10 books and summarize them."
      );
    });

    it(`does not attach an older assistant message to a newer trailing user turn (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "user-10",
            sessionId,
            role: "user",
            content: "old prompt",
            createdAt: "2026-06-11T10:00:00.000Z",
          } as any,
          {
            id: "user-20",
            sessionId,
            role: "user",
            content: "new prompt after clearing",
            createdAt: "2026-06-11T10:01:00.000Z",
          } as any,
          {
            id: "assistant-11",
            sessionId,
            role: "assistant",
            content: "old assistant answer",
            createdAt: "2026-06-11T10:00:20.000Z",
          } as any,
        ],
        sessionId,
        2,
        []
      );

      expect(rows).toHaveLength(2);
      expect(rows[0].question).toBe("old prompt");
      expect(rows[0].answer).toBe("");
      expect(rows[1].question).toBe("new prompt after clearing");
      expect(rows[1].answer).toBe("");
      expect(rows[1].openclawTurn.status).toBe("completed");
      expect(rows[1].openclawProjection.isStreaming).toBe(false);
    });

    it(`does not let previous raw timeline events override a later persisted assistant answer (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const oldPrompt = "ledger interrupt smoke";
      const oldAnswer = "Old answer from the previous request";
      const newPrompt = "Verify session state persists after refresh";
      const newAnswer = "1. Verify session state persists after refresh.\n2. Confirm loading is closed.";
      const rows = buildMessages(
        [
          {
            id: "hub53ai-user-old",
            sessionId,
            role: "user",
            content: oldPrompt,
            createdAt: "2026-06-11T11:44:57.205Z",
          } as any,
          {
            id: "user-4",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope(oldPrompt),
            createdAt: "2026-06-11T11:44:58.056Z",
          } as any,
          {
            id: "assistant-9",
            sessionId,
            role: "assistant",
            content: "I'll create a comprehensive 40-item numbered list for OpenClaw ledger interrupt smoke testing.",
            createdAt: "2026-06-11T11:44:58.122Z",
          } as any,
          {
            id: "assistant-90",
            sessionId,
            role: "assistant",
            content: "Completed the previous request and saved a file.",
            createdAt: "2026-06-11T11:45:14.426Z",
          } as any,
          {
            id: "assistant-93",
            sessionId,
            role: "assistant",
            content: oldAnswer,
            createdAt: "2026-06-11T11:45:21.590Z",
          } as any,
          {
            id: "hub53ai-user-new",
            sessionId,
            role: "user",
            content: newPrompt,
            createdAt: "2026-06-11T11:58:58.553Z",
          } as any,
          {
            id: "user-98",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope(newPrompt),
            createdAt: "2026-06-11T11:58:59.249Z",
          } as any,
          {
            id: "assistant-158",
            sessionId,
            role: "assistant",
            content: newAnswer,
            createdAt: "2026-06-11T11:59:17.702Z",
          } as any,
          {
            id: "assistant-159",
            sessionId,
            role: "assistant",
            content: newAnswer,
            createdAt: "2026-06-11T11:59:17.717Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: `${sessionId}:message:1`,
            sessionId,
            seq: 1,
            kind: "user.message",
            payload: { content: oldPrompt },
            createdAt: "2026-06-11T11:44:57.205Z",
          } as any,
          {
            id: `${sessionId}:thinking:8`,
            sessionId,
            seq: 8,
            kind: "assistant.thinking",
            payload: { content: "Thinking for the previous request" },
            createdAt: "2026-06-11T11:44:58.122Z",
          } as any,
          {
            id: `${sessionId}:message:93`,
            sessionId,
            seq: 93,
            kind: "assistant.message",
            payload: { content: oldAnswer },
            createdAt: "2026-06-11T11:45:21.590Z",
          } as any,
          {
            id: `${sessionId}:status:94`,
            sessionId,
            seq: 94,
            kind: "run.completed",
            payload: {},
            createdAt: "2026-06-11T11:45:21.590Z",
          } as any,
          {
            id: `${sessionId}:message:95`,
            sessionId,
            seq: 95,
            kind: "user.message",
            payload: { content: newPrompt },
            createdAt: "2026-06-11T11:58:58.665Z",
          } as any,
          {
            id: `${sessionId}:status:97`,
            sessionId,
            seq: 97,
            kind: "run.started",
            payload: {},
            createdAt: "2026-06-11T11:58:59.250Z",
          } as any,
          {
            id: `${sessionId}:message:98`,
            sessionId,
            seq: 98,
            kind: "user.message",
            payload: { content: senderMetadataEnvelope(newPrompt) },
            createdAt: "2026-06-11T11:58:59.249Z",
          } as any,
          {
            id: `${sessionId}:chat:100`,
            sessionId,
            seq: 100,
            kind: "assistant.delta",
            payload: { content: "1. Verify session state persists after refresh." },
            createdAt: "2026-06-11T11:59:06.000Z",
          } as any,
          {
            id: `${sessionId}:message:159`,
            sessionId,
            seq: 159,
            kind: "assistant.message",
            payload: { content: newAnswer },
            createdAt: "2026-06-11T11:59:17.717Z",
          } as any,
          {
            id: `${sessionId}:status:160`,
            sessionId,
            seq: 160,
            kind: "status.update",
            payload: { messageSeq: 6, status: "running" },
            createdAt: "2026-06-11T11:58:59.490Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(2);
      expect(rows[0].question).toBe(oldPrompt);
      expect(rows[0].answer).toBe(oldAnswer);
      expect(rows[1].question).toBe(newPrompt);
      expect(rows[1].answer).toBe(newAnswer);
      expect(rows[1].answer).not.toContain(oldAnswer);
      expect(rows[1].openclawTimelineItems.map((item: any) => item.content || item.summary || "")).not.toContain(
        "Thinking for the previous request"
      );
      expect(rows[1].openclawProjection.isStreaming).toBe(false);
    });

    it(`does not attach earlier ledger events to a newer user-only turn (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "user-20",
            sessionId,
            role: "user",
            content: "new prompt after clearing",
            createdAt: "2026-06-11T10:01:00.000Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "ledger-old-answer",
            sessionId,
            seq: 12,
            kind: "assistant.message",
            payload: {
              content: "old ledger answer",
              openclaw_ledger: {
                protocol_version: "openclaw.ledger.v1",
                seq: 12,
                session_id: sessionId,
                conversation_id: sessionId,
                turn_id: `${sessionId}:turn:old`,
                active_request_id: "old-request",
                part_id: `${sessionId}:turn:old:answer:0`,
                part_type: "answer",
                event_type: "part.replace",
                operation: "replace",
                visibility: "final",
                text: "old ledger answer",
                created_at: "2026-06-11T10:00:55.000Z",
              },
            },
            createdAt: "2026-06-11T10:00:55.000Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("new prompt after clearing");
      expect(rows[0].answer).toBe("");
      expect(rows[0].openclawTurn.events).toHaveLength(0);
      expect(rows[0].openclawTurn.status).toBe("completed");
    });

    it(`keeps one canonical ledger turn per projected message (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:multi-ledger-turn";
      const oldTurnId = `${sessionId}:turn:old`;
      const currentTurnId = `${sessionId}:turn:current`;
      const ledgerAnswer = (turnId: string, seq: number, text: string) => ({
        id: `${turnId}:answer:${seq}`,
        sessionId,
        seq,
        kind: "assistant.message",
        payload: {
          content: text,
          openclaw_ledger: {
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
            terminal_status: "completed",
            created_at: `2026-06-11T13:26:${seq === 202 ? "03" : "20"}.000Z`,
          },
        },
        createdAt: `2026-06-11T13:26:${seq === 202 ? "03" : "20"}.000Z`,
      });

      const rows = buildMessages(
        [
          {
            id: `${sessionId}:user:25`,
            sessionId,
            role: "user",
            content: "RUNNING-SWITCH-VERIFY sleep request",
            createdAt: "2026-06-11T13:25:55.000Z",
          } as any,
          {
            id: `${sessionId}:assistant:26`,
            sessionId,
            role: "assistant",
            content: "",
            createdAt: "2026-06-11T13:26:20.000Z",
          } as any,
        ],
        sessionId,
        9,
        [
          ledgerAnswer(oldTurnId, 202, "old answer from previous turn") as any,
          ledgerAnswer(currentTurnId, 432, "current answer from the matching turn") as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].answer).toBe("current answer from the matching turn");
      expect(rows[0].answer).not.toContain("old answer from previous turn");
      const ledgerTurnIds = new Set(
        rows[0].openclawTurn.events
          .map((event: any) => event.payload?.openclaw_ledger?.turn_id)
          .filter(Boolean)
      );
      expect([...ledgerTurnIds]).toEqual([currentTurnId]);
    });

    it(`keeps older sequenced thinking events out of newer user turns (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "hub53ai-user-new",
            sessionId,
            role: "user",
            content: "1",
            createdAt: "2026-06-10T06:31:00.000Z",
          } as any,
          {
            id: "user-2374",
            sessionId,
            role: "user",
            content: senderMetadataEnvelope("1"),
            createdAt: "2026-06-10T06:31:00.000Z",
          } as any,
          {
            id: "assistant-2381",
            sessionId,
            role: "assistant",
            content: "✅ 收到！系统运行正常。",
            createdAt: "2026-06-10T06:31:07.062Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "old-thinking-with-current-time",
            sessionId,
            seq: 258,
            kind: "assistant.thinking",
            payload: { content: "The search results have some good information." },
            createdAt: "2026-06-10T06:31:01.000Z",
          } as any,
          {
            id: "current-thinking",
            sessionId,
            seq: 2377,
            kind: "assistant.thinking",
            payload: { content: "The user is sending simple test messages." },
            createdAt: "2026-06-10T06:31:00.074Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
        "The user is sending simple test messages.",
      ]);
    });

    it(`uses history message seq instead of synthetic display seq when assigning events (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "agent:main:dashboard:test:user:239",
            sessionId,
            role: "user",
            content: "1",
            createdAt: "2026-06-10T04:01:42.006Z",
          } as any,
          {
            id: "agent:main:dashboard:test:assistant:240",
            sessionId,
            role: "assistant",
            content: "收到！系统运行正常。",
            createdAt: "2026-06-10T04:01:42.111Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "agent:main:dashboard:test:history:24:thinking",
            sessionId,
            seq: 240,
            kind: "assistant.thinking",
            payload: { content: "用户询问今天天气如何，我已经成功查询到了上海的天气情况。" },
            createdAt: "2026-06-10T04:01:42.111Z",
          } as any,
          {
            id: "agent:main:dashboard:test:thinking:240",
            sessionId,
            seq: 240,
            kind: "assistant.thinking",
            payload: { content: "The search results have some good information." },
            createdAt: "2026-06-10T04:01:42.111Z",
          } as any,
          {
            id: "agent:main:dashboard:test:history:240:thinking",
            sessionId,
            seq: 2400,
            kind: "assistant.thinking",
            payload: { content: "The user sent just \"1\"." },
            createdAt: "2026-06-10T04:01:42.111Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
        "The user sent just \"1\".",
      ]);
    });

    it(`does not attach old higher-seq events to a user-only history row (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "agent:main:dashboard:test:user:274",
            sessionId,
            role: "user",
            content: "测试",
            createdAt: "2026-06-10T07:10:00.000Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "agent:main:dashboard:test:thinking:433",
            sessionId,
            seq: 433,
            kind: "assistant.thinking",
            payload: { content: "The zhihu article is blocked." },
            createdAt: "2026-06-09T06:10:00.000Z",
          } as any,
          {
            id: "agent:main:dashboard:test:chat:2151",
            sessionId,
            seq: 2151,
            kind: "assistant.message",
            payload: { content: "旧的天气回答" },
            createdAt: "2026-06-09T06:10:30.000Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].question).toBe("测试");
      expect(rows[0].answer).toBe("");
      expect(rows[0].openclawTimelineItems || []).toEqual([]);
    });

    it(`keeps near-time events for a user-only in-flight history row (${builderName})`, () => {
      const sessionId = "agent:main:dashboard:test";
      const rows = buildMessages(
        [
          {
            id: "agent:main:dashboard:test:user:274",
            sessionId,
            role: "user",
            content: "测试",
            createdAt: "2026-06-10T07:10:00.000Z",
          } as any,
        ],
        sessionId,
        2,
        [
          {
            id: "agent:main:dashboard:test:thinking:433",
            sessionId,
            seq: 433,
            kind: "assistant.thinking",
            payload: { content: "The user sent a simple test message." },
            createdAt: "2026-06-10T07:10:01.000Z",
          } as any,
          {
            id: "agent:main:dashboard:test:chat:2151",
            sessionId,
            seq: 2151,
            kind: "assistant.message",
            payload: { content: "✅ 正常！" },
            createdAt: "2026-06-10T07:10:05.000Z",
          } as any,
        ]
      );

      expect(rows).toHaveLength(1);
      expect(rows[0].answer).toBe("✅ 正常！");
      expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
        "The user sent a simple test message.",
      ]);
    });
  }

  it("separates array-based OpenClaw reasoning blocks in history replay", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:1",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "从网上找资料",
          createdAt: "2026-05-26T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:2",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "我会整理资料并给出总结。",
          createdAt: "2026-05-26T10:00:03.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "event-thinking-array",
          sessionId: "agent:main:dashboard:test",
          seq: 2,
          kind: "assistant.thinking",
          payload: {
            content: [
              { text: "First block: search the web." },
              { text: "Second block: summarize the results." },
            ],
          },
          createdAt: "2026-05-26T10:00:01.500Z",
        } as any,
      ]
    );

    expect(rows[0].reasoning_content).toBe("");
    expect(rows[0].openclawActivities[0].summary).toBe(
      "First block: search the web.\n\nSecond block: summarize the results."
    );
  });

  it("maps thinking and tool timeline events to separate inline activity cards", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:1",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "从网上找资料",
          createdAt: "2026-05-26T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:8",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "我已完成资料整理。",
          createdAt: "2026-05-26T10:00:08.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "event-thinking-1",
          sessionId: "agent:main:dashboard:test",
          seq: 2,
          kind: "assistant.thinking",
          payload: { content: "Need to search first." },
          createdAt: "2026-05-26T10:00:01.000Z",
        } as any,
        {
          id: "event-thinking-2",
          sessionId: "agent:main:dashboard:test",
          seq: 3,
          kind: "assistant.thinking",
          payload: { content: "Search returned enough context." },
          createdAt: "2026-05-26T10:00:02.000Z",
        } as any,
        {
          id: "event-tool-call",
          sessionId: "agent:main:dashboard:test",
          seq: 4,
          kind: "tool.call",
          payload: {
            data: {
              name: "web_search",
              args: { query: "OpenClaw 53AI" },
            },
          },
          createdAt: "2026-05-26T10:00:03.000Z",
        } as any,
        {
          id: "event-tool-result",
          sessionId: "agent:main:dashboard:test",
          seq: 5,
          kind: "tool.result",
          payload: {
            data: {
              name: "web_search",
              result: { output: "Found 3 sources." },
            },
          },
          createdAt: "2026-05-26T10:00:04.000Z",
        } as any,
      ]
    );

    expect(rows[0].reasoning_content).toBe("");
    expect(rows[0].openclawActivities).toHaveLength(4);
    expect(rows[0].openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "assistant.thinking",
      "tool.call",
      "tool.result",
    ]);
    expect(rows[0].openclawActivities[0].summary).toBe("Need to search first.");
    expect(rows[0].openclawActivities[2].tool.displayName).toBe("Web Search");
    expect(rows[0].openclawActivities[2].tool.input).toContain("OpenClaw 53AI");
    expect(rows[0].openclawActivities[3].tool.output).toContain("Found 3 sources.");
  });

  it("maps OpenClaw output_files timeline events to the same assistant turn in history", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:1",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "搜索五部中国名著并保存为 txt",
          createdAt: "2026-06-05T09:48:45.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:48",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "已保存为 `/Users/y65ng/.qclaw/workspace/chinese_classics.txt`",
          createdAt: "2026-06-05T09:49:04.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "event-thinking",
          sessionId: "agent:main:dashboard:test",
          seq: 460,
          kind: "assistant.thinking",
          payload: {
            content: "先整理中国名著列表。",
          },
          createdAt: "2026-06-05T09:48:50.000Z",
        } as any,
        {
          id: "event-tool-call",
          sessionId: "agent:main:dashboard:test",
          seq: 461,
          kind: "tool.call",
          payload: {
            data: {
              name: "write",
              args: {
                path: "chinese_classics.txt",
              },
            },
          },
          createdAt: "2026-06-05T09:48:51.000Z",
        } as any,
        {
          id: "event-output-files",
          sessionId: "agent:main:dashboard:test",
          seq: 471,
          kind: "process.step",
          payload: {
            object: "process.step",
            process_step: {
              step_code: "output_files",
              status: "completed",
              message: "生成了 1 个文件",
              data: {
                files: [
                  {
                    id: "local-history-file",
                    file_name: "chinese_classics.txt",
                    mime_type: "text/plain",
                    size: 14,
                    preview_key: "chinese_classics.txt",
                    preview_url: "/api/preview/chinese_classics.txt",
                    download_url: "/api/messages/msg-4/files/local-history-file",
                    signed_download_url: "https://example.com/download/chinese_classics.txt?sig=1",
                    message_id: "msg-4",
                    source_kind: "ai_generated",
                    base64: Buffer.from("history output").toString("base64"),
                  },
                ],
              },
            },
          },
          createdAt: "2026-06-05T09:49:00.000Z",
        } as any,
        {
          id: "event-answer",
          sessionId: "agent:main:dashboard:test",
          seq: 481,
          kind: "assistant.message",
          payload: {
            content: "已保存为 `/Users/y65ng/.qclaw/workspace/chinese_classics.txt`",
          },
          createdAt: "2026-06-05T09:49:04.000Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toContain("chinese_classics.txt");
    expect(rows[0].process_records).toHaveLength(1);
    expect(rows[0].process_records[0]).toMatchObject({
      step_code: "output_files",
      status: "completed",
    });
    expect(rows[0].outputFiles).toEqual([
      expect.objectContaining({
        id: "local-history-file",
        file_name: "chinese_classics.txt",
        url: "/api/preview/chinese_classics.txt",
        preview_key: "chinese_classics.txt",
        preview_url: "/api/preview/chinese_classics.txt",
        download_url: "/api/messages/msg-4/files/local-history-file",
        signed_download_url: "https://example.com/download/chinese_classics.txt?sig=1",
        message_id: "msg-4",
        source_kind: "ai_generated",
      }),
    ]);
    expect(rows[0].openclawTimelineItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "thinking",
          seq: 460,
        }),
        expect.objectContaining({
          type: "tool_call",
          seq: 461,
        }),
        expect.objectContaining({
          type: "output_files",
          seq: 471,
          files: expect.arrayContaining([
            expect.objectContaining({
              preview_url: "/api/preview/chinese_classics.txt",
              download_url: "/api/messages/msg-4/files/local-history-file",
              signed_download_url: "https://example.com/download/chinese_classics.txt?sig=1",
            }),
          ]),
        }),
        expect.objectContaining({
          type: "answer",
          seq: 481,
        }),
      ])
    );
    expect(rows[0].openclawTimelineItems.map((item: any) => [item.type, item.seq])).toEqual([
      ["thinking", 460],
      ["tool_call", 461],
      ["output_files", 471],
      ["answer", 481],
    ]);
  });

  it("deduplicates repeated OpenClaw reasoning events in history replay", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:1",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "从网上找电影",
          createdAt: "2026-05-26T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:8",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "我已整理完成。",
          createdAt: "2026-05-26T10:00:08.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "event-thinking-1",
          sessionId: "agent:main:dashboard:test",
          seq: 2,
          kind: "assistant.thinking",
          payload: { content: "Let me try a different search approach." },
          createdAt: "2026-05-26T10:00:01.000Z",
        } as any,
        {
          id: "event-thinking-2",
          sessionId: "agent:main:dashboard:test",
          seq: 6,
          kind: "assistant.thinking",
          payload: { content: "Let me try a different search approach." },
          createdAt: "2026-05-26T10:00:03.000Z",
        } as any,
      ]
    );

    expect(rows[0].openclawActivities).toHaveLength(1);
    expect(rows[0].openclawActivities[0].seq).toBe(6);
    expect(rows[0].openclawActivities[0].summary).toBe("Let me try a different search approach.");
  });

  it("does not let OpenClaw status assistant messages replace the final answer in history replay", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:1",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "从网上找5部电影并总结",
          createdAt: "2026-05-26T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:12",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "网络访问暂时不可用，我可以基于已知信息推荐5部电影。",
          createdAt: "2026-05-26T10:00:08.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:13",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "⚙️ Reasoning visibility enabled.",
          createdAt: "2026-05-26T10:00:09.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      []
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toBe("网络访问暂时不可用，我可以基于已知信息推荐5部电影。");
    expect(rows[0].raw_assistant_message.id).toBe("agent:main:dashboard:assistant:12");
  });

  it("drops a same-turn weak live row when history replay has the final answer", () => {
    const sessionId = "agent:main:dashboard:test";
    const question = "明天广州天气如何";
    const finalAnswer =
      "广州明天天气预报：最高温度 37°C，最低温度 28°C，下午可能有小雨。体感温度仍然较高，请尽量待在室内并及时补充水分。早晚短暂外出也需要防晒，午后避免户外运动，并关注高温预警。";
    const weakLiveRow = {
      id: `${sessionId}:user:393`,
      conversation_id: sessionId,
      question,
      answer: "",
      loading: true,
      created_time: 1782308500000,
      updated_time: 1782308501000,
      _openclawTurnStartSeq: 393,
      raw_user_message: {
        id: `${sessionId}:user:393`,
        content: question,
        seq: 393,
      },
      openclawTurn: {
        turnKey: `${sessionId}:turn:393`,
        sessionId,
        status: "completed",
      },
    };
    const finalHistoryRow = {
      id: `${sessionId}:assistant:398`,
      conversation_id: sessionId,
      question,
      answer: finalAnswer,
      created_time: 1782308500000,
      updated_time: 1782308520000,
      _openclawTurnStartSeq: 393,
      raw_user_message: {
        id: `${sessionId}:user:393`,
        content: question,
        seq: 393,
      },
      raw_assistant_message: {
        id: `${sessionId}:assistant:398`,
        content: finalAnswer,
        seq: 398,
      },
    };

    const collapsed = collapseDuplicateOpenClawIntermediateRows([weakLiveRow, finalHistoryRow]);

    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].id).toBe(`${sessionId}:assistant:398`);
    expect(collapsed[0].answer).toContain("广州明天天气预报");
    expect(collapsed[0].loading).not.toBe(true);
  });

  it("drops named Hub tool placeholder thinking events when tool timeline events are present in history replay", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:100",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "今天天气如何",
          createdAt: "2026-06-08T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:112",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "**上海今天天气：** 晴，气温 31°C。",
          createdAt: "2026-06-08T10:00:12.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "thinking-1",
          sessionId: "agent:main:dashboard:test",
          seq: 101,
          kind: "assistant.thinking",
          payload: { content: "Used tool exec" },
          createdAt: "2026-06-08T10:00:01.000Z",
        } as any,
        {
          id: "tool-call-1",
          sessionId: "agent:main:dashboard:test",
          seq: 102,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              args: { command: "curl wttr.in/Shanghai" },
            },
          },
          createdAt: "2026-06-08T10:00:02.000Z",
        } as any,
        {
          id: "tool-result-1",
          sessionId: "agent:main:dashboard:test",
          seq: 103,
          kind: "tool.result",
          payload: {
            data: {
              name: "exec",
              result: { output: "Shanghai: sunny 31C" },
            },
          },
          createdAt: "2026-06-08T10:00:03.000Z",
        } as any,
        {
          id: "status-answer",
          sessionId: "agent:main:dashboard:test",
          seq: 104,
          kind: "assistant.message",
          payload: { content: "我需要检查一下天气信息。让我为您查询。" },
          createdAt: "2026-06-08T10:00:04.000Z",
        } as any,
        {
          id: "placeholder-answer",
          sessionId: "agent:main:dashboard:test",
          seq: 105,
          kind: "assistant.message",
          payload: { content: "NO_REPLY" },
          createdAt: "2026-06-08T10:00:05.000Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].answer).toBe("**上海今天天气：** 晴，气温 31°C。");
    expect(rows[0].openclawTimelineItems.filter((item: any) => item.type === "answer")).toHaveLength(1);
    expect(rows[0].openclawTimelineItems.map((item: any) => [item.type, item.seq])).toEqual([
      ["tool_call", 102],
      ["tool_result", 103],
      ["answer", 105],
    ]);
    expect(rows[0].openclawActivities.map((item: any) => item.summary)).not.toContain("Used tool exec");
    expect(rows[0].openclawTimelineItems.some((item: any) => item.content?.includes("NO_REPLY"))).toBe(false);
    expect(rows[0].openclawTimelineItems.some((item: any) => item.content?.includes("让我为您查询"))).toBe(false);
  });

  it("keeps tool result cards in history replay when protocol metadata mislabels them as answer segments", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:200",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "明天辽宁天气如何",
          createdAt: "2026-06-09T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:212",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "辽宁（沈阳）明天天气晴。",
          createdAt: "2026-06-09T10:00:12.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "thinking-200",
          sessionId: "agent:main:dashboard:test",
          seq: 201,
          kind: "assistant.thinking",
          payload: {
            content: "先查询沈阳天气，因为它是辽宁省省会。",
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: "agent:main:dashboard:test:turn:weather",
              segment_id: "agent:main:dashboard:test:turn:weather:thinking:0",
              segment_type: "thinking",
              segment_index: 0,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T10:00:01.000Z",
        } as any,
        {
          id: "tool-call-200",
          sessionId: "agent:main:dashboard:test",
          seq: 202,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              args: { command: "curl -s \"wttr.in/Shenyang?2\"" },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: "agent:main:dashboard:test:turn:weather",
              segment_id: "agent:main:dashboard:test:turn:weather:tool_call:exec",
              segment_type: "tool_call",
              segment_index: 1,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T10:00:02.000Z",
        } as any,
        {
          id: "tool-result-200",
          sessionId: "agent:main:dashboard:test",
          seq: 203,
          kind: "tool.result",
          payload: {
            data: {
              name: "exec",
              result: {
                output: "Shenyang: sunny 25C",
              },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: "agent:main:dashboard:test:turn:weather",
              segment_id: "agent:main:dashboard:test:turn:weather:answer:0",
              segment_type: "answer",
              segment_index: 2,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          createdAt: "2026-06-09T10:00:03.000Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
    ]);
    expect(rows[0].openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(rows[0].openclawActivities[2].tool.output).toContain("Shenyang: sunny 25C");
  });

  it("uses message raw seq metadata instead of event-level ids when attaching history tool events to the latest assistant turn", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:test:user:1617",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "今天深圳天气怎么样？",
          createdAt: "2026-06-09T13:02:21.000Z",
          __openclaw: { seq: 156 },
        } as any,
        {
          id: "agent:main:dashboard:test:assistant:1661",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "深圳今天上午有阵雨，气温炎热，记得带伞+防暑！",
          createdAt: "2026-06-09T13:02:22.000Z",
          __openclaw: { seq: 159 },
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "thinking-1619",
          sessionId: "agent:main:dashboard:test",
          seq: 1619,
          kind: "assistant.thinking",
          payload: { content: "Need Shenzhen weather first.", rawSeq: 157 },
          createdAt: "2026-06-09T13:02:22.000Z",
        } as any,
        {
          id: "tool-call-1621",
          sessionId: "agent:main:dashboard:test",
          seq: 1621,
          kind: "tool.call",
          payload: {
            rawSeq: 157,
            data: {
              name: "exec",
              args: { command: "curl -s \"wttr.in/Shenzhen?1\"" },
            },
          },
          createdAt: "2026-06-09T13:02:46.000Z",
        } as any,
        {
          id: "tool-result-1623",
          sessionId: "agent:main:dashboard:test",
          seq: 1623,
          kind: "tool.result",
          payload: {
            rawSeq: 158,
            data: {
              name: "exec",
              result: { output: "Shenzhen: shower, 28C" },
            },
          },
          createdAt: "2026-06-09T13:02:47.000Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
    ]);
    expect(rows[0].openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(rows[0].openclawActivities[1].tool.input).toContain("wttr.in/Shenzhen?1");
    expect(rows[0].openclawActivities[2].tool.output).toContain("Shenzhen: shower, 28C");
  });

  it("keeps timeline events bounded by the next user turn when a turn has no assistant message", () => {
    const rows = buildOpenClawMessages(
      [
        {
          id: "agent:main:dashboard:user:10",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "帮我设置一个 no-op",
          createdAt: "2026-05-27T10:00:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:user:30",
          sessionId: "agent:main:dashboard:test",
          role: "user",
          content: "帮我设置另一个 no-op",
          createdAt: "2026-05-27T10:01:00.000Z",
        } as any,
        {
          id: "agent:main:dashboard:assistant:40",
          sessionId: "agent:main:dashboard:test",
          role: "assistant",
          content: "第二个任务已创建。",
          createdAt: "2026-05-27T10:01:20.000Z",
        } as any,
      ],
      "agent:main:dashboard:test",
      2,
      [
        {
          id: "first-thinking",
          sessionId: "agent:main:dashboard:test",
          seq: 12,
          kind: "assistant.thinking",
          payload: { content: "第一轮正在检查 taskflow。" },
          createdAt: "2026-05-27T10:00:10.000Z",
        } as any,
        {
          id: "second-thinking",
          sessionId: "agent:main:dashboard:test",
          seq: 32,
          kind: "assistant.thinking",
          payload: { content: "第二轮正在检查 taskflow。" },
          createdAt: "2026-05-27T10:01:10.000Z",
        } as any,
        {
          id: "second-tool",
          sessionId: "agent:main:dashboard:test",
          seq: 34,
          kind: "tool.call",
          payload: { data: { name: "exec", args: { command: "openclaw cron add" } } },
          createdAt: "2026-05-27T10:01:12.000Z",
        } as any,
      ]
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].openclawActivities.map((item: any) => item.summary)).toEqual([
      "第一轮正在检查 taskflow。",
    ]);
    expect(rows[1].openclawActivities.map((item: any) => item.summary)).toContain(
      "第二轮正在检查 taskflow。"
    );
    expect(rows[1].openclawActivities.map((item: any) => item.kind)).toContain("tool.call");
  });

  it.each(openClawMessageBuilders)(
    "projects canonical ledger answer turns without seq-window guessing in %s builder",
    (_name, builder) => {
      const sessionId = "agent:main:dashboard:test";
      const messages = [
        {
          id: `${sessionId}:user:1`,
          sessionId,
          role: "user",
          content: "测试",
          createdAt: "2026-06-11T15:55:00.000Z",
        },
        {
          id: `${sessionId}:assistant:2`,
          sessionId,
          role: "assistant",
          content: "legacy answer should not be required",
          createdAt: "2026-06-11T15:55:03.000Z",
        },
        {
          id: `${sessionId}:user:3`,
          sessionId,
          role: "user",
          content: "1",
          createdAt: "2026-06-11T15:56:00.000Z",
        },
        {
          id: `${sessionId}:assistant:4`,
          sessionId,
          role: "assistant",
          content: "legacy answer should not be required",
          createdAt: "2026-06-11T15:56:03.000Z",
        },
      ] as any[];

      const ledgerTimelineEvent = (
        seq: number,
        runId: string,
        turnIndex: number,
        partType: "status" | "answer",
        eventType: "turn.started" | "part.replace" | "turn.completed",
        text = ""
      ) => {
        const turnId = `${sessionId}:turn:history:${runId}`;
        const partId = partType === "answer" ? `${turnId}:answer:0` : `${turnId}:status`;
        const ledger = {
          protocol_version: "openclaw.ledger.v1",
          seq,
          session_id: sessionId,
          conversation_id: sessionId,
          turn_id: turnId,
          run_id: runId,
          active_request_id: `history:${runId}`,
          part_id: partId,
          part_type: partType,
          event_type: eventType,
          operation: eventType === "turn.completed" ? "close" : eventType === "turn.started" ? "noop" : "replace",
          visibility: "final",
          ...(text ? { text } : {}),
          ...(eventType === "turn.started" ? { terminal_status: "running" } : {}),
          ...(eventType === "turn.completed" ? { terminal_status: "completed" } : {}),
          created_at: `2026-06-11T15:5${turnIndex}:0${seq % 10}.000Z`,
          raw_event_ref: `${sessionId}:${seq}:event:${seq}`,
        };
        return {
          id: ledger.raw_event_ref,
          sessionId,
          seq,
          kind:
            eventType === "turn.started"
              ? "run.started"
              : eventType === "turn.completed"
                ? "run.completed"
                : "assistant.message",
          payload: {
            content: text,
            openclaw_ledger: ledger,
          },
          createdAt: ledger.created_at,
        };
      };

      const events = [
        ledgerTimelineEvent(10, "run-one", 5, "status", "turn.started"),
        ledgerTimelineEvent(15, "run-one", 5, "answer", "part.replace", "收到测试消息。"),
        ledgerTimelineEvent(16, "run-one", 5, "status", "turn.completed"),
        ledgerTimelineEvent(20, "run-two", 6, "status", "turn.started"),
        ledgerTimelineEvent(27, "run-two", 6, "answer", "part.replace", "收到 \"1\"。"),
        ledgerTimelineEvent(28, "run-two", 6, "status", "turn.completed"),
      ] as any[];

      const rows = builder(messages, sessionId, 2, events, { canonicalOnly: true });

      expect(rows).toHaveLength(2);
      expect(rows.map((row: any) => row.answer)).toEqual(["收到测试消息。", "收到 \"1\"。"]);
      expect(rows.map((row: any) => row.openclawProjection?.visibleAnswer)).toEqual(["收到测试消息。", "收到 \"1\"。"]);
    }
  );

  it("does not merge timeline events from another OpenClaw session into a message", () => {
    const message = {
      id: "assistant-a",
      question: "A",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:session-a",
      openclawActivities: [],
    } as any;

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-b",
          sessionId: "agent:main:session-b",
          seq: 2,
          kind: "assistant.thinking",
          payload: { content: "另一个会话的思考过程" },
          createdAt: "2026-05-27T10:00:01.000Z",
        },
      ],
    });

    expect(changed).toBe(false);
    expect(message.openclawActivities).toEqual([]);
  });

  it("does not merge timeline events without a session id into an explicit OpenClaw conversation", () => {
    const message = {
      id: "assistant-a",
      question: "A",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:session-a",
      openclawActivities: [],
    } as any;

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-without-session",
          seq: 10,
          kind: "assistant.thinking",
          payload: { content: "Old reasoning from another conversation." },
          createdAt: "2026-05-27T10:00:01.000Z",
        },
      ],
    });

    expect(changed).toBe(false);
    expect(message.openclawActivities).toEqual([]);
  });

  it("preserves earlier streaming thinking cards when final events replace the turn", () => {
    const message = {
      id: "assistant-a",
      question: "今天纽约天气怎么样？",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      openclawActivities: [],
    } as any;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-newyork-ambiguous",
          sessionId: "agent:main:dashboard:test",
          seq: 1675,
          kind: "assistant.thinking",
          payload: { content: "NewYork may not resolve to New York City, so I need to verify the location." },
          createdAt: "2026-06-09T13:24:16.000Z",
        },
        {
          id: "thinking-nyc-confirmed",
          sessionId: "agent:main:dashboard:test",
          seq: 1682,
          kind: "assistant.thinking",
          payload: { content: "NYC resolves to New York City; now I can answer with the weather." },
          createdAt: "2026-06-09T13:25:00.000Z",
        },
      ],
    });

    const changed = replaceOpenClawTurnWithTimelineEvents(
      message,
      {
        events: [
          {
            id: "thinking-nyc-confirmed-final",
            sessionId: "agent:main:dashboard:test",
            seq: 1710,
            kind: "assistant.thinking",
            payload: { content: "NYC resolves to New York City; now I can answer with the weather." },
            createdAt: "2026-06-09T13:25:10.000Z",
          },
          {
            id: "answer-final",
            sessionId: "agent:main:dashboard:test",
            seq: 1711,
            kind: "assistant.message",
            payload: { content: "纽约今天有阵雨，气温约 27°C。" },
            createdAt: "2026-06-09T13:25:11.000Z",
          },
        ],
      }
    );

    expect(changed).toBe(true);
    expect(message.openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "thinking",
      "answer",
    ]);
    expect(message.openclawTimelineItems.map((item: any) => item.content || item.title)).toEqual([
      "NewYork may not resolve to New York City, so I need to verify the location.",
      "NYC resolves to New York City; now I can answer with the weather.",
      "纽约今天有阵雨，气温约 27°C。",
    ]);
  });

  it("preserves earlier streaming thinking cards during final replace even without tool events", () => {
    const message = {
      id: "assistant-no-tool",
      question: "解释一下这个概念",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      openclawActivities: [],
    } as any;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-first",
          sessionId: "agent:main:dashboard:test",
          seq: 10,
          kind: "assistant.thinking",
          payload: { content: "First reasoning block." },
          createdAt: "2026-06-09T13:00:00.000Z",
        },
        {
          id: "thinking-second",
          sessionId: "agent:main:dashboard:test",
          seq: 11,
          kind: "assistant.thinking",
          payload: { content: "Second reasoning block." },
          createdAt: "2026-06-09T13:00:01.000Z",
        },
      ],
    });

    replaceOpenClawTurnWithTimelineEvents(
      message,
      {
        events: [
          {
            id: "thinking-second-final",
            sessionId: "agent:main:dashboard:test",
            seq: 12,
            kind: "assistant.thinking",
            payload: { content: "Second reasoning block." },
            createdAt: "2026-06-09T13:00:02.000Z",
          },
          {
            id: "answer-final-no-tool",
            sessionId: "agent:main:dashboard:test",
            seq: 13,
            kind: "assistant.message",
            payload: { content: "Final answer." },
            createdAt: "2026-06-09T13:00:03.000Z",
          },
        ],
      }
    );

    expect(message.openclawTimelineItems.map((item: any) => item.type)).toEqual([
      "thinking",
      "thinking",
      "answer",
    ]);
    expect(message.openclawTimelineItems.map((item: any) => item.content || item.detail)).toEqual([
      "First reasoning block.",
      "Second reasoning block.",
      "Final answer.",
    ]);
  });

  it("treats replace-mode assistant.delta events as answer snapshots during final replace", () => {
    const message = {
      id: "assistant-delta-final",
      question: "今天天气如何",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      _openclawTurnStartSeq: 100,
      openclawActivities: [],
    } as any;

    const changed = replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "answer-delta-short",
          sessionId: "agent:main:dashboard:test",
          seq: 101,
          kind: "assistant.delta",
          mode: "replace",
          replace: true,
          payload: { content: "🌤️ 上海今日天气（6月9日，周二） 当前天气：多云" },
          createdAt: "2026-06-10T08:14:55.000Z",
        },
        {
          id: "answer-delta-full",
          sessionId: "agent:main:dashboard:test",
          seq: 102,
          kind: "assistant.delta",
          mode: "replace",
          replace: true,
          payload: {
            content:
              "🌤️ 上海今日天气（6月9日，周二） 当前天气：多云。白天气温 26-31°C，夜间有雾霾，建议注意补水。",
          },
          createdAt: "2026-06-10T08:14:56.000Z",
        },
        {
          id: "run-completed",
          sessionId: "agent:main:dashboard:test",
          seq: 103,
          kind: "run.completed",
          payload: {},
          createdAt: "2026-06-10T08:14:57.000Z",
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.answer).toContain("夜间有雾霾");
    expect(message.answer).not.toContain("多云🌤️");
    const answerItems = message.openclawTimelineItems.filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toBe(message.answer);
  });

  it("drops transient progress answers before later OpenClaw activities", () => {
    const message = {
      id: "assistant-transient-progress",
      question: "今天广州天气如何",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      openclawActivities: [],
    } as any;

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-weather",
          sessionId: "agent:main:dashboard:test",
          seq: 10,
          kind: "assistant.thinking",
          payload: { content: "Need to check Guangzhou weather." },
          createdAt: "2026-06-10T08:20:00.000Z",
        },
        {
          id: "ack-progress",
          sessionId: "agent:main:dashboard:test",
          seq: 11,
          kind: "assistant.message",
          payload: { content: "✅ 收到！\n\n系统运行正常，随时为您服务。😊" },
          createdAt: "2026-06-10T08:20:01.000Z",
        },
        {
          id: "tool-weather",
          sessionId: "agent:main:dashboard:test",
          seq: 12,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              toolCallId: "call-weather",
              args: { command: 'curl -s "wttr.in/Guangzhou?lang=zh"' },
            },
          },
          createdAt: "2026-06-10T08:20:02.000Z",
        },
        {
          id: "intro-progress",
          sessionId: "agent:main:dashboard:test",
          seq: 13,
          kind: "assistant.message",
          payload: { content: "我来查询广州今天的天气情况。" },
          createdAt: "2026-06-10T08:20:03.000Z",
        },
        {
          id: "thinking-after-tool",
          sessionId: "agent:main:dashboard:test",
          seq: 14,
          kind: "assistant.thinking",
          payload: { content: "Now summarize the weather result." },
          createdAt: "2026-06-10T08:20:04.000Z",
        },
        {
          id: "answer-final",
          sessionId: "agent:main:dashboard:test",
          seq: 15,
          kind: "assistant.message",
          payload: { content: "广州今天多云，当前约 29°C，夜间能见度会下降。" },
          createdAt: "2026-06-10T08:20:05.000Z",
        },
      ],
    });

    expect(message.answer).toBe("广州今天多云，当前约 29°C，夜间能见度会下降。");
    expect(message.answer).not.toContain("系统运行正常");
    expect(message.answer).not.toContain("我来查询");
    expect(message.openclawTimelineItems.filter((item: any) => item.type === "answer")).toHaveLength(1);
  });

  it("keeps a standalone status acknowledgement as the final OpenClaw answer", () => {
    const message = {
      id: "assistant-standalone-ack",
      question: "1",
      answer: "",
      role: "assistant",
      conversation_id: "agent:main:dashboard:test",
      openclawActivities: [],
    } as any;

    replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "thinking-ack",
          sessionId: "agent:main:dashboard:test",
          seq: 20,
          kind: "assistant.thinking",
          payload: { content: "The user is sending a simple test message." },
          createdAt: "2026-06-10T08:21:00.000Z",
        },
        {
          id: "answer-ack",
          sessionId: "agent:main:dashboard:test",
          seq: 21,
          kind: "assistant.message",
          payload: { content: "✅ 收到！系统运行正常。" },
          createdAt: "2026-06-10T08:21:01.000Z",
        },
        {
          id: "run-completed",
          sessionId: "agent:main:dashboard:test",
          seq: 22,
          kind: "run.completed",
          payload: {},
          createdAt: "2026-06-10T08:21:02.000Z",
        },
      ],
    });

    expect(message.answer).toBe("✅ 收到！系统运行正常。");
    expect(message.openclawTimelineItems.filter((item: any) => item.type === "answer")).toHaveLength(1);
  });
});
