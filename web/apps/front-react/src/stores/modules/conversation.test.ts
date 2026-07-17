import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/modules/conversation/index", () => ({
  default: {
    list: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    del: vi.fn(),
  },
  Conversation_Type: {},
}));

vi.mock("@/router", () => ({
  isHashRouter: false,
  pathIncludes: (pathSegment: string) => window.location.pathname.includes(pathSegment),
}));

import { useConversationStore } from "./conversation";

describe("conversation store routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/chat");
    useConversationStore.setState({
      conversations: [],
      current_agentid: "",
      current_conversationid: 0,
      base_path: "/chat",
      next_agent_prepare: {},
      currentVirtualId: "",
    });
  });

  it("updates the chat URL in place", () => {
    window.history.replaceState(null, "", "/chat?agent_id=1");
    useConversationStore.getState().setBasePath("/chat");
    const replaceState = vi.spyOn(window.history, "replaceState");

    useConversationStore.getState().setCurrentState("2", "agent:main:dashboard:current");

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/chat?agent_id=2&conversation_id=agent%3Amain%3Adashboard%3Acurrent&type=openclaw"
    );
  });

  it("updates the index agent URL in place instead of hard reloading", () => {
    window.history.replaceState(null, "", "/agent/agent?agent_id=2&type=openclaw");
    useConversationStore.getState().setBasePath("/agent/agent");
    const replaceState = vi.spyOn(window.history, "replaceState");

    useConversationStore.getState().setCurrentState("2", "agent:main:dashboard:index-current");

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/agent/agent?agent_id=2&type=openclaw&conversation_id=agent%3Amain%3Adashboard%3Aindex-current"
    );
    expect(window.location.pathname).toBe("/agent/agent");
  });
});
