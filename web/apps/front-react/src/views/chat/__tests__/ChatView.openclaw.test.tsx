import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatConfigProvider, ChatView, useConversationStore } from "@km/shared-business/chat";

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
  handleLoadListMore: vi.fn(),
  updateMessageList: vi.fn(),
  clearMessageList: vi.fn(),
  getOpenClawMessageListMaxActivitySeq: vi.fn(),
  getOpenClawPayloadTimelineMaxSeq: vi.fn(),
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
    isStreaming: false,
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
  getOpenClawPayloadTimelineMaxSeq: mocks.getOpenClawPayloadTimelineMaxSeq,
  mergeOpenClawActiveMessageIntoList: vi.fn((list: any[]) => list),
  mergeOpenClawTimelineEventsIntoMessage: mocks.mergeOpenClawTimelineEventsIntoMessage,
  useChatMessages: vi.fn((options?: any) => {
    mocks.chatMessagesHookOptions = options;
    return {
      state: mocks.chatMessagesState,
      loadMessageList: mocks.loadMessageList,
      handleLoadListMore: mocks.handleLoadListMore,
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
  viewOverrides: Record<string, any> = {},
  adapterOverrides: Record<string, any> = {}
) {
  const conversationApi: Record<string, any> = {
    create: vi.fn(),
    list: vi.fn().mockResolvedValue({ data: { conversations: [] } }),
    messages: vi.fn().mockResolvedValue({ data: { messages: [] } }),
    edit: vi.fn(),
    del: vi.fn(),
    completions: vi.fn(),
    events: vi.fn().mockResolvedValue({ data: { events: [] } }),
    ...conversationApiOverrides,
  };

  const features = (viewOverrides.features as Record<string, any> | undefined) ?? {};
  const {
    openclaw: openclawEnabled,
    skipInitialLoad,
    openclawInputDisabled,
    openclawInputDisabledReason,
    initialConversationResolving,
    messageMenu,
    share: shareEnabled,
    ...legacyFeatureRest
  } = features;
  if (Object.keys(legacyFeatureRest).length > 0) {
    throw new Error(
      `renderOpenClawChatView: deprecated features.${Object.keys(legacyFeatureRest).join(", ")} not supported`
    );
  }
  const mergedOpenclaw = {
    enabled: openclawEnabled ?? true,
    ...(skipInitialLoad !== undefined ? { skipInitialLoad } : {}),
    ...(openclawInputDisabled !== undefined ? { inputDisabled: openclawInputDisabled } : {}),
    ...(openclawInputDisabledReason !== undefined
      ? { inputDisabledReason: openclawInputDisabledReason }
      : {}),
    ...(initialConversationResolving !== undefined
      ? { initialConversationResolving }
      : {}),
    ...(viewOverrides.openclaw ?? {}),
  };
  const mergedMessage = {
    ...(messageMenu !== undefined ? { showMenu: messageMenu } : {}),
    ...(viewOverrides.onMessageSent !== undefined ? { onSent: viewOverrides.onMessageSent } : {}),
    ...(viewOverrides.onOutputFilePreview !== undefined
      ? { onPreviewOutputFile: viewOverrides.onOutputFilePreview }
      : {}),
    ...(viewOverrides.onAddAsMd !== undefined
      ? { onSaveToKnowledge: viewOverrides.onAddAsMd }
      : {}),
    ...(viewOverrides.message ?? {}),
  };
  const mergedShare =
    shareEnabled !== undefined
      ? { enabled: shareEnabled, ...(viewOverrides.share ?? {}) }
      : viewOverrides.share;

  const view = render(
    <ChatConfigProvider
      adapters={{
        conversationApi: conversationApi as any,
        agentApi: {
          detail: vi.fn(),
        } as any,
        workflowApi: {
          run: vi.fn(),
        },
        ...adapterOverrides,
      }}
    >
      <ChatView
        agentId="2"
        initialConversationId="agent:main:main"
        openclaw={mergedOpenclaw}
        message={mergedMessage}
        share={mergedShare}
        agentInfo={{
          agent_id: 2,
          name: "OpenClaw",
          custom_config_obj: {},
          settings_obj: {},
        } as any}
        {...viewOverrides}
      />
    </ChatConfigProvider>
  );

  return { ...view, conversationApi };
}

async function advanceOpenClawTimers(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("ChatView OpenClaw stop/send flow", () => {
  beforeEach(() => {
    mocks.chatInputProps = null;
    mocks.sendMessage.mockReset().mockResolvedValue(undefined);
    mocks.handleStop.mockReset();
    mocks.loadMessageList.mockReset().mockResolvedValue([]);
    mocks.handleLoadListMore.mockReset();
    mocks.updateMessageList.mockReset();
    mocks.clearMessageList.mockReset();
    mocks.chatMessagesHookOptions = null;
    mocks.getOpenClawMessageListMaxActivitySeq.mockReset().mockReturnValue(0);
    mocks.chatMessagesProps = null;
    mocks.chatMessagesState.messageList = [];
    mocks.chatMessagesState.hasMore = false;
    mocks.chatMessagesState.isLoadingMore = false;
    mocks.chatMessagesState.isLoadingMessages = false;
    mocks.getOpenClawPayloadTimelineMaxSeq.mockReset().mockImplementation((payload: any) => {
      const events = payload?.events ?? payload?.data?.events ?? [];
      return events.reduce((max: number, event: any) => Math.max(max, Number(event?.seq) || 0), 0);
    });
    mocks.mergeOpenClawTimelineEventsIntoMessage.mockReset().mockReturnValue(false);
    mocks.chatSendState.isStreaming = false;
    mocks.chatSendState.isStopping = false;
    useConversationStore.setState({
      conversations: [],
      current_agentid: 0,
      current_conversationid: 0,
      next_agent_prepare: {},
      currentVirtualId: "",
      // 重置本次新增的分页字段，避免上一个测试的 hasMore/loadingMore/nextOffset 泄漏（#8）
      hasMore: true,
      loadingMore: false,
      nextOffset: 0,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("enables OpenClaw and routes uploaded file clicks to the preview callback", async () => {
    const onOutputFilePreview = vi.fn();
    renderOpenClawChatView({}, { onOutputFilePreview });

    await waitFor(() => {
      expect(mocks.chatMessagesProps).toBeTruthy();
    });

    expect(mocks.chatMessagesProps.openclaw?.enabled).toBe(true);
    expect(mocks.chatMessagesProps.onFileClick).toEqual(expect.any(Function));

    act(() => {
      mocks.chatMessagesProps.onFileClick({
        id: "input-file-1",
        file_name: "probe.md",
        file_mime: "text/markdown",
        file_size: 512,
        preview_url: "http://localhost:9001/api/preview/probe.md",
        signed_download_url: "http://localhost:9001/api/preview/probe.md",
      });
    });

    expect(onOutputFilePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "input-file-1",
        file_name: "probe.md",
        mime_type: "text/markdown",
        size: 512,
        preview_url: "http://localhost:9001/api/preview/probe.md",
        signed_download_url: "http://localhost:9001/api/preview/probe.md",
        source_kind: "openclaw_input_file",
      }),
      expect.any(Object)
    );
  });

  it("loads OpenClaw skills from the skill adapter", async () => {
    const openSkillLibrary = vi.fn();
    const listMySkills = vi.fn().mockResolvedValue([
      {
        id: "skill-1",
        skill_id: "skill-1",
        skill_name: "openclaw_pdf_probe",
        display_name: "PDF Probe",
        binding_status: "enabled",
      },
      {
        id: "skill-2",
        skill_id: "skill-2",
        skill_name: "disabled_skill",
        display_name: "Disabled Skill",
        binding_status: "disabled",
      },
    ]);

    renderOpenClawChatView(
      {},
      {},
      {
        skillApi: {
          listMySkills,
          openSkillLibrary,
        },
      }
    );

    await waitFor(() => {
      expect(listMySkills).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mocks.chatInputProps?.skill?.suggestions).toEqual([
        expect.objectContaining({
          skill_name: "openclaw_pdf_probe",
          display_name: "PDF Probe",
        }),
      ]);
    });
    expect(mocks.chatInputProps?.skill?.enabled).toBe(true);
    expect(mocks.chatInputProps?.skill?.onOpenLibrary).toBe(openSkillLibrary);
  });

  it("refreshes OpenClaw skills when the window regains focus", async () => {
    const listMySkills = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "skill-1",
          skill_name: "first_skill",
          display_name: "First Skill",
          binding_status: "enabled",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "skill-2",
          skill_name: "second_skill",
          display_name: "Second Skill",
          binding_status: "enabled",
        },
      ]);

    renderOpenClawChatView(
      {},
      {},
      {
        skillApi: {
          listMySkills,
        },
      }
    );

    await waitFor(() => {
      expect(mocks.chatInputProps?.skill?.suggestions?.[0]?.skill_name).toBe("first_skill");
    });

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    await waitFor(() => {
      expect(listMySkills).toHaveBeenCalledTimes(2);
      expect(mocks.chatInputProps?.skill?.suggestions?.[0]?.skill_name).toBe("second_skill");
    });
  });

  it("keeps OpenClaw input and stop button disabled while stop is pending", async () => {
    mocks.chatSendState.isStreaming = true;
    mocks.chatSendState.isStopping = true;

    render(
      <ChatConfigProvider
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
          workflowApi: {
            run: vi.fn(),
          },
        }}
      >
        <ChatView
          agentId="2"
          openclaw={{ enabled: true, skipInitialLoad: true }}
          agentInfo={{
            agent_id: 2,
            name: "OpenClaw",
            custom_config_obj: {},
            settings_obj: {},
          } as any}
        />
      </ChatConfigProvider>
    );

    expect(mocks.chatInputProps.isStreaming).toBe(true);
    expect(mocks.chatInputProps.inputState?.disabled).toBe(true);
    expect(mocks.chatInputProps.inputState?.stopDisabled).toBe(true);

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

  it("revalidates cached OpenClaw history with fresh messages after the plugin is available", async () => {
    const cachedRows: any[] = [
      {
        id: "cached-row",
        conversation_id: "agent:main:main",
        question: "缓存问题",
        answer: "缓存回答",
      },
    ];
    Object.assign(cachedRows, {
      openclawHistoryMeta: { source: "mirror", stale: true },
    });
    const freshRows: any[] = [
      {
        id: "cached-row",
        conversation_id: "agent:main:main",
        question: "缓存问题",
        answer: "实时回答",
      },
    ];
    Object.assign(freshRows, {
      openclawHistoryMeta: { source: "openclaw", stale: false },
    });
    mocks.loadMessageList
      .mockResolvedValueOnce(cachedRows)
      .mockResolvedValueOnce(freshRows);
    const onMessageSent = vi.fn();
    const { conversationApi } = renderOpenClawChatView({}, { onMessageSent });

    await waitFor(() => {
      expect(mocks.loadMessageList).toHaveBeenCalledTimes(2);
    });

    expect(mocks.loadMessageList.mock.calls[0]?.[0]).toBe("agent:main:main");
    expect(mocks.loadMessageList.mock.calls[0]?.[2]).toBeUndefined();
    expect(mocks.loadMessageList.mock.calls[1]?.[0]).toBe("agent:main:main");
    expect(mocks.loadMessageList.mock.calls[1]?.[2]).toMatchObject({ silent: true });

    const freshMessagesLoader = mocks.loadMessageList.mock.calls[1]?.[1];
    await freshMessagesLoader("agent:main:main", { offset: 0, limit: 30 });

    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:main", {
      offset: 0,
      limit: 30,
      fresh: true,
    });
    await act(async () => {});
    expect(onMessageSent).toHaveBeenCalledTimes(1);
  });

  it("uses fresh OpenClaw messages when loading older history", async () => {
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: "agent:main:main",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    const done = vi.fn();
    const { conversationApi } = renderOpenClawChatView();

    await waitFor(() => {
      expect(mocks.chatMessagesProps?.onLoadMore).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatMessagesProps.onLoadMore(done);
    });

    expect(mocks.handleLoadListMore).toHaveBeenCalledWith(
      done,
      "agent:main:main",
      expect.any(Function)
    );
    const loader = mocks.handleLoadListMore.mock.calls[0][2];
    await loader("agent:main:main", { offset: 30, limit: 30 });

    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:main", {
      offset: 30,
      limit: 30,
      fresh: true,
    });
  });

  it("does not start /snapshot polling while no local OpenClaw stream or running turn is active", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: "agent:main:main",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    const snapshot = vi.fn().mockResolvedValue({ data: { events: [] } });

    renderOpenClawChatView({ snapshot });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });

    expect(snapshot).not.toHaveBeenCalled();
  });

  it("polls /messages with fresh=1 every 5 seconds for OpenClaw cross-client sync", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: "agent:main:main",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    mocks.loadMessageList.mockImplementation(
      async (conversationId: string, loader: any) => {
        await loader(conversationId, { offset: 0, limit: 30 });
        return [];
      }
    );
    const { conversationApi } = renderOpenClawChatView();

    // 等 effect1 初始 load 走完,清掉 spy,只看 polling 触发的 messages。
    await act(async () => {});
    conversationApi.messages.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(conversationApi.messages).toHaveBeenCalledTimes(1);
    expect(conversationApi.messages).toHaveBeenLastCalledWith("agent:main:main", {
      offset: 0,
      limit: 30,
      fresh: true,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(conversationApi.messages).toHaveBeenCalledTimes(2);
  });

  it("does not start /messages cross-client polling while a local OpenClaw stream is active", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = true;
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: "agent:main:main",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    mocks.loadMessageList.mockImplementation(
      async (conversationId: string, loader: any) => {
        await loader(conversationId, { offset: 0, limit: 30 });
        return [];
      }
    );
    const { conversationApi } = renderOpenClawChatView();

    // isStreaming=true 挂载后立刻跑 0ms(只 flush 已排队的 microtask),
    // effect guard 应当早退,我们 polling 的 setTimeout 永远不应该被排上。
    await act(async () => {});
    conversationApi.messages.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    const freshCalls = conversationApi.messages.mock.calls.filter(
      (call) => (call[1] as any)?.fresh === true
    );
    expect(freshCalls).toHaveLength(0);
  });

  it("loads mirror OpenClaw messages but skips runtime snapshots while unavailable", async () => {
    useConversationStore.setState({
      conversations: [],
      current_agentid: 2,
      current_conversationid: 0,
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    const snapshot = vi.fn().mockResolvedValue({ data: { ledger_events: [] } });
    const mirrorMessages = Object.assign([], {
      openclawHistoryMeta: { source: "mirror", stale: true },
    });
    mocks.loadMessageList.mockImplementationOnce(async (conversationId: string, loader: any) => {
      await loader(conversationId, { offset: 0, limit: 30 });
      return mirrorMessages;
    });

    const { conversationApi } = renderOpenClawChatView(
      { snapshot },
      {
        initialConversationId: "agent:main:dashboard:cached-qclaw",
        features: { openclaw: true, openclawInputDisabled: true, skipInitialLoad: true },
      }
    );

    await waitFor(() => {
      expect(mocks.loadMessageList).toHaveBeenCalledWith(
        "agent:main:dashboard:cached-qclaw",
        expect.any(Function)
      );
    });

    expect(mocks.clearMessageList).toHaveBeenCalled();
    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:dashboard:cached-qclaw", {
      offset: 0,
      limit: 30,
    });
    expect((conversationApi as any).snapshot).not.toHaveBeenCalled();
    expect(mocks.chatInputProps.inputState?.disabled).toBe(true);
  });

  it("clears the current OpenClaw conversation when fresh message validation returns not found", async () => {
    const invalidated = vi.fn();
    window.addEventListener("openclaw:conversation-invalidated", invalidated);
    const mirrorRows = Object.assign([
      {
        id: "cached-row",
        conversation_id: "agent:main:main",
        question: "缓存问题",
        answer: "缓存回答",
      },
    ], {
      openclawHistoryMeta: { source: "mirror", stale: true },
    });
    const notFound = {
      response: {
        status: 404,
        data: {
          code: "NOT_FOUND",
          message: "OpenClaw session not found",
        },
      },
    };
    mocks.loadMessageList
      .mockImplementationOnce(async (conversationId: string, loader: any) => {
        await loader(conversationId, { offset: 0, limit: 30 });
        return mirrorRows;
      })
      .mockImplementationOnce(async (conversationId: string, loader: any) => {
        await loader(conversationId, { offset: 0, limit: 30 });
        return [];
      });
    const { conversationApi } = renderOpenClawChatView({
      messages: vi.fn()
        .mockResolvedValueOnce({ data: { messages: [], source: "mirror", stale: true } })
        .mockRejectedValueOnce(notFound),
    });

    await waitFor(() => {
      expect(mocks.loadMessageList).toHaveBeenCalledTimes(2);
    });

    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:main", {
      offset: 0,
      limit: 30,
    });
    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:main", {
      offset: 0,
      limit: 30,
      fresh: true,
    });

    await waitFor(() => {
      expect(useConversationStore.getState().current_conversationid).toBe(0);
      expect(mocks.clearMessageList).toHaveBeenCalled();
      expect(invalidated).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: expect.objectContaining({
            agentId: "2",
            conversationId: "agent:main:main",
            reason: "history.fresh.not_found",
          }),
        })
      );
    });

    window.removeEventListener("openclaw:conversation-invalidated", invalidated);
  });

  it("does not load OpenClaw messages from a stale conversation store agent", async () => {
    useConversationStore.setState({
      conversations: [],
      current_agentid: "kOKT9M",
      current_conversationid: "agent:main:dashboard:stale-k",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
    mocks.loadMessageList.mockImplementation(async (conversationId: string, loader: any) => {
      await loader(conversationId, { offset: 0, limit: 30 });
      return [];
    });

    const { conversationApi } = renderOpenClawChatView(
      {
        list: vi.fn().mockResolvedValue({
          data: {
            conversations: [],
          },
        }),
      },
      {
        agentId: "F0GX8N",
        initialConversationId: undefined,
        features: {
          openclaw: true,
          skipInitialLoad: false,
        },
      }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadMessageList).not.toHaveBeenCalled();
    expect(conversationApi.messages).not.toHaveBeenCalled();
  });

  it("does not let a stale OpenClaw blank initialization rewrite another agent URL", async () => {
    window.history.replaceState(null, "", "/agent/agent?agent_id=3&type=openclaw");

    renderOpenClawChatView(
      {},
      {
        agentId: "2",
        initialConversationId: undefined,
        features: {
          openclaw: true,
          skipInitialLoad: false,
        },
      }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.location.search).toContain("agent_id=3");
    expect(window.location.search).not.toContain("agent_id=2");
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
  });

  it("does not emit a duplicate URL sync for an unchanged OpenClaw blank route", async () => {
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
    const replaceState = vi.spyOn(window.history, "replaceState");

    renderOpenClawChatView(
      {},
      {
        agentId: "2",
        initialConversationId: undefined,
        features: {
          openclaw: true,
          skipInitialLoad: false,
        },
      }
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
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
    expect(mocks.loadMessageList.mock.calls[0]?.[2]).toMatchObject({ silent: true });
    const terminalMessagesLoader = mocks.loadMessageList.mock.calls[0]?.[1];
    await terminalMessagesLoader("agent:main:main", { offset: 0, limit: 30 });
    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:main", {
      offset: 0,
      limit: 30,
      fresh: true,
    });
  });

  it("shows conversation loading overlay and disables input while messages are loading", async () => {
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.isLoadingMessages = true;

    renderOpenClawChatView();
    await act(async () => {});

    expect(mocks.chatMessagesProps.isConversationLoading).toBe(true);
    expect(mocks.chatInputProps.inputState?.disabled).toBe(true);
    expect(mocks.chatInputProps.inputState?.disabledReason).toBe("加载消息...");
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
    expect(mocks.chatInputProps.inputState?.disabled).toBe(true);

    await act(async () => {
      messages.resolve([]);
      await messages.promise;
    });

    expect(mocks.chatMessagesProps.isConversationLoading).toBe(false);
    expect(mocks.chatInputProps.inputState?.disabled).toBe(false);
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
    expect(mocks.chatMessagesProps.messageAction?.onAddAsMd).toBe(onAddAsMd);

    await act(async () => {
      mocks.chatMessagesProps.messageAction?.onRegenerate?.({
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

  it("blocks input during initial OpenClaw conversation resolving without showing a message reload", async () => {
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

    expect(mocks.chatMessagesProps.isConversationLoading).toBe(false);
    expect(mocks.chatInputProps.inputState?.disabled).toBe(true);
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
      <ChatConfigProvider
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
          workflowApi: {
            run: vi.fn(),
          },
        }}
      >
        <ChatView
          agentId="2"
          initialConversationId="agent:main:dashboard:first"
          openclaw={{ enabled: true, skipInitialLoad: true }}
          agentInfo={{
            agent_id: 2,
            name: "OpenClaw",
            custom_config_obj: {},
            settings_obj: {},
          } as any}
        />
      </ChatConfigProvider>
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
    const onMessageSent = vi.fn();
    const { conversationApi } = renderOpenClawChatView({ events }, { onMessageSent });

    await act(async () => {});
    mocks.loadMessageList.mockClear();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(conversationApi.events).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessageList).toHaveBeenCalledTimes(1);
    expect(mocks.loadMessageList.mock.calls[0]?.[2]).toMatchObject({ silent: true });
    const terminalMessagesLoader = mocks.loadMessageList.mock.calls[0]?.[1];
    await terminalMessagesLoader("agent:main:main", { offset: 0, limit: 30 });
    expect(conversationApi.messages).toHaveBeenCalledWith("agent:main:main", {
      offset: 0,
      limit: 30,
      fresh: true,
    });
    await act(async () => {});
    expect(onMessageSent).toHaveBeenCalledTimes(1);

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
      fresh: true,
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
      fresh: true,
      after_seq: 9,
    });
    expect(mocks.loadMessageList).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });

    expect(mocks.loadMessageList).not.toHaveBeenCalled();
  });

  it("does not merge unrelated high-seq history terminal events into the latest OpenClaw message", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-current",
        conversation_id: "agent:main:main",
        question: "当前问题",
        answer: "当前完整回复",
        loading: false,
        openclawActivities: [
          {
            seq: 100,
            kind: "assistant.message",
          },
        ],
      },
    ];
    mocks.getOpenClawMessageListMaxActivitySeq.mockReturnValue(100);
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 110,
        active_turns: [],
        events: [
          {
            seq: 110,
            kind: "run.completed",
            sessionId: "agent:main:main",
            payload: {
              openclaw_ledger: {
                protocol_version: "openclaw.ledger.v1",
                turn_id: "agent:main:main:turn:history:previous",
                event_type: "turn.completed",
                terminal_status: "completed",
              },
            },
          },
        ],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    mocks.loadMessageList.mockClear();
    mocks.mergeOpenClawTimelineEventsIntoMessage.mockClear();

    await advanceOpenClawTimers(800);

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", {
      fresh: true,
      after_seq: 100,
    });
    expect(mocks.loadMessageList).not.toHaveBeenCalled();
    expect(mocks.mergeOpenClawTimelineEventsIntoMessage).not.toHaveBeenCalled();
    expect(mocks.chatMessagesState.messageList[0].answer).toBe("当前完整回复");
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

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", { fresh: true });
    expect(mocks.chatMessagesState.messageList[0].loading).toBe(true);
    expect(mocks.chatMessagesState.messageList[0]._openclawClientMessageId).toBe("request-running");
    expect(mocks.chatMessagesState.messageList[0].openclawTurn?.status).toBe("streaming");
  });

  it("does not reopen a completed OpenClaw history answer when snapshot still reports a running active turn", async () => {
    vi.useFakeTimers();
    mocks.chatSendState.isStreaming = false;
    mocks.chatMessagesState.messageList = [
      {
        id: "message-books-complete",
        conversation_id: "agent:main:main",
        question: "从网上搜索10本书并总结",
        answer: "我已经成功从网上搜索并整理了10本书的总结。",
        loading: false,
        openclawTurn: {
          turnKey: "agent:main:main:turn:req-books",
          sessionId: "agent:main:main",
          status: "completed",
          maxSeq: 360,
          events: [],
        },
        openclawTimelineItems: [
          {
            key: "books-answer",
            type: "answer",
            seq: 355,
            content: "我已经成功从网上搜索并整理了10本书的总结。",
          },
        ],
      },
    ];
    mocks.updateMessageList.mockImplementation((updater: (list: any[]) => any[]) => {
      mocks.chatMessagesState.messageList = updater(mocks.chatMessagesState.messageList);
      return mocks.chatMessagesState.messageList;
    });
    const snapshot = vi.fn().mockResolvedValue({
      data: {
        last_seq: 361,
        active_turns: [
          {
            turn_id: "agent:main:main:turn:req-books",
            active_request_id: "req-books",
            status: "running",
            last_seq: 361,
            part_ids: [],
          },
        ],
        recent_events: [],
      },
    });
    const { conversationApi } = renderOpenClawChatView({ snapshot });

    await act(async () => {});
    await advanceOpenClawTimers(800);

    expect(conversationApi.snapshot).toHaveBeenCalledWith("agent:main:main", { fresh: true });
    expect(mocks.chatMessagesState.messageList[0].loading).toBe(false);
    expect(mocks.chatMessagesState.messageList[0]._openclawClientMessageId).toBeUndefined();
    expect(mocks.chatMessagesState.messageList[0].openclawTurn?.status).toBe("completed");
    expect(mocks.chatMessagesState.messageList[0].answer).toContain("10本书");
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
      fresh: true,
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
      fresh: true,
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
