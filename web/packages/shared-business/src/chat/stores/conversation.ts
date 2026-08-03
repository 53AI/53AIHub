import { create } from "zustand";
import type { AgentRunInfo, ConversationCreateDocumentRef, IConversationApi } from "../adapters/types";
import type { ConversationInfo } from "../types";
import { AGENT_RUN_RUNNING_STATUSES } from "../adapters/types";
import { readPaginationHasMore, readPaginationNextOffset, readResponseCount } from "../utils/pagination";

/**
 * 判断 run 是否仍在运行中
 *
 * 用于会话列表中展示 loading 状态与驱动轮询。
 */
export function isRunRunning(latestRun: AgentRunInfo | null | undefined): boolean {
  if (!latestRun) return false;
  return AGENT_RUN_RUNNING_STATUSES.includes(latestRun.status);
}

export interface ConversationState {
  conversations: ConversationInfo[];
  current_agentid: string | number;
  current_conversationid: string | number;
  next_agent_prepare: { agent_id?: string | number; parameters?: any; execution_rule?: string };
  currentVirtualId: string;
  /** 是否还有更多会话可加载（仅在 backend 返回 pagination.hasMore 时为 true） */
  hasMore: boolean;
  /** 是否正在加载更多 */
  loadingMore: boolean;
  /** 下一页的偏移量（来自后端 nextOffset；无分页时保持 0） */
  nextOffset: number;
}

export interface ConversationActions {
  setNextAgentPrepare: (data: any) => void;
  /**
   * 初次/重置加载会话列表。
   *
   * 默认行为是「全量加载」：不向 adapter 传 offset/limit，依赖后端返回完整列表或
   * 带 pagination 的首页响应。当后端返回 pagination.hasMore=true 时，ChatHistory
   * 的 IntersectionObserver 会按需触发 loadMoreConversations 加载后续分页。
   *
   * 调用方如需显式分页（不推荐），可传 params.offset / params.limit。
   */
  loadConversations: (
    agent_id?: string | number,
    params?: { offset?: number; limit?: number }
  ) => Promise<ConversationInfo[]>;
  /**
   * 基于当前 nextOffset 增量加载下一页会话。
   * 当 hasMore=false 或 loadingMore=true 时直接返回。
   */
  loadMoreConversations: (
    agent_id?: string | number
  ) => Promise<void>;
  /**
   * 重置分页状态（hasMore=false, nextOffset=0, loadingMore=false），
   * 不影响 conversations 列表。一般用于手动重置或测试。
   */
  resetPagination: () => void;
  /**
   * 创建会话（v0.4.2 §3.2）：仅使用 document_type + document_id，移除旧 file_id 字段。
   */
  createConversation: (
    agent_id: string | number,
    title?: string,
    documentRef?: ConversationCreateDocumentRef,
    conversation_type?: number
  ) => Promise<ConversationInfo>;
  addConversation: (conversation: ConversationInfo) => void;
  updateConversation: (conversation: Partial<ConversationInfo>) => void;
  editConversation: (
    conversation: Pick<ConversationInfo, "conversation_id" | "title">
  ) => Promise<void>;
  delConversation: (conversation: ConversationInfo) => Promise<void>;
  /**
   * 更新单个会话的 latest_run 字段
   *
   * latestRun 为 null 时表示该会话不再有运行中的 run，
   * 用于会话列表展示 loading 状态。
   */
  updateConversationLatestRun: (
    conversationId: string | number,
    latestRun: AgentRunInfo | null
  ) => void;
  setCurrentState: (
    agent_id: string | number,
    conversation_id: string | number,
    isReplace?: boolean
  ) => void;
  clearCurrentState: () => void;
  currentConversation: () => ConversationInfo | undefined;
}

const initialState: ConversationState = {
  conversations: [],
  current_agentid: 0,
  current_conversationid: 0,
  next_agent_prepare: {},
  currentVirtualId: "",
  // 初始为 true：分页语义下默认「可能还有更多」，由首次 loadConversations 的真实响应覆盖
  hasMore: true,
  loadingMore: false,
  nextOffset: 0,
};

export const DEFAULT_AGENT_IMG = "/images/default_agent.png";

// Store instance - will be initialized with API adapter
let conversationApi: IConversationApi | null = null;
/** loadConversations 请求版本号：用于丢弃过期请求的响应 */
let loadConversationsRequestId = 0;
/** loadMore 独立版本号，loadConversations / clearCurrentState 会一并递增以作废在飞请求 */
let loadMoreConversationsRequestId = 0;

/** 默认分页大小，沿用 useChatMessages 的默认值便于后端对齐 */
const DEFAULT_PAGE_LIMIT = 20;

/** 把后端返回的会话列表归一化为带 created_at/updated_at 显示字段的对象 */
function normalizeConversations(rawConversations: any[]): ConversationInfo[] {
  return rawConversations.map((item: any) => ({
    ...item,
    created_at: getSimpleDateFormat(item.created_time, "YYYY.MM.DD hh:mm"),
    updated_at: getSimpleDateFormat(item.updated_time, "YYYY.MM.DD hh:mm"),
  }));
}

export const setConversationApi = (api: IConversationApi) => {
  conversationApi = api;
};

function getSimpleDateFormat(date: number | string, format: string): string {
  if (!date) return "";
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return format
    .replace("YYYY", String(year))
    .replace("MM", month)
    .replace("DD", day)
    .replace("hh", hours)
    .replace("mm", minutes);
}

export const useConversationStore = create<ConversationState & ConversationActions>(
  (set, get) => ({
    ...initialState,

    currentConversation: () => {
      const state = get();
      const targetId = String(state.current_conversationid);
      const conversation = state.conversations.find(
        (item) => String(item.conversation_id) === targetId
      );

      if (conversation) {
        return conversation;
      }

      if (!state.currentVirtualId) {
        set({ currentVirtualId: Date.now().toString() });
      }

      return {
        conversation_id: 0,
        title: "",
        created_time: 0,
        updated_time: 0,
        top: 0,
        is_valid: 0,
        virtual_id: get().currentVirtualId,
      };
    },

    setNextAgentPrepare: (data) => {
      set({ next_agent_prepare: data });
    },

    loadConversations: async (agent_id, params) => {
      const requestId = ++loadConversationsRequestId;
      // 关键：全量刷新时一并作废在飞的 loadMore，避免其响应把已重置的状态填回去
      loadMoreConversationsRequestId++;
      const targetAgentId = agent_id != null ? String(agent_id) : "";

      if (!conversationApi) {
        console.warn("conversationApi not set, returning empty conversations");
        return [];
      }

      // 每次全量加载都重置分页，避免 nextOffset 在 agent 切换间泄漏（#2）
      set({ hasMore: false, loadingMore: false, nextOffset: 0 });

      try {
        // 标准接口始终走分页（offset/limit），后端响应会带 count 字段供 hasMore 推导
        const offset = params?.offset ?? 0;
        const limit = params?.limit ?? DEFAULT_PAGE_LIMIT;
        const res = await conversationApi.list(targetAgentId, { offset, limit });

        // 丢弃过期请求的响应
        if (requestId !== loadConversationsRequestId) {
          return [];
        }

        const rawList = res.data?.conversations || res.conversations || [];
        const conversations = normalizeConversations(rawList);

        const currentId = get().current_conversationid;
        if (currentId && currentId !== 0) {
          const currentInNew = conversations.find(
            (c: ConversationInfo) => String(c.conversation_id) === String(currentId)
          );
          const oldCurrent = get().conversations.find(
            (c: ConversationInfo) => String(c.conversation_id) === String(currentId)
          );
          if (!currentInNew && oldCurrent) {
            conversations.unshift(oldCurrent);
          }
        }

        // hasMore 推导（按后端契约分两路）：
        // 1) OpenClaw adapter：response.data.pagination.hasMore / nextOffset
        // 2) 标准 /api/conversations：response.data.count，由 offset + rawList.length < count 推导
        // 两者都没有时保守按「无更多」处理（#7），避免 rawList.length === limit 兜底在整除时多打空请求
        const explicitHasMore = readPaginationHasMore(res);
        const explicitNextOffset = readPaginationNextOffset(res);
        const count = readResponseCount(res);

        let hasMore: boolean;
        let nextOffset: number;
        if (explicitHasMore !== undefined) {
          hasMore = explicitHasMore;
          nextOffset = explicitNextOffset ?? offset + rawList.length;
        } else if (count !== undefined) {
          nextOffset = offset + rawList.length;
          hasMore = nextOffset < count;
        } else {
          hasMore = false;
          nextOffset = offset + rawList.length;
        }

        set({
          conversations,
          hasMore,
          nextOffset,
        });
        return conversations;
      } catch (err) {
        console.error("Failed to load conversations:", err);
        return [];
      }
    },

    loadMoreConversations: async (agent_id) => {
      const state = get();
      if (state.loadingMore || !state.hasMore) return;

      if (!conversationApi) {
        console.warn("conversationApi not set, skipping loadMore");
        return;
      }

      const loadMoreRequestId = ++loadMoreConversationsRequestId;
      // 捕获发起时的 agent_id，用于响应回来时校验是否被切换（#10）
      const targetAgentId = agent_id != null
        ? String(agent_id)
        : String(state.current_agentid || "");

      set({ loadingMore: true });

      try {
        const offset = state.nextOffset;
        const limit = DEFAULT_PAGE_LIMIT;
        const res = await conversationApi.list(targetAgentId, { offset, limit });

        // 已被新一轮 loadMore / loadConversations 超越（loadConversations 会一并递增此计数器）
        if (loadMoreRequestId !== loadMoreConversationsRequestId) return;
        // 期间发生 agent 切换，响应属于旧 agent，丢弃
        if (String(get().current_agentid || "") !== targetAgentId) return;

        const rawList = res.data?.conversations || res.conversations || [];
        const incoming = normalizeConversations(rawList);

        // 按 conversation_id 去重，避免重复添加
        const existingIds = new Set(
          get().conversations.map((item) => String(item.conversation_id))
        );
        const merged = [
          ...get().conversations,
          ...incoming.filter((item) => !existingIds.has(String(item.conversation_id))),
        ];

        // 与 loadConversations 相同的 hasMore 推导逻辑
        const explicitHasMore = readPaginationHasMore(res);
        const explicitNextOffset = readPaginationNextOffset(res);
        const count = readResponseCount(res);

        let hasMore: boolean;
        let nextOffset: number;
        if (explicitHasMore !== undefined) {
          hasMore = explicitHasMore;
          nextOffset = explicitNextOffset ?? offset + rawList.length;
        } else if (count !== undefined) {
          nextOffset = offset + rawList.length;
          hasMore = nextOffset < count;
        } else {
          hasMore = false;
          nextOffset = offset + rawList.length;
        }

        set({
          conversations: merged,
          hasMore,
          nextOffset,
        });
      } catch (err) {
        console.error("Failed to load more conversations:", err);
      } finally {
        // 仅当本请求仍是最新一次时清除 loading，避免相互覆盖
        if (loadMoreRequestId === loadMoreConversationsRequestId) {
          set({ loadingMore: false });
        }
      }
    },

    resetPagination: () => {
      set({
        hasMore: true,
        loadingMore: false,
        nextOffset: 0,
      });
    },

    createConversation: async (agent_id, title = "", documentRef, conversation_type) => {
      if (!conversationApi) {
        throw new Error("conversationApi not set");
      }

      const data: any = { agent_id, title };
      // 统一文档引用（v0.4.2 §3.2）：仅 document_type + document_id，移除旧 file_id
      if (documentRef?.documentType && documentRef?.documentId) {
        data.document_type = documentRef.documentType;
        data.document_id = documentRef.documentId;
      }
      if (conversation_type !== undefined) {
        data.conversation_type = conversation_type;
      }

      const res = await conversationApi.create(
        String(agent_id),
        title,
        title,
        String(conversation_type || ""),
        documentRef,
      );
      return res.data || res;
    },

    addConversation: (conversation) => {
      const newConversation = {
        ...conversation,
        created_at: getSimpleDateFormat(conversation.created_time || 0, "YYYY.MM.DD hh:mm"),
        updated_at: getSimpleDateFormat(conversation.updated_time || 0, "YYYY.MM.DD hh:mm"),
      };
      set((state) => ({
        conversations: [newConversation, ...state.conversations],
      }));
    },

    updateConversation: (conversation) => {
      set((state) => ({
        conversations: state.conversations.map((item) =>
          item.conversation_id === conversation.conversation_id
            ? { ...item, ...conversation }
            : item
        ),
      }));
    },

    editConversation: async (conversation) => {
      if (!conversationApi) {
        throw new Error("conversationApi not set");
      }

      const data = { title: conversation.title || "" };
      await conversationApi.edit(conversation.conversation_id, data);
      get().updateConversation(conversation);
    },

    delConversation: async (conversation) => {
      set((state) => ({
        conversations: state.conversations.filter(
          (item) => item.conversation_id !== conversation.conversation_id
        ),
      }));

      if (conversationApi) {
        await conversationApi.del(conversation.conversation_id);
      }

      if (get().current_conversationid === conversation.conversation_id) {
        get().setCurrentState(get().current_agentid, 0);
      }
    },

    updateConversationLatestRun: (conversationId, latestRun) => {
      set((state) => ({
        conversations: state.conversations.map((item) =>
          String(item.conversation_id) === String(conversationId)
            ? { ...item, latest_run: latestRun }
            : item
        ),
      }));
    },

    setCurrentState: (agent_id: string | number, conversation_id: string | number, _isReplace = true) => {
      set((state) => {
        if (
          state.current_conversationid !== conversation_id ||
          state.current_agentid !== agent_id
        ) {
          return {
            current_agentid: agent_id,
            current_conversationid: conversation_id,
            currentVirtualId: "",
          };
        }
        return {
          current_agentid: agent_id,
          current_conversationid: conversation_id,
        };
      });
    },

    clearCurrentState: () => {
      // 作废所有在飞请求（#3）：clearCurrentState 之后 conversations 会被清空，
      // 不递增计数器会让已发的 loadMore 在响应到达时通过版本检查并合并进已清空的状态
      loadConversationsRequestId++;
      loadMoreConversationsRequestId++;
      set({
        current_agentid: 0,
        current_conversationid: 0,
        conversations: [],
        hasMore: true,
        loadingMore: false,
        nextOffset: 0,
      });
    },
  })
);

// Computed hook for current conversation
export const useCurrentConversation = () => {
  const currentConversationId = useConversationStore(
    (state) => state.current_conversationid
  );
  const conversations = useConversationStore((state) => state.conversations);

  const conversation = conversations.find(
    (item) => String(item.conversation_id) === String(currentConversationId)
  );

  return conversation;
};