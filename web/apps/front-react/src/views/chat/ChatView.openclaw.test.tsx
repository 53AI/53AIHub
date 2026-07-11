import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatProvider, ChatView, useConversationStore } from "@km/shared-business/chat";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const mocks = vi.hoisted(() => ({
  chatInputProps: null as any,
  sendMessage: vi.fn(),
  handleStop: vi.fn(),
  loadMessageList: vi.fn(),
  updateMessageList: vi.fn(),
  clearMessageList: vi.fn(),
  getOpenClawMessageListMaxActivitySeq: vi.fn(),
  getOpenClawTimelineMaxSeq: vi.fn(),
  mergeOpenClawTimelineEventsIntoMessage: vi.fn(),
  chatMessagesHookOptions: null as any,
  chatMessagesProps: null as any,
  chatMessagesState: {
    messageList: [] as any[],
    hasMore: false,
    isLoadingMore: false,
    isLoadingMessages: false,
  },
  chatSendState: {
    isStreaming: true,
    isStopping: false,
  },
}));

vi.mock("../../../../../packages/shared-business/src/chat/components/ChatView/ChatInput", () => ({
  default: (props: any) => {
    mocks.chatInputProps = props;
    return <div data-testid="chat-input" />;
  },
}));

vi.mock("../../../../../packages/shared-business/src/chat/components/ChatMessages", () => ({
  ChatMessages: (props: any) => {
    mocks.chatMessagesProps = props;
    return <div data-testid="chat-messages" />;
  },
  default: (props: any) => {
    mocks.chatMessagesProps = props;
    return <div data-testid="chat-messages" />;
  },
}));

vi.mock("../../../../../packages/shared-business/src/chat/hooks", () => ({
  getOpenClawMessageListMaxActivitySeq: mocks.getOpenClawMessageListMaxActivitySeq,
  getOpenClawTimelineMaxSeq: mocks.getOpenClawTimelineMaxSeq,
  mergeOpenClawActiveMessageIntoList: vi.fn((list: any[]) => list),
  mergeOpenClawTimelineEventsIntoMessage: mocks.mergeOpenClawTimelineEventsIntoMessage,
  useChatMessages: vi.fn((options?: any) => {
    mocks.chatMessagesHookOptions = options;
    return {
      state: mocks.chatMessagesState,
      loadMessageList: mocks.loadMessageList,
      handleLoadListMore: vi.fn(),
      updateMessageList: mocks.updateMessageList,
      clearMessageList: mocks.clearMessageList,
    };
  }),
  useChatSend: vi.fn(() => ({
    sendMessage: mocks.sendMessage,
    handleStop: mocks.handleStop,
    isStreaming: mocks.chatSendState.isStreaming,
    isStopping: mocks.chatSendState.isStopping,
  })),
  useChatTimeout: vi.fn(() => ({
    setLastMessageTime: vi.fn(),
    resetTimer: vi.fn(),
  })),
  useEmbedMode: vi.fn(() => ({
    isEmbedMode: false,
    notifyReady: vi.fn(),
    requestClose: vi.fn(),
  })),
}));

function renderOpenClawChatView(
  conversationApiOverrides: Record<string, any> = {},
  viewOverrides: Record<string, any> = {}
) {
  const conversationApi = {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue({ data: { conversations: [] } }),
    messages: vi.fn().mockResolvedValue({ data: { messages: [] } }),
    edit: vi.fn(),
    del: vi.fn(),
    completions: vi.fn(),
    events: vi.fn().mockResolvedValue({ data: { events: [] } }),
    ...conversationApiOverrides,
  };

  const view = render(
    <ChatProvider
      config={{
        type: "agent",
        title: "OpenClaw",
        features: {},
      }}
      adapters={{
        conversationApi: conversationApi as any,
        agentApi: {
          detail: vi.fn(),
        } as any,
        uploadApi: {
          upload: vi.fn(),
        },
      }}
    >
      <ChatView
        agentId="2"
        initialConversationId="agent:main:main"
        features={{ openclaw: true, skipInitialLoad: true, ...(viewOverrides.features || {}) } as any}
        agentInfo={{
          agent_id: 2,
          name: "OpenClaw",
          custom_config_obj: {},
          settings_obj: {},
        } as any}
        {...viewOverrides}
      />
    </ChatProvider>
  );

  return { ...view, conversationApi };
}

describe("ChatView OpenClaw stop/send flow", () => {
  beforeEach(() => {
    mocks.chatInputProps = null;
    mocks.sendMessage.mockReset().mockResolvedValue(undefined);
    mocks.handleStop.mockReset();
    mocks.loadMessageList.mockReset().mockResolvedValue([]);
    mocks.updateMessageList.mockReset();
    mocks.clearMessageList.mockReset();
    mocks.chatMessagesHookOptions = null;
    mocks.getOpenClawMessageListMaxActivitySeq.mockReset().mockReturnValue(0);
    mocks.chatMessagesProps = null;
    mocks.chatMessagesState.messageList = [];
    mocks.chatMessagesState.hasMore = false;
    mocks.chatMessagesState.isLoadingMore = false;
    mocks.chatMessagesState.isLoadingMessages = false;
    mocks.getOpenClawTimelineMaxSeq.mockReset().mockImplementation((payload: any) => {
      const events = payload?.events ?? payload?.data?.events ?? [];
      return events.reduce((max: number, event: any) => Math.max(max, Number(event?.seq) || 0), 0);
    });
    mocks.mergeOpenClawTimelineEventsIntoMessage.mockReset().mockReturnValue(false);
    mocks.chatSendState.isStreaming = true;
    mocks.chatSendState.isStopping = false;
    useConversationStore.setState({
      conversations: [],
      current_agentid: 0,
      current_conversationid: 0,
      next_agent_prepare: {},
      currentVirtualId: "",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps OpenClaw input and stop button disabled while stop is pending", async () => {
    mocks.chatSendState.isStopping = true;

    render(
      <ChatProvider
        config={{
          type: "agent",
          title: "OpenClaw",
          features: {},
        }}
        adapters={{
          conversationApi: {
            create: vi.fn(),
            list: vi.fn().mockResolvedValue({ data: { conversations: [] } }),
            messages: vi.fn().mockResolvedValue({ data: { messages: [] } }),
            edit: vi.fn(),
            del: vi.fn(),
            completions: vi.fn(),
          } as any,
          agentApi: {
            detail: vi.fn(),
          } as any,
          uploadApi: {
            upload: vi.fn(),
          },
        }}
      >
        <ChatView
          agentId="2"
          features={{ openclaw: true, skipInitialLoad: true }}
          agentInfo={{
            agent_id: 2,
            name: "OpenClaw",
            custom_config_obj: {},
            settings_obj: {},
          } as any}
        />
      </ChatProvider>
    );

    expect(mocks.chatInputProps.isStreaming).toBe(true);
    expect(mocks.chatInputProps.disabled).toBe(true);
    expect(mocks.chatInputProps.stopDisabled).toBe(true);

    act(() => {
      mocks.chatInputProps.onStop();
    });
    await act(async () => {
      await mocks.chatInputProps.onSend("第二条");
    });

    expect(mocks.handleStop).not.toHaveBeenCalled();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it("uses a bounded message history limit for OpenClaw", async () => {
    renderOpenClawChatView();

    expect(mocks.chatMessagesHookOptions).toEqual({ limit: 30 });
  });

  it("does not load stale OpenClaw messages or snapshots while the runtime is unavailable", async () => {
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: "agent:main:dashboard:stale-qclaw",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    const snapshot = vi.fn().mockResolvedValue({ data: { ledger_events: [] } });

    const { conversationApi } = renderOpenClawChatView(
      { snapshot },
      {
        initialConversationId: undefined,
        features: { openclawInputDisabled: true, skipInitialLoad: false },
      }
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.clearMessageList).toHaveBeenCalled();
    expect(mocks.loadMessageList).not.toHaveBeenCalled();
    expect((conversationApi as any).snapshot).not.toHaveBeenCalled();
    expect(useConversationStore.getState().current_conversationid).toBe(0);
  });

  it("reconciles a terminal OpenClaw snapshot after stop", async () => {
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        ledger_events: [
          {
            protocol_version: "openclaw.ledger.v1",
            seq: 12,
            session_id: "agent:main:main",
            conversation_id: "agent:main:main",
            turn_id: "agent:main:main:turn:req-stop",
            active_request_id: "req-stop",
            part_id: "agent:main:main:turn:req-stop:status",
            part_type: "status",
            event_type: "turn.interrupted",
            operation: "close",
            visibility: "final",
            terminal_status: "interrupted",
            created_at: "2026-06-12T03:00:00.000Z",
            raw_event_ref: "raw-stop",
          },
        ],
      },
    });

    const { conversationApi } = renderOpenClawChatView({ snapshot });
    await act(async () => {});
    mocks.loadMessageList.mockClear();
    conversationApi.snapshot.mockClear();

    act(() => {
      mocks.chatInputProps.onStop();
    });

    expect(mocks.handleStop).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", expect.any(Object));
    });
    await waitFor(() => {
      expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);
    });
  });

  it("shows conversation loading overlay and disables input while messages are loading", async () => {
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.isLoadingMessages = true;

    renderOpenClawChatView();
    await act(async () => {});

    expect(mocks.chatMessagesProps.isConversationLoading).toBe(true);
    expect(mocks.chatInputProps.disabled).toBe(true);
    expect(mocks.chatInputProps.disabledReason).toBe("加载消息...");
  });

  it("keeps the loading overlay visible after an initial OpenClaw conversation id resolves and before messages load", async () => {
    mocks.chatSendState.isStreaming = false;
    const messages = deferred<any[]>();
    mocks.loadMessageList.mockReturnValue(messages.promise);
    renderOpenClawChatView(
      {},
      {
        initialConversationId: "agent:main:dashboard:resolved",
        features: {
          openclaw: true,
          skipInitialLoad: true,
        },
      }
    );
    await act(async () => {});

    expect(useConversationStore.getState().current_conversationid).toBe("agent:main:dashboard:resolved");
    expect(mocks.loadMessageList).toHaveBeenCalledWith("agent:main:dashboard:resolved", expect.any(Function));
    expect(mocks.chatMessagesProps.isConversationLoading).toBe(true);
    expect(mocks.chatInputProps.disabled).toBe(true);

    await act(async () => {
      messages.resolve([]);
      await messages.promise;
    });

    expect(mocks.chatMessagesProps.isConversationLoading).toBe(false);
    expect(mocks.chatInputProps.disabled).toBe(false);
  });

  it("exposes only copy, add-to-knowledge, and regenerate actions for OpenClaw assistant messages", async () => {
    mocks.chatSendState.isStreaming = false;
    const onAddAsMd = vi.fn();

    renderOpenClawChatView(
      {},
      {
        onAddAsMd,
        features: {
          openclaw: true,
          skipInitialLoad: true,
          messageMenu: true,
          share: true,
        },
      }
    );
    await act(async () => {});

    expect(mocks.chatMessagesProps.features.menu).toEqual({
      copy: true,
      regenerate: true,
      share: false,
      feedback: false,
      addAsMd: true,
    });
    expect(mocks.chatMessagesProps.onAddAsMd).toBe(onAddAsMd);

    await act(async () => {
      mocks.chatMessagesProps.onRegenerate({
        id: "assistant-1",
        original_question: "重新查询 OpenClaw 状态",
        question: "旧问题",
        uploaded_files: [{ id: "file-1", name: "trace.log" }],
      });
    });

    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      question: "重新查询 OpenClaw 状态",
      openclaw: true,
      files: [expect.objectContaining({ id: "file-1", filename: "trace.log" })],
    }));
  });

  it("keeps initial OpenClaw conversation resolving on loading without initializing a blank conversation", async () => {
    mocks.chatSendState.isStreaming = false;
    const { conversationApi } = renderOpenClawChatView(
      {},
      {
        initialConversationId: undefined,
        features: {
          openclaw: true,
          initialConversationResolving: true,
        },
      }
    );
    await act(async () => {});

    expect(mocks.chatMessagesProps.isConversationLoading).toBe(true);
    expect(mocks.chatInputProps.disabled).toBe(true);
    expect(mocks.clearMessageList).not.toHaveBeenCalled();
    expect(mocks.loadMessageList).not.toHaveBeenCalled();
    expect(conversationApi.list).not.toHaveBeenCalled();
    expect(useConversationStore.getState().current_conversationid).toBe(0);
  });

  it("does not clear the optimistic first message when a blank OpenClaw send resolves to a session id", async () => {
    mocks.chatSendState.isStreaming = false;
    const { rerender } = renderOpenClawChatView(
      {},
      {
        initialConversationId: undefined,
        features: {
          openclaw: true,
          skipInitialLoad: true,
        },
      }
    );
    await act(async () => {});
    mocks.clearMessageList.mockClear();
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await mocks.chatInputProps.onSend("第一条消息");
    });
    const sendOptions = mocks.sendMessage.mock.calls[0]?.[0];
    expect(sendOptions?.conversation_id).toBe("");

    act(() => {
      sendOptions.onMessageListChange((list: any[]) => [
        ...list,
        {
          id: "optimistic",
          question: "第一条消息",
          answer: "",
          conversation_id: "",
          loading: true,
        },
      ]);
      sendOptions.onOpenClawConversationResolved("agent:main:dashboard:first");
    });

    rerender(
      <ChatProvider
        config={{
          type: "agent",
          title: "OpenClaw",
          features: {},
        }}
        adapters={{
          conversationApi: {
            create: vi.fn(),
            list: vi.fn().mockResolvedValue({ data: { conversations: [] } }),
            messages: vi.fn().mockResolvedValue({ data: { messages: [] } }),
            edit: vi.fn(),
            del: vi.fn(),
            completions: vi.fn(),
            events: vi.fn().mockResolvedValue({ data: { events: [] } }),
          } as any,
          agentApi: {
            detail: vi.fn(),
          } as any,
          uploadApi: {
            upload: vi.fn(),
          },
        }}
      >
        <ChatView
          agentId="2"
          initialConversationId="agent:main:dashboard:first"
          features={{ openclaw: true, skipInitialLoad: true } as any}
          agentInfo={{
            agent_id: 2,
            name: "OpenClaw",
            custom_config_obj: {},
            settings_obj: {},
          } as any}
        />
      </ChatProvider>
    );
    await act(async () => {});

    expect(mocks.clearMessageList).not.toHaveBeenCalled();
    expect(mocks.loadMessageList).not.toHaveBeenCalled();
  });

  it("rebases optimistic OpenClaw timeline items when a blank conversation resolves before refresh", async () => {
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [];
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });

    renderOpenClawChatView(
      {},
      {
        initialConversationId: undefined,
        features: {
          openclaw: true,
          skipInitialLoad: true,
        },
      }
    );
    await act(async () => {});

    await act(async () => {
      await mocks.chatInputProps.onSend("今天广州天气如何");
    });

    const sendOptions = mocks.sendMessage.mock.calls.at(-1)?.[0];
    act(() => {
      sendOptions.onMessageListChange((list: any[]) => [
        ...list,
        {
          id: "optimistic",
          question: "今天广州天气如何",
          answer: "广州今天天气：",
          conversation_id: "",
          loading: true,
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
        },
      ]);
      sendOptions.onOpenClawConversationResolved("agent:main:weather");
    });

    expect(mocks.chatMessagesState.messageList).toHaveLength(1);
    expect(mocks.chatMessagesState.messageList[0].conversation_id).toBe("agent:main:weather");
    expect(mocks.chatMessagesState.messageList[0].openclawActivities[0].sessionId).toBe("agent:main:weather");
    expect(
      mocks.chatMessagesState.messageList[0].openclawTimelineItems.filter((item: any) => item.type === "answer")
    ).toHaveLength(1);
  });

  it("loads messages when reopening an existing OpenClaw conversation with the same store conversation id", async () => {
    mocks.chatSendState.isStreaming = false;
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: "agent:main:dashboard:first",
      next_agent_prepare: {},
      currentVirtualId: "",
    });

    renderOpenClawChatView(
      {},
      {
        initialConversationId: "agent:main:dashboard:first",
        features: {
          openclaw: true,
          skipInitialLoad: true,
        },
      }
    );
    await act(async () => {});

    expect(mocks.clearMessageList).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessageList).toHaveBeenCalledWith("agent:main:dashboard:first", expect.any(Function));
  });

  it("backs off OpenClaw event polling when no new events are returned", async () => {
    vi.useFakeTimers();
    const { conversationApi } = renderOpenClawChatView();

    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1801);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(2);
  });

  it("resets OpenClaw event polling to the fast interval after receiving a new event", async () => {
    vi.useFakeTimers();
    const events = vi
      .fn()
      .mockResolvedValueOnce({ data: { events: [] } })
      .mockResolvedValueOnce({
        data: {
          events: [
            {
              seq: 3,
              kind: "assistant.thinking",
              payload: { content: "thinking" },
            },
          ],
        },
      })
      .mockResolvedValue({ data: { events: [] } });
    const { conversationApi } = renderOpenClawChatView({ events });

    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1999);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(3);
  });

  it("stops OpenClaw event polling after a terminal event reloads messages", async () => {
    vi.useFakeTimers();
    const events = vi.fn().mockResolvedValue({
      data: {
        events: [
          {
            seq: 9,
            kind: "run.completed",
            payload: {},
          },
        ],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ events });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.events).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(conversationApi.events).toHaveBeenCalledTimes(1);
  });

  it("starts OpenClaw event polling after the max loaded activity seq", async () => {
    vi.useFakeTimers();
    mocks.loadMessageList.mockResolvedValue([
      {
        id: "message-1",
        conversation_id: "agent:main:main",
        openclawActivities: [
          {
            seq: 9,
            kind: "run.completed",
          },
        ],
      },
    ]);
    mocks.getOpenClawMessageListMaxActivitySeq.mockImplementation((messages: any[]) =>
      messages.reduce((maxSeq, message) => {
        const activityMax = (message.openclawActivities || []).reduce(
          (innerMax: number, item: any) => Math.max(innerMax, Number(item.seq) || 0),
          0
        );
        return Math.max(maxSeq, activityMax);
      }, 0)
    );
    const events = vi.fn().mockResolvedValue({
      data: {
        events: [
          {
            seq: 9,
            kind: "run.completed",
            payload: {},
          },
        ],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ events });

    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.events).toHaveBeenCalledWith("agent:main:main", {
      limit: 100,
      after_seq: 9,
    });
    expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);
  });

  it("does not reload messages for snapshot recovery-window terminal events at or below after_seq", async () => {
    vi.useFakeTimers();
    mocks.loadMessageList.mockResolvedValue([
      {
        id: "message-1",
        conversation_id: "agent:main:main",
        openclawActivities: [
          {
            seq: 9,
            kind: "run.completed",
          },
        ],
      },
    ]);
    mocks.getOpenClawMessageListMaxActivitySeq.mockImplementation((messages: any[]) =>
      messages.reduce((maxSeq, message) => {
        const activityMax = (message.openclawActivities || []).reduce(
          (innerMax: number, item: any) => Math.max(innerMax, Number(item.seq) || 0),
          0
        );
        return Math.max(maxSeq, activityMax);
      }, 0)
    );
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        events: [
          {
            seq: 9,
            kind: "run.completed",
            payload: {},
          },
        ],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", {
      after_seq: 9,
    });
    expect(mocks.loadMessageList).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(mocks.loadMessageList).not.toHaveBeenCalled();
  });

  it("restores OpenClaw loading from snapshot active turns after switching back to a running conversation", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-running",
        conversation_id: "agent:main:main",
        question: "RUNNING-SWITCH-VERIFY sleep request",
        answer: "",
        loading: false,
      },
    ];
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 12,
        active_turns: [
          {
            turn_id: "agent:main:main:turn:running",
            active_request_id: "request-running",
            status: "running",
            last_seq: 12,
            part_ids: [],
          },
        ],
        recent_events: [],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", {});
    expect(mocks.chatMessagesState.messageList[0].loading).toBe(true);
    expect(mocks.chatMessagesState.messageList[0]._openclawClientMessageId).toBe("request-running");
    expect(mocks.chatMessagesState.messageList[0].openclawTurn?.status).toBe("streaming");
  });

  it("binds snapshot active turns to a refreshed history row with a local history turn key", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-refresh-running",
        conversation_id: "agent:main:main",
        question: "REFRESH-RUNNING-VERIFY sleep request",
        answer: "",
        loading: false,
        openclawTurn: {
          turnKey: "agent:main:main:history:message-refresh-running",
          sessionId: "agent:main:main",
          status: "completed",
          maxSeq: 0,
          events: [],
        },
      },
    ];
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 16,
        active_turns: [
          {
            turn_id: "agent:main:main:turn:refresh-running",
            active_request_id: "request-refresh-running",
            status: "running",
            last_seq: 16,
            part_ids: [],
          },
        ],
        recent_events: [],
      },
    });
    renderOpenClawChatView({ snapshot });

    await act(async () => {});
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(mocks.chatMessagesState.messageList).toHaveLength(1);
    expect(mocks.chatMessagesState.messageList[0].loading).toBe(true);
    expect(mocks.chatMessagesState.messageList[0]._openclawClientMessageId).toBe("request-refresh-running");
    expect(mocks.chatMessagesState.messageList[0].openclawTurn?.turnKey).toBe("agent:main:main:turn:refresh-running");
    expect(mocks.chatMessagesState.messageList[0].openclawTurn?.status).toBe("streaming");
  });

  it("keeps polling when snapshot recovery includes a stale terminal event before a running active turn", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-previous",
        conversation_id: "agent:main:main",
        question: "previous",
        answer: "previous answer",
        loading: false,
        openclawActivities: [
          {
            seq: 356,
            kind: "assistant.message",
          },
        ],
      },
      {
        id: "message-immediate-refresh",
        conversation_id: "agent:main:main",
        question: "九",
        answer: "",
        loading: false,
      },
    ];
    mocks.getOpenClawMessageListMaxActivitySeq.mockReturnValue(356);
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 360,
        active_turns: [
          {
            turn_id: "agent:main:main:turn:running",
            active_request_id: "request-running",
            status: "running",
            last_seq: 360,
            part_ids: [],
          },
        ],
        events: [
          {
            seq: 357,
            kind: "run.completed",
            sessionId: "agent:main:main",
            payload: {
              openclaw_ledger: {
                protocol_version: "openclaw.ledger.v1",
                turn_id: "agent:main:main:turn:previous",
                event_type: "turn.completed",
                terminal_status: "completed",
              },
            },
          },
          {
            seq: 360,
            kind: "run.started",
            sessionId: "agent:main:main",
            payload: {
              openclaw_ledger: {
                protocol_version: "openclaw.ledger.v1",
                turn_id: "agent:main:main:turn:running",
                active_request_id: "request-running",
                event_type: "turn.started",
                terminal_status: "running",
              },
            },
          },
        ],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", {
      after_seq: 356,
    });
    expect(mocks.loadMessageList).not.toHaveBeenCalled();
    expect(mocks.chatMessagesState.messageList[1].loading).toBe(true);
    expect(mocks.chatMessagesState.messageList[1]._openclawClientMessageId).toBe("request-running");
    expect(mocks.chatMessagesState.messageList[1].openclawTurn?.turnKey).toBe("agent:main:main:turn:running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_999);
    });
    expect(conversationApi.snapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(conversationApi.snapshot).toHaveBeenCalledTimes(2);
    expect(conversationApi.snapshot).toHaveBeenLastCalledWith("agent:main:main", {
      after_seq: 360,
    });
  });

  it("does not restore snapshot active turns before handling a new terminal event", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-terminal",
        conversation_id: "agent:main:main",
        question: "RUNNING-SWITCH-VERIFY terminal request",
        answer: "",
        loading: false,
      },
    ];
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 14,
        active_turns: [
          {
            turn_id: "agent:main:main:turn:stale",
            active_request_id: "request-stale",
            status: "running",
            last_seq: 4,
            part_ids: [],
          },
        ],
        events: [
          {
            seq: 14,
            kind: "run.completed",
            payload: {},
          },
        ],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);
    expect(mocks.chatMessagesState.messageList[0].loading).toBe(false);
    expect(mocks.chatMessagesState.messageList[0]._openclawClientMessageId).toBeUndefined();
    expect(mocks.chatMessagesState.messageList[0].openclawTurn).toBeUndefined();
  });

  it("does not merge the same terminal snapshot payload again after canonical message reload succeeds", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-terminal-refresh",
        conversation_id: "agent:main:main",
        question: "refresh while running",
        answer: "",
        loading: true,
      },
    ];
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    mocks.mergeOpenClawTimelineEventsIntoMessage.mockReturnValue(true);
    mocks.loadMessageList.mockResolvedValue([
      {
        id: "message-terminal-refresh",
        conversation_id: "agent:main:main",
        question: "refresh while running",
        answer: "canonical final answer",
        loading: false,
        openclawActivities: [
          {
            seq: 21,
            kind: "run.completed",
          },
        ],
      },
    ]);

    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 21,
        events: [
          {
            seq: 21,
            kind: "run.completed",
            payload: {
              openclaw_ledger: {
                protocol_version: "openclaw.ledger.v1",
                event_type: "turn.completed",
                terminal_status: "completed",
              },
            },
          },
        ],
      },
    });
    renderOpenClawChatView({ snapshot });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);
    expect(mocks.mergeOpenClawTimelineEventsIntoMessage).toHaveBeenCalledTimes(1);
  });

  it("backs off OpenClaw event polling after request failures", async () => {
    vi.useFakeTimers();
    const events = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({ data: { events: [] } });
    const { conversationApi } = renderOpenClawChatView({ events });

    await act(async () => {});

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1199);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1801);
    });
    expect(conversationApi.events).toHaveBeenCalledTimes(2);
  });

  it("recovers OpenClaw snapshot polling after a transient network failure and stops on terminal events", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-network",
        conversation_id: "agent:main:main",
        question: "network recovery",
        answer: "",
        loading: true,
      },
    ];
    const snapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValue({
        data: {
          events: [
            {
              seq: 12,
              kind: "run.completed",
              payload: {},
            },
          ],
        },
      });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(conversationApi.snapshot).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessageList).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_999);
    });
    expect(conversationApi.snapshot).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(conversationApi.snapshot).toHaveBeenCalledTimes(2);
    expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    expect(conversationApi.snapshot).toHaveBeenCalledTimes(2);
  });
});
