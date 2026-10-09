import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 复现"选中历史会话后发送仍新建会话"的回归测试。
 * agentList（/api/agents/{id}/conversations）返回的列表项主键是 id，
 * 没有 conversation_id 字段（与旧版首页会话 store 的消费方式一致）。
 */
vi.mock("@/api/modules/conversation/index", () => ({
  default: {
    list: vi.fn(),
    create: vi.fn(),
    edit: vi.fn(),
    del: vi.fn(),
    agentList: vi.fn(),
  },
  Conversation_Type: {},
}));

import conversationApi from "@/api/modules/conversation/index";
import { useFileConversationStore } from "./conversation";

const AGENT_ID = "agent-1";

/** 模拟 agentList 真实返回：body.data.items，项只有 id */
const mockAgentList = (items: any[]) => {
  vi.mocked(conversationApi.agentList).mockResolvedValue({
    data: { items, total: items.length },
  } as any);
};

describe("file conversation store — 选中历史会话后发送", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useFileConversationStore.setState({
      conversations: [],
      current_agentid: "",
      current_conversationid: 0,
      currentDocumentRef: {},
      currentVirtualId: "",
    });
  });

  it("历史会话列表项只有 id 时，选中后 currentConversation().conversation_id 可用（不触发新建）", async () => {
    // 1. 打开历史抽屉：setAgentId + setDocumentRef + loadConversations
    mockAgentList([
      { id: "conv-100", title: "历史会话A", created_time: 1, updated_time: 1 },
      { id: "conv-200", title: "历史会话B", created_time: 2, updated_time: 2 },
    ]);
    const store = useFileConversationStore.getState();
    store.setAgentId(AGENT_ID);
    store.setDocumentRef({ documentType: "file", documentId: "f-1" });
    await store.loadConversations();

    // 2. 抽屉选中 conv-100（Chat.tsx onSelectConversation 路径）
    useFileConversationStore
      .getState()
      .setCurrentState(AGENT_ID, "conv-100", false);

    // 3. 发送时 Chat.tsx createConversation 的判断：
    //    if (currentConversation?.conversation_id) return —— 必须为真，才不会新建
    const current = useFileConversationStore.getState().currentConversation();
    expect(current.conversation_id).toBe("conv-100");
    expect(Boolean(current.conversation_id)).toBe(true);
  });

  it("新建对话（current_conversationid=0）时 conversation_id 为 0，照常走新建", () => {
    useFileConversationStore
      .getState()
      .setCurrentState(AGENT_ID, 0, false);

    const current = useFileConversationStore.getState().currentConversation();
    expect(current.conversation_id).toBe(0);
    expect(Boolean(current.conversation_id)).toBe(false);
  });

  it("loadConversations 归一化：列表项补齐 conversation_id = id", async () => {
    mockAgentList([{ id: "conv-300", title: "x", created_time: 1, updated_time: 1 }]);
    useFileConversationStore.getState().setAgentId(AGENT_ID);
    await useFileConversationStore.getState().loadConversations();

    const list = useFileConversationStore.getState().conversations;
    expect(list[0].conversation_id).toBe("conv-300");
    expect(list[0].id).toBe("conv-300");
  });
});
