import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, forwardRef, StrictMode, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ChatContainer from "./ChatContainer";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushAsyncUpdates(times = 6) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

const mocks = vi.hoisted(() => {
  const frontStore = {
    current_conversationid: 0 as string | number,
    conversations: [] as any[],
    addConversation: vi.fn((conversation: any) => {
      frontStore.conversations = [...frontStore.conversations, conversation];
    }),
    setCurrentState: vi.fn((_agentId: string | number, conversationId: string | number) => {
      frontStore.current_conversationid = conversationId;
    }),
    setNextAgentPrepare: vi.fn(),
    next_agent_prepare: {},
  };
  const sharedStore = {
    current_conversationid: 0 as string | number,
    current_agentid: 0 as string | number,
    conversations: [] as any[],
    addConversation: vi.fn((conversation: any) => {
      sharedStore.conversations = [...sharedStore.conversations, conversation];
    }),
    setCurrentState: vi.fn((agentId: string | number, conversationId: string | number) => {
      sharedStore.current_agentid = agentId;
      sharedStore.current_conversationid = conversationId;
    }),
  };
  return {
    navigate: vi.fn(),
    frontStore,
    sharedStore,
    currentConversation: vi.fn(),
    status: vi.fn(),
    conversations: vi.fn(),
    checkPermission: vi.fn(() => true),
    eventBus: {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      clearCache: vi.fn(),
    },
    searchParams: new URLSearchParams("type=openclaw"),
    currentAgent: {
      agent_id: 2,
      name: "OpenClaw",
      channel_type: 1014,
      custom_config_obj: { agent_type: "openclaw" },
      settings_obj: {},
      use_cases: [],
      user_group_ids: [] as number[],
      owner_id: 0,
    } as any,
    skillGetMyList: vi.fn(),
    chatPluginProviderProps: [] as any[],
    chatViewProps: [] as any[],
    openClawPanelProps: [] as any[],
    fileViewerProps: null as any,
    addAnswerAsMdOpen: vi.fn(),
    buildOpenClawConversation: vi.fn((session: any, agentId: string | number) => ({
      conversation_id: session.id,
      agent_id: agentId,
      title: session.title,
      created_time: 1779871345,
      updated_time: 1779871346,
      is_valid: 1,
      has_cached_history: session.has_cached_history,
      raw: session,
    })),
  };
});

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams],
}));

vi.mock("@km/shared-business/chat", () => ({
  ChatProvider: (props: { children: any; config: any; adapters: any }) => {
    mocks.chatPluginProviderProps.push(props);
    return createElement("div", null, props.children);
  },
  ChatPluginProvider: (props: { children: any; config: any; adapters: any }) => {
    mocks.chatPluginProviderProps.push(props);
    return createElement("div", null, props.children);
  },
  ChatConfigProvider: (props: { children: any; config?: any; adapters?: any }) => {
    mocks.chatPluginProviderProps.push(props);
    return createElement("div", null, props.children);
  },
  ChatView: forwardRef((props: any, _ref: any) => {
    mocks.chatViewProps.push(props);
    return createElement(
      "div",
      { "data-testid": "chat-view" },
      props.renderHeader ? props.renderHeader({ agentInfo: props.agentInfo, lang: "zh-cn", setLang: vi.fn() }) : null
    );
  }),
  UsageGuide: vi.fn(() => null),
  useChatFeedback: vi.fn(() => ({
    loadFeedbackConfig: vi.fn().mockResolvedValue(undefined),
  })),
  getOutputFileDownloadStrategy: vi.fn((file: any) => {
    if (file.signed_download_url) return { kind: "direct_url", url: file.signed_download_url };
    if (file.download_url) return { kind: "direct_url", url: file.download_url };
    if (typeof file.url === "string" && file.url.startsWith("data:")) return { kind: "data_url", url: file.url };
    if (typeof file.base64 === "string" && file.base64.trim()) {
      return {
        kind: "data_url",
        url: `data:${file.mime_type || "application/octet-stream"};base64,${file.base64.trim()}`,
      };
    }
    if (typeof file.url === "string" && /^https?:\/\//i.test(file.url)) return { kind: "direct_url", url: file.url };
    if (file.message_id) return { kind: "message_lookup" };
    if (typeof file.url === "string" && file.url.startsWith("/api/")) return { kind: "direct_url", url: file.url };
    return { kind: "none" };
  }),
  shouldUseOpenClawChatAdapter: vi.fn(() => true),
  useConversationStore: (selector?: any) => (selector ? selector(mocks.sharedStore) : mocks.sharedStore),
  buildOpenClawConversation: mocks.buildOpenClawConversation,
  buildOpenClawMessages: vi.fn(() => []),
  createOpenClawConversationApiAdapter: vi.fn(() => ({})),
  canSyncConversationUrlForAgent: vi.fn(() => false),
  getOpenClawPayload: vi.fn((response: any) => response?.data || response || {}),
  syncConversationIdToUrl: vi.fn(),
  hasConversationId: vi.fn((id?: any) => Boolean(id) && id !== 0 && id !== "0"),
}));

vi.mock("@/stores/modules/agent", () => ({
  useAgentStore: () => ({ agentList: [] }),
  useCurrentAgent: () => mocks.currentAgent,
}));

vi.mock("@/stores/modules/conversation", () => ({
  useConversationStore: (selector?: any) => (selector ? selector(mocks.frontStore) : mocks.frontStore),
}));

vi.mock("@/stores/modules/user", () => ({
  useUserStore: (selector?: any) => {
    const state = { info: { access_token: "user-token-1", nickname: "test", username: "test" } };
    return selector ? selector(state) : state;
  },
}));

vi.mock("@/stores/modules/enterprise", () => ({
  useEnterpriseStore: () => ({ copyright: "false" }),
  useIsSoftStyle: () => false,
}));

vi.mock("@/stores/modules/shortcuts", () => ({
  useShortcutsStore: () => ({
    isShortcut: vi.fn(() => false),
    addShortcut: vi.fn(),
    removeShortcut: vi.fn(),
  }),
}));

vi.mock("@/adapters/chat-adapters", () => ({
  conversationApiAdapter: {},
  createOpenClawConversationApiAdapter: vi.fn(() => ({})),
  agentApiAdapter: {},
  buildOpenClawConversation: mocks.buildOpenClawConversation,
  buildOpenClawMessages: vi.fn(() => []),
  chatAdapters: {
    feedback: { api: {}, context: { getEid: () => "" } },
    share: { api: {}, context: {} },
    messages: { api: {} },
    chunkPopup: { fetchChunkDetail: vi.fn(), renderMarkdown: vi.fn() },
    fileLink: { getFileLink: () => "" },
    fileDownload: { downloadFile: vi.fn() },
    agentRun: {},
    recentUsed: { save: vi.fn() },
    platform: { createConversation: vi.fn(), t: (k: string) => k, showWarning: vi.fn() },
    permission: { checkPermission: vi.fn() },
    conversationApi: {},
    agentApi: {},
    workflowApi: { run: vi.fn() },
  },
}));

vi.mock("@/api/modules/openclaw", () => ({
  default: {
    currentConversation: mocks.currentConversation,
    status: mocks.status,
    conversations: mocks.conversations,
  },
}));

vi.mock("@/api/modules/shares", () => ({
  sharesApi: { create: vi.fn() },
}));

vi.mock("@/api/modules/upload", () => ({
  default: { upload: vi.fn() },
}));

vi.mock("@/api/modules/skill", () => ({
  skillApi: {
    getMyList: mocks.skillGetMyList,
  },
  default: {
    getMyList: mocks.skillGetMyList,
  },
}));

vi.mock("@/api/host", () => ({
  API_HOST: "",
}));

vi.mock("@/constants/platform/config", () => ({
  AGENT_TYPES: { OPENCLAW: "openclaw" },
}));

vi.mock("@/locales", () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    const gatewayName = String(params?.gatewayName || "OpenClaw");
    const messages: Record<string, string> = {
      "openclaw.status.connected": `${gatewayName} 已连接`,
      "openclaw.status.disconnected": `${gatewayName} 未连接`,
      "openclaw.status.checking": `${gatewayName} 检测中`,
      "openclaw.status.unavailable": `${gatewayName} 当前不可用`,
      "openclaw.status.status_checking": `${gatewayName} 状态检测中`,
      "openclaw.input.checking": `正在检测 ${gatewayName} 连接...`,
      "openclaw.input.disconnected": `${gatewayName} 插件未连接，正在重连...`,
      "openclaw.history.preview_debug": "预览与调试",
      "openclaw.history.no_title": "无标题会话",
      "openclaw.history.loading": "正在加载...",
      "openclaw.history.load_more_on_scroll": "向下滚动加载更多",
      "openclaw.history.empty": "暂无历史会话",
      "openclaw.history.server_cache_empty_suffix": "暂无服务器缓存会话。",
      "openclaw.history.current": "当前会话",
      "openclaw.history.new": "新对话",
      "openclaw.history.connect_plugin_first": "连接插件后可加载此会话",
      "openclaw.panel.settings": "Gateway 设置",
      "openclaw.preview.close_file": "关闭文件预览",
    };
    return messages[key] || key;
  },
}));

vi.mock("@/utils/router", () => ({
  buildUrl: (path: string) => path,
}));

vi.mock("@/utils/permission", () => ({
  checkPermission: mocks.checkPermission,
}));

vi.mock("@/utils/config", () => ({
  getPublicPath: (path: string) => path,
}));

vi.mock("@/components/AuthTagGroup", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/components/Chat/AddAnswerAsMd", () => ({
  default: forwardRef((_props: any, ref: any) => {
    useImperativeHandle(ref, () => ({
      open: mocks.addAnswerAsMdOpen,
    }));
    return createElement("div", { "data-testid": "add-answer-as-md" });
  }),
}));

vi.mock("@/components/MoreDropdown", () => ({
  default: vi.fn(() => null),
}));

vi.mock("@/components/Layout/ExpandSidebarButton", () => ({
  ExpandSidebarButton: vi.fn(() => null),
}));

vi.mock("@/components/FileViewer", () => ({
  default: vi.fn((props: any) => {
    mocks.fileViewerProps = props;
    return createElement("div", { "data-testid": "file-viewer" }, props.content || props.url);
  }),
}));

vi.mock("@km/shared-components-react", () => ({
  SvgIcon: vi.fn(() => null),
}));

vi.mock("@km/shared-utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@km/shared-utils")>();
  return {
    ...actual,
    eventBus: mocks.eventBus,
    copyToClip: vi.fn(),
    encodeShortId: vi.fn(async (value: string) => value),
  };
});

vi.mock("./components/AgentTooltip", () => ({
  default: ({ children }: { children: any }) => createElement("div", null, children),
}));

vi.mock("./components/OpenClawPanel", () => ({
  default: vi.fn((props: any) => {
    mocks.openClawPanelProps.push(props);
    return props.open ? createElement("div", { "data-testid": "openclaw-panel" }, "Gateway 设置") : null;
  }),
}));

describe("ChatContainer OpenClaw bootstrap", () => {
  beforeEach(() => {
    vi.useRealTimers();
    (window as any).api_host = "http://localhost:9001";
    mocks.navigate.mockReset();
    mocks.currentConversation.mockReset();
    mocks.status.mockReset();
    mocks.conversations.mockReset().mockResolvedValue({ data: { sessions: [], pagination: { hasMore: false } } });
    mocks.checkPermission.mockClear();
    mocks.eventBus.emit.mockClear();
    mocks.eventBus.on.mockClear();
    mocks.eventBus.off.mockClear();
    mocks.eventBus.clearCache.mockClear();
    mocks.searchParams = new URLSearchParams("type=openclaw");
    mocks.currentAgent = {
      agent_id: 2,
      name: "OpenClaw",
      channel_type: 1014,
      custom_config_obj: { agent_type: "openclaw" },
      settings_obj: {},
      use_cases: [],
      user_group_ids: [],
      owner_id: 0,
    } as any;
    mocks.chatViewProps = [];
    mocks.chatPluginProviderProps = [];
    mocks.openClawPanelProps = [];
    mocks.fileViewerProps = null;
    mocks.addAnswerAsMdOpen.mockClear();
    mocks.skillGetMyList.mockReset().mockResolvedValue({ items: [], count: 0 });
    mocks.buildOpenClawConversation.mockClear();
    mocks.frontStore.current_conversationid = 0;
    mocks.frontStore.conversations = [];
    mocks.frontStore.addConversation.mockClear();
    mocks.frontStore.setCurrentState.mockClear();
    mocks.frontStore.setNextAgentPrepare.mockClear();
    mocks.sharedStore.current_conversationid = 0;
    mocks.sharedStore.current_agentid = 0;
    mocks.sharedStore.conversations = [];
    mocks.sharedStore.addConversation.mockClear();
    mocks.sharedStore.setCurrentState.mockClear();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:openclaw-output-file"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    window.history.replaceState(null, "", "/chat?agent_id=2&type=openclaw");
  });

  afterEach(() => {
    delete (window as any).api_host;
    vi.useRealTimers();
  });

  it("loads the current OpenClaw session into both conversation stores and syncs the URL", async () => {
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:current",
        title: "53AI Hub-openclaw-local@example.com：当前 OpenClaw 会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
      expect(mocks.sharedStore.addConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: "agent:main:dashboard:current",
          title: "53AI Hub-openclaw-local@example.com：当前 OpenClaw 会话",
        })
      );
      expect(mocks.frontStore.addConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation_id: "agent:main:dashboard:current",
        })
      );
    });

    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:current");
    expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", "agent:main:dashboard:current", false);
    expect(window.location.search).toContain("conversation_id=agent%3Amain%3Adashboard%3Acurrent");
  });

  it("injects the OpenClaw skill adapter from the skill library API", async () => {
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:current",
        title: "53AI Hub-openclaw-local@example.com：当前 OpenClaw 会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.skillGetMyList.mockResolvedValue({
      items: [
        {
          id: "skill-library-1",
          skill_name: "openclaw_pdf_probe",
          display_name: "PDF Probe",
          binding_status: "enabled",
        },
      ],
      count: 1,
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatPluginProviderProps.length).toBeGreaterThan(0);
    });

    const latestAdapters = mocks.chatPluginProviderProps.at(-1)?.adapters;
    expect(latestAdapters?.skillApi?.listMySkills).toEqual(expect.any(Function));
    await expect(latestAdapters.skillApi.listMySkills()).resolves.toEqual([
      expect.objectContaining({
        id: "skill-library-1",
        skill_id: "skill-library-1",
        skill_name: "openclaw_pdf_probe",
        display_name: "PDF Probe",
        binding_status: "enabled",
      }),
    ]);
    expect(mocks.skillGetMyList).toHaveBeenCalledWith({ offset: 0, limit: 500 });

    latestAdapters.skillApi.openSkillLibrary();
    expect(mocks.navigate).toHaveBeenCalledWith("/skills");
  });

  it("locks embedded OpenClaw preview to the current agent without usage scope tags", async () => {
    mocks.currentAgent.user_group_ids = [12, 34];
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:current",
        title: "53AI Hub-openclaw-local@example.com：当前 OpenClaw 会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, {
      agentId: 2,
      embeddedOpenClawPreview: true,
    }));

    await waitFor(() => {
      expect(mocks.chatViewProps.length).toBeGreaterThan(0);
    });

    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.features?.agentTooltip).toBe(false);
    expect(latestProps?.features?.showRecommend).toBe(false);
    expect(latestProps?.features?.showRelatedScene).toBe(false);
    expect(latestProps?.slots?.agentSelector).toBeUndefined();
    expect(latestProps?.slots?.authTags).toBeUndefined();
  });

  it("syncs the current OpenClaw session on the index agent route without front-store navigation", async () => {
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
    mocks.searchParams = new URLSearchParams("type=openclaw");
    const replaceState = vi.spyOn(window.history, "replaceState");
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:index-current",
        title: "53AI Hub-openclaw-local@example.com：首页会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2, isIndexRoute: true }));

    await waitFor(() => {
      expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith(
        "2",
        "agent:main:dashboard:index-current",
        false
      );
    });

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("/agent/agent?agent_id=2&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Aindex-current")
    );
    expect(window.location.pathname).toBe("/agent/agent");
    expect(window.location.search).toContain("conversation_id=agent%3Amain%3Adashboard%3Aindex-current");
    replaceState.mockRestore();
  });

  it("does not let a stale OpenClaw current resolve rewrite the URL after switching agents", async () => {
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
    mocks.searchParams = new URLSearchParams("type=openclaw");
    const currentConversation = deferred<any>();
    mocks.currentConversation.mockReturnValue(currentConversation.promise);
    mocks.status.mockResolvedValue({
      data: {
        connectionHealthy: false,
        hub53ai: { connectionStatus: "disconnected" },
      },
    });

    render(createElement(ChatContainer, { agentId: 2, isIndexRoute: true }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    window.history.replaceState(null, "", "/agent/agent?agent_id=3&type=openclaw");

    await act(async () => {
      currentConversation.resolve({
        data: {
          id: "agent:main:dashboard:stale-qclaw",
          title: "53AI Hub-test：旧 QClaw 会话",
        },
      });
      await currentConversation.promise;
      await flushAsyncUpdates();
    });

    expect(window.location.search).toContain("agent_id=3");
    expect(window.location.search).not.toContain("stale-qclaw");
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
  });

  it("respects an explicit URL OpenClaw conversation id instead of replacing it with the default session", async () => {
    window.history.replaceState(
      null,
      "",
      "/chat?agent_id=2&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Acontrol"
    );
    mocks.searchParams = new URLSearchParams("type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Acontrol");
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:hub-latest",
        title: "53AI Hub-openclaw-local@example.com：最近会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, {
      agentId: 2,
      conversationId: "agent:main:dashboard:control",
    }));

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:control");
    });

    expect(mocks.currentConversation).not.toHaveBeenCalledWith(2, { ignoreMessage: true });
    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true, fresh: true });
    });
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:hub-latest");
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("2", "agent:main:dashboard:hub-latest", false);
    expect(mocks.chatViewProps.some((props) => props.initialConversationId === "agent:main:dashboard:control")).toBe(true);
    expect(window.location.search).toContain("conversation_id=agent%3Amain%3Adashboard%3Acontrol");
  });

  it("does not bind a current OpenClaw session that belongs to the control center", async () => {
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:control",
        title: "Claw Control Center",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, 0);
      expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", 0, false);
    });
    expect(mocks.sharedStore.addConversation).not.toHaveBeenCalled();
    expect(mocks.frontStore.addConversation).not.toHaveBeenCalled();
    expect(window.location.search).not.toContain("conversation_id=agent%3Amain%3Adashboard%3Acontrol");
  });

  it("keeps ChatView in initial resolving state without publishing a blank conversation while current session is pending", async () => {
    const currentConversation = deferred<any>();
    mocks.currentConversation.mockReturnValue(currentConversation.promise);
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.features?.initialConversationResolving).toBe(true);
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, 0);
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("2", 0, false);

    await act(async () => {
      currentConversation.resolve({
        data: {
          id: "agent:main:dashboard:resolved",
          title: "53AI Hub-openclaw-local@example.com：解析后的 OpenClaw 会话",
        },
      });
      await currentConversation.promise;
    });

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:resolved");
    });
  });

  it("does not let a stale OpenClaw current failure blank an already visible conversation", async () => {
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:cached-f0";
    mocks.sharedStore.current_agentid = "F0GX8N";
    mocks.frontStore.current_conversationid = "agent:main:dashboard:cached-f0";
    mocks.currentConversation.mockRejectedValue(new Error("network error: OpenClaw 插件未连接"));
    mocks.status.mockResolvedValue({ data: { connectionHealthy: false, hub53ai: { connectionStatus: "disconnected" } } });

    render(createElement(ChatContainer, { agentId: "F0GX8N" }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith("F0GX8N", { ignoreMessage: true });
    });

    await flushAsyncUpdates();

    expect(mocks.sharedStore.current_conversationid).toBe("agent:main:dashboard:cached-f0");
    expect(mocks.frontStore.current_conversationid).toBe("agent:main:dashboard:cached-f0");
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith("F0GX8N", 0);
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("F0GX8N", 0, false);
  });

  it("keeps the current OpenClaw agent state when a previous agent request settles late", async () => {
    const staleList = deferred<any>();
    const staleCurrent = deferred<any>();
    mocks.status.mockResolvedValue({ data: { connectionHealthy: false, hub53ai: { connectionStatus: "disconnected" } } });
    mocks.currentConversation.mockImplementation((agentId: string | number) => {
      if (String(agentId) === "kOKT9M") return staleCurrent.promise;
      return Promise.resolve({
        data: {
          id: "agent:main:dashboard:f0",
          title: "53AI Hub-test：测试",
        },
      });
    });
    mocks.conversations.mockImplementation((agentId: string | number) => {
      if (String(agentId) === "kOKT9M") return staleList.promise;
      return Promise.resolve({
        data: {
          sessions: [
            { id: "agent:main:dashboard:f0", title: "53AI Hub-test：测试", has_cached_history: true },
          ],
          pagination: { hasMore: false },
        },
      });
    });

    const { rerender } = render(createElement(ChatContainer, {
      agentId: "F0GX8N",
      currentAgentOverride: { ...mocks.currentAgent, agent_id: "F0GX8N", name: "qclaw" },
    }));

    await waitFor(() => {
      expect(screen.getByText("53AI Hub-test：测试")).toBeInTheDocument();
    });
    mocks.sharedStore.setCurrentState.mockClear();
    mocks.frontStore.setCurrentState.mockClear();

    rerender(createElement(ChatContainer, {
      agentId: "kOKT9M",
      currentAgentOverride: { ...mocks.currentAgent, agent_id: "kOKT9M", name: "Manus" },
    }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith("kOKT9M", { ignoreMessage: true });
      expect(mocks.conversations).toHaveBeenCalledWith("kOKT9M", {
        fresh: false,
        limit: 30,
        offset: 0,
      });
    });

    rerender(createElement(ChatContainer, {
      agentId: "F0GX8N",
      currentAgentOverride: { ...mocks.currentAgent, agent_id: "F0GX8N", name: "qclaw" },
    }));

    await waitFor(() => {
      expect(screen.getByText("53AI Hub-test：测试")).toBeInTheDocument();
    });
    mocks.sharedStore.setCurrentState.mockClear();
    mocks.frontStore.setCurrentState.mockClear();

    await act(async () => {
      staleList.resolve({
        data: {
          sessions: [
            { id: "agent:main:dashboard:k", title: "53AI Hub-Manus：测试", has_cached_history: true },
          ],
          pagination: { hasMore: false },
        },
      });
      staleCurrent.resolve({
        data: {
          id: "agent:main:dashboard:k",
          title: "53AI Hub-Manus：测试",
        },
      });
      await staleList.promise;
      await staleCurrent.promise;
    });

    await flushAsyncUpdates();

    expect(screen.getByText("53AI Hub-test：测试")).toBeInTheDocument();
    expect(screen.queryByText("53AI Hub-Manus：测试")).not.toBeInTheDocument();
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith("kOKT9M", expect.anything());
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("kOKT9M", expect.anything(), false);
  });

  it("does not block ChatView on default-session resolving when an explicit OpenClaw URL conversation is present", async () => {
    window.history.replaceState(
      null,
      "",
      "/chat?agent_id=2&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Astale"
    );
    mocks.searchParams = new URLSearchParams("type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Astale");
    const currentConversation = deferred<any>();
    mocks.currentConversation.mockReturnValue(currentConversation.promise);
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, {
      agentId: 2,
      conversationId: "agent:main:dashboard:stale",
    }));

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:stale");
    });

    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.features?.initialConversationResolving).toBe(false);
    expect(latestProps?.initialConversationId).toBe("agent:main:dashboard:stale");
  });

  it("skips group permission checks for my agents from the personal route", async () => {
    mocks.searchParams = new URLSearchParams("type=openclaw&from=my");
    mocks.currentAgent.user_group_ids = [12, 34];
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.length).toBeGreaterThan(0);
    });

    await expect(Promise.resolve(mocks.chatViewProps.at(-1)?.permission?.checkAccess?.())).resolves.toBe(true);
    expect(mocks.checkPermission).not.toHaveBeenCalled();
  });

  it("skips group permission checks for owned personal agents", async () => {
    mocks.currentAgent.owner_id = 1001;
    mocks.currentAgent.user_group_ids = [12, 34];
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.length).toBeGreaterThan(0);
    });

    await expect(Promise.resolve(mocks.chatViewProps.at(-1)?.permission?.checkAccess?.())).resolves.toBe(true);
    expect(mocks.checkPermission).not.toHaveBeenCalled();
  });

  it("keeps enterprise agent group permission checks unchanged", async () => {
    mocks.currentAgent.owner_id = 0;
    mocks.currentAgent.user_group_ids = [12, 34];
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.length).toBeGreaterThan(0);
    });

    await expect(Promise.resolve(mocks.chatViewProps.at(-1)?.permission?.checkAccess?.())).resolves.toBe(true);
    expect(mocks.checkPermission).toHaveBeenCalledWith({ groupIds: [12, 34] });
  });

  it("reads mirror current and history while OpenClaw status is still pending", async () => {
    const status = deferred<any>();
    mocks.currentAgent = {
      ...mocks.currentAgent,
      name: "QClaw",
      custom_config_obj: { agent_type: "qclaw", hostKind: "qclaw" },
    };
    mocks.status.mockReturnValue(status.promise);
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:cached-checking",
        title: "53AI Hub-openclaw-local@example.com：检查中缓存会话",
      },
    });
    mocks.conversations.mockResolvedValue({
      data: {
        sessions: [
          { id: "agent:main:dashboard:cached-checking", title: "53AI Hub-openclaw-local@example.com：检查中缓存会话" },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.status).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 0,
      });
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:cached-checking");
      expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", "agent:main:dashboard:cached-checking", false);
    });

    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.initialConversationId).toBe("agent:main:dashboard:cached-checking");
    expect(latestProps?.features?.initialConversationResolving).toBe(false);
    expect(latestProps?.features?.openclawInputDisabled).toBe(true);
    expect(latestProps?.features?.openclawInputDisabledReason).toBe("正在检测 QClaw 连接...");

    await act(async () => {
      status.resolve({ data: { connectionHealthy: false, hub53ai: { connectionStatus: "disconnected" } } });
      await status.promise;
    });
  });

  it("deduplicates OpenClaw status probing during StrictMode initialization", async () => {
    const status = deferred<any>();
    mocks.status.mockReturnValue(status.promise);

    render(createElement(StrictMode, null, createElement(ChatContainer, { agentId: 2 })));

    await waitFor(() => {
      expect(mocks.status).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      status.resolve({ data: { connectionHealthy: false, hub53ai: { connectionStatus: "disconnected" } } });
      await status.promise;
    });
  });

  it("publishes a blank OpenClaw conversation only after current session resolves empty", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, 0);
      expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", 0, false);
    });

    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.features?.initialConversationResolving).toBe(false);
  });

  it("updates the OpenClaw selector title immediately after a blank conversation is resolved", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, 0);
    });

    await act(async () => {
      mocks.chatViewProps.at(-1)?.onOpenClawConversationResolved?.({
        conversation_id: "agent:main:dashboard:new-title",
        title: "开始对话",
        question: "开始对话",
        created_time: 1779871400,
        updated_time: 1779871401,
      });
      await flushAsyncUpdates();
    });

    expect(await screen.findByText("53AI Hub-test：开始对话")).toBeInTheDocument();
    expect(mocks.sharedStore.addConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "agent:main:dashboard:new-title",
        title: "53AI Hub-test：开始对话",
      })
    );
    expect(mocks.frontStore.addConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "agent:main:dashboard:new-title",
        title: "53AI Hub-test：开始对话",
      })
    );
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:new-title");
    expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", "agent:main:dashboard:new-title", false);
    expect(mocks.eventBus.emit).toHaveBeenCalledWith("shortcut:updated");
  });

  it("does not inherit an OpenClaw current conversation from another agent", async () => {
    mocks.sharedStore.current_agentid = 3;
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:other-agent";
    mocks.sharedStore.conversations = [
      {
        conversation_id: "agent:main:dashboard:other-agent",
        agent_id: 3,
        title: "53AI Hub-test：其他智能体会话",
        created_time: 1779871300,
        updated_time: 1779871301,
        is_valid: 1,
      },
    ];
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    expect(screen.queryByText("53AI Hub-test：其他智能体会话")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, 0);
    });

    expect(mocks.chatViewProps.at(-1)?.initialConversationId).not.toBe("agent:main:dashboard:other-agent");
  });

  it("ignores a stale route conversation id when switching between OpenClaw agents", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    window.history.replaceState(
      null,
      "",
      "/chat?agent_id=3&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Aagent-3"
    );

    const { rerender } = render(
      createElement(ChatContainer, {
        agentId: 3,
        conversationId: "agent:main:dashboard:agent-3",
      })
    );

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(3, "agent:main:dashboard:agent-3");
    });

    mocks.sharedStore.setCurrentState.mockClear();
    mocks.frontStore.setCurrentState.mockClear();
    mocks.currentAgent = {
      ...mocks.currentAgent,
      agent_id: 2,
      name: "QClaw",
      custom_config_obj: { agent_type: "qclaw", hostKind: "qclaw" },
    };
    window.history.replaceState(
      null,
      "",
      "/chat?agent_id=2&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Aagent-3"
    );

    rerender(
      createElement(ChatContainer, {
        agentId: 2,
        conversationId: "agent:main:dashboard:agent-3",
      })
    );

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, 0);
    });

    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:agent-3");
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("2", "agent:main:dashboard:agent-3", false);
    expect(mocks.chatViewProps.at(-1)?.initialConversationId).not.toBe("agent:main:dashboard:agent-3");
    expect(window.location.search).not.toContain("conversation_id=agent%3Amain%3Adashboard%3Aagent-3");
  });

  it("keeps the OpenClaw input disabled while loading cached conversations offline", async () => {
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:stale-qclaw" as any;
    mocks.sharedStore.current_agentid = 2;
    mocks.frontStore.current_conversationid = "agent:main:dashboard:stale-qclaw" as any;
    mocks.currentAgent = {
      ...mocks.currentAgent,
      name: "QClaw",
      custom_config_obj: { agent_type: "qclaw", hostKind: "qclaw" },
    };
    mocks.status.mockResolvedValue({
      data: {
        healthy: true,
        gatewayHealth: { ok: true, status: "ok" },
        connectionHealthy: false,
        hub53ai: { connectionStatus: "disconnected" },
      },
    });
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:cached-offline",
        title: "53AI Hub-openclaw-local@example.com：缓存会话",
      },
    });
    mocks.conversations.mockResolvedValue({
      data: {
        sessions: [
          { id: "agent:main:dashboard:cached-offline", title: "53AI Hub-openclaw-local@example.com：缓存会话" },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.status).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 0,
      });
    });
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:cached-offline");
    expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", "agent:main:dashboard:cached-offline", false);
    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.initialConversationId).toBe("agent:main:dashboard:cached-offline");
    expect(latestProps?.features).toMatchObject({
      openclaw: true,
      openclawInputDisabled: true,
      openclawInputDisabledReason: "QClaw 插件未连接，正在重连...",
    });
  });

  it("fills a blank visible conversation from fresh current after status polling reports connected", async () => {
    vi.useFakeTimers();
    mocks.status
      .mockResolvedValueOnce({
        data: {
          healthy: true,
          gatewayHealth: { ok: true, status: "ok" },
          connectionHealthy: false,
          hub53ai: { connectionStatus: "disconnected" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          connectionHealthy: true,
          hub53ai: { connectionStatus: "connected" },
        },
      });
    mocks.currentConversation
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:recovered",
          title: "53AI Hub-openclaw-local@example.com：恢复后的会话",
        },
      });

    render(createElement(ChatContainer, { agentId: 2 }));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, 0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    vi.useRealTimers();

    expect(mocks.currentConversation).toHaveBeenCalledTimes(2);
    expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true, fresh: true });
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:recovered");
  });

  it("does not switch the visible OpenClaw conversation when fresh current returns a different id", async () => {
    mocks.status.mockResolvedValue({
      data: {
        connectionHealthy: true,
        hub53ai: { connectionStatus: "connected" },
      },
    });
    mocks.currentConversation
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:mirror-current",
          title: "53AI Hub-openclaw-local@example.com：Mirror 当前",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:plugin-current",
          title: "53AI Hub-openclaw-local@example.com：插件当前",
        },
      });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:mirror-current");
    });

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true, fresh: true });
      expect(mocks.sharedStore.addConversation).toHaveBeenCalledWith(
        expect.objectContaining({ conversation_id: "agent:main:dashboard:plugin-current" })
      );
    });

    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:plugin-current");
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("2", "agent:main:dashboard:plugin-current", false);
    expect(mocks.chatViewProps.at(-1)?.initialConversationId).toBe("agent:main:dashboard:mirror-current");
  });

  it("reselects mirror current after a connected OpenClaw plugin disconnects", async () => {
    vi.useFakeTimers();
    mocks.status
      .mockResolvedValueOnce({
        data: {
          connectionHealthy: true,
          hub53ai: { connectionStatus: "connected" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          connectionHealthy: false,
          hub53ai: { connectionStatus: "disconnected" },
        },
      });
    mocks.currentConversation
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:mirror-initial",
          title: "53AI Hub-openclaw-local@example.com：初始缓存会话",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:plugin-current",
          title: "53AI Hub-openclaw-local@example.com：插件当前会话",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:mirror-restored",
          title: "53AI Hub-openclaw-local@example.com：断线恢复缓存会话",
        },
      });
    mocks.conversations.mockResolvedValue({
      data: {
        source: "mirror",
        sessions: [
          { id: "agent:main:dashboard:mirror-restored", title: "53AI Hub-openclaw-local@example.com：断线恢复缓存会话" },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await act(async () => {
      await flushAsyncUpdates();
    });
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:mirror-initial");
    expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true, fresh: true });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await flushAsyncUpdates();
    });
    vi.useRealTimers();

    expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:mirror-restored");
    expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith("2", "agent:main:dashboard:mirror-restored", false);
  });

  it("does not let disconnected mirror current override an explicit history selection", async () => {
    vi.useFakeTimers();
    mocks.status
      .mockResolvedValueOnce({
        data: {
          connectionHealthy: true,
          hub53ai: { connectionStatus: "connected" },
        },
      })
      .mockResolvedValueOnce({
        data: {
          connectionHealthy: false,
          hub53ai: { connectionStatus: "disconnected" },
        },
      });
    mocks.currentConversation
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:mirror-initial",
          title: "53AI Hub-openclaw-local@example.com：初始缓存会话",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:plugin-current",
          title: "53AI Hub-openclaw-local@example.com：插件当前会话",
        },
      })
      .mockResolvedValueOnce({
        data: {
          id: "agent:main:dashboard:mirror-restored",
          title: "53AI Hub-openclaw-local@example.com：断线恢复缓存会话",
        },
      });
    mocks.conversations.mockResolvedValue({
      data: {
        source: "mirror",
        sessions: [
          { id: "agent:main:dashboard:manual", title: "53AI Hub-openclaw-local@example.com：手动选择会话" },
          { id: "agent:main:dashboard:mirror-restored", title: "53AI Hub-openclaw-local@example.com：断线恢复缓存会话" },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await act(async () => {
      await flushAsyncUpdates();
    });
    const selector = screen.getByTestId("openclaw-history-selector");
    fireEvent.click(selector.querySelector(".openclaw-history-trigger") as HTMLElement);

    await act(async () => {
      await flushAsyncUpdates();
    });
    expect(document.querySelector('[data-conversation-id="agent:main:dashboard:manual"]')).toBeInTheDocument();

    fireEvent.click(document.querySelector('[data-conversation-id="agent:main:dashboard:manual"]') as HTMLElement);
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:manual");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
      await flushAsyncUpdates();
    });
    vi.useRealTimers();

    expect(mocks.currentConversation.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:mirror-restored");
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("2", "agent:main:dashboard:mirror-restored", false);
  });

  it("queues a fresh OpenClaw history reload when the mirror list is still loading during connect", async () => {
    const mirrorHistory = deferred<any>();
    mocks.status.mockResolvedValue({
      data: {
        connectionHealthy: true,
        hub53ai: { connectionStatus: "connected" },
      },
    });
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:mirror-current",
        title: "53AI Hub-openclaw-local@example.com：Mirror 当前",
      },
    });
    mocks.conversations
      .mockReturnValueOnce(mirrorHistory.promise)
      .mockResolvedValueOnce({
        data: {
          sessions: [
            { id: "agent:main:dashboard:fresh-list", title: "53AI Hub-openclaw-local@example.com：Fresh 列表" },
          ],
          pagination: { hasMore: false },
        },
      });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 0,
      });
    });

    expect(mocks.conversations).toHaveBeenCalledTimes(1);

    await act(async () => {
      mirrorHistory.resolve({
        data: {
          sessions: [
            { id: "agent:main:dashboard:mirror-list", title: "53AI Hub-openclaw-local@example.com：Mirror 列表" },
          ],
          pagination: { hasMore: false },
        },
      });
      await mirrorHistory.promise;
    });

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: true,
        limit: 30,
        offset: 0,
      });
    });
  });

  it("ignores a stale disconnected status response after switching OpenClaw agents", async () => {
    const staleStatus = deferred<any>();
    const activeStatus = deferred<any>();
    const staleCurrentConversation = deferred<any>();
    mocks.status.mockImplementation((targetAgentId: string | number) =>
      String(targetAgentId) === "2" ? staleStatus.promise : activeStatus.promise
    );
    mocks.currentConversation.mockImplementation((targetAgentId: string | number) =>
      String(targetAgentId) === "2"
        ? staleCurrentConversation.promise
        : Promise.resolve({
          data: {
            id: "agent:main:dashboard:agent-3-current",
            title: "53AI Hub-openclaw-local@example.com：A 智能体会话",
          },
        })
    );

    const { rerender } = render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.status).toHaveBeenCalledWith(2, { ignoreMessage: true });
      expect(mocks.currentConversation).toHaveBeenCalledWith(2, { ignoreMessage: true });
    });

    mocks.currentAgent = {
      ...mocks.currentAgent,
      agent_id: 3,
      name: "QClaw",
    };
    rerender(createElement(ChatContainer, { agentId: 3 }));

    await waitFor(() => {
      expect(mocks.status).toHaveBeenCalledWith(3, { ignoreMessage: true });
    });

    await act(async () => {
      activeStatus.resolve({
        data: {
          connectionHealthy: true,
          hub53ai: { connectionStatus: "connected" },
        },
      });
      await activeStatus.promise;
    });

    await waitFor(() => {
      expect(mocks.currentConversation).toHaveBeenCalledWith(3, { ignoreMessage: true });
    });

    await act(async () => {
      staleCurrentConversation.resolve({
        data: {
          id: "agent:main:dashboard:agent-2-stale",
          title: "53AI Hub-openclaw-local@example.com：旧智能体会话",
        },
      });
      await staleCurrentConversation.promise;
    });

    await act(async () => {
      staleStatus.resolve({
        data: {
          connectionHealthy: false,
          hub53ai: { connectionStatus: "disconnected" },
        },
      });
      await staleStatus.promise;
    });

    const latestProps = mocks.chatViewProps.at(-1);
    expect(latestProps?.features?.openclawInputDisabled).toBe(false);
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:agent-2-stale");
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith("2", "agent:main:dashboard:agent-2-stale", false);
  });

  it("renders Gateway settings as a right side panel that takes chat layout space", async () => {
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:current",
        title: "53AI Hub-openclaw-local@example.com：当前 OpenClaw 会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    const gatewayButton = await screen.findByRole("button", { name: "Gateway 设置" });
    fireEvent.click(gatewayButton);

    const sidePanel = await screen.findByTestId("openclaw-side-panel");
    expect(sidePanel).toContainElement(screen.getByTestId("openclaw-panel"));
    expect(sidePanel.className).toContain("flex-none");
    expect(sidePanel.className).toContain("w-[450px]");
    expect(sidePanel.className).toContain("border-l");
  });

  it("closes the usage guide when opening the Gateway settings panel", async () => {
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:current",
        title: "53AI Hub-openclaw-local@example.com：当前 OpenClaw 会话",
      },
    });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    const guideButton = await screen.findByRole("button", { name: "chat.usage_guide" });
    fireEvent.click(guideButton);
    expect(screen.getByText("chat.usage_guide")).toBeInTheDocument();

    const gatewayButton = await screen.findByRole("button", { name: "Gateway 设置" });
    fireEvent.click(gatewayButton);

    expect(await screen.findByTestId("openclaw-side-panel")).toBeInTheDocument();
    expect(screen.queryByText("chat.usage_guide")).not.toBeInTheDocument();
  });

  it("opens generated OpenClaw files in the right preview pane instead of downloading immediately", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    const gatewayButton = await screen.findByRole("button", { name: "Gateway 设置" });
    fireEvent.click(gatewayButton);
    expect(await screen.findByTestId("openclaw-side-panel")).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "file-1",
          file_name: "report.md",
          url: "/api/upload-files/file-1/download/report.md",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.queryByTestId("openclaw-side-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();
    expect(screen.getByText("report.md")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "action.download" })).toBeInTheDocument();
    expect(mocks.fileViewerProps.extension).toBe("md");
    expect(mocks.fileViewerProps.url).toContain("http://localhost:9001/api/upload-files/file-1/download/report.md");
    expect(mocks.fileViewerProps.url).toContain("token=user-token-1");

    fireEvent.click(screen.getByRole("button", { name: "关闭文件预览" }));
    expect(screen.queryByTestId("openclaw-output-file-preview-pane")).not.toBeInTheDocument();
  });

  it("uses stable preview urls over transient realtime file urls", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "file-1",
          file_name: "live-report.md",
          url: "http://127.0.0.1:1/unavailable/live-report.md",
          preview_url: "/api/preview/live-report.md",
          download_url: "/api/upload-files/file-1/download/live-report.md",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();
    expect(mocks.fileViewerProps.url).toContain("http://localhost:9001/api/preview/live-report.md");
    expect(mocks.fileViewerProps.url).not.toContain("localhost:5173");
    expect(mocks.fileViewerProps.url).not.toContain("token=user-token-1");
    expect(mocks.fileViewerProps.url).not.toContain("127.0.0.1:1");
  });

  it("derives the preview host from absolute artifact urls when runtime api host is missing", async () => {
    delete (window as any).api_host;
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "file-1",
          file_name: "report.md",
          preview_url: "/api/preview/report.md",
          signed_download_url: "http://localhost:9001/api/openclaw/agents/2/artifacts/file-1/download",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();
    expect(mocks.fileViewerProps.url).toContain("http://localhost:9001/api/preview/report.md");
    expect(mocks.fileViewerProps.url).not.toContain("localhost:5173");
  });

  it("keeps the upload entry enabled for OpenClaw agents without parser settings", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentAgent = {
      ...mocks.currentAgent,
      settings_obj: {},
    };

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)).toEqual(
        expect.objectContaining({
          fileUpload: expect.objectContaining({
            request: expect.any(Function),
            acceptTypes: "*/*",
            enabled: true,
            allowMultiple: true,
            allowSendWithFiles: true,
            enableDrag: true,
            enablePaste: true,
          }),
          features: expect.objectContaining({
            fileUpload: true,
            allowMultiple: true,
            allowSendWithFiles: true,
            enableDragUpload: true,
            enablePasteUpload: true,
          }),
        })
      );
    });
  });

  it("uses preview urls for the preview pane while keeping download urls for downloads", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    const originalCreateElement = document.createElement.bind(document);
    let createdAnchor = null as HTMLAnchorElement | null;
    const createElementSpy = vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        createdAnchor = element as HTMLAnchorElement;
        vi.spyOn(createdAnchor, "click").mockImplementation(() => undefined);
      }
      return element;
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "file-1",
          file_name: "report.md",
          preview_url: "/api/preview/report.md",
          download_url: "/api/openclaw/agents/2/artifacts/file-1/download",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();
    expect(mocks.fileViewerProps.url).toContain("http://localhost:9001/api/preview/report.md");
    expect(mocks.fileViewerProps.url).not.toContain("/download");

    fireEvent.click(screen.getByRole("button", { name: "action.download" }));
    expect(createdAnchor?.href).toContain("http://localhost:9001/api/openclaw/agents/2/artifacts/file-1/download");

    createElementSpy.mockRestore();
  });

  it("closes an OpenClaw file preview when switching agents", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    const { rerender } = render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "file-1",
          file_name: "report.md",
          preview_url: "/api/preview/report.md",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();

    mocks.currentAgent = {
      ...mocks.currentAgent,
      agent_id: 3,
    };
    rerender(createElement(ChatContainer, { agentId: 3 }));

    await waitFor(() => {
      expect(screen.queryByTestId("openclaw-output-file-preview-pane")).not.toBeInTheDocument();
    });
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it("closes an OpenClaw file preview when switching conversations", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    const { rerender } = render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "file-1",
          file_name: "report.md",
          preview_url: "/api/preview/report.md",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();

    act(() => {
      mocks.sharedStore.current_conversationid = "agent:main:dashboard:next";
      mocks.sharedStore.current_agentid = 2;
    });
    rerender(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(screen.queryByTestId("openclaw-output-file-preview-pane")).not.toBeInTheDocument();
    });
  });

  it("opens content-only OpenClaw local files in the right preview pane", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "local:/Users/y65ng/.qclaw/workspace/test_document.txt",
          file_name: "test_document.txt",
          mime_type: "text/plain",
          content: "这是一个十五字测试文档",
          source_kind: "tool.write",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();
    expect(screen.getByText("test_document.txt")).toBeInTheDocument();
    expect(mocks.fileViewerProps.url).toBe("blob:openclaw-output-file");
    expect(mocks.fileViewerProps.content).toBe("这是一个十五字测试文档");
    expect(mocks.fileViewerProps.extension).toBe("txt");
  });

  it("opens base64-only OpenClaw files in the right preview pane", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onOutputFilePreview).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onOutputFilePreview(
        {
          id: "output-test-12",
          file_name: "test_12words_v3.txt",
          mime_type: "text/plain",
          base64: "56ys5LiJ5Liq5Y2B5LqM5Liq5rGJ5a2X5rWL6K+V5paH5qGj",
          source_kind: "tool.write",
        },
        { id: "assistant-1" }
      );
    });

    expect(screen.getByTestId("openclaw-output-file-preview-pane")).toBeInTheDocument();
    expect(screen.getByText("test_12words_v3.txt")).toBeInTheDocument();
    expect(mocks.fileViewerProps.url).toBe(
      "data:text/plain;base64,56ys5LiJ5Liq5Y2B5LqM5Liq5rGJ5a2X5rWL6K+V5paH5qGj"
    );
    expect(mocks.fileViewerProps.extension).toBe("txt");
  });

  it("opens the add-to-knowledge dialog with the OpenClaw assistant answer", async () => {
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.chatViewProps.at(-1)?.onAddAsMd).toEqual(expect.any(Function));
    });

    act(() => {
      mocks.chatViewProps.at(-1).onAddAsMd({
        id: "assistant-1",
        question: "生成一份迁移报告",
        answer: "",
        openclawProjection: {
          visibleAnswer: "这是 OpenClaw 生成的最终报告。",
          timelineItems: [],
          outputFiles: [],
          activities: [],
        },
      });
    });

    expect(mocks.addAnswerAsMdOpen).toHaveBeenCalledWith({
      answer: "这是 OpenClaw 生成的最终报告。",
      question: "生成一份迁移报告",
    });
  });

  it("lets the OpenClaw history selector shrink with the available toolbar space", async () => {
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:history";
    mocks.sharedStore.current_agentid = 2;
    mocks.sharedStore.conversations = [
      {
        conversation_id: "agent:main:dashboard:history",
        title: "A very long OpenClaw conversation title that should stay truncated inside the selector",
        created_time: 1779871345,
        updated_time: 1779871346,
        is_valid: 1,
      },
    ];

    render(createElement(ChatContainer, { agentId: 2 }));

    const selector = screen.getByTestId("openclaw-history-selector");
    const selectorClasses = selector.className.split(/\s+/);
    expect(selectorClasses).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "max-w-[520px]"]));
    expect(selectorClasses).not.toContain("w-[520px]");
    expect(selectorClasses).not.toContain("max-w-[45vw]");
    expect(selectorClasses).not.toContain("flex-none");

    const label = selector.querySelector(".openclaw-history-trigger > span");
    expect(label?.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-w-0", "flex-1", "truncate"]));
  });

  it("does not render a raw OpenClaw conversation id as the selector title", async () => {
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:raw-title";
    mocks.sharedStore.current_agentid = 2;
    mocks.sharedStore.conversations = [
      {
        conversation_id: "agent:main:dashboard:raw-title",
        title: "agent:main:dashboard:raw-title",
        created_time: 1779871345,
        updated_time: 1779871346,
        is_valid: 1,
      },
    ];

    render(createElement(ChatContainer, { agentId: 2 }));

    const selector = screen.getByTestId("openclaw-history-selector");
    await waitFor(() => {
      expect(selector).toHaveTextContent("新对话");
      expect(selector).not.toHaveTextContent("agent:main:dashboard:raw-title");
    });
  });

  it("renders a new conversation label instead of an OpenClaw control-center title", async () => {
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:control-title";
    mocks.sharedStore.current_agentid = 2;
    mocks.sharedStore.conversations = [
      {
        conversation_id: "agent:main:dashboard:control-title",
        title: "Claw Control Center",
        created_time: 1779871345,
        updated_time: 1779871346,
        is_valid: 1,
      },
    ];

    render(createElement(ChatContainer, { agentId: 2 }));

    const selector = screen.getByTestId("openclaw-history-selector");
    await waitFor(() => {
      expect(selector).toHaveTextContent("新对话");
      expect(selector).not.toHaveTextContent("Claw Control Center");
      expect(selector).not.toHaveTextContent("OpenClaw");
    });
  });

  it("does not let a fresh control-center title overwrite an existing Hub title", async () => {
    const conversationId = "agent:main:dashboard:resolved-title";
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.sharedStore.current_conversationid = conversationId;
    mocks.sharedStore.current_agentid = 2;
    mocks.sharedStore.conversations = [
      {
        conversation_id: conversationId,
        title: "53AI Hub-test：开始对话",
        created_time: 1779871345,
        updated_time: 1779871346,
        is_valid: 1,
      },
    ];
    mocks.conversations.mockImplementation((_agentId: string | number, params: any = {}) => Promise.resolve({
      data: {
        sessions: [
          {
            id: conversationId,
            title: params.fresh ? "Claw Control Center" : "53AI Hub-test：开始对话",
            has_cached_history: true,
          },
        ],
        pagination: { hasMore: false },
      },
    }));

    render(createElement(ChatContainer, { agentId: 2 }));

    const selector = screen.getByTestId("openclaw-history-selector");
    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, expect.objectContaining({ fresh: true }));
    });
    await waitFor(() => {
      expect(selector).toHaveTextContent("53AI Hub-test：开始对话");
      expect(selector).not.toHaveTextContent("Claw Control Center");
    });
  });

  it("replaces the OpenClaw history list with fresh plugin order while preserving cache flags", async () => {
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:current";
    mocks.sharedStore.current_agentid = 2;
    mocks.conversations.mockImplementation((_agentId: string | number, params: any = {}) => {
      if (params.fresh) {
        return Promise.resolve({
          data: {
            source: "openclaw",
            sessions: [
              { id: "agent:main:dashboard:fresh-only", title: "53AI Hub-Y65NG：Fresh Only", has_cached_history: false },
              { id: "agent:main:dashboard:current", title: "53AI Hub-Y65NG：当前 Fresh Metadata", has_cached_history: true },
            ],
            pagination: { hasMore: false },
          },
        });
      }
      return Promise.resolve({
        data: {
          source: "mirror",
          sessions: [
            { id: "agent:main:dashboard:current", title: "53AI Hub-Y65NG：当前", has_cached_history: true },
            { id: "agent:main:dashboard:other", title: "53AI Hub-Y65NG：其他", has_cached_history: true },
          ],
          pagination: { hasMore: false },
        },
      });
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: true,
        limit: 30,
        offset: 0,
      });
    });

    const selector = screen.getByTestId("openclaw-history-selector");
    const trigger = selector.querySelector(".openclaw-history-trigger") as HTMLElement;
    fireEvent.click(trigger);

    await waitFor(() => {
      const rows = Array.from(document.querySelectorAll(".openclaw-history-row"));
      expect(rows.map((row) => row.textContent)).toEqual([
        "53AI Hub-Y65NG：Fresh Only",
        "53AI Hub-Y65NG：当前 Fresh Metadata",
      ]);
      expect(document.querySelector('[data-conversation-id="agent:main:dashboard:fresh-only"]')).toBeInTheDocument();
    });
  });

  it("shows uncached discovered OpenClaw conversations offline but disables selecting them", async () => {
    mocks.status.mockResolvedValue({
      data: {
        connectionHealthy: false,
        hub53ai: { connectionStatus: "disconnected" },
      },
    });
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:cached",
        title: "53AI Hub-test：Cached",
      },
    });
    mocks.conversations.mockResolvedValue({
      data: {
        source: "mirror",
        sessions: [
          { id: "agent:main:dashboard:cached", title: "53AI Hub-test：Cached", has_cached_history: true },
          { id: "agent:main:dashboard:cached-other", title: "53AI Hub-test：Other Cached", has_cached_history: true },
          { id: "agent:main:dashboard:uncached", title: "Session 2", has_cached_history: false },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 0,
      });
    });

    const selector = screen.getByTestId("openclaw-history-selector");
    await act(async () => {
      fireEvent.click(selector.querySelector(".openclaw-history-trigger") as HTMLElement);
      await flushAsyncUpdates();
    });

    await waitFor(() => {
      expect(document.querySelector('[data-conversation-id="agent:main:dashboard:uncached"]')).toBeInTheDocument();
    });
    const cachedRow = document.querySelector('[data-conversation-id="agent:main:dashboard:cached-other"]') as HTMLButtonElement;
    expect(cachedRow).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(cachedRow);
      await flushAsyncUpdates();
    });
    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:cached-other");
    expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:cached-other", false);

    const uncachedRow = document.querySelector('[data-conversation-id="agent:main:dashboard:uncached"]') as HTMLButtonElement;
    expect(uncachedRow).toBeDisabled();
    expect(uncachedRow.className).toContain("cursor-not-allowed");
    fireEvent.click(uncachedRow);

    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:uncached");
    expect(mocks.frontStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:uncached", false);
  });

  it("allows selecting uncached discovered OpenClaw conversations after the plugin connects", async () => {
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.conversations.mockImplementation((_agentId: string | number, params: any = {}) => {
      if (params.fresh) {
        return Promise.resolve({
          data: {
            source: "openclaw",
            sessions: [
              { id: "agent:main:dashboard:uncached-online", title: "Session Online", has_cached_history: false },
            ],
            pagination: { hasMore: false },
          },
        });
      }
      return Promise.resolve({
        data: {
          source: "mirror",
          sessions: [],
          pagination: { hasMore: false },
        },
      });
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: true,
        limit: 30,
        offset: 0,
      });
    });

    const selector = screen.getByTestId("openclaw-history-selector");
    await act(async () => {
      fireEvent.click(selector.querySelector(".openclaw-history-trigger") as HTMLElement);
      await flushAsyncUpdates();
    });

    await waitFor(() => {
      expect(document.querySelector('[data-conversation-id="agent:main:dashboard:uncached-online"]')).toBeInTheDocument();
    });
    const uncachedRow = document.querySelector('[data-conversation-id="agent:main:dashboard:uncached-online"]') as HTMLButtonElement;
    expect(uncachedRow).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(uncachedRow);
      await flushAsyncUpdates();
    });

    await waitFor(() => {
      expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:uncached-online");
      expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:uncached-online", false);
    });
  });

  it("expands cached OpenClaw history in steps and fetches the next page at the boundary without re-scrolling the selection", async () => {
    const firstPage = Array.from({ length: 30 }, (_, index) => ({
      id: `agent:main:dashboard:session-${String(index + 1).padStart(2, "0")}`,
      title: `Session ${String(index + 1).padStart(2, "0")}`,
      has_cached_history: true,
    }));
    const secondPage = Array.from({ length: 5 }, (_, index) => ({
      id: `agent:main:dashboard:session-${String(index + 31).padStart(2, "0")}`,
      title: `Session ${String(index + 31).padStart(2, "0")}`,
      has_cached_history: index === 0,
    }));
    mocks.status.mockResolvedValue({
      data: {
        connectionHealthy: false,
        hub53ai: { connectionStatus: "disconnected" },
      },
    });
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: firstPage[0].id,
        title: firstPage[0].title,
        has_cached_history: true,
      },
    });
    mocks.conversations.mockImplementation((_agentId: string | number, params: any = {}) =>
      Promise.resolve({
        data: {
          source: "mirror",
          sessions: params.offset === 30 ? secondPage : firstPage,
          pagination: params.offset === 30
            ? { limit: 30, offset: 30, total: 35, hasMore: false, nextOffset: 35 }
            : { limit: 30, offset: 0, total: 35, hasMore: true, nextOffset: 30 },
        },
      })
    );

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 0,
      });
    });

    const selector = screen.getByTestId("openclaw-history-selector");
    await act(async () => {
      fireEvent.click(selector.querySelector(".openclaw-history-trigger") as HTMLElement);
      await flushAsyncUpdates();
    });

    await waitFor(() => {
      expect(document.querySelectorAll(".openclaw-history-row")).toHaveLength(10);
    });
    const scrollIntoView = HTMLElement.prototype.scrollIntoView as any;
    const autoScrollCalls = scrollIntoView.mock.calls.length;
    const list = screen.getByTestId("openclaw-history-list");
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1000 },
      clientHeight: { configurable: true, value: 100 },
      scrollTop: { configurable: true, value: 900, writable: true },
    });

    await act(async () => {
      fireEvent.scroll(list);
      await flushAsyncUpdates();
    });
    expect(document.querySelectorAll(".openclaw-history-row")).toHaveLength(20);
    expect(mocks.conversations).not.toHaveBeenCalledWith(2, expect.objectContaining({ offset: 30 }));
    expect(scrollIntoView.mock.calls.length).toBe(autoScrollCalls);

    await act(async () => {
      fireEvent.scroll(list);
      await flushAsyncUpdates();
    });
    expect(document.querySelectorAll(".openclaw-history-row")).toHaveLength(30);
    expect(mocks.conversations).not.toHaveBeenCalledWith(2, expect.objectContaining({ offset: 30 }));

    await act(async () => {
      fireEvent.scroll(list);
      await flushAsyncUpdates();
    });

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 30,
      });
      expect(document.querySelector('[data-conversation-id="agent:main:dashboard:session-31"]')).toBeInTheDocument();
    });
  });

  it("treats missing OpenClaw cache metadata as unavailable while offline", async () => {
    mocks.status.mockResolvedValue({
      data: {
        connectionHealthy: false,
        hub53ai: { connectionStatus: "disconnected" },
      },
    });
    mocks.currentConversation.mockResolvedValue({
      data: {
        id: "agent:main:dashboard:cached",
        title: "53AI Hub-test：Cached",
        has_cached_history: true,
      },
    });
    mocks.conversations.mockResolvedValue({
      data: {
        source: "mirror",
        sessions: [
          { id: "agent:main:dashboard:cached", title: "53AI Hub-test：Cached", has_cached_history: true },
          { id: "agent:main:dashboard:missing-flag", title: "Legacy Session" },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2 }));

    await waitFor(() => {
      expect(mocks.conversations).toHaveBeenCalledWith(2, {
        fresh: false,
        limit: 30,
        offset: 0,
      });
    });

    const selector = screen.getByTestId("openclaw-history-selector");
    await act(async () => {
      fireEvent.click(selector.querySelector(".openclaw-history-trigger") as HTMLElement);
      await flushAsyncUpdates();
    });

    await waitFor(() => {
      expect(document.querySelector('[data-conversation-id="agent:main:dashboard:missing-flag"]')).toBeInTheDocument();
    });
    const legacyRow = document.querySelector('[data-conversation-id="agent:main:dashboard:missing-flag"]') as HTMLButtonElement;
    expect(legacyRow).toBeDisabled();
    fireEvent.click(legacyRow);
    expect(mocks.sharedStore.setCurrentState).not.toHaveBeenCalledWith(2, "agent:main:dashboard:missing-flag");
  });

  it("selects OpenClaw history on the index agent route without front-store navigation", async () => {
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
    mocks.searchParams = new URLSearchParams("type=openclaw");
    const replaceState = vi.spyOn(window.history, "replaceState");
    mocks.status.mockResolvedValue({ data: { connectionHealthy: true, hub53ai: { connectionStatus: "connected" } } });
    mocks.currentConversation.mockResolvedValue({ data: {} });
    mocks.sharedStore.current_conversationid = "agent:main:dashboard:current";
    mocks.sharedStore.current_agentid = 2;
    mocks.sharedStore.conversations = [
      {
        conversation_id: "agent:main:dashboard:current",
        title: "53AI Hub-Y65NG：当前",
        created_time: 1779871345,
        updated_time: 1779871346,
        is_valid: 1,
      },
    ];
    mocks.conversations.mockResolvedValue({
      data: {
        sessions: [
          { id: "agent:main:dashboard:current", title: "53AI Hub-Y65NG：当前" },
          { id: "agent:main:dashboard:other", title: "53AI Hub-Y65NG：其他" },
        ],
        pagination: { hasMore: false },
      },
    });

    render(createElement(ChatContainer, { agentId: 2, isIndexRoute: true }));

    const selector = screen.getByTestId("openclaw-history-selector");
    const trigger = selector.querySelector(".openclaw-history-trigger") as HTMLElement;
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(document.querySelector('[data-conversation-id="agent:main:dashboard:other"]')).toBeInTheDocument();
    });

    fireEvent.click(document.querySelector('[data-conversation-id="agent:main:dashboard:other"]') as HTMLElement);

    expect(mocks.sharedStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:other");
    expect(mocks.frontStore.setCurrentState).toHaveBeenCalledWith(2, "agent:main:dashboard:other", false);
    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      expect.stringContaining("/agent/agent?agent_id=2&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Aother")
    );
    expect(window.location.pathname).toBe("/agent/agent");
    expect(window.location.search).toContain("conversation_id=agent%3Amain%3Adashboard%3Aother");
    replaceState.mockRestore();
  });
});
