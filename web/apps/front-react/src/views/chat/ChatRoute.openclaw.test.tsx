import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ChatView from "./index";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  searchParams: new URLSearchParams("agent_id=F0GX8N&type=openclaw"),
  location: { pathname: "/agent/agent" },
  currentAgent: {
    agent_id: "F0GX8N",
    name: "qclaw",
    channel_type: 1014,
    custom_config_obj: {},
    settings_obj: {},
  },
  agentStore: {
    boxHeight: 0,
    myAgentList: [] as any[],
    loadAgentList: vi.fn(),
    loadMyAgentList: vi.fn(),
    loadCategorys: vi.fn(),
    findAgentByAgentId: vi.fn(),
  },
  conversationStore: {
    current_agentid: "",
    current_conversationid: 0 as string | number,
    setBasePath: vi.fn(),
    setCurrentState: vi.fn(),
    loadConversations: vi.fn(),
    clearCurrentState: vi.fn(),
  },
  eventHandlers: {} as Record<string, () => void>,
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useSearchParams: () => [mocks.searchParams],
  useLocation: () => mocks.location,
  Outlet: () => <div data-testid="outlet" />,
}));

vi.mock("antd", () => ({
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
}));

vi.mock("@km/shared-components-react", () => ({
  SvgIcon: () => <span data-testid="svg-icon" />,
}));

vi.mock("@/components/DetailBreadcrumb", () => ({
  default: ({ name }: any) => <div data-testid="breadcrumb">{name}</div>,
  MODULE_CONFIGS: { agent: {} },
}));

vi.mock("./ChatContainer", () => ({
  default: () => <div data-testid="chat-container" />,
}));

vi.mock("@/stores/modules/agent", () => {
  const useAgentStore = Object.assign(vi.fn(() => mocks.agentStore), {
    getState: () => mocks.agentStore,
    setState: vi.fn((updater: any) => {
      const next = typeof updater === "function" ? updater(mocks.agentStore) : updater;
      Object.assign(mocks.agentStore, next);
    }),
  });
  return {
    useAgentStore,
    useCurrentAgent: () => mocks.currentAgent,
  };
});

vi.mock("@/stores/modules/conversation", () => ({
  useConversationStore: () => mocks.conversationStore,
}));

vi.mock("@/stores/modules/enterprise", () => ({
  useIsSoftStyle: () => false,
}));

vi.mock("@/stores/modules/user", () => ({
  useUserStore: () => ({ is_login: true }),
}));

vi.mock("@/api/modules/agents", () => ({
  default: {
    my: { detail: vi.fn() },
  },
}));

vi.mock("@/constants/events", () => ({
  EVENT_NAMES: { LOGIN_SUCCESS: "LOGIN_SUCCESS" },
}));

vi.mock("@km/shared-utils", () => ({
  eventBus: {
    on: vi.fn((event: string, handler: () => void) => {
      mocks.eventHandlers[event] = handler;
    }),
    off: vi.fn((event: string) => {
      delete mocks.eventHandlers[event];
    }),
  },
}));

vi.mock("@/locales", () => ({
  t: (key: string) => key,
}));

describe("Chat route OpenClaw conversation loading", () => {
  beforeEach(() => {
    mocks.navigate.mockReset();
    mocks.searchParams = new URLSearchParams("agent_id=F0GX8N&type=openclaw");
    mocks.location = { pathname: "/agent/agent" };
    mocks.currentAgent = {
      agent_id: "F0GX8N",
      name: "qclaw",
      channel_type: 1014,
      custom_config_obj: {},
      settings_obj: {},
    };
    mocks.agentStore.boxHeight = 0;
    mocks.agentStore.myAgentList = [];
    mocks.agentStore.loadAgentList.mockReset().mockResolvedValue([mocks.currentAgent]);
    mocks.agentStore.loadMyAgentList.mockReset().mockResolvedValue([]);
    mocks.agentStore.loadCategorys.mockReset().mockResolvedValue(undefined);
    mocks.agentStore.findAgentByAgentId.mockReset().mockImplementation((agentId: string) =>
      String(agentId) === "F0GX8N" ? mocks.currentAgent : undefined
    );
    mocks.conversationStore.current_agentid = "";
    mocks.conversationStore.current_conversationid = 0;
    mocks.conversationStore.setBasePath.mockReset();
    mocks.conversationStore.setCurrentState.mockReset().mockImplementation((agentId: string, conversationId: string | number) => {
      mocks.conversationStore.current_agentid = agentId;
      mocks.conversationStore.current_conversationid = conversationId;
    });
    mocks.conversationStore.loadConversations.mockReset().mockResolvedValue([]);
    mocks.conversationStore.clearCurrentState.mockReset();
    mocks.eventHandlers = {};
  });

  it("skips the ordinary conversation list for OpenClaw routes, including login refresh", async () => {
    render(<ChatView />);

    await waitFor(() => {
      expect(mocks.conversationStore.setCurrentState).toHaveBeenCalledWith("F0GX8N", "", false);
    });

    expect(mocks.conversationStore.loadConversations).not.toHaveBeenCalled();

    act(() => {
      mocks.eventHandlers.LOGIN_SUCCESS?.();
    });

    expect(mocks.conversationStore.loadConversations).not.toHaveBeenCalled();
  });

  it("keeps ordinary conversation loading for non-OpenClaw routes", async () => {
    const normalAgent = {
      ...mocks.currentAgent,
      agent_id: "normal-agent",
      channel_type: 1,
    };
    mocks.searchParams = new URLSearchParams("agent_id=normal-agent");
    mocks.currentAgent = normalAgent;
    mocks.agentStore.loadAgentList.mockResolvedValue([normalAgent]);
    mocks.agentStore.findAgentByAgentId.mockImplementation((agentId: string) =>
      String(agentId) === "normal-agent" ? normalAgent : undefined
    );

    render(<ChatView />);

    await waitFor(() => {
      expect(mocks.conversationStore.loadConversations).toHaveBeenCalledWith("normal-agent");
    });
  });
});
