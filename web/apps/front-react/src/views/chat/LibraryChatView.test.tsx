/**
 * LibraryChatView — 路由胶水层单元测试
 *
 * 关注点:
 * - store.agentList 中已有 agent_usage=1 + is_system=true → 不调 loadAgentList
 * - loadAgentList 返回包含目标 agent → 注入 agentList 并渲染 ChatContainer
 * - loadAgentList 返回无目标 agent → 跳 /agent
 * - loadAgentList 抛错 → 跳 /agent
 * - 卸载时取消 in-flight fetch
 * - 不查 myAgentList
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadAgentList: vi.fn(),
  setCurrentState: vi.fn(),
  clearCurrentState: vi.fn(),
  // stores
  myAgentList: [] as any[],
  agentList: [] as any[],
  currentAgentId: "",
  // mock ChatContainer 渲染探针
  chatContainerProps: null as any,
  consoleError: vi.spyOn(console, "error").mockImplementation(() => {}),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<any>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mocks.navigate,
  };
});

vi.mock("@/constants/agent", () => ({
  AGENT_USAGES: { KM_AI_SEARCH: 1 },
}));

vi.mock("@/stores/modules/agent", () => {
  const state = {
    get myAgentList() { return mocks.myAgentList; },
    get agentList() { return mocks.agentList; },
    loadAgentList: mocks.loadAgentList,
  };
  return {
    useAgentStore: Object.assign((() => state) as any, {
      getState: () => state,
      setState: (updater: any) => {
        const next = updater(state);
        if (next?.agentList) mocks.agentList = next.agentList;
      },
    }),
    useCurrentAgent: () => {
      const list = [...mocks.myAgentList, ...mocks.agentList];
      return list.find((a) => String(a.agent_id) === String(mocks.currentAgentId)) || list[0] || { agent_id: "" };
    },
  };
});

vi.mock("@/stores/modules/conversation", () => ({
  useConversationStore: () => ({
    setCurrentState: mocks.setCurrentState,
    clearCurrentState: mocks.clearCurrentState,
  }),
}));

vi.mock("./ChatContainer", () => ({
  default: (props: any) => {
    mocks.chatContainerProps = props;
    return <div data-testid="chat-container" data-agent-id={props.agentId} />;
  },
}));

import { LibraryChatView } from "./LibraryChatView";
import { MemoryRouter } from "react-router-dom";

const renderWithRouter = (ui: ReactNode) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  mocks.myAgentList = [];
  mocks.agentList = [];
  mocks.currentAgentId = "";
  mocks.loadAgentList.mockReset();
  mocks.navigate.mockReset();
  mocks.setCurrentState.mockReset();
  mocks.chatContainerProps = null;
  mocks.consoleError.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LibraryChatView", () => {
  it("store.agentList 已有 agent_usage=1 + is_system=true → 不调 loadAgentList", async () => {
    mocks.agentList = [{ agent_id: "KM-1", agent_usage: 1, is_system: true }];
    mocks.currentAgentId = "KM-1";

    renderWithRouter(<LibraryChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-container")).toBeTruthy();
    });

    expect(mocks.loadAgentList).not.toHaveBeenCalled();
    expect(mocks.setCurrentState).toHaveBeenCalledWith("KM-1", "", false);
    expect(mocks.chatContainerProps.agentId).toBe("KM-1");
  });

  it("agentList 中只有 myAgentList 含匹配项 → 不命中,继续走 loadAgentList", async () => {
    // 即便 myAgentList 里有 agent_usage=1 + is_system=true,也不命中
    mocks.myAgentList = [{ agent_id: "MY-1", agent_usage: 1, is_system: true }];
    mocks.loadAgentList.mockResolvedValue([]);

    renderWithRouter(<LibraryChatView />);

    await waitFor(() => {
      expect(mocks.loadAgentList).toHaveBeenCalled();
    });

    // 跳 /agent(因为返回空)
    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/agent", { replace: true });
    });
  });

  it("agentList 中有 agent_usage=1 但 is_system≠true → 不命中,继续走 loadAgentList", async () => {
    mocks.agentList = [{ agent_id: "NON-SYS", agent_usage: 1, is_system: false }];
    mocks.loadAgentList.mockResolvedValue([]);

    renderWithRouter(<LibraryChatView />);

    await waitFor(() => {
      expect(mocks.loadAgentList).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/agent", { replace: true });
    });
  });

  it("loadAgentList 返回含目标 agent → 注入 agentList 并渲染 ChatContainer", async () => {
    const fetched = [{ agent_id: "KM-API", agent_usage: 1, is_system: true }];
    mocks.loadAgentList.mockImplementation(async () => {
      // 模拟 store 写入
      mocks.agentList = fetched;
      return fetched;
    });

    renderWithRouter(<LibraryChatView />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-container")).toBeTruthy();
    });

    expect(mocks.loadAgentList).toHaveBeenCalledTimes(1);
    expect(mocks.setCurrentState).toHaveBeenCalledWith("KM-API", "", false);
    // store.agentList 被注入(去重后保留)
    expect(mocks.agentList.find((a) => a.agent_id === "KM-API")).toBeTruthy();
  });

  it("loadAgentList 返回不含 is_system=true 的 agent → 跳 /agent", async () => {
    mocks.loadAgentList.mockImplementation(async () => {
      mocks.agentList = [{ agent_id: "X", agent_usage: 1, is_system: false }];
      return mocks.agentList;
    });

    renderWithRouter(<LibraryChatView />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/agent", { replace: true });
    });

    expect(screen.queryByTestId("chat-container")).toBeNull();
  });

  it("loadAgentList 抛错 → 跳 /agent 且 console.error", async () => {
    mocks.loadAgentList.mockRejectedValue(new Error("network down"));

    renderWithRouter(<LibraryChatView />);

    await waitFor(() => {
      expect(mocks.navigate).toHaveBeenCalledWith("/agent", { replace: true });
    });

    expect(mocks.consoleError).toHaveBeenCalled();
  });

  it("卸载时取消进行中的 fetch(避免 setState on unmounted)", async () => {
    let resolveLoad: (v: any) => void = () => {};
    mocks.loadAgentList.mockImplementation(() => new Promise((r) => { resolveLoad = r; }));

    const { unmount } = renderWithRouter(<LibraryChatView />);
    unmount();
    resolveLoad([{ agent_id: "LATE", agent_usage: 1, is_system: true }]);

    // 卸载后不应再调用 setCurrentState
    expect(mocks.setCurrentState).not.toHaveBeenCalled();
    // 卸载后不应 navigate(missing phase 不应触发)
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});