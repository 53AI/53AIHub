import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createOpenClawPendingConversationId,
  getOpenClawMessageListMaxActivitySeq,
  isOpenClawPendingConversationId,
  mergeOpenClawActiveMessageIntoList,
  mergeOpenClawTimelineEventsIntoMessage,
  processStreamDataItem,
  rebaseOpenClawMessageConversation,
  replaceOpenClawTurnWithTimelineEvents,
  shouldStartOpenClawBlankConversation,
  shouldUseOpenClawChatAdapter,
  shouldUseOpenClawRouteType,
  useChatStream,
} from "@km/shared-business/chat";

describe("OpenClaw route helpers", () => {
  it("uses the OpenClaw adapter when the current agent has the OpenClaw channel type", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: {
          agent_id: 1,
          channel_type: 1014,
        },
        agentId: "1",
        openClawChannelType: 1014,
      })
    ).toBe(true);
  });

  it("ignores custom_config agent_type when channel type is not OpenClaw", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: {
          agent_id: 1,
          channel_type: 1001,
          custom_config_obj: {
            agent_type: "openclaw",
          },
        },
        agentId: 1,
        openClawChannelType: 1014,
      })
    ).toBe(false);
  });

  it("ignores backend agent_type when channel type is not OpenClaw", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: {
          agent_id: 1,
          agent_type: 2,
          channel_type: 1001,
        },
        agentId: 1,
        openClawChannelType: 1014,
      })
    ).toBe(false);
  });

  it("does not let a stale type=openclaw route force normal agents into the OpenClaw adapter", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: {
          agent_id: 1,
          channel_type: 1001,
        },
        agentId: 1,
        openClawChannelType: 1014,
      })
    ).toBe(false);
  });

  it("does not enable the OpenClaw adapter from route hints while the target agent is still loading", () => {
    expect(
      shouldUseOpenClawChatAdapter({
        currentAgent: null,
        agentId: 1,
        openClawChannelType: 1014,
      })
    ).toBe(false);
  });

  it("keeps type=openclaw when syncing arbitrary OpenClaw session ids to the URL", () => {
    expect(shouldUseOpenClawRouteType(true, "oc-session-1")).toBe(true);
  });

  it("starts OpenClaw in a blank conversation when no explicit conversation id is provided", () => {
    expect(shouldStartOpenClawBlankConversation({ openclaw: true })).toBe(true);
    expect(shouldStartOpenClawBlankConversation({ openclaw: true, initialConversationId: "agent:main:main" })).toBe(false);
    expect(shouldStartOpenClawBlankConversation({ openclaw: false })).toBe(false);
  });

  it("uses a temporary OpenClaw conversation id only before the real session is resolved", () => {
    const pendingId = createOpenClawPendingConversationId();

    expect(isOpenClawPendingConversationId(pendingId)).toBe(true);
    expect(isOpenClawPendingConversationId("agent:main:main")).toBe(false);
  });

  it("maps OpenClaw thinking chunks to reasoning content instead of assistant answer", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "正在检查本地运行状态",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.answer).toBe("");
    expect(message.reasoning_content).toBe("正在检查本地运行状态");
    expect(message.openclawActivities).toHaveLength(1);
    expect(message.openclawActivities[0].summary).toBe("正在检查本地运行状态");
  });

  it("hydrates realtime OpenClaw messages from timeline events when the stream lacks tool metadata", () => {
    const message: any = {
      answer: "正在生成答案",
      reasoning_content: "正在处理您的请求...",
      reasoning_expanded: true,
      openclawActivities: [],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "session-1:thinking:1",
          seq: 1,
          kind: "assistant.thinking",
          payload: {
            content: "Need to inspect the local runtime first.",
          },
        },
        {
          id: "session-1:tool:2",
          seq: 2,
          kind: "tool.call",
          payload: {
            data: {
              name: "status_check",
              args: { target: "gateway" },
            },
          },
        },
        {
          id: "session-1:tool:3",
          seq: 3,
          kind: "tool.result",
          payload: {
            data: {
              name: "status_check",
              result: {
                output: "Gateway is healthy.",
              },
            },
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
    ]);
    expect(message.openclawActivities[1].tool.displayName).toBe("Status Check");
    expect(message.openclawActivities[2].tool.output).toContain("Gateway is healthy.");
    expect(message.answer).toBe("正在生成答案");
  });

  it("merges realtime OpenClaw output_files process steps without throwing", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:files",
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "event-output-files-1",
          sessionId: "agent:main:files",
          seq: 8,
          kind: "process.step",
          payload: {
            process_step: {
              step_code: "output_files",
              status: "completed",
              data: {
                files: [
                  {
                    id: "file-1",
                    file_name: "report.txt",
                    download_url: "/api/messages/1/files/file-1/download",
                  },
                ],
              },
            },
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.outputFiles).toHaveLength(1);
    expect(message.outputFiles[0].file_name).toBe("report.txt");
    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "output_files")).toHaveLength(1);
  });

  it("uses the actual OpenClaw tool name instead of the session display name for tool result cards", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
    };

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "session-1:tool-result:13",
          seq: 13,
          kind: "tool.result",
          payload: {
            displayName: "53AI Hub-Y65NG：从网上找5部电影并总结",
            data: {
              name: "web_fetch",
              meta: "from https://www.imdb.com/chart/top (max 8000 chars)",
              result: {
                details: {
                  error: "Web fetch extraction failed",
                },
              },
              isError: true,
            },
          },
        },
      ],
    });

    expect(message.openclawActivities).toHaveLength(1);
    expect(message.openclawActivities[0].title).toBe("Tool output");
    expect(message.openclawActivities[0].tool.displayName).toBe("Web Fetch");
    expect(message.openclawActivities[0].title).not.toContain("53AI Hub");
    expect(message.openclawActivities[0].summary).not.toContain("53AI Hub");
  });

  it("deduplicates realtime and timeline OpenClaw reasoning cards with the same content", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [
        {
          key: "local-thinking",
          seq: 1,
          kind: "assistant.thinking",
          title: "已完成深度思考",
          summary: "Let me try a different search approach.",
        },
      ],
    };

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "session-1:thinking:8",
          seq: 8,
          kind: "assistant.thinking",
          payload: {
            content: "Let me try a different search approach.",
          },
        },
      ],
    });

    expect(message.openclawActivities).toHaveLength(1);
    expect(message.openclawActivities[0].seq).toBe(8);
    expect(message.openclawActivities[0].summary).toBe("Let me try a different search approach.");
  });

  it("rebases an active OpenClaw message to the resolved conversation id without duplicating internal timeline items", () => {
    const rebased = rebaseOpenClawMessageConversation(
      {
        conversation_id: "",
        answer: "广州今天天气：",
        openclawActivities: [
          {
            key: "thinking-live",
            seq: 1,
            kind: "assistant.thinking",
            title: "已完成深度思考",
            summary: "User asks about Guangzhou weather today.",
          },
        ],
        openclawTimelineItems: [
          {
            key: "thinking-live",
            type: "thinking",
            seq: 1,
            kind: "assistant.thinking",
            content: "User asks about Guangzhou weather today.",
            activity: {
              key: "thinking-live",
              seq: 1,
              kind: "assistant.thinking",
              title: "已完成深度思考",
              summary: "User asks about Guangzhou weather today.",
            },
          },
          {
            key: "openclaw:answer:live:0",
            type: "answer",
            seq: 2,
            content: "广州今天天气：",
          },
        ],
        _openclawLastAnswerItemKey: "openclaw:answer:live:0",
      } as any,
      "agent:main:weather"
    );

    expect(rebased.conversation_id).toBe("agent:main:weather");
    expect(rebased.openclawActivities[0].sessionId).toBe("agent:main:weather");
    expect(rebased.openclawTimelineItems).toHaveLength(2);
    expect(rebased.openclawTimelineItems?.filter((item: any) => item.type === "answer")).toHaveLength(1);
  });

  it("upgrades a provisional OpenClaw answer into the hydrated assistant.message instead of appending a second answer bubble", () => {
    const message: any = {
      conversation_id: "agent:main:weather",
      answer: "广州今天天气：",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [
        {
          key: "local-thinking",
          seq: 1,
          kind: "assistant.thinking",
          title: "已完成深度思考",
          summary: "User asks about Guangzhou weather today.",
        },
      ],
      openclawTimelineItems: [
        {
          key: "local-thinking",
          type: "thinking",
          seq: 1,
          kind: "assistant.thinking",
          content: "User asks about Guangzhou weather today.",
          activity: {
            key: "local-thinking",
            seq: 1,
            kind: "assistant.thinking",
            title: "已完成深度思考",
            summary: "User asks about Guangzhou weather today.",
          },
        },
        {
          key: "openclaw:answer:live:0",
          type: "answer",
          seq: 2,
          content: "广州今天天气：",
        },
      ],
      _openclawLastAnswerItemKey: "openclaw:answer:live:0",
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "event-thinking-10",
          sessionId: "agent:main:weather",
          seq: 10,
          kind: "assistant.thinking",
          payload: {
            content: "User asks about Guangzhou weather today.",
          },
        },
        {
          id: "event-answer-12",
          sessionId: "agent:main:weather",
          seq: 12,
          kind: "assistant.message",
          payload: {
            content: "广州今天天气：\n\n- 雷阵雨，气温 33°C，体感 40°C",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.openclawActivities).toHaveLength(1);
    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].key).toBe("agent:main:weather:answer:12");
    expect(answerItems[0].content).toContain("雷阵雨");
  });

  it("replaces a live tail-fragment OpenClaw answer with the hydrated full answer instead of keeping both bubbles", () => {
    const message: any = {
      conversation_id: "agent:main:guangdong",
      answer: "- 风力：西南风 4km/h\n\n广东整体闷热潮湿，多地有阵雨，出门记得带伞！☔🌧️",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [
        {
          key: "thinking-1",
          seq: 1,
          kind: "assistant.thinking",
          title: "已完成深度思考",
          summary:
            "The user is asking about Guangdong province weather. wttr.in works best with cities, so I'll query for Guangzhou as the capital/primary city of Guangdong.",
        },
        {
          key: "tool-call-2",
          seq: 2,
          kind: "tool.call",
          title: "Used Exec",
          summary: "Used Exec",
          tool: {
            name: "exec",
            displayName: "Exec",
            input: "curl -s \"wttr.in/Guangzhou?...\"",
          },
        },
        {
          key: "tool-result-3",
          seq: 3,
          kind: "tool.result",
          title: "Tool output",
          summary: "Guangzhou: 🌦️  +29°C (feels like +32°C), ↘4km/h wind, 89% humidity",
          tool: {
            name: "exec",
            displayName: "Exec",
            output: "Guangzhou: 🌦️  +29°C (feels like +32°C), ↘4km/h wind, 89% humidity",
          },
        },
      ],
      openclawTimelineItems: [
        {
          key: "thinking-1",
          type: "thinking",
          seq: 1,
          kind: "assistant.thinking",
          content:
            "The user is asking about Guangdong province weather. wttr.in works best with cities, so I'll query for Guangzhou as the capital/primary city of Guangdong.",
        },
        {
          key: "tool-call-2",
          type: "tool_call",
          seq: 2,
          kind: "tool.call",
          title: "Used Exec",
          tool: {
            name: "exec",
            displayName: "Exec",
            input: "curl -s \"wttr.in/Guangzhou?...\"",
          },
        },
        {
          key: "tool-result-3",
          type: "tool_result",
          seq: 3,
          kind: "tool.result",
          title: "Tool output",
          tool: {
            name: "exec",
            displayName: "Exec",
            output: "Guangzhou: 🌦️  +29°C (feels like +32°C), ↘4km/h wind, 89% humidity",
          },
        },
        {
          key: "openclaw:answer:live:0",
          type: "answer",
          seq: 4,
          content: "- 风力：西南风 4km/h\n\n广东整体闷热潮湿，多地有阵雨，出门记得带伞！☔🌧️",
        },
      ],
      _openclawLastAnswerItemKey: "openclaw:answer:live:0",
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-5",
          sessionId: "agent:main:guangdong",
          seq: 5,
          kind: "assistant.thinking",
          payload: {
            content:
              "The user is asking about Guangdong province weather. Guangzhou is the capital city of Guangdong, so I'll use that as a reference.",
          },
        },
        {
          id: "answer-6",
          sessionId: "agent:main:guangdong",
          seq: 6,
          kind: "assistant.message",
          payload: {
            content:
              "**广东今天天气：**\n\n🌦️ 多云转阵雨，气温 **29°C**，体感 **32°C**\n\n- 湿度：89%\n- 风力：西南风 4km/h\n\n广东整体闷热潮湿，多地有阵雨，出门记得带伞！☔🌧️",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].key).toBe("agent:main:guangdong:answer:6");
    expect(answerItems[0].seq).toBe(6);
    expect(answerItems[0].content).toContain("广东今天天气");
    expect(answerItems[0].content).toContain("风力：西南风 4km/h");
    expect(answerItems[0].content).not.toBe("- 风力：西南风 4km/h\n\n广东整体闷热潮湿，多地有阵雨，出门记得带伞！☔🌧️");
  });

  it("drops a tiny provisional OpenClaw answer fragment when a new thinking block starts before the final answer", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:guangzhou-tomorrow",
    };

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "用户问明天广州天气，我可以用wttr.in查询明天的预报。" } }],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "⚠️☔" } }],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "The output shows today's weather, but I need tomorrow's forecast for Guangzhou. I should inspect the full-day forecast and then summarize tomorrow's result.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-12",
          sessionId: "agent:main:guangzhou-tomorrow",
          seq: 12,
          kind: "assistant.thinking",
          payload: {
            content:
              "The output shows today's weather, but I need tomorrow's forecast for Guangzhou. I should inspect the full-day forecast and then summarize tomorrow's result.",
          },
        },
        {
          id: "answer-13",
          sessionId: "agent:main:guangzhou-tomorrow",
          seq: 13,
          kind: "assistant.message",
          payload: {
            content:
              "**广州明天天气预报（6月9日 周二）：**\n\n- 🌧️ 全天有雨\n- 气温：26-29°C\n- 体感温度：30-34°C\n- 降水：33.7mm（晚间雨量较大）\n- 湿度：96-98%\n\n明天雨势较大，暴雨级别，请提前做好准备，尽量避免外出！⚠️☔",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toContain("广州明天天气预报");
    expect(answerItems[0].content).not.toBe("⚠️☔");
  });

  it("keeps hidden OpenClaw timeline v2 answer deltas invisible even when the stream chunk uses replace mode", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:shanghai",
    };
    const hiddenTimeline = {
      protocol_version: "openclaw.timeline.v2",
      turn_id: "agent:main:shanghai:turn:req-weather",
      segment_id: "agent:main:shanghai:turn:req-weather:answer:0",
      segment_type: "answer",
      segment_index: 0,
      delta_index: 0,
      operation: "append",
      visibility: "hidden",
      final: false,
    };

    processStreamDataItem(
      {
        event_kind: "assistant.delta",
        data: {
          mode: "replace",
          replace: true,
          payload: {
            content: "8km/h\n\n天气不错，适合出行！🌤️",
            openclaw_timeline: hiddenTimeline,
          },
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "8km/h\n\n天气不错，适合出行！🌤️" } }],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          payload: {
            content:
              "The user is asking for Shanghai weather again. I already got the data from the previous exec call.",
            openclaw_timeline: {
              ...hiddenTimeline,
              segment_id: "agent:main:shanghai:turn:req-weather:thinking:1",
              segment_type: "thinking",
              segment_index: 1,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "The user is asking for Shanghai weather again. I already got the data from the previous exec call.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          payload: {
            content:
              "**上海今天天气：**\n\n☁️ 多云，气温 **22°C**，体感 **24°C**\n\n- 湿度：61%\n- 风力：西南风 8km/h\n\n天气不错，适合出行！🌤️",
            openclaw_timeline: {
              ...hiddenTimeline,
              delta_index: 1,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "**上海今天天气：**\n\n☁️ 多云，气温 **22°C**，体感 **24°C**\n\n- 湿度：61%\n- 风力：西南风 8km/h\n\n天气不错，适合出行！🌤️",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toContain("上海今天天气");
    expect(answerItems[0].content).not.toBe("8km/h\n\n天气不错，适合出行！🌤️");
  });

  it("does not surface a larger provisional OpenClaw tail fragment before a later thinking block and hydrated final answer", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:chengdu-tomorrow",
    };

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "用户问明天成都的天气。我需要用wttr.in查询成都明天的天气预报。" } }],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "°C\n- 降水概率：0-4%\n- 风力：5-18 km/h\n\n明天天气不错，适合出行！☀️",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "用户要求查询明天成都的天气。我需要重新确认 wttr.in 的日期含义，然后再给出最终摘要。",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "thinking-22",
          sessionId: "agent:main:chengdu-tomorrow",
          seq: 22,
          kind: "assistant.thinking",
          payload: {
            content:
              "用户要求查询明天成都的天气。我需要重新确认 wttr.in 的日期含义，然后再给出最终摘要。",
          },
        },
        {
          id: "answer-23",
          sessionId: "agent:main:chengdu-tomorrow",
          seq: 23,
          kind: "assistant.message",
          payload: {
            content:
              "**成都明天天气预报（6月9日 周二）：**\n\n🌤️ **多云转晴**\n\n- **上午**：多云，20°C\n- **中午**：多云，22°C（体感25°C）\n- **傍晚**：晴，26°C\n- **夜间**：晴，21°C\n- 降水概率：0-4%\n- 风力：5-18 km/h\n\n明天天气不错，适合出行！☀️",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toContain("成都明天天气预报");
    expect(answerItems.some((item: any) => String(item.content || "").trim().startsWith("°C"))).toBe(false);
  });

  it("uses OpenClaw timeline v2 segment metadata to hide provisional answer deltas and upgrade to one final answer", () => {
    const message: any = {
      id: "assistant-v2",
      answer: "",
      reasoning_content: "",
      conversation_id: "agent:main:v2",
      loading: true,
      _openclawClientMessageId: "client-v2",
    };
    const timeline = {
      protocol_version: "openclaw.timeline.v2",
      turn_id: "agent:main:v2:turn:req-v2",
      segment_id: "agent:main:v2:turn:req-v2:answer:0",
      segment_type: "answer",
      segment_index: 3,
      delta_index: 0,
      operation: "append",
      visibility: "hidden",
      final: false,
    };

    processStreamDataItem(
      {
        data: {
          session_id: "agent:main:v2",
          event_kind: "assistant.delta",
          payload: {
            seq: 10,
            message_seq: 10,
            openclaw_timeline: timeline,
          },
          choices: [
            {
              delta: {
                role: "assistant",
                content: "°C\n- 降水概率：0-4%",
              },
              finish_reason: null,
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "answer-v2-final",
          sessionId: "agent:main:v2",
          seq: 11,
          kind: "assistant.message",
          payload: {
            content: "成都明天天气：晴，气温 28°C。",
            openclaw_timeline: {
              ...timeline,
              delta_index: 1,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
        {
          id: "answer-v2-final-duplicate",
          sessionId: "agent:main:v2",
          seq: 11,
          kind: "assistant.message",
          payload: {
            content: "成都明天天气：晴，气温 28°C。",
            openclaw_timeline: {
              ...timeline,
              delta_index: 1,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
      ],
    });

    expect(changed).toBe(true);
    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toBe("成都明天天气：晴，气温 28°C。");
  });

  it("projects protocol stream chunks the same way as events hydration", () => {
    const conversationId = "agent:main:stream-events-parity";
    const turnId = `${conversationId}:turn:req-parity`;
    const answerSegmentId = `${turnId}:answer:0`;
    const events = [
      {
        id: "parity-thinking",
        sessionId: conversationId,
        seq: 1,
        kind: "assistant.thinking",
        payload: {
          content: "Need to check Shanghai weather before answering.",
          openclaw_timeline: {
            protocol_version: "openclaw.timeline.v2",
            turn_id: turnId,
            segment_id: `${turnId}:thinking:1`,
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
        id: "parity-tool-call",
        sessionId: conversationId,
        seq: 2,
        kind: "tool.call",
        payload: {
          data: {
            name: "exec",
            toolCallId: "call-weather",
            args: { command: "curl -s wttr.in/Shanghai?format=j1" },
          },
          openclaw_timeline: {
            protocol_version: "openclaw.timeline.v2",
            turn_id: turnId,
            segment_id: `${turnId}:tool_call:call-weather`,
            segment_type: "tool_call",
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
        id: "parity-tool-result",
        sessionId: conversationId,
        seq: 3,
        kind: "tool.result",
        payload: {
          data: {
            name: "exec",
            toolCallId: "call-weather",
            result: { output: "Shanghai: cloudy, 22C." },
          },
          openclaw_timeline: {
            protocol_version: "openclaw.timeline.v2",
            turn_id: turnId,
            segment_id: `${turnId}:tool_result:call-weather`,
            segment_type: "tool_result",
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
        id: "parity-answer-1",
        sessionId: conversationId,
        seq: 4,
        kind: "assistant.delta",
        payload: {
          content: "上海今天天气：",
          openclaw_timeline: {
            protocol_version: "openclaw.timeline.v2",
            turn_id: turnId,
            segment_id: answerSegmentId,
            segment_type: "answer",
            segment_index: 3,
            delta_index: 0,
            operation: "append",
            visibility: "stream",
            final: false,
          },
        },
        createdAt: "2026-06-09T15:47:03.000Z",
      },
      {
        id: "parity-answer-2",
        sessionId: conversationId,
        seq: 5,
        kind: "assistant.delta",
        payload: {
          content: "多云，气温 22°C。",
          openclaw_timeline: {
            protocol_version: "openclaw.timeline.v2",
            turn_id: turnId,
            segment_id: answerSegmentId,
            segment_type: "answer",
            segment_index: 3,
            delta_index: 1,
            operation: "append",
            visibility: "stream",
            final: false,
          },
        },
        createdAt: "2026-06-09T15:47:04.000Z",
      },
      {
        id: "parity-completed",
        sessionId: conversationId,
        seq: 6,
        kind: "run.completed",
        payload: {
          openclaw_timeline: {
            protocol_version: "openclaw.timeline.v2",
            turn_id: turnId,
            segment_id: `${turnId}:run:6`,
            segment_type: "run",
            segment_index: 4,
            delta_index: 0,
            operation: "close",
            visibility: "final",
            final: true,
          },
        },
        createdAt: "2026-06-09T15:47:05.000Z",
      },
    ];

    const streamMessage: any = {
      id: "assistant-stream-parity",
      answer: "",
      reasoning_content: "",
      conversation_id: conversationId,
      loading: true,
    };
    for (const event of events) {
      const content = typeof event.payload.content === "string" ? event.payload.content : "";
      processStreamDataItem(
        {
          status: event.kind === "run.completed" ? "done" : event.kind === "assistant.thinking" ? "thinking" : "streaming",
          data: {
            session_id: conversationId,
            event_kind: event.kind,
            payload: {
              ...event.payload,
              event_id: event.id,
              event_kind: event.kind,
              event_created_at: event.createdAt,
              seq: event.seq,
              message_seq: event.seq,
            },
            object: "chat.completion.chunk",
            choices: [
              {
                delta: { content },
                finish_reason: event.kind === "run.completed" ? "stop" : null,
              },
            ],
          },
        },
        streamMessage,
        () => null,
        { openclaw: true }
      );
    }

    const eventsMessage: any = {
      id: "assistant-events-parity",
      answer: "",
      reasoning_content: "",
      conversation_id: conversationId,
      loading: false,
    };
    mergeOpenClawTimelineEventsIntoMessage(eventsMessage, { events });

    const summarize = (message: any) => ({
      answer: message.answer,
      reasoning: message.reasoning_content,
      loading: message.loading,
      items: (message.openclawTimelineItems || []).map((item: any) => ({
        type: item.type,
        kind: item.kind || "",
        content: item.content || "",
        input: item.tool?.input || "",
        output: item.tool?.output || "",
      })),
    });

    expect(summarize(streamMessage)).toEqual(summarize(eventsMessage));
    expect(streamMessage.loading).toBe(false);
    expect(streamMessage.answer).toBe("上海今天天气：多云，气温 22°C。");
  });

  it("projects only the active OpenClaw timeline v2 turn from realtime state", () => {
    const conversationId = "agent:main:stream-active-turn";
    const oldTurnId = `${conversationId}:turn:req-old`;
    const newTurnId = `${conversationId}:turn:req-new`;
    const buildTimeline = (
      turnId: string,
      segmentType: "answer" | "thinking" | "tool_call" | "tool_result" | "run",
      segmentId: string,
      segmentIndex: number,
      deltaIndex = 0,
      operation: "append" | "replace" | "close" = "replace",
      visibility: "hidden" | "stream" | "final" = "final",
      final = true
    ) => ({
      protocol_version: "openclaw.timeline.v2",
      turn_id: turnId,
      segment_id: segmentId,
      segment_type: segmentType,
      segment_index: segmentIndex,
      delta_index: deltaIndex,
      operation,
      visibility,
      final,
    });

    const streamMessage: any = {
      id: "assistant-stream-active-turn",
      answer: "",
      reasoning_content: "",
      conversation_id: conversationId,
      loading: true,
    };

    mergeOpenClawTimelineEventsIntoMessage(streamMessage, {
      events: [
        {
          id: "old-thinking",
          sessionId: conversationId,
          seq: 1,
          kind: "assistant.thinking",
          payload: {
            content: "The user is sending a simple test message.",
            openclaw_timeline: buildTimeline(oldTurnId, "thinking", `${oldTurnId}:thinking:1`, 0),
          },
        },
        {
          id: "old-answer",
          sessionId: conversationId,
          seq: 2,
          kind: "assistant.message",
          payload: {
            content: "✅ 正常！系统运行稳定，随时为您服务。",
            openclaw_timeline: buildTimeline(oldTurnId, "answer", `${oldTurnId}:answer:0`, 1),
          },
        },
        {
          id: "old-completed",
          sessionId: conversationId,
          seq: 3,
          kind: "run.completed",
          payload: {
            openclaw_timeline: buildTimeline(oldTurnId, "run", `${oldTurnId}:run:3`, 2, 0, "close"),
          },
        },
      ],
    });
    expect(streamMessage.answer).toContain("系统运行稳定");

    const newEvents = [
      {
        id: "new-thinking",
        sessionId: conversationId,
        seq: 4,
        kind: "assistant.thinking",
        payload: {
          content: "Need to query Heilongjiang weather and summarize the result.",
          openclaw_timeline: buildTimeline(newTurnId, "thinking", `${newTurnId}:thinking:4`, 0),
        },
      },
      {
        id: "new-tool-call",
        sessionId: conversationId,
        seq: 5,
        kind: "tool.call",
        payload: {
          data: {
            name: "exec",
            toolCallId: "call-heilongjiang-weather",
            args: { command: "curl -s wttr.in/Heilongjiang?lang=zh" },
          },
          openclaw_timeline: buildTimeline(newTurnId, "tool_call", `${newTurnId}:tool_call:call-heilongjiang-weather`, 1),
        },
      },
      {
        id: "new-tool-result",
        sessionId: conversationId,
        seq: 6,
        kind: "tool.result",
        payload: {
          data: {
            name: "exec",
            toolCallId: "call-heilongjiang-weather",
            result: { output: "Heilongjiang: sunny, 22C." },
          },
          openclaw_timeline: buildTimeline(newTurnId, "tool_result", `${newTurnId}:tool_result:call-heilongjiang-weather`, 2),
        },
      },
      {
        id: "new-answer",
        sessionId: conversationId,
        seq: 7,
        kind: "assistant.message",
        payload: {
          content: "黑龙江今天晴，当前约 22°C。",
          openclaw_timeline: buildTimeline(newTurnId, "answer", `${newTurnId}:answer:0`, 3),
        },
      },
      {
        id: "new-completed",
        sessionId: conversationId,
        seq: 8,
        kind: "run.completed",
        payload: {
          openclaw_timeline: buildTimeline(newTurnId, "run", `${newTurnId}:run:8`, 4, 0, "close"),
        },
      },
    ];

    for (const event of newEvents) {
      const content = typeof event.payload.content === "string" ? event.payload.content : "";
      processStreamDataItem(
        {
          status: event.kind === "run.completed" ? "done" : event.kind === "assistant.thinking" ? "thinking" : "streaming",
          data: {
            session_id: conversationId,
            event_kind: event.kind,
            payload: {
              ...event.payload,
              event_id: event.id,
              event_kind: event.kind,
              seq: event.seq,
              message_seq: event.seq,
            },
            object: "chat.completion.chunk",
            choices: [
              {
                delta: { content },
                finish_reason: event.kind === "run.completed" ? "stop" : null,
              },
            ],
          },
        },
        streamMessage,
        () => null,
        { openclaw: true }
      );
    }

    const eventsMessage: any = {
      id: "assistant-events-active-turn",
      answer: "",
      reasoning_content: "",
      conversation_id: conversationId,
      loading: false,
    };
    mergeOpenClawTimelineEventsIntoMessage(eventsMessage, { events: newEvents });

    const summarize = (message: any) => ({
      answer: message.answer,
      reasoning: message.reasoning_content,
      items: (message.openclawTimelineItems || []).map((item: any) => ({
        type: item.type,
        content: item.content || "",
        input: item.tool?.input || "",
        output: item.tool?.output || "",
      })),
    });

    expect(summarize(streamMessage)).toEqual(summarize(eventsMessage));
    expect(streamMessage.answer).toBe("黑龙江今天晴，当前约 22°C。");
    expect(streamMessage.answer).not.toContain("系统运行稳定");
    expect(streamMessage.reasoning_content).toBe("Need to query Heilongjiang weather and summarize the result.");
  });

  it("keeps same-turn realtime support events when final OpenClaw timeline v2 snapshot only contains the answer", () => {
    const conversationId = "agent:main:stream-final-preserve";
    const turnId = `${conversationId}:turn:req-current`;
    const message: any = {
      id: "assistant-stream-final-preserve",
      answer: "",
      reasoning_content: "",
      conversation_id: conversationId,
      loading: true,
      _openclawTurnStartSeq: 10,
    };

    const stream = (eventKind: string, seq: number, payload: Record<string, unknown>, status = "streaming") => {
      processStreamDataItem(
        {
          status,
          session_id: conversationId,
          event_kind: eventKind,
          payload: {
            ...payload,
            event_id: `rt-${eventKind}-${seq}`,
            seq,
            message_seq: seq,
          },
          data: {
            session_id: conversationId,
            object: "chat.completion.chunk",
            choices: [
              {
                delta: {
                  content: typeof payload.content === "string" ? payload.content : "",
                },
                finish_reason: null,
              },
            ],
          },
        },
        message,
        () => null,
        { openclaw: true }
      );
    };

    stream("assistant.thinking", 11, { content: "Need to query Harbin weather before answering." }, "thinking");
    stream("tool.call", 12, {
      data: {
        name: "exec",
        toolCallId: "call-harbin-weather",
        args: { command: "curl -s wttr.in/Harbin?lang=zh&format=3" },
      },
    });
    stream("tool.result", 13, {
      data: {
        name: "exec",
        toolCallId: "call-harbin-weather",
        result: { output: "Harbin: thundershowers, +24°C" },
      },
    });

    const changed = replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "final-answer-only",
          sessionId: conversationId,
          seq: 14,
          kind: "assistant.message",
          payload: {
            content: "哈尔滨今天雷阵雨，当前 24°C。",
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: `${turnId}:answer:0`,
              segment_type: "answer",
              segment_index: 3,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
        {
          id: "final-completed",
          sessionId: conversationId,
          seq: 15,
          kind: "run.completed",
          payload: {
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: turnId,
              segment_id: `${turnId}:run:15`,
              segment_type: "run",
              segment_index: 4,
              delta_index: 0,
              operation: "close",
              visibility: "final",
              final: true,
            },
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.answer).toBe("哈尔滨今天雷阵雨，当前 24°C。");
    expect(message.reasoning_content).toBe("Need to query Harbin weather before answering.");
    expect((message.openclawTimelineItems || []).map((item: any) => item.type === "answer" ? "answer" : item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
      "answer",
    ]);
    expect(
      (message.openclawTimelineItems || []).some((item: any) =>
        String(item.tool?.input || "").includes("wttr.in/Harbin")
      )
    ).toBe(true);
  });

  it("keeps same-turn realtime support events after a protocol final answer arrives in the stream", () => {
    const conversationId = "agent:main:stream-protocol-final-support";
    const turnId = `${conversationId}:turn:req-current`;
    const message: any = {
      id: "assistant-stream-protocol-final-support",
      answer: "",
      reasoning_content: "",
      conversation_id: conversationId,
      loading: true,
    };

    const stream = (eventKind: string, seq: number, payload: Record<string, unknown>, status = "streaming") => {
      processStreamDataItem(
        {
          status,
          session_id: conversationId,
          event_kind: eventKind,
          payload: {
            ...payload,
            event_id: `rt-${eventKind}-${seq}`,
            seq,
            message_seq: seq,
          },
          data: {
            session_id: conversationId,
            object: "chat.completion.chunk",
            choices: [
              {
                delta: {
                  content: typeof payload.content === "string" ? payload.content : "",
                },
                finish_reason: null,
              },
            ],
          },
        },
        message,
        () => null,
        { openclaw: true }
      );
    };

    stream("assistant.thinking", 21, { content: "Need to query Harbin weather before answering." }, "thinking");
    stream("tool.call", 22, {
      data: {
        name: "exec",
        toolCallId: "call-harbin-weather",
        args: { command: "curl -s wttr.in/Harbin?lang=zh" },
      },
    });
    stream("tool.result", 23, {
      data: {
        name: "exec",
        toolCallId: "call-harbin-weather",
        result: { output: "Harbin: thundershowers, +24°C" },
      },
    });
    stream("assistant.message", 24, {
      content: "哈尔滨今天雷阵雨，当前 24°C。",
      openclaw_timeline: {
        protocol_version: "openclaw.timeline.v2",
        turn_id: turnId,
        segment_id: `${turnId}:answer:0`,
        segment_type: "answer",
        segment_index: 3,
        delta_index: 0,
        operation: "replace",
        visibility: "final",
        final: true,
      },
    });

    expect(message.answer).toBe("哈尔滨今天雷阵雨，当前 24°C。");
    expect(message.reasoning_content).toBe("Need to query Harbin weather before answering.");
    expect((message.openclawTimelineItems || []).map((item: any) => item.type === "answer" ? "answer" : item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
      "answer",
    ]);
    expect(
      (message.openclawTimelineItems || []).some((item: any) =>
        String(item.tool?.input || "").includes("wttr.in/Harbin")
      )
    ).toBe(true);
  });

  it("orders OpenClaw timeline v2 thinking before a later final answer by seq even when answer has a smaller segment index", () => {
    const message: any = {
      id: "assistant-v2-order",
      answer: "",
      reasoning_content: "",
      conversation_id: "agent:main:v2-order",
      loading: false,
      _openclawClientMessageId: "client-v2-order",
    };
    const answerTimeline = {
      protocol_version: "openclaw.timeline.v2",
      turn_id: "agent:main:v2-order:turn:req-v2-order",
      segment_id: "agent:main:v2-order:turn:req-v2-order:answer:0",
      segment_type: "answer",
      segment_index: 0,
      delta_index: 2,
      operation: "replace",
      visibility: "final",
      final: true,
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "answer-v2-order-final",
          sessionId: "agent:main:v2-order",
          seq: 67,
          kind: "assistant.message",
          payload: {
            content: "✅ 正常！",
            openclaw_timeline: answerTimeline,
          },
        },
        {
          id: "thinking-v2-order-final",
          sessionId: "agent:main:v2-order",
          seq: 66,
          kind: "assistant.thinking",
          payload: {
            content: "Same data as before. Answer is stable.",
            openclaw_timeline: {
              ...answerTimeline,
              segment_id: "agent:main:v2-order:turn:req-v2-order:thinking:66",
              segment_type: "thinking",
              segment_index: 1,
              delta_index: 0,
            },
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect((message.openclawTimelineItems || []).map((item: any) => item.seq)).toEqual([66, 67]);
    expect((message.openclawTimelineItems || []).map((item: any) => item.type === "answer" ? "answer" : item.kind)).toEqual([
      "assistant.thinking",
      "answer",
    ]);
  });

  it("replaces the in-flight OpenClaw turn with the final events snapshot after streaming completes", () => {
    const message: any = {
      id: "assistant-final-reconcile",
      answer: "",
      reasoning_content: "",
      conversation_id: "agent:main:final-reconcile",
      loading: true,
      _openclawClientMessageId: "client-final-reconcile",
      _openclawTurnStartSeq: 50,
    };
    const timeline = {
      protocol_version: "openclaw.timeline.v2",
      turn_id: "agent:main:final-reconcile:turn:req-final-reconcile",
      segment_id: "agent:main:final-reconcile:turn:req-final-reconcile:answer:0",
      segment_type: "answer",
      segment_index: 0,
      delta_index: 0,
      operation: "replace",
      visibility: "final",
      final: true,
    };

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "stream-session-message",
          sessionId: "agent:main:final-reconcile",
          seq: 61,
          kind: "assistant.message",
          payload: {
            content: "临时摘要。",
            openclaw_timeline: timeline,
          },
        },
        {
          id: "stream-bad-append",
          sessionId: "agent:main:final-reconcile",
          seq: 62,
          kind: "assistant.message",
          payload: {
            content: "临时摘要。最终答案的一部分。",
          },
        },
      ],
    });

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer").length).toBeGreaterThan(0);

    const changed = replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "events-thinking",
          sessionId: "agent:main:final-reconcile",
          seq: 60,
          kind: "assistant.thinking",
          payload: {
            content: "完成检索并整理结果。",
          },
        },
        {
          id: "events-answer",
          sessionId: "agent:main:final-reconcile",
          seq: 63,
          kind: "assistant.message",
          payload: {
            content: "最终答案：十部小说推荐如下。",
            openclaw_timeline: {
              ...timeline,
              delta_index: 1,
            },
          },
        },
        {
          id: "events-done",
          sessionId: "agent:main:final-reconcile",
          seq: 64,
          kind: "run.completed",
          payload: {},
        },
      ],
    });

    expect(changed).toBe(true);
    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toBe("最终答案：十部小说推荐如下。");
    expect(message.answer).toBe("最终答案：十部小说推荐如下。");
    expect(message.openclawTurn.events.map((event: any) => event.id || event.eventId)).not.toContain("stream-bad-append");
  });

  it("keeps realtime output files when final events replacement omits lower-seq history file events", () => {
    const message: any = {
      id: "assistant-current",
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:final-files",
      _openclawTurnStartSeq: 100,
    };

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "stream-output-files",
          sessionId: "agent:main:final-files",
          seq: 108,
          kind: "process.step",
          payload: {
            process_step: {
              step_code: "output_files",
              status: "completed",
              data: {
                files: [
                  {
                    id: "file-1",
                    file_name: "report.md",
                    download_url: "/api/messages/1/files/file-1/download",
                  },
                ],
              },
            },
          },
        },
      ],
    });

    expect(message.outputFiles).toHaveLength(1);
    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "output_files")).toHaveLength(1);

    const changed = replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "events-answer",
          sessionId: "agent:main:final-files",
          seq: 120,
          kind: "assistant.message",
          payload: {
            content: "最终答案：文件已生成。",
          },
        },
        {
          id: "events-done",
          sessionId: "agent:main:final-files",
          seq: 121,
          kind: "run.completed",
          payload: {},
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.answer).toBe("最终答案：文件已生成。");
    expect(message.outputFiles).toHaveLength(1);
    expect(message.outputFiles[0].file_name).toBe("report.md");
    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "output_files")).toHaveLength(1);
  });

  it("keeps realtime tool activities when final events replacement omits them", () => {
    const message: any = {
      id: "assistant-tools",
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:final-tools",
      _openclawTurnStartSeq: 200,
    };

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "stream-tool-call",
          sessionId: "agent:main:final-tools",
          seq: 208,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              arguments: 'curl -s "wttr.in/Chengdu?2"',
            },
          },
        },
        {
          id: "stream-tool-result",
          sessionId: "agent:main:final-tools",
          seq: 209,
          kind: "tool.result",
          payload: {
            data: {
              name: "exec",
              result: {
                output: "晴，24C",
              },
            },
          },
        },
      ],
    });

    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual(["tool.call", "tool.result"]);

    const changed = replaceOpenClawTurnWithTimelineEvents(message, {
      events: [
        {
          id: "events-answer",
          sessionId: "agent:main:final-tools",
          seq: 220,
          kind: "assistant.message",
          payload: {
            content: "成都明天天气晴。",
          },
        },
        {
          id: "events-done",
          sessionId: "agent:main:final-tools",
          seq: 221,
          kind: "run.completed",
          payload: {},
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.answer).toBe("成都明天天气晴。");
    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual(["tool.call", "tool.result", "run.completed"]);
    expect((message.openclawTimelineItems || []).some((item: any) => item.type === "tool_call")).toBe(true);
    expect((message.openclawTimelineItems || []).some((item: any) => item.type === "tool_result")).toBe(true);
  });

  it("keeps tool result activities visible when protocol metadata mislabels them as answer segments", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:protocol-mislabel",
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "protocol-thinking",
          sessionId: "agent:main:protocol-mislabel",
          seq: 10,
          kind: "assistant.thinking",
          payload: {
            content: "Need to inspect Shenyang weather first.",
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: "agent:main:protocol-mislabel:turn:weather",
              segment_id: "agent:main:protocol-mislabel:turn:weather:thinking:0",
              segment_type: "thinking",
              segment_index: 0,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
        {
          id: "protocol-tool-call",
          sessionId: "agent:main:protocol-mislabel",
          seq: 11,
          kind: "tool.call",
          payload: {
            data: {
              name: "exec",
              args: { command: "curl -s \"wttr.in/Shenyang?2\"" },
            },
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: "agent:main:protocol-mislabel:turn:weather",
              segment_id: "agent:main:protocol-mislabel:turn:weather:tool_call:exec",
              segment_type: "tool_call",
              segment_index: 1,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
        {
          id: "protocol-tool-result",
          sessionId: "agent:main:protocol-mislabel",
          seq: 12,
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
              turn_id: "agent:main:protocol-mislabel:turn:weather",
              segment_id: "agent:main:protocol-mislabel:turn:weather:answer:0",
              segment_type: "answer",
              segment_index: 2,
              delta_index: 0,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
        {
          id: "protocol-answer",
          sessionId: "agent:main:protocol-mislabel",
          seq: 13,
          kind: "assistant.message",
          payload: {
            content: "辽宁（沈阳）明天天气晴。",
            openclaw_timeline: {
              protocol_version: "openclaw.timeline.v2",
              turn_id: "agent:main:protocol-mislabel:turn:weather",
              segment_id: "agent:main:protocol-mislabel:turn:weather:answer:0",
              segment_type: "answer",
              segment_index: 3,
              delta_index: 1,
              operation: "replace",
              visibility: "final",
              final: true,
            },
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
    ]);
    expect((message.openclawTimelineItems || []).map((item: any) => item.type)).toEqual([
      "thinking",
      "tool_call",
      "tool_result",
      "answer",
    ]);
    expect(message.openclawActivities[2].tool.output).toContain("Shenyang: sunny 25C");
  });

  it("ignores generic and named Hub tool placeholder thinking events and hydrates the final assistant message", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "session-1:hub-thinking:1",
          seq: 1,
          kind: "assistant.thinking",
          payload: {
            content: "Used a tool",
            source: "hub53ai",
          },
        },
        {
          id: "session-1:thinking:2",
          seq: 2,
          kind: "assistant.thinking",
          payload: {
            content: "Need to inspect the session history.",
            source: "hub53ai",
          },
        },
        {
          id: "session-1:hub-thinking:3",
          seq: 3,
          kind: "assistant.thinking",
          payload: {
            content: "Tool sessions_history returned a result",
            source: "hub53ai",
          },
        },
        {
          id: "session-1:tool:4",
          seq: 4,
          kind: "tool.call",
          payload: {
            data: {
              name: "sessions_history",
              args: { sessionKey: "current" },
            },
          },
        },
        {
          id: "session-1:assistant:5",
          seq: 5,
          kind: "assistant.message",
          payload: {
            content: "最终回复",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.answer).toBe("最终回复");
    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
    ]);
    expect(message.openclawActivities.map((item: any) => item.summary)).not.toContain("Used a tool");
    expect(message.openclawActivities.map((item: any) => item.summary)).not.toContain("Tool returned a result");
  });

  it("ignores OpenClaw status assistant events when hydrating the final assistant message", () => {
    const message: any = {
      answer: "旧内容",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "session-1:assistant:12",
          seq: 12,
          kind: "assistant.message",
          payload: {
            content: "真实最终回复",
          },
        },
        {
          id: "session-1:assistant:13",
          seq: 13,
          kind: "assistant.message",
          payload: {
            content: "⚙️ Reasoning visibility enabled.",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.answer).toBe("真实最终回复");
  });

  it("does not merge prior-turn OpenClaw events into the current optimistic assistant turn", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      conversation_id: "session-1",
      _openclawTurnStartSeq: 20,
      openclawActivities: [],
      openclawTimelineItems: [],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "session-1:thinking:19",
          sessionId: "session-1",
          seq: 19,
          kind: "assistant.thinking",
          payload: { content: "上一轮的思考" },
        },
        {
          id: "session-1:thinking:20",
          sessionId: "session-1",
          seq: 20,
          kind: "assistant.thinking",
          payload: { content: "上一轮结束边界" },
        },
        {
          id: "session-1:thinking:21",
          sessionId: "session-1",
          seq: 21,
          kind: "assistant.thinking",
          payload: { content: "当前轮次的思考" },
        },
      ],
    });

    expect(changed).toBe(true);
    expect(message.openclawActivities).toHaveLength(1);
    expect(message.openclawActivities[0].seq).toBe(21);
    expect(message.openclawActivities[0].summary).toBe("当前轮次的思考");
  });

  it("uses existing OpenClaw activity seqs as the realtime event hydration baseline", () => {
    expect(
      getOpenClawMessageListMaxActivitySeq([
        {
          id: "m1",
          role: "assistant",
          question: "old",
          answer: "old answer",
          openclawActivities: [
            { key: "thinking:8", kind: "assistant.thinking", title: "已完成深度思考", seq: 8 },
            { key: "completed:22", kind: "run.completed", title: "运行已完成", seq: 22 },
          ],
        } as any,
        {
          id: "m2",
          role: "assistant",
          question: "newer",
          answer: "newer answer",
          openclawActivities: [
            { key: "thinking:33", kind: "assistant.thinking", title: "已完成深度思考", seq: 33 },
          ],
        } as any,
      ])
    ).toBe(33);
  });

  it("scopes the OpenClaw activity seq baseline to the selected conversation", () => {
    expect(
      getOpenClawMessageListMaxActivitySeq(
        [
          {
            id: "other-message",
            role: "assistant",
            question: "other",
            answer: "other answer",
            conversation_id: "agent:main:other",
            openclawActivities: [
              { key: "other-thinking:80", kind: "assistant.thinking", title: "已完成深度思考", seq: 80 },
            ],
          } as any,
          {
            id: "current-message",
            role: "assistant",
            question: "current",
            answer: "current answer",
            conversation_id: "agent:main:current",
            openclawActivities: [
              { key: "current-thinking:12", kind: "assistant.thinking", title: "已完成深度思考", seq: 12 },
            ],
          } as any,
        ],
        "agent:main:current"
      )
    ).toBe(12);
  });

  it("keeps only the latest OpenClaw terminal run activity in one assistant message", () => {
    const message: any = {
      answer: "最终回复",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
    };

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        { id: "session-1:done:10", seq: 10, kind: "run.completed", payload: { message: "old done" } },
        { id: "session-1:done:20", seq: 20, kind: "run.completed", payload: { message: "new done" } },
      ],
    });

    expect(message.openclawActivities).toHaveLength(1);
    expect(message.openclawActivities[0].kind).toBe("run.completed");
    expect(message.openclawActivities[0].summary).toBe("new done");
    expect(message.answer).toBe("最终回复");
  });

  it("restores an active OpenClaw message snapshot after switching back to a running conversation", () => {
    const loadedMessages: any[] = [
      {
        id: "agent:main:current:user:1",
        _openclawClientMessageId: "client-current-running",
        role: "assistant",
        question: "帮我检查环境",
        answer: "",
        loading: false,
        conversation_id: "agent:main:current",
        openclawActivities: [],
      },
    ];
    const activeMessage: any = {
      id: "optimistic-running",
      _openclawClientMessageId: "client-current-running",
      role: "assistant",
      question: "帮我检查环境",
      answer: "",
      loading: true,
      conversation_id: "agent:main:current",
      openclawActivities: [
        {
          key: "thinking:12",
          seq: 12,
          kind: "assistant.thinking",
          title: "已完成深度思考",
          summary: "正在检查本地网关状态",
        },
      ],
    };

    const merged = mergeOpenClawActiveMessageIntoList(
      loadedMessages,
      activeMessage,
      "agent:main:current"
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("agent:main:current:user:1");
    expect(merged[0].loading).toBe(true);
    expect(merged[0].openclawActivities).toHaveLength(1);
    expect(merged[0].openclawActivities[0].summary).toBe("正在检查本地网关状态");
  });

  it("keeps a single optimistic OpenClaw assistant row after the stream message id and conversation id are resolved", () => {
    const loadedMessages: any[] = [
      {
        id: "optimistic-client-id",
        _openclawClientMessageId: "optimistic-client-id",
        role: "assistant",
        question: "今天北京天气如何",
        answer: "",
        loading: true,
        conversation_id: "",
        openclawActivities: [],
      },
    ];
    const activeMessage: any = {
      id: "agent:main:weather:assistant:12",
      _openclawClientMessageId: "optimistic-client-id",
      role: "assistant",
      question: "今天北京天气如何",
      answer: "北京今天天气：晴天",
      loading: true,
      conversation_id: "agent:main:weather",
      openclawActivities: [
        {
          key: "thinking:12",
          seq: 12,
          kind: "assistant.thinking",
          title: "已完成深度思考",
          summary: "The user is asking about the weather in Beijing today.",
        },
      ],
    };

    const merged = mergeOpenClawActiveMessageIntoList(
      loadedMessages,
      activeMessage,
      "agent:main:weather"
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]._openclawClientMessageId).toBe("optimistic-client-id");
    expect(merged[0].conversation_id).toBe("agent:main:weather");
    expect(merged[0].answer).toContain("北京今天天气");
  });

  it("keeps the hydrated OpenClaw final row when a completed active snapshot has duplicate answer blocks", () => {
    const conversationId = "agent:main:shows";
    const question = "从网上搜索五部电视剧并总结";
    const finalAnswer = "搜索「2026年热门电视剧推荐」找到 20 条结果，展示前 5 条。";
    const hydratedMessage: any = {
      id: "assistant-history-final",
      _openclawClientMessageId: "client-shows",
      role: "assistant",
      conversation_id: conversationId,
      message: JSON.stringify([{ role: "user", content: question }]),
      answer: finalAnswer,
      loading: false,
      openclawTurn: {
        events: [
          {
            source: "history",
            kind: "assistant.message",
          },
        ],
      },
      openclawTimelineItems: [
        {
          key: "history-answer",
          type: "answer",
          seq: 20,
          content: finalAnswer,
        },
      ],
      outputFiles: [],
    };
    const duplicateActiveSnapshot: any = {
      id: "assistant-active-duplicate",
      _openclawClientMessageId: "client-shows",
      role: "assistant",
      conversation_id: conversationId,
      question,
      answer: `我来帮您从网上搜索五部电视剧并总结。让我先搜索相关推荐信息。${finalAnswer}`,
      loading: false,
      openclawTurn: {
        events: [
          {
            source: "stream",
            kind: "assistant.message",
          },
        ],
      },
      openclawTimelineItems: [
        {
          key: "active-combined-answer",
          type: "answer",
          seq: 12,
          content: `我来帮您从网上搜索五部电视剧并总结。让我先搜索相关推荐信息。${finalAnswer}`,
        },
        {
          key: "active-intro-answer",
          type: "answer",
          seq: 13,
          content: "我来帮您从网上搜索五部电视剧并总结。让我先搜索相关推荐信息。",
        },
        {
          key: "active-final-answer",
          type: "answer",
          seq: 20,
          content: finalAnswer,
        },
      ],
      outputFiles: [
        {
          id: "active-file",
          file_name: "shows.md",
        },
      ],
    };

    const merged = mergeOpenClawActiveMessageIntoList(
      [hydratedMessage],
      duplicateActiveSnapshot,
      conversationId
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("assistant-history-final");
    expect(merged[0].answer).toBe(finalAnswer);
    expect((merged[0].openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(1);
    expect(merged[0].outputFiles).toHaveLength(1);
  });

  it("separates multiple OpenClaw thinking blocks while streaming", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "Search failed. Let me try a different query.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "Web search is failing. Let me try web_fetch.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.answer).toBe("");
    expect(message.reasoning_content).toBe(
      "Search failed. Let me try a different query.\n\nWeb search is failing. Let me try web_fetch."
    );
    expect(message.openclawActivities.map((item: any) => item.summary)).toEqual([
      "Search failed. Let me try a different query.",
      "Web search is failing. Let me try web_fetch.",
    ]);
  });

  it("keeps non-final OpenClaw answer deltas hidden after later tool events", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:timeline-order",
    };

    processStreamDataItem(
      {
        id: "chatcmpl-ordering",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "先给出一个临时正文。",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        event_kind: "tool.call",
        payload: {
          seq: 5,
          data: {
            name: "write",
            args: {
              path: "books.txt",
            },
          },
        },
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "Used a tool",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.openclawTimelineItems.map((item: any) => item.type)).toEqual(["tool_call"]);
    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);
  });

  it("keeps streamed OpenClaw answer chunks hidden until the final assistant.message arrives", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:weather",
    };

    processStreamDataItem(
      {
        data: {
          session_id: "agent:main:weather",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "重庆今天天气：**",
                message_seq: 12,
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        data: {
          session_id: "agent:main:weather",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "🌦️ 多云转阵雨，气温 **17°C**，体感 **13°C**",
                message_seq: 13,
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(0);

    mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "weather-answer-final",
          sessionId: "agent:main:weather",
          seq: 14,
          kind: "assistant.message",
          payload: {
            content: "重庆今天天气：**🌦️ 多云转阵雨，气温 **17°C**，体感 **13°C**",
          },
        },
      ],
    });

    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toContain("重庆今天天气");
    expect(answerItems[0].content).toContain("17°C");
  });

  it("does not trim a streamed OpenClaw weather answer down to a tail fragment when earlier thinking overlaps semantically", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
      openclawTimelineItems: [],
      conversation_id: "agent:main:macau",
    };

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "User asks about Macau weather." } }],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        status: "thinking",
        event_kind: "assistant.thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [{ delta: { content: "澳门天气：雷暴天气，29度，体感32度，湿度84%，风力28km/h。" } }],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          session_id: "agent:main:macau",
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "**澳门今天天气：**\n\n⛈️ 雷暴，气温 **29°C**，体感 **32°C**\n\n- 湿度：84%\n- 风力：东北风 28km/h\n\n雷暴天气，尽量避免外出，注意安全！⚡🌧️",
                message_seq: 12,
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    const answerItems = (message.openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toContain("澳门今天天气");
    expect(answerItems[0].content).toContain("雷暴天气，尽量避免外出");
    expect(answerItems[0].content).not.toBe("暴天气，尽量避免外出，注意安全！⚡🌧️");
  });

  it("dedupes identical OpenClaw thinking cards when realtime stream and event hydration use different seq values", () => {
    const message: any = {
      answer: "",
      reasoning_content: "User asks about Macau weather.",
      reasoning_expanded: true,
      conversation_id: "agent:main:macau",
      openclawActivities: [
        {
          key: "thinking-live",
          sessionId: "agent:main:macau",
          seq: 1,
          kind: "assistant.thinking",
          title: "已完成深度思考",
          summary: "User asks about Macau weather.",
          detail: "User asks about Macau weather.",
        },
      ],
      openclawTimelineItems: [
        {
          key: "thinking-live",
          mergeKey: "thinking:user asks about macau weather.",
          sessionId: "agent:main:macau",
          seq: 1,
          type: "thinking",
          kind: "assistant.thinking",
          title: "已完成深度思考",
          content: "User asks about Macau weather.",
          detail: "User asks about Macau weather.",
          activity: {
            key: "thinking-live",
            sessionId: "agent:main:macau",
            seq: 1,
            kind: "assistant.thinking",
            title: "已完成深度思考",
            summary: "User asks about Macau weather.",
            detail: "User asks about Macau weather.",
          },
        },
      ],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(message, {
      events: [
        {
          id: "event-thinking-31",
          sessionId: "agent:main:macau",
          seq: 31,
          kind: "assistant.thinking",
          payload: {
            content: "User asks about Macau weather.",
          },
        },
      ],
    });

    expect(changed).toBe(true);
    expect((message.openclawTimelineItems || []).filter((item: any) => item.type === "thinking")).toHaveLength(1);
  });

  it("does not accumulate stale OpenClaw answer snapshots when the active message is merged back into the list", () => {
    const baseMessage: any = {
      id: "optimistic-1",
      _openclawClientMessageId: "optimistic-1",
      question: "今天香港天气如何",
      conversation_id: "agent:main:hongkong",
      answer: "**香港",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawTimelineItems: [
        {
          key: "thinking:1",
          type: "thinking",
          kind: "assistant.thinking",
          seq: 1,
          content: "先查看香港天气。",
        },
        {
          key: "tool-call:2",
          type: "tool_call",
          kind: "tool.call",
          seq: 2,
          title: "Used Exec",
          tool: { name: "exec", displayName: "Exec", input: "curl wttr.in/HongKong" },
        },
        {
          key: "tool-result:3",
          type: "tool_result",
          kind: "tool.result",
          seq: 3,
          title: "Tool output",
          tool: { name: "exec", displayName: "Exec", output: "HongKong: 🌧️ +32°C ..." },
        },
        {
          key: "openclaw:answer:live:0",
          type: "answer",
          seq: 4,
          content: "**香港",
        },
      ],
    };

    const nextSnapshot: any = {
      ...baseMessage,
      answer: "**香港今天天气：**\n\n🌧️ 阵雨，气温 **32°C**，体感 **42°C**",
      openclawTimelineItems: [
        {
          key: "thinking:1",
          type: "thinking",
          kind: "assistant.thinking",
          seq: 1,
          content: "先查看香港天气。",
        },
        {
          key: "tool-call:2",
          type: "tool_call",
          kind: "tool.call",
          seq: 2,
          title: "Used Exec",
          tool: { name: "exec", displayName: "Exec", input: "curl wttr.in/HongKong" },
        },
        {
          key: "tool-result:3",
          type: "tool_result",
          kind: "tool.result",
          seq: 3,
          title: "Tool output",
          tool: { name: "exec", displayName: "Exec", output: "HongKong: 🌧️ +32°C ..." },
        },
        {
          key: "openclaw:answer:live:0",
          type: "answer",
          seq: 7,
          content: "**香港今天天气：**\n\n🌧️ 阵雨，气温 **32°C**，体感 **42°C**",
        },
      ],
    };

    const mergedOnce = mergeOpenClawActiveMessageIntoList([baseMessage], nextSnapshot, "agent:main:hongkong");
    const mergedTwice = mergeOpenClawActiveMessageIntoList(mergedOnce, {
      ...nextSnapshot,
      answer: "**香港今天天气：**\n\n🌧️ 阵雨，气温 **32°C**，体感 **42°C**\n\n- 湿度：71%",
      openclawTimelineItems: [
        ...nextSnapshot.openclawTimelineItems.slice(0, 3),
        {
          key: "openclaw:answer:live:0",
          type: "answer",
          seq: 9,
          content: "**香港今天天气：**\n\n🌧️ 阵雨，气温 **32°C**，体感 **42°C**\n\n- 湿度：71%",
        },
      ],
    }, "agent:main:hongkong");

    const answerItems = (mergedTwice[0].openclawTimelineItems || []).filter((item: any) => item.type === "answer");
    expect(answerItems).toHaveLength(1);
    expect(answerItems[0].content).toContain("香港今天天气");
    expect(answerItems[0].content).toContain("湿度：71%");
  });

  it("does not bind canonical ledger recovery events to a non-active message without turn identity", () => {
    const conversationId = "agent:main:dashboard:ledger-bind";
    const staleMessage: any = {
      id: `${conversationId}:user:19`,
      question: "RUNNING-SWITCH-VERIFY new request",
      answer: "",
      conversation_id: conversationId,
      loading: false,
      openclawActivities: [],
      openclawTimelineItems: [],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(staleMessage, {
      recent_events: [
        {
          protocol_version: "openclaw.ledger.v1",
          seq: 93,
          session_id: conversationId,
          conversation_id: conversationId,
          turn_id: `${conversationId}:turn:old`,
          active_request_id: "old-request",
          part_id: `${conversationId}:turn:old:answer:0`,
          part_type: "answer",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "old final answer must not attach to the latest message",
          terminal_status: "completed",
          created_at: "2026-06-11T13:00:00.000Z",
          raw_event_ref: "old-final",
        },
      ],
    });

    expect(changed).toBe(false);
    expect(staleMessage.answer).toBe("");
    expect(staleMessage.openclawTimelineItems || []).toHaveLength(0);
  });

  it("allows an active OpenClaw message to bind its first canonical ledger turn", () => {
    const conversationId = "agent:main:dashboard:ledger-bind-active";
    const activeMessage: any = {
      id: "optimistic-active-ledger-bind",
      _openclawClientMessageId: "optimistic-active-ledger-bind",
      _openclawTurnStartSeq: 200,
      question: "RUNNING-SWITCH-VERIFY active request",
      answer: "",
      conversation_id: conversationId,
      loading: true,
      openclawActivities: [],
      openclawTimelineItems: [],
    };

    const changed = mergeOpenClawTimelineEventsIntoMessage(activeMessage, {
      recent_events: [
        {
          protocol_version: "openclaw.ledger.v1",
          seq: 201,
          session_id: conversationId,
          conversation_id: conversationId,
          turn_id: `${conversationId}:turn:current`,
          active_request_id: "current-request",
          part_id: `${conversationId}:turn:current:answer:0`,
          part_type: "answer",
          event_type: "part.replace",
          operation: "replace",
          visibility: "final",
          text: "current final answer should attach",
          terminal_status: "completed",
          created_at: "2026-06-11T13:01:00.000Z",
          raw_event_ref: "current-final",
        },
      ],
    });

    expect(changed).toBe(true);
    expect(activeMessage.answer).toContain("current final answer should attach");
    expect((activeMessage.openclawTimelineItems || []).filter((item: any) => item.type === "answer")).toHaveLength(1);
  });

  it("does not overwrite realtime OpenClaw tool chain chunks that share the same stream id", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    const sharedStreamId = "chatcmpl-same-stream-id";

    processStreamDataItem(
      {
        id: sharedStreamId,
        event_kind: "assistant.thinking",
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                reasoning_content: "Need to search first.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        id: sharedStreamId,
        event_kind: "tool.call",
        status: "thinking",
        payload: {
          data: {
            name: "web_search",
            args: {
              query: "OpenClaw 53AI",
            },
          },
        },
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                reasoning_content: "调用工具：Web Search",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        id: sharedStreamId,
        event_kind: "tool.result",
        status: "thinking",
        payload: {
          data: {
            name: "web_search",
            result: {
              details: "Found 3 sources.",
            },
          },
        },
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                reasoning_content: "工具返回结果：Found 3 sources.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual([
      "assistant.thinking",
      "tool.call",
      "tool.result",
    ]);
    expect(message.openclawActivities.map((item: any) => item.summary)).toEqual([
      "Need to search first.",
      "调用工具：Web Search",
      "工具返回结果：Found 3 sources.",
    ]);
    expect(message.openclawActivities[1].tool.displayName).toBe("Web Search");
    expect(message.openclawActivities[1].tool.input).toContain("OpenClaw 53AI");
    expect(message.openclawActivities[2].tool.output).toContain("Found 3 sources.");
  });

  it("keeps OpenClaw stream tool events when chunks only carry metadata payloads", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      openclawActivities: [],
    };

    processStreamDataItem(
      {
        id: "tool-call-without-delta-text",
        event_kind: "tool.call",
        status: "thinking",
        payload: {
          data: {
            name: "web_search",
            args: {
              query: "recent movies recommendations",
            },
          },
        },
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {},
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    processStreamDataItem(
      {
        id: "tool-result-without-delta-text",
        event_kind: "tool.result",
        status: "thinking",
        payload: {
          data: {
            name: "web_search",
            result: {
              details: "Network search failed.",
            },
          },
        },
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {},
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.answer).toBe("");
    expect(message.reasoning_content).toBe("");
    expect(message.openclawActivities.map((item: any) => item.kind)).toEqual([
      "tool.call",
      "tool.result",
    ]);
    expect(message.openclawActivities[0].tool.displayName).toBe("Web Search");
    expect(message.openclawActivities[0].tool.input).toContain("recent movies recommendations");
    expect(message.openclawActivities[1].tool.output).toContain("Network search failed.");
  });

  it("binds an OpenClaw assistant message to the resolved session id from stream chunks", () => {
    const message: any = {
      answer: "",
      conversation_id: "hub53ai:new:test",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          session_id: "agent:main:new-session",
          conversation_id: "agent:main:new-session",
          event_kind: "assistant.message",
          choices: [
            {
              delta: {
                content: "已创建新会话",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.conversation_id).toBe("agent:main:new-session");
    expect(message.answer).toBe("已创建新会话");
  });

  it("keeps OpenClaw inline think tags inside reasoning while streaming", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "<think>先检查环境",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "，再回复</think>最终答案",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.reasoning_content).toBe("先检查环境，再回复");
    expect(message.answer).toBe("最终答案");
  });

  it("separates multiple inline OpenClaw think tags in one chunk", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "<think>第一步：确认问题</think><think>第二步：准备答案</think>最终答案",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.reasoning_content).toBe("第一步：确认问题\n\n第二步：准备答案");
    expect(message.answer).toBe("最终答案");
  });

  it("removes OpenClaw reasoning text when the final answer repeats the reasoning suffix", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };
    const duplicatedReasoning =
      "正在处理您的请求...Same issue - web search not working. I’ll recommend 5 movies based on my knowledge and summarize them.";

    processStreamDataItem(
      {
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: duplicatedReasoning,
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "Same issue - web search not working. I’ll recommend 5 movies based on my knowledge and summarize them.网络搜索暂不可用，我直接推荐并总结5部经典电影。",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.reasoning_content).toBe(duplicatedReasoning);
    expect(message.answer).toBe("网络搜索暂不可用，我直接推荐并总结5部经典电影。");
  });

  it("removes repeated reasoning prefixes even when whitespace differs", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "First I will check the local gateway, then summarize the result.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        event_kind: "assistant.message",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "First I will check the local gateway, then\nsummarize the result.本地连通性正常。",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.answer).toBe("本地连通性正常。");
  });

  it("removes OpenClaw reasoning leakage from final replacement chunks", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "The user wants me to find 10 books from the web and summarize them. Let me search for popular/recommended books across different categories.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        mode: "replace",
        replace: true,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "好的，我来搜索10本值得一读的好书并为你总结。",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        status: "thinking",
        mode: "replace",
        replace: true,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "Search failed. Let me try a different query.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        status: "thinking",
        mode: "append",
        replace: false,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "Web search is failing. Let me try web_fetch to get some content from a book recommendation site.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        event_kind: "assistant.message",
        mode: "replace",
        replace: true,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content:
                  "好的，我来搜索10本值得一读的好书并为你总结。Search failed. Let me try a different query.Web search is failing. Let me try web_fetch to get some content from a book recommendation site.网络连接有些问题，我直接基于知识库为你推荐10本经典好书并\n总结：",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.reasoning_content).toBe(
      "Search failed. Let me try a different query.\n\nWeb search is failing. Let me try web_fetch to get some content from a book recommendation site."
    );
    expect(message.answer).toBe(
      "好的，我来搜索10本值得一读的好书并为你总结。网络连接有些问题，我直接基于知识库为你推荐10本经典好书并\n总结："
    );
  });

  it("removes reasoning that was already appended to the answer before later thinking detection", () => {
    const message: any = {
      answer: "正在检查本地网关状态",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        status: "thinking",
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "正在检查本地网关状态",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.reasoning_content).toBe("正在检查本地网关状态");
    expect(message.answer).toBe("");
  });

  it("replaces OpenClaw provisional content and ignores repeated final answer chunks", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
    };

    processStreamDataItem(
      {
        mode: "append",
        replace: false,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "Test message again.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        mode: "replace",
        replace: true,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "收到！✅",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        mode: "replace",
        replace: false,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "收到！✅",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );
    processStreamDataItem(
      {
        status: "thinking",
        mode: "replace",
        replace: true,
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "Test message again.",
              },
            },
          ],
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.answer).toBe("收到！✅");
    expect(message.reasoning_content).toBe("Test message again.");
  });

  it("marks OpenClaw interrupted events without treating them as network errors", () => {
    const message: any = {
      answer: "",
      reasoning_content: "正在处理您的请求",
      reasoning_expanded: true,
      loading: true,
    };

    processStreamDataItem(
      {
        kind: "run.interrupted",
        payload: { reason: "user stop" },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.loading).toBe(false);
    expect(message.error).toBe(false);
    expect(message.interrupted).toBe(true);
    expect(message.answer).toBe("本次运行已中断");
    expect(message.reasoning_content).toBe("正在处理您的请求");
  });

  it("maps OpenClaw interrupted error chunks to an interrupted state", () => {
    const message: any = {
      answer: "",
      reasoning_content: "正在处理您的请求",
      reasoning_expanded: true,
      loading: true,
    };

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "⚠️ run.interrupted",
              },
              finish_reason: "error",
            },
          ],
          error: {
            code: "RUN_INTERRUPTED",
            message: "run.interrupted",
          },
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.loading).toBe(false);
    expect(message.error).toBe(false);
    expect(message.interrupted).toBe(true);
    expect(message.answer).toBe("本次运行已中断");
    expect(message.reasoning_content).toBe("正在处理您的请求");
  });

  it("maps generic OpenClaw error chunks to a failed assistant state", () => {
    const message: any = {
      answer: "部分回复",
      reasoning_content: "",
      reasoning_expanded: true,
      loading: true,
    };

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          choices: [
            {
              delta: {
                content: "",
              },
              finish_reason: "error",
            },
          ],
          error: {
            code: "RUN_FAILED",
            message: "OpenClaw 运行失败",
          },
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.loading).toBe(false);
    expect(message.error).toBe(true);
    expect(message.interrupted).not.toBe(true);
    expect(message.answer).toBe("OpenClaw 运行失败");
  });

  it("prefers structured OpenClaw auth failure messages over low-information error text", () => {
    const message: any = {
      answer: "",
      reasoning_content: "",
      reasoning_expanded: true,
      loading: true,
    };
    const userMessage =
      "QClaw/OpenClaw 智能体登录失败或模型供应商认证失效。请重新登录 QClaw/OpenClaw，或检查模型供应商的 API Key、Base URL 与账号权限。当前模型：pool-hy3-preview。";

    processStreamDataItem(
      {
        data: {
          object: "chat.completion.chunk",
          event_kind: "run.failed",
          payload: {
            failure_code: "QCLAW_LOGIN_REQUIRED",
            failure_reason: "qclaw_login_or_provider_auth_failed",
            user_message: userMessage,
            error_message: userMessage,
            error: "error",
            message: "error",
            terminal_status: "failed",
          },
          choices: [
            {
              delta: {
                content: "⚠️ error",
              },
              finish_reason: "error",
            },
          ],
          error: {
            code: "QCLAW_LOGIN_REQUIRED",
            message: "error",
          },
        },
      },
      message,
      () => null,
      { openclaw: true }
    );

    expect(message.loading).toBe(false);
    expect(message.error).toBe(true);
    expect(message.interrupted).not.toBe(true);
    expect(message.answer).toBe(userMessage);
  });

  it("preserves OpenClaw auth failure messages from stream-level SSE error chunks", () => {
    const { result } = renderHook(() => useChatStream());
    const message: any = {
      answer: "",
      reasoning_content: "",
      loading: true,
    };
    const userMessage =
      "QClaw/OpenClaw 智能体登录失败或模型供应商认证失效。请重新登录 QClaw/OpenClaw，或检查模型供应商的 API Key、Base URL 与账号权限。当前模型：pool-hy3-preview。";
    const response = `data: ${JSON.stringify({
      error: {
        message: userMessage,
        type: "one_api_error",
      },
    })}\n\ndata: [DONE]\n\n`;

    let processedLength = 0;
    act(() => {
      processedLength = result.current.processStreamData(
        { event: { target: { response } } },
        0,
        message,
        false,
        () => null,
        { openclaw: true }
      );
    });

    expect(processedLength).toBe(response.length);
    expect(message.loading).toBe(false);
    expect(message.error).toBe(true);
    expect(message.answer).toBe(userMessage);
  });
});
