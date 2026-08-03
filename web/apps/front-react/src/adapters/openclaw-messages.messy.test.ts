import { describe, expect, it } from "vitest";

import { buildOpenClawMessages as buildSharedOpenClawMessages } from "@km/shared-business/chat";
import { buildOpenClawMessages } from "./chat-adapters";

// 这些用例对应 packages/shared-business/src/chat/messages.txt 里观察到的真实数据形态。
// `messages.txt` 是 conversations/agent%3Amain%3Amain/messages?limit=30 的实际返回。
// 投影层应当把脏数据规整为可渲染的输出，下列用例固化"什么算干净"。

const openClawMessageBuilders = [
  ["front", buildOpenClawMessages],
  ["shared", buildSharedOpenClawMessages],
] as const;

const CONVERSATION_ID = "agent:main:main";
const AGENT_ID = 0;

/** 构造 ws-* 原始帧里的 user content：把整段 ChatCompletionRequest body JSON 化进 content */
function rawChatCompletionRequestBody(userText: string, clientMessageId: string) {
  return JSON.stringify({
    conversation_id: CONVERSATION_ID,
    frequency_penalty: 0,
    messages: [{ content: userText, role: "user" }],
    metadata: { openclaw_client_message_id: clientMessageId, openclaw_conversation_title: "当前会话" },
    model: "agent-p3EklV",
    presence_penalty: 0,
    request_source: "web",
    stream: true,
    temperature: 0,
    top_p: 0,
  });
}

describe("openclaw messages projection — ws-* raw frames", () => {
  it.each(openClawMessageBuilders)(
    "extracts user text from ws-* user frame whose content is a JSON-stringified ChatCompletionRequest in %s builder",
    (_name, builder) => {
      const userText = "✅ emoji 就是这个";
      const rows = builder(
        [
          {
            id: "ws-17150:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: rawChatCompletionRequestBody(userText, "1783045469416"),
            createdAt: 1783045469241,
          },
          {
            id: "ws-17150:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "收到 ✅。简单、干净。",
            createdAt: 1783045520367,
          },
        ] as any,
        CONVERSATION_ID,
        AGENT_ID,
        []
      );

      expect(rows).toHaveLength(1);
      // 现状：row.question 是整段 JSON，会断言失败
      expect(rows[0].question).toBe(userText);
      expect(rows[0].question).not.toContain("frequency_penalty");
      expect(rows[0].question).not.toContain("openclaw_client_message_id");
      expect(rows[0].answer).toBe("收到 ✅。简单、干净。");
    }
  );
});

describe("openclaw messages projection — legacy in-progress snapshots", () => {
  it.each(openClawMessageBuilders)(
    "drops legacy:* assistant snapshot with status=running and empty visibleAnswer in %s builder",
    (_name, builder) => {
      // messages.txt:549 legacy:4 — 一个未完成的旧 run 留下的快照
      const rows = builder(
        [
          {
            id: "turn:agent:main:main:legacy:4:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "你可以叫我政哥",
            createdAt: 1783057034481,
          },
          {
            id: "turn:agent:main:main:legacy:4:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "",
            createdAt: 1783057038452,
            payload: {
              openclawProjection: {
                activities: null,
                failed: false,
                interrupted: false,
                isStreaming: true,
                outputFiles: null,
                projection_version: "openclaw.message_projection.v1",
                request_id: "",
                seq: 15,
                seq_end: 15,
                seq_start: 15,
                status: "running",
                timelineItems: null,
                turn_id: "agent:main:main:legacy:4",
                visibleAnswer: "",
              },
              rawSeq: 15,
            },
          },
        ] as any,
        CONVERSATION_ID,
        AGENT_ID,
        []
      );

      // 现状：shouldKeepOpenClawMessageRow 让它通过（question 存在），断言失败
      expect(rows).toHaveLength(0);
    }
  );
});

describe("openclaw messages projection — orphan assistant arrives before its user", () => {
  it.each(openClawMessageBuilders)(
    "does not attach an orphan assistant to the previous turn when its user appears later in %s builder",
    (_name, builder) => {
      // 真实数据：messages.txt 中 legacy:3 之后是 turn:1783499340404 的 assistant 帧
      // 先到达（顺序错位），其 user 帧在后面。原实现按时间顺序挂载，会把
      // "收到，啥事？" 错挂到 legacy:3 的 user "行，就这样" 上。
      const rows = builder(
        [
          {
            id: "turn:agent:main:main:legacy:3:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "行，就这样",
            createdAt: 1783043713465,
          },
          {
            id: "turn:agent:main:main:legacy:3:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "得嘞 ✅ 身份定完，小小子正式上线。",
            createdAt: 1783499337928,
          },
          {
            id: "turn:agent:main:main:turn:1783499340404:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "收到，啥事？",
            createdAt: 1783580553704,
          },
          {
            id: "turn:agent:main:main:turn:1783499340404:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "1",
            createdAt: 1783499451869,
          },
        ] as any,
        CONVERSATION_ID,
        AGENT_ID,
        []
      );

      expect(rows).toHaveLength(2);
      const questions = rows.map((r: any) => r.question);
      const answers = rows.map((r: any) => r.answer);
      expect(questions).toEqual(["行，就这样", "1"]);
      // legacy:3 的回答必须是它自己的 "得嘞 ✅..."，不是 orphan 的 "收到，啥事？"
      expect(answers[0]).toBe("得嘞 ✅ 身份定完，小小子正式上线。");
      expect(answers[0]).not.toContain("收到，啥事？");
      // orphan assistant 应该挂回它自己的 user（"1"）
      expect(answers[1]).toBe("收到，啥事？");
    }
  );
});

describe("openclaw messages projection — repeated user input across turns", () => {
  it.each(openClawMessageBuilders)(
    "keeps both turns when identical user input produces identical assistant reply in different turn_ids in %s builder",
    (_name, builder) => {
      // 用户发两次 "1"，模型都答 "收到，啥事？"，但 turn_id 不同。
      // 数据层应当保留两条独立 row，不在投影里去重。
      const rows = builder(
        [
          {
            id: "turn:agent:main:main:turn:1783057133648:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "1",
            createdAt: 1783043713465,
            payload: { rawSeq: 1 },
          },
          {
            id: "turn:agent:main:main:turn:1783057133648:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "收到，啥事？",
            createdAt: 1784255366708,
            payload: {
              openclawProjection: {
                seq: 281,
                seq_end: 281,
                seq_start: 1,
                status: "completed",
                visibleAnswer: "收到，啥事？",
                request_id: "1783057133648",
                projection_version: "openclaw.message_projection.v1",
                turn_id: "agent:main:main:turn:1783057133648",
                isStreaming: false,
                failed: false,
                interrupted: false,
                activities: [],
                timelineItems: [],
                outputFiles: null,
              },
              rawSeq: 281,
            },
          },
          {
            id: "turn:agent:main:main:turn:1783499340404:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "1",
            createdAt: 1783499451869,
            payload: { rawSeq: 74 },
          },
          {
            id: "turn:agent:main:main:turn:1783499340404:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "收到，啥事？",
            createdAt: 1783580553704,
            payload: {
              openclawProjection: {
                seq: 91,
                seq_end: 91,
                seq_start: 74,
                status: "completed",
                visibleAnswer: "收到，啥事？",
                request_id: "1783499340404",
                projection_version: "openclaw.message_projection.v1",
                turn_id: "agent:main:main:turn:1783499340404",
                isStreaming: false,
                failed: false,
                interrupted: false,
                activities: [
                  {
                    kind: "assistant.thinking",
                    seq: 87,
                    summary: "just one short user msg",
                  },
                ],
                timelineItems: [],
                outputFiles: null,
              },
              rawSeq: 91,
            },
          },
        ] as any,
        CONVERSATION_ID,
        AGENT_ID,
        []
      );

      // 两条独立 row；这是数据语义，不是 UI 折叠问题
      expect(rows).toHaveLength(2);
      expect(rows.map((r: any) => r.question)).toEqual(["1", "1"]);
      expect(rows.map((r: any) => r.answer)).toEqual(["收到，啥事？", "收到，啥事？"]);
      // 不同 turn_id 必须保留区分
      expect(rows[0].id).not.toBe(rows[1].id);
    }
  );
});

describe("openclaw messages projection — mixed id namespaces in one response", () => {
  it.each(openClawMessageBuilders)(
    "processes ws-*, turn:*, legacy:* within a single payload in %s builder",
    (_name, builder) => {
      // messages.txt 的开篇就是 ws-* 裸帧 + turn:* 投影 + legacy:* 旧快照的混搭
      const rows = builder(
        [
          {
            id: "ws-17150:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: rawChatCompletionRequestBody("ws 帧里的 user 文本", "1783045469416"),
            createdAt: 1783045469241,
          },
          {
            id: "ws-17150:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "ws assistant reply",
            createdAt: 1783045520367,
          },
          {
            id: "turn:agent:main:main:turn:1783045469416:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "turn 投影里的 user 文本",
            createdAt: 1783040864525,
          },
          {
            id: "turn:agent:main:main:turn:1783045469416:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "turn assistant reply",
            createdAt: 1783499337613,
          },
          {
            id: "turn:agent:main:main:legacy:1:user",
            sessionId: CONVERSATION_ID,
            role: "user",
            content: "legacy user",
            createdAt: 1782956983081,
          },
          {
            id: "turn:agent:main:main:legacy:1:assistant",
            sessionId: CONVERSATION_ID,
            role: "assistant",
            content: "legacy assistant reply",
            createdAt: 1783499337816,
          },
        ] as any,
        CONVERSATION_ID,
        AGENT_ID,
        []
      );

      // ws-* 应当被规整，三个真实 turn 都应当产出可渲染 row
      expect(rows).toHaveLength(3);
      // 投影后按 raw_user_message.createdAt 升序排：legacy(2956983081) < turn(3040864525) < ws(3045469241)
      const questions = rows.map((r: any) => r.question);
      expect(questions).toEqual([
        "legacy user",
        "turn 投影里的 user 文本",
        "ws 帧里的 user 文本",
      ]);
      // JSON 字符串不能漏到 row 上
      for (const r of rows) {
        expect(String(r.question || "").startsWith("{")).toBe(false);
      }
    }
  );
});
