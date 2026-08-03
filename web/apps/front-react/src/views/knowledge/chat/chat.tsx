/* eslint-disable react-hooks/exhaustive-deps */
// ==================== 导入区域 ====================
// React 核心
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation, useParams } from "react-router-dom";

// Ant Design UI
import { Checkbox, Tooltip, message, Spin } from "antd";
import { Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { DownOutlined } from "@ant-design/icons";

// 共享组件
import { SvgIcon } from "@km/shared-components-react";
import { BubbleList, BubbleUser, BubbleAssistant } from "@km/hub-ui-x-react";
import { ProcessFlowHeader, ChatConfigProvider, type KnowledgePanelData } from "@km/shared-business/chat";
import { chatAdapters } from "@/adapters/chat-adapters";
import { cacheManager as cache, CacheMode, eventBus, formatFileInfo } from "@km/shared-utils";

// 内部 Stores
import { useConversationStore } from "./conversation";
import { useAgentRunStore } from "@/stores/modules/agentRun";
import { useUserStore } from "@/stores/modules/user";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useLibraryStore } from "@/stores/modules/library";
import { useSpaceStore } from "@/stores/modules/space";
import { useEnterpriseStore } from "@/stores/modules/enterprise";

// 内部 Composables
import {
  useChatFeedback,
  useChatMessages,
  useChatSend,
  useChatShare,
  useRagStats,
  convertReplayEventToSSE,
  processStreamDataItem,
} from "@km/shared-business/chat";

// 内部 API
import { TERMINAL_EVENTS } from "@/api/modules/agentRun/types";
import { agentRunApi } from "@/api/modules/agentRun";
import agentsApi from "@/api/modules/agents/index";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import chunksApi from "@/api/modules/chunks";

// 内部组件
import Header from "@/components/Layout/Header";
import {
  Sender,
  FeedbackPanel,
  ShareHeader,
  ThinkKnowledge,
  Quotation,
  Chunk,
  Graph,
  MessageMenu,
  SpecifiedFiles,
  AddAnswerAsMd,
} from "@/components/Chat";
import { ModelView } from "@/components/Model/view";
import { KnowledgeSourceSelector } from "@/components/KnowledgeSource";
import type { KnowledgeSourceState } from "@/components/KnowledgeSource";
import ChatHistory from "./history";

// 工具与常量
import { buildUrl } from "@/utils/router";
import { checkPermission, checkLoginStatus } from "@/utils/permission";
import { t } from "@/locales";
import { AGENT_USAGES } from "@/constants/agent";
import { EVENT_NAMES } from "@/constants/events";
import { markdownPreview } from "@/components/Markdown/helper";

// 样式
import "./chat.css";

// ==================== 类型定义 ====================

/** 智能体信息 */
interface AgentInfo {
  agent_id: string;
  name: string;
  logo: string;
  description?: string;
  settings?: {
    opening_statement?: string;
    suggested_questions?: { id: string; content: string }[];
    web_search_setting?: { enable: boolean };
    graph_search_setting?: { enable: boolean; default_enable: boolean };
    answer_remarks_config?: { enable: boolean; content: string };
    deep_thinking_config?: {
      channel_id: number;
      channel_type: number;
      model_name: string;
      temperature: number;
    };
    fast_reasoning_config?: { channel_id: number; temperature: number };
  };
  configs?: {
    completion_params?: any;
  };
}

/** 模型项 */
interface ModelItem {
  id: number;
  name: string;
  value: string;
  channel_id: number;
  channel_type: number;
  model: string;
  temperature: number;
  icon: string;
  type: string;
}

// ==================== 外层组件：注入 ChatConfigProvider ====================
/**
 * KnowledgeChatView 外层包装
 *
 * 将 ChatConfigProvider 提升到组件顶层，确保 useChatFeedback 等 hook
 * 能正确读取到 adapters 上下文（React Context 只读祖先，不读自身 JSX）
 */
export function KnowledgeChatView() {
  const locale = useEnterpriseStore((state) => state.language);

  return (
    <ChatConfigProvider lang={locale} adapters={chatAdapters}>
      <KnowledgeChatViewInner />
    </ChatConfigProvider>
  );
}

// ==================== 内层组件：使用 ChatConfigProvider 的 context ====================

function KnowledgeChatViewInner() {
  // ==================== Router Hooks ====================
  const location = useLocation();
  const { space_id } = useParams<{ space_id: string }>();

  // ==================== Store Hooks ====================
  const convStore = useConversationStore();
  const agentRunStore = useAgentRunStore();
  const agentRunEvents = useAgentRunStore(state => state.events);
  const agentRunCurrentRun = useAgentRunStore(state => state.currentRun);
  const userStore = useUserStore();
  const navigationStore = useNavigationStore();
  const libraryStore = useLibraryStore();
  const spaceStore = useSpaceStore();
  const locale = useEnterpriseStore((state) => state.language);

  // ==================== Refs ====================
  /** 发送框组件引用 */
  const senderRef = useRef<any>(null);
  /** Chunk 弹窗引用 */
  const chunkRef = useRef<any>(null);
  /** 思考知识库侧边栏引用 */
  const thinkKnowledgeRef = useRef<any>(null);
  const chunkSourceRef = useRef<any>(null);
  const graphRef = useRef<any>(null);
  const graphSourceRef = useRef<any>(null);
  /** 添加回答为MD弹窗引用 */
  const addAnswerAsMdRef = useRef<any>(null);
  /** 加载会话请求ID（用于取消过期请求） */
  const loadConversationRequestId = useRef(0);
  /** 是否已获取 latest_run（流式输出开始时只请求一次） */
  const latestRunFetchedRef = useRef(false);
  /** 当前 Graph 消息引用（用于 @view 事件） */
  const currentGraphMessage = useRef<any>(null);

  // ==================== State ====================
  /** 是否显示历史记录侧边栏 */
  const [showHistory, setShowHistory] = useState(false);
  /** 是否显示思考知识库侧边栏 */
  const [showThinkKnowledge, setShowThinkKnowledge] = useState(false);
  const [showUserMemory, setShowUserMemory] = useState(false);
  const [isUserMemoryFullscreen, setIsUserMemoryFullscreen] = useState(false);
  /** 智能体信息 */
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  /** 智能体可用模型列表 */
  const [agentModels, setAgentModels] = useState<ModelItem[]>([]);
  /** 当前选中的模型 */
  const [model, setModel] = useState("");
  /** 当前选择的知识库 */
  const [library, setLibrary] = useState({
    name: t("library.all_libraries"),
    value: ["all"],
    isSpace: false,
  });
  /** 知识源选择状态 */
  const [knowledgeSource, setKnowledgeSource] = useState<KnowledgeSourceState>({
    mode: 'all',
    allKnowledge: true,
    knowledgeGraph: false,
    networkSearch: false,
    selectedFiles: [],
    selectedLibraries: [],
    selectedSpaces: []
  });
  /** 是否正在流式输出 */
  const [isStreaming, setIsStreaming] = useState(false);
  /** 是否正在初始化 */
  const [isInitializing, setIsInitializing] = useState(true);

  // ==================== 派生状态 ====================
  /** 是否在知识库模式 */
  const isInLibrary = location.pathname.includes("/library/");

  // ==================== Custom Hooks ====================
  const {
    loadFeedbackConfig,
    handleClickFeedbackBtn: handleClickFeedbackBtnBase,
    handleToggleFeedbackBtn,
    handleCloseFeedback,
    handleSubmitFeedback,
    resetFeedbackSuccessState,
  } = useChatFeedback();

  const {
    state: messageState,
    handleLoadListMore: handleLoadListMoreBase,
    loadMessageList: loadMessageListBase,
    handleRegenerate: handleRegenerateBase,
    handleSourceReferenceHover: handleSourceReferenceHoverBase,
    handleOpenKnow: handleOpenKnowBase,
    clearMessageList,
    updateMessageList,
  } = useChatMessages({ limit: 10 });

  const { sendMessage: sendMessageBase, handleStop: handleStopBase } = useChatSend();
  const { formatRagStats } = useRagStats({ formatFileInfo });

  const {
    state: shareState,
    isShareMode,
    handleSelectAll: handleSelectAllBase,
    handleOpenShare: handleOpenShareBase,
    handleSelectMessage: handleSelectMessageBase,
    handleCreateShare: handleCreateShareBase,
  } = useChatShare();

  // ==================== useMemo ====================
  /** 当前对话 */
  const currentConv = useMemo(
    () => convStore.currentConversation(),
    [convStore.conversations, convStore.current_conversationid],
  );

  /** 当前模型 */
  const currentModel = useMemo(() => {
    return agentModels.find((item) => item.value === model);
  }, [agentModels, model]);

  /** 消息列表 */
  const messageList = useMemo(
    () => messageState.messageList,
    [messageState.messageList],
  );

  // ==================== 辅助函数 ====================
  /** 按 ID 更新消息 */
  const updateMessageById = useCallback(
    (id: string, updater: (msg: any) => any) => {
      updateMessageList((list) =>
        list.map((item) => (item.id === id ? updater(item) : item)),
      );
    },
    [updateMessageList],
  );

  /** 批量更新消息列表（用于关闭其他消息的反馈面板） */
  const updateMessages = useCallback(
    (updater: (list: any[]) => any[]) => {
      updateMessageList(updater);
    },
    [updateMessageList],
  );

  // ==================== 数据加载 ====================
  /** 加载更多消息 */
  const handleLoadListMore = useCallback(
    async (done: () => void): Promise<void> => {
      const { id } = currentConv;
      if (!id) return done();
      return handleLoadListMoreBase(done, id);
    },
    [currentConv, handleLoadListMoreBase],
  );

  /** 加载消息列表 */
  const loadMessageList = useCallback(
    async (conversationId?: string | number, options?: { isRunning?: boolean; runningMessageId?: string | number }) => {
      const id = conversationId || currentConv.id;
      if (!id) return;
      await loadMessageListBase(id, options);
    },
    [currentConv, loadMessageListBase],
  );

  /** 加载模型列表 */
  const loadModels = useCallback(async (agent: any) => {
    const res = await agentsApi.models.list(agent.agent_id);
    const deepConfig = agent.settings?.deep_thinking_config || { temperature: 0.5 };
    const fastConfig = agent.settings?.fast_reasoning_config || { temperature: 0.5 };
    const deepValue = `${deepConfig.channel_id}_${deepConfig.channel_type}_${deepConfig.model_name}`;

    const models = res.agent_models
      .map((item: any) => {
        const value = `${item.channel_id}_${item.channel_type}_${item.model}`;
        const isDeepThinking = value === deepValue;
        return {
          ...item,
          type: isDeepThinking ? "deep_reasoning" : "fast_reasoning",
          icon: isDeepThinking ? "star-link" : "lightning",
          name: isDeepThinking ? t("chat.deep_thinking") : t("chat.fast_response"),
          temperature: isDeepThinking ? deepConfig.temperature : fastConfig.temperature,
          value,
        };
      })
      .filter((item: any, index: number, self: any[]) =>
        index === self.findIndex((t: any) => t.type === item.type)
      );

    if (models.length) setModel((models[0] as any).value);
    setAgentModels(models);
  }, []);

  /** 加载智能体 */
  const loadAgent = useCallback(async () => {
    const res = await agentsApi.list({
      agent_usages: String(AGENT_USAGES.KM_AI_SEARCH),
    });
    const agent = res.agents[0] ? transformAgentInfo(res.agents[0]) : null;
    setAgentInfo(agent);
    if (agent) {
      loadModels(agent);
      convStore.setAgentId(agent.agent_id);
      // 更新知识图谱默认状态
      const graphDefaultEnable = agent.settings?.graph_search_setting?.default_enable ?? false;
      setKnowledgeSource(prev => ({
        ...prev,
        knowledgeGraph: graphDefaultEnable
      }));
    }
    return agent;
  }, [loadModels, convStore]);

  /** 加载会话消息并恢复运行中的 run
   * @returns Promise<boolean> 是否成功加载（用于判断是否需要等待）
   */
  const loadConversation = useCallback(
    async (conversation_id: string): Promise<boolean> => {
      const requestId = ++loadConversationRequestId.current;

      // 使用 Promise 包装 recover，等待 onMessage 完成
      return new Promise((resolve) => {
        // 检查请求是否已过期
        if (requestId !== loadConversationRequestId.current) {
          resolve(false);
          return;
        }

        agentRunStore.recover(conversation_id, {
          onStart: () => {
            // 竞态检查：确保仍是最新请求
            if (requestId !== loadConversationRequestId.current) return;
            setIsStreaming(true);
          },
          onMessage: async ({ isRunning, messageId }) => {
            // 竞态检查：确保仍是最新请求
            if (requestId !== loadConversationRequestId.current) return;
            setIsStreaming(isRunning);
            await loadMessageList(conversation_id, { isRunning, runningMessageId: messageId });
          }
        }).then(({ run, isrunning }) => {
          // 竞态检查
          if (requestId !== loadConversationRequestId.current) {
            resolve(false);
            return;
          }
          resolve(true);
        }).catch((error) => {
          // 404 是正常情况（没有运行中的 run）
          if (error?.response?.status !== 404) {
            console.error('Failed to recover run:', error);
          }
          // 即使出错也返回 true，因为会话可能存在（只是没有运行中的 run）
          resolve(requestId === loadConversationRequestId.current);
        });
      });
    },
    [loadMessageList, agentRunStore],
  );

  // 创建会话
  const createConversation = useCallback(
    async (agent_id: string, question: string) => {
      const currentConversation = currentConv;
      if (currentConversation.id) return currentConversation.id;
      const conversation = await convStore.createConversation(
        agent_id,
        question,
      );

      convStore.addConversation({
        ...conversation,
        id: conversation.conversation_id,
        virtual_id: currentConversation.virtual_id,
      } as any);
      convStore.setCurrentState(String(conversation.conversation_id), true);
      return conversation.conversation_id;
    },
    [currentConv, convStore],
  );

  // 发送消息
  const sendMessage = useCallback(
    async (question: string, links: any[] = [], files: any[] = [], overrideOptions?: { networkSearch?: boolean; knowledgeGraph?: boolean }) => {
      if (isStreaming) return;
      setShowHistory(false);
      setShowThinkKnowledge(false);

      setIsStreaming(true);
      latestRunFetchedRef.current = false;

      const agent_id = agentInfo?.agent_id;
      // 创建会话并获取 conversation_id
      let conversation_id = currentConv.id;
      if (!conversation_id) {
        conversation_id = await createConversation(agent_id || 0, question);
      }

      const completion_params = agentInfo?.configs?.completion_params;
      const modelId = currentModel?.id || "";

      // 优先使用传入的参数（重新生成场景），否则使用当前状态
      const useNetworkSearch = overrideOptions?.networkSearch ?? knowledgeSource.networkSearch;
      const useKnowledgeGraph = overrideOptions?.knowledgeGraph ?? knowledgeSource.knowledgeGraph;

      // 构建 links：优先使用传入的 links，否则使用 knowledgeSource
      const sendLinks = links.length > 0 ? links : [
        ...(knowledgeSource.selectedSpaces || []).map(space => ({
          id: space.id,
          name: space.name,
          icon: space.icon,
          isspace: true,
        })),
        ...(knowledgeSource.selectedLibraries || []).map(lib => ({
          id: lib.id,
          name: lib.name,
          icon: lib.icon,
          islibrary: true,
        })),
        ...(knowledgeSource.selectedFiles || []),
      ];

      try {
        await sendMessageBase({
          question,
          agent_id: agent_id || 0,
          conversation_id: conversation_id || 0,
          modelId,
          completion_params: {
            ...completion_params,
            temperature: currentModel?.temperature,
          },
          messageList: messageState.messageList,
          links: sendLinks,
          files,
          networkSearch: useNetworkSearch,
          knowledgeGraph: useKnowledgeGraph,
          library: isInLibrary
            ? library
            : (knowledgeSource.mode === 'all' && knowledgeSource.allKnowledge
              ? library
              : { name: '', value: [], isSpace: false }),
          agentInfo,
          onMessageListChange: (updater, newMessage) => {
            updateMessageList(updater);
            // 流式输出开始时请求 latest_run（只请求一次）
            if (!latestRunFetchedRef.current && isNaN(Number(newMessage?.id))) {
              latestRunFetchedRef.current = true;
              agentRunApi.latest(String(conversation_id))
                .then(res => {
                  const run = res.data || res;
                  if (run) {
                    run.message_id = newMessage.id;
                    agentRunStore.setCurrentRun(run);
                    convStore.updateConversationLatestRun(String(conversation_id), run);
                  }
                })
                .catch(() => {
                  // 404 或网络错误，静默处理
                });
            }
          },
        });
      } catch (err: any) {
        console.log(err);
      } finally {
        setIsStreaming(false);
        // 通知侧边栏刷新快捷方式列表（更新 last_message_time）
        eventBus.emit(EVENT_NAMES.SHORTCUT_UPDATED);
      }
    },
    [
      isStreaming,
      createConversation,
      agentInfo,
      currentConv,
      currentModel,
      sendMessageBase,
      messageState.messageList,
      knowledgeSource,
      library,
      updateMessageList,
      agentRunStore,
    ],
  );

  // 发送消息入口
  const handleSend = useCallback(
    (data: any) => {
      const { textContent, atList, files = [], networkSearch: overrideNetworkSearch, knowledgeGraph: overrideKnowledgeGraph } = data;
      checkPermission({
        checkInternal: true,
        onClick: () => {
          if (!textContent.trim()) return;
          if (!agentInfo || !agentInfo.agent_id) {
            message.warning(t("index.ai_search_setup_tip"));
          } else {
            sendMessage(textContent, atList || [], files, {
              networkSearch: overrideNetworkSearch,
              knowledgeGraph: overrideKnowledgeGraph,
            });
          }
        },
      });
    },
    [agentInfo, sendMessage],
  );

  // 停止生成
  // 停止生成
  const handleStop = useCallback(async () => {
    setIsStreaming(false)

    // 立即更新当前消息的 loading 状态
    const currentRun = agentRunStore.currentRun
    if (currentRun?.message_id) {
      updateMessageList((list) => {
        const targetIndex = list.findIndex((m: any) => m.id === currentRun.message_id)
        if (targetIndex === -1) return list

        const newList = [...list]
        newList[targetIndex] = { ...newList[targetIndex], loading: false }
        return newList
      })
    }

    // 同时调用两个停止方法：
    // 1. handleStopBase() 中止 completions 流式响应（本地）
    // 2. agentRunStore.cancel() 取消后端 run（远程）
    handleStopBase()
    await agentRunStore.cancel()
  }, [agentRunStore, handleStopBase, updateMessageList])

  // 重新生成回答
  const handleRegenerate = useCallback(
    (msg: any) => {
      if (isStreaming) return;
      handleRegenerateBase(msg, handleSend);
    },
    [isStreaming, handleRegenerateBase, handleSend],
  );

  const handleShowErrorDetails = useCallback((msg: any) => {
    updateMessageList((list) =>
      list.map((item) =>
        item.id === msg.id ? { ...item, showErrorDetails: true } : item,
      ),
    );
  }, [updateMessageList]);

  // 点赞/点踩
  const handleClickFeedbackBtn = useCallback(
    async (msg: any, type: "satisfied" | "unsatisfied") => {
      // 先关闭其他消息的反馈面板
      updateMessages((list) =>
        list.map((item) =>
          item.id !== msg.id ? { ...item, feedbackVisible: false } : item,
        ),
      );
      // 然后更新当前消息
      const updatedMsg = await handleClickFeedbackBtnBase(msg, type);
      updateMessageById(updatedMsg.id, () => updatedMsg);
    },
    [handleClickFeedbackBtnBase, updateMessages, updateMessageById],
  );

  const handleSourceReferenceHover = useCallback(
    (data: any, msg: any) => {
      handleSourceReferenceHoverBase(
        data,
        msg,
        chunkRef,
        chunkSourceRef,
        graphRef,
        graphSourceRef,
      );
      // 保存当前 graph 对应的 message 引用，用于 @view 事件
      const chunks = msg.rag_stats?.chunks || [];
      const key = `[Source:${data.sourceType}-${data.sourceNumber}]`;
      const chunk = chunks.find(
        (item: any) => item.source_key === key || item.source === key,
      );
      if (chunk?.chunk_type === "graph_result") {
        currentGraphMessage.current = msg;
      }
    },
    [handleSourceReferenceHoverBase],
  );

  const handleOpenKnow = useCallback(
    (msg: any) => {
      handleOpenKnowBase(msg, thinkKnowledgeRef, setShowThinkKnowledge);
    },
    [handleOpenKnowBase],
  );

  // 处理 Source 点击事件，打开 think-knowledge 并选中对应项
  const handleSourceClick = useCallback(
    (msg: any) => (source: any) => {
      setShowThinkKnowledge(true);
      setTimeout(() => {
        thinkKnowledgeRef.current?.updateResults(
          msg.rag_stats?.files_search || [],
          msg.rag_stats?.type,
        );
        setTimeout(() => {
          thinkKnowledgeRef.current?.selectItem(source);
        }, 0);
      }, 0);
    },
    [],
  );

  // 处理 Graph 的 view 事件，打开 think-knowledge 并选中对应项
  const handleGraphView = useCallback((libraryInfo: any) => {
    const message = currentGraphMessage.current;
    if (!message) return;
    setShowThinkKnowledge(true);
    setTimeout(() => {
      thinkKnowledgeRef.current?.updateResults(
        message.rag_stats?.files_search,
        message.rag_stats?.type,
      );
      setTimeout(() => {
        thinkKnowledgeRef.current?.selectItem(libraryInfo);
      }, 0);
    }, 0);
  }, []);

  // Chunk 详情获取回调
  const handleFetchChunkDetail = useCallback(async (chunkId: string) => {
    const chunk = await chunksApi.get(chunkId);
    return {
      content: chunk.content,
      token_count: chunk.token_count,
      chunk_index: chunk.chunk_index,
    };
  }, []);

  // Markdown 渲染回调
  const handleRenderMarkdown = useCallback(
    async (element: HTMLDivElement, content: string) => {
      await markdownPreview(element, content);
    },
    []
  );

  // 前台场景：知识面板打开回调（统一处理 ProcessFlow 中的点击事件）
  const handleOpenKnowledgePanel = useCallback((msg: any) => (data: KnowledgePanelData) => {
    // knowledge_search: 打开知识检索结果侧边栏
    if (data.type === 'knowledge_search') {
      setShowThinkKnowledge(true);
      setTimeout(() => {
        thinkKnowledgeRef.current?.updateResults(
          msg.rag_stats?.files_search || [],
          msg.rag_stats?.type,
        );
      }, 0);
      return true;
    }
    // source_click: 打开侧边栏并选中对应文件
    if (data.type === 'source_click' && data.source) {
      setShowThinkKnowledge(true);
      setTimeout(() => {
        thinkKnowledgeRef.current?.updateResults(
          msg.rag_stats?.files_search || [],
          msg.rag_stats?.type,
        );
        setTimeout(() => {
          thinkKnowledgeRef.current?.selectItem(data.source);
        }, 0);
      }, 0);
      return true;
    }
    // scope_narrowing: 跳转到知识库首页（新页面）
    if (data.type === 'scope_narrowing' && data.source?.library_id) {
      const libraryId = data.source.library_id;
      const url = buildUrl(`/library/${libraryId}`);
      window.open(url, '_blank', 'noopener,noreferrer');
      return true;
    }
    return false;
  }, []);

  // ==================== 会话操作 ====================
  /** 新建会话 */
  const handleNewChat = useCallback(() => {
    if (!checkLoginStatus()) return;
    convStore.setCurrentState("", true);
    setShowHistory(false);
    setShowThinkKnowledge(false);
    clearMessageList();
    agentRunStore.disconnect();
    setIsStreaming(false);
  }, [convStore, clearMessageList, agentRunStore]);

  /** 选择会话 */
  const onSelectConversation = useCallback(
    async (conversation_id: string) => {
      agentRunStore.disconnect();
      convStore.setCurrentState(conversation_id);
      setShowHistory(false);
      setShowThinkKnowledge(false);
      await loadConversation(conversation_id);
    },
    [convStore, agentRunStore, loadConversation],
  );

  /** 切换知识库 */
  const handleChangeLibrary = useCallback(
    (item: any) => {
      setLibrary(item);
      cache.set(
        "library_" + userStore.info.eid,
        item,
        60 * 24 * 7,
        CacheMode.LOCAL_STORAGE,
      );
    },
    [userStore.info.eid],
  );

  /** 切换模型 */
  const handleChangeModel = useCallback((modelValue: string) => {
    setModel(modelValue);
  }, []);

  // ==================== 分享操作 ====================
  /** 全选消息 */
  const handleSelectAll = useCallback(() => {
    handleSelectAllBase(messageList);
  }, [handleSelectAllBase, messageList]);

  /** 创建分享 */
  const handleCreateShare = useCallback(() => {
    handleCreateShareBase(
      convStore.current_conversationid as string,
      "index",
      currentConv?.title,
    );
  }, [handleCreateShareBase, convStore.current_conversationid, currentConv]);

  /** 添加回答为 Markdown */
  const handleAddAsMd = useCallback((msg: any) => {
    addAnswerAsMdRef.current?.open({
      answer: msg.answer,
      question: msg.original_question || msg.question,
    });
  }, []);

  // ==================== 初始化 ====================
  /** 初始化聊天
   *
   * 优化策略：
   * 1. 核心数据（agent、会话）优先加载，阻塞初始化
   * 2. 非核心数据（反馈配置）并行加载，不阻塞
   * 3. 确保 loadMessageList 完成后才结束初始化
   */
  const initChat = useCallback(async (signal?: AbortSignal) => {
    setIsInitializing(true);

    try {
      // ===== 1. 并行加载非核心数据（不阻塞） =====
      loadFeedbackConfig();  // 反馈配置，延迟加载

      // ===== 2. 加载智能体（核心，阻塞） =====
      const agent = await loadAgent();

      if (signal?.aborted) return;

      // 如果没有智能体，提前结束
      if (!agent?.agent_id) {
        setIsInitializing(false);
        return;
      }

      convStore.setBasePath(location.pathname);

      // 知识库模式设置
      if (isInLibrary) {
        setLibrary({
          name: libraryStore.library?.name || t("library.this_library_content"),
          value: [libraryStore.library?.id as string],
          isSpace: false,
        });
        setKnowledgeSource(prev => ({ ...prev, allKnowledge: false }));
        spaceStore.loadSpaceList();  // 非阻塞
      } else {
        cache.get<{ name: string; value: string[] }>(
          "library_" + userStore.info.eid,
          CacheMode.LOCAL_STORAGE
        ).then(cachedLibrary => {
          if (cachedLibrary) setLibrary(cachedLibrary);
        });
      }

      // ===== 3. 加载会话（核心，阻塞） =====
      const conversation_id = new URLSearchParams(location.search).get("conversation_id") as string;

      const conversations = await Promise.all([
        loadModels(agent),
        convStore.loadConversations(signal)
      ]).then(([, convs]) => convs);

      if (signal?.aborted) return;

      if (conversation_id) {
        convStore.setCurrentState(conversation_id, false);
        // 等待消息加载完成
        const loaded = await loadConversation(conversation_id);
        if (!loaded) {
          // 如果加载失败（可能是 404），尝试加载历史会话
          if (conversations.length > 0) {
            convStore.setCurrentState(String(conversations[0].id), true);
            await loadConversation(String(conversations[0].id));
          }
        }
      } else if (conversations.length > 0) {
        const latestConversation = conversations[0];
        convStore.setCurrentState(String(latestConversation.id), true);
        // 等待消息加载完成
        await loadConversation(String(latestConversation.id));
      }

    } catch (error) {
      if (signal?.aborted) return;
      console.error("Failed to initialize knowledge chat:", error);
    } finally {
      if (!signal?.aborted) {
        setIsInitializing(false);
      }
    }
  }, [loadAgent, loadConversation, convStore, location.pathname, location.search, isInLibrary, libraryStore, spaceStore, userStore.info.eid]);

  // ==================== useEffect ====================
  // 组件挂载时初始化
  useEffect(() => {
    const abortController = new AbortController();

    initChat(abortController.signal);

    const query = new URLSearchParams(location.search).get("query");
    if (query) {
      setTimeout(() => senderRef.current?.insertText(query), 100);
    }

    const handleLoginSuccess = () => {
      initChat(abortController.signal);
    };
    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);

    return () => {
      abortController.abort();
      eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
    };
  }, []);

  // 监听实时 SSE 事件并更新消息
  useEffect(() => {
    const events = agentRunEvents;
    const lastEvent = events[events.length - 1];
    const currentRun = agentRunCurrentRun;
    const messageId = currentRun?.message_id;

    if (!events.length || !messageId) return;

    const isTerminalEvent = TERMINAL_EVENTS.includes(lastEvent.type || lastEvent.event_type);
    if (isTerminalEvent) {
      setIsStreaming(false);
      eventBus.emit(EVENT_NAMES.SHORTCUT_UPDATED);
    }

    if (events.length > 0 && messageId) {
      updateMessageList((list) => {
        const targetIndex = list.findIndex((m: any) => m.id === messageId);
        if (targetIndex === -1) return list;

        const message = {
          ...list[targetIndex],
          process_records: [],
          skillRunItems: [],
          outputFiles: [],
          rag_temp: {},
          rag_stats: undefined,
          answer: '',
          reasoning_content: '',
          loading: !isTerminalEvent
        };

        for (const event of events) {
          const sseData = convertReplayEventToSSE(event as any, messageId);
          if (sseData) {
            processStreamDataItem(sseData, message, formatRagStats);
          } else if (event.type === 'message.completed' || event.event_type === 'message.completed') {
            message.answer = event.payload.answer;
          }
        }

        const newList = [...list];
        newList[targetIndex] = message;
        return newList;
      });
    }
  }, [agentRunEvents, agentRunCurrentRun, updateMessageList, formatRagStats]);

  // 监听路由重置事件
  useEffect(() => {
    const handleResetRouteState = () => {
      if (convStore.current_conversationid) {
        convStore.setCurrentState("", true);
        setShowHistory(false);
        setShowThinkKnowledge(false);
        clearMessageList();
      }
    };

    window.addEventListener("reset-route-state", handleResetRouteState);
    return () => {
      window.removeEventListener("reset-route-state", handleResetRouteState);
    };
  }, [convStore, clearMessageList]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      convStore.clearCurrentState();
      agentRunStore.disconnect();
    };
  }, []);

  // 同步 knowledgeSource 到 Sender 的 links 显示
  useEffect(() => {
    const links: any[] = [];

    // 添加空间
    if (knowledgeSource.selectedSpaces && knowledgeSource.selectedSpaces.length > 0) {
      knowledgeSource.selectedSpaces.forEach((space) => {
        links.push({
          id: space.id,
          name: space.name,
          icon: space.icon,
          ui: { active: true },
          source: 'knowledge',
          isspace: true,
          islibrary: false,
          isfolder: false,
        });
      });
    }

    // 添加知识库
    if (knowledgeSource.selectedLibraries && knowledgeSource.selectedLibraries.length > 0) {
      knowledgeSource.selectedLibraries.forEach((lib) => {
        links.push({
          id: lib.id,
          name: lib.name,
          icon: lib.icon,
          ui: { active: true },
          source: 'knowledge',
          islibrary: true,
          isspace: false,
          isfolder: false,
          upload_file_id: null,
          file_size: null,
          file_mime: null,
          library_id: null,
        });
      });
    }

    // 添加文件
    if (knowledgeSource.selectedFiles && knowledgeSource.selectedFiles.length > 0) {
      knowledgeSource.selectedFiles.forEach((file) => {
        links.push({
          id: file.id,
          name: file.name,
          icon: file.icon,
          ui: { active: true },
          source: 'knowledge',
          upload_file_id: file.upload_file_id,
          file_size: file.file_size,
          file_mime: file.file_mime,
          library_id: file.library_id,
          isfolder: file.isfolder,
          islibrary: false,
          isspace: false,
        });
      });
    }

    if (links.length > 0) {
      senderRef.current?.setLinks(links);
    } else {
      senderRef.current?.clearLinks();
    }
  }, [knowledgeSource.selectedFiles, knowledgeSource.selectedLibraries, knowledgeSource.selectedSpaces]);

  // ==================== 渲染数据 ====================
  /** 模型选择下拉菜单 */
  const modelMenuItems: MenuProps["items"] = useMemo(() => {
    return agentModels.map((item) => ({
      key: item.value,
      label: (
        <div
          className={`w-full h-9 flex items-center gap-2 ${item.value === model ? "text-[#2563EB]" : "text-[#1D1E1F]"}`}
        >
          <SvgIcon name={item.icon} />
          <span className="text-sm whitespace-nowrap">{item.name}</span>
          <ModelView
            showIcon={false}
            channelId={item.channel_id}
            model={item.model}
          />
          {item.value === model && <SvgIcon name="check-one" />}
        </div>
      ),
    }));
  }, [agentModels, model]);

  /** 输入框占位符 */
  const placeholder = knowledgeSource.networkSearch
    ? t("index.chat_placeholder")
    : t("index.chat_placeholder_library", { name: library.name });

  /** 是否为空状态 */
  const isEmpty = !messageList.length && !isStreaming && !isInitializing;

  return (
      <div className="w-full h-full overflow-hidden flex">
      {/* History 侧边栏 */}
      {showHistory && (
        <div className="w-60">
          <ChatHistory
            onCollapse={() => setShowHistory(false)}
            onNewChat={handleNewChat}
            onConversation={onSelectConversation}
          />
        </div>
      )}

      <div className="flex-1 overflow-hidden flex flex-col">
        {/* 分享模式头部 */}
        {isShareMode ? (
          <ShareHeader
            selectAll={shareState.selectAll}
            selectMessageIds={shareState.selectMessageIds}
            onSelectAll={handleSelectAll}
            onCreateShare={handleCreateShare}
            onOpenShare={handleOpenShareBase}
          />
        ) : (
          <Header
            back={false}
            title={currentConv?.title || ""}
            expandSidebar={false}
            border={false}
            titlePrefix={
              !showHistory ? (
                <>
                  <div className="flex-none flex items-center gap-3">
                    <div
                      className="size-7 cursor-pointer rounded flex items-center justify-center hover:bg-[#F5F5F7]"
                      onClick={() => {
                        if (!checkLoginStatus()) return;
                        setShowHistory(true);
                      }}
                    >
                      <SvgIcon name="history" />
                    </div>
                    <div
                      className="size-7 cursor-pointer rounded flex items-center justify-center hover:bg-[#F5F5F7]"
                      onClick={handleNewChat}
                    >
                      <SvgIcon name="add-chat" />
                    </div>
                  </div>
                  {currentConv?.title && <div className="border-r h-4" />}
                </>
              ) : undefined
            }
            // right={
            //   <div
            //     className={`size-7 cursor-pointer rounded flex items-center justify-center ${showUserMemory ? 'bg-[#F5F5F7]' : 'hover:bg-[#F5F5F7]'}`}
            //     onClick={() => setShowUserMemory(true)}
            //   >
            //     <SvgIcon name="brain" />
            //   </div>
            // }
          />
        )}

        {/* 消息区域 */}
        <div className={`flex-1 py-5 flex flex-col ${
          messageList.length
            ? 'overflow-hidden' : 'items-center justify-center'
        }`}>
          {isInitializing ? (
            <div className="flex-1 flex items-center justify-center">
              <Spin size="large" />
            </div>
          ) : messageList.length > 0 ? (
            <BubbleList
              autoScroll={true}
              className="flex-1"
              mainClass="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto"
              enablePullUp={true}
              onPullUp={handleLoadListMore}
              messages={messageList}
            >
              {messageList.map((msg: any) => (
                <div key={msg.id}>
                  {/* 用户消息气泡 */}
                  <div
                    className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
                    onClick={() => handleSelectMessageBase(msg)}
                  >
                    {isShareMode && (
                      <Checkbox
                        checked={shareState.selectMessageIds.includes(msg.id)}
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      <BubbleUser
                        content={msg.original_question || msg.question}
                        files={msg.user_files}
                        className={isShareMode ? "!mb-0" : ""}
                        style={{
                          "--hubx-color-bg-message": "#EBF1FF",
                        }}
                        header={
                          <SpecifiedFiles
                            files={msg.specified_files}
                          />
                        }
                        menu={
                          !isShareMode ? (
                            <MessageMenu
                              type="user"
                              content={msg.original_question || msg.question}
                            />
                          ) : null
                        }
                      />
                    </div>
                  </div>

                  {/* AI助手消息气泡 */}
                  <div
                    className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
                    onClick={() => handleSelectMessageBase(msg)}
                  >
                    {isShareMode && (
                      <Checkbox
                        checked={shareState.selectMessageIds.includes(msg.id)}
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      <BubbleAssistant
                        content={msg.answer || msg.content}
                        reasoning={msg.reasoning_content}
                        reasoningExpanded={msg.reasoning_expanded}
                        streaming={msg.loading}
                        alwaysShowMenu={
                          msg.id === messageList[messageList.length - 1]?.id ||
                          msg.feedbackVisible
                        }
                        className={isShareMode ? "!mb-0" : ""}
                        sourceEnabled
                        showError={msg.error}
                        onSourceReferenceClick={(data: any) =>
                          handleSourceReferenceHover(data, msg)
                        }
                        style={{
                          "--hubx-color-bg-message": "transparent",
                        }}
                        header={
                          <ChatConfigProvider lang={locale} adapters={chatAdapters} onOpenKnowledgePanel={handleOpenKnowledgePanel(msg)}>
                            <ProcessFlowHeader
                              processRecords={msg.process_records}
                              streaming={msg.loading}
                              hasContent={!!(msg.answer || msg.content)}
                              getKnowledgeSearchFiles={() => msg.rag_stats?.files_search || []}
                            />
                          </ChatConfigProvider>
                        }
                        footer={
                          <>
                            {!msg.loading &&
                              agentInfo?.settings?.answer_remarks_config
                                ?.enable && (
                                <div className="text-sm text-[#999999] break-words my-2">
                                  {
                                    agentInfo.settings.answer_remarks_config
                                      .content
                                  }
                                </div>
                              )}
                            {msg.rag_stats?.file_quotations?.length > 0 && (
                              <Quotation
                                files={msg.rag_stats.file_quotations}
                              />
                            )}
                          </>
                        }
                        menu={
                          (!msg.loading ||
                            msg.feedbackVisible ||
                            msg.feedbackSuccessful) &&
                          !isShareMode ? (
                            <MessageMenu
                              type="assistant"
                              content={msg.answer || msg.content}
                              feedbackType={msg.feedback_type}
                              features={{ share: true, feedback: true, addAsFile: true }}
                              onRegenerate={() => handleRegenerate(msg)}
                              onFeedback={(type) =>
                                handleClickFeedbackBtn(msg, type)
                              }
                              onShare={handleOpenShareBase}
                              onAddAsFile={() => handleAddAsMd(msg)}
                            />
                          ) : null
                        }
                        error={
                          msg.error ? (
                            <div className="text-[#262626]">
                              {t("agent.error_tip")}
                              <span
                                className="text-blue-500 cursor-pointer underline"
                                onClick={() => handleShowErrorDetails(msg)}
                              >
                                {t("agent.error_details")}
                              </span>
                              {msg.showErrorDetails && (
                                <div className="mt-2 whitespace-pre-wrap">
                                  {msg.answer || msg.content}
                                </div>
                              )}
                            </div>
                          ) : null
                        }
                      />
                    </div>
                  </div>

                  {/* 反馈面板 */}
                  <FeedbackPanel
                    visible={!!(msg.feedbackVisible && !isShareMode)}
                    feedbackType={msg.feedback_type || ""}
                    feedbackTypeOptions={msg.feedbackTypeOptions || null}
                    submitBtnDisabled={msg.submitBtnDisabled !== false}
                    feedbackSuccessful={msg.feedbackSuccessful || false}
                    description={msg.description}
                    onClose={() => {
                      const updatedMsg = handleCloseFeedback(msg);
                      updateMessageById(updatedMsg.id, () => updatedMsg);
                    }}
                    onToggle={(key: string) => {
                      const updatedMsg = handleToggleFeedbackBtn(msg, key);
                      updateMessageById(updatedMsg.id, () => updatedMsg);
                    }}
                    onSubmit={async () => {
                      const updatedMessage = await handleSubmitFeedback(msg);
                      updateMessageById(updatedMessage.id, () => updatedMessage);
                      // 2秒后重置成功状态
                      setTimeout(() => {
                        const resetMsg = resetFeedbackSuccessState(updatedMessage);
                        updateMessageById(resetMsg.id, () => resetMsg);
                      }, 2000);
                    }}
                    onDescriptionChange={(value: string) => {
                      updateMessageById(msg.id, (item) => ({ ...item, description: value }));
                    }}
                  />
                </div>
              ))}
            </BubbleList>
          ) : null}

          {/* 输入区域 */}
          {!isShareMode && !isInitializing && (
            <div className="flex-none w-4/5 max-w-[1200px] mx-auto">
              {isEmpty && (
                <h2 className="text-2xl font-medium text-center">
                  {t("index.knowledge_search")}
                </h2>
              )}
              {isEmpty &&
                agentInfo?.settings?.opening_statement && (
                  <h3 className="text-base text-[#666666] text-center mt-3 whitespace-pre-wrap max-h-52 overflow-y-auto">
                    {agentInfo.settings.opening_statement}
                  </h3>
                )}

              <Sender
                className="mt-9"
                ref={senderRef}
                showAt={
                  userStore.is_login &&
                  navigationStore.hasKnowledge &&
                  userStore.info.is_internal
                }
                disabledAt={knowledgeSource.networkSearch}
                placeholder={placeholder}
                loading={isStreaming}
                library={isInLibrary ? libraryStore.library : undefined}
                onSend={handleSend}
                onStop={handleStop}
                onRemoveLink={(link) => {
                  // 判断此 link 是否由 knowledgeSource 管理
                  const isInKnowledgeSource =
                    (link.isspace && knowledgeSource.selectedSpaces?.some(s => s.id === link.id)) ||
                    (link.islibrary && knowledgeSource.selectedLibraries?.some(l => l.id === link.id)) ||
                    (!link.isspace && !link.islibrary && knowledgeSource.selectedFiles.some(f => f.id === link.id));

                  // 如果不是 knowledgeSource 管理的链接（例如通过 @ 添加的），
                  // 不操作 knowledgeSource，让 Sender 内部自行管理删除
                  if (!isInKnowledgeSource) return;

                  setKnowledgeSource(prev => {
                    // 根据 link 的类型标识判断要删除的是哪种资源
                    const linkType = link.isspace ? 'space' : (link.islibrary ? 'library' : 'file');
                    const newFiles = linkType === 'file'
                      ? prev.selectedFiles.filter(f => f.id !== link.id)
                      : prev.selectedFiles;
                    const newLibraries = linkType === 'library'
                      ? (prev.selectedLibraries || []).filter(l => l.id !== link.id)
                      : prev.selectedLibraries || [];
                    const newSpaces = linkType === 'space'
                      ? (prev.selectedSpaces || []).filter(s => s.id !== link.id)
                      : prev.selectedSpaces || [];

                    // 删除最后一个项目时重置为全部知识模式
                    if (newFiles.length === 0 && newLibraries.length === 0 && newSpaces.length === 0) {
                      return {
                        ...prev,
                        mode: 'all' as const,
                        allKnowledge: true,
                        selectedFiles: [],
                        selectedLibraries: [],
                        selectedSpaces: []
                      } as KnowledgeSourceState;
                    }
                    return {
                      ...prev,
                      selectedFiles: newFiles,
                      selectedLibraries: newLibraries,
                      selectedSpaces: newSpaces
                    };
                  });
                }}
                onSelectFiles={(files, libraries, spaces) => {
                  setKnowledgeSource(prev => {
                    // 存储完整信息，确保 useEffect 构建的 links 不会丢失数据
                    const newFiles = files.map(f => ({
                      id: String(f.id),
                      name: f.name,
                      icon: f.icon,
                      library_id: f.library_id,
                      isfolder: f.isfolder,
                      upload_file_id: f.upload_file_id,
                      file_size: f.upload_file?.size,
                      file_mime: f.upload_file?.mime_type || f.file_mime,
                    }));
                    const newLibraries = (libraries || []).map(l => ({
                      id: String(l.id),
                      name: l.name,
                      icon: l.icon,
                    }));
                    const newSpaces = (spaces || []).map(s => ({
                      id: String(s.id),
                      name: s.name,
                      icon: s.icon,
                    }));

                    return {
                      ...prev,
                      mode: 'files' as const,
                      allKnowledge: false,
                      selectedFiles: newFiles,
                      selectedLibraries: newLibraries,
                      selectedSpaces: newSpaces,
                    };
                  });
                }}
                extras={
                  <div className="flex items-center gap-2">
                    {/* 模型选择 */}
                    <Dropdown
                      menu={{
                        items: modelMenuItems,
                        onClick: ({ key }) => handleChangeModel(key),
                      }}
                      trigger={["click"]}
                      placement="bottom"
                    >
                      <div className="h-8 px-4 flex items-center gap-1 rounded-full border border-[#E3EEFF] bg-[#F3F8FF] cursor-pointer text-[#2563EB]">
                        {currentModel ? (
                          <>
                            <SvgIcon name={currentModel.icon} />
                            <span className="text-sm whitespace-nowrap">
                              {currentModel.name}
                            </span>
                          </>
                        ) : (
                          <span>{t("chat.select_model")}</span>
                        )}
                        <div className="size-4 flex items-center justify-center">
                          <DownOutlined style={{ fontSize: "14px" }} />
                        </div>
                      </div>
                    </Dropdown>

                    {/* 知识源选择器 */}
                    {userStore.is_login && navigationStore.hasKnowledge && (
                      <KnowledgeSourceSelector
                        value={knowledgeSource}
                        onChange={setKnowledgeSource}
                        library={library}
                        disabled={!userStore.info.is_internal}
                        allowSelectLibrary={true}
                        allowSelectSpace={true}
                        agentInfo={agentInfo}
                      />
                    )}
                  </div>
                }
              />

              {/* AI 生成提示 */}
              <div className="text-xs text-[#999999] text-center mt-5">
                {t("common.ai_generated")}
              </div>

              {/* 推荐问题 */}
              {isEmpty &&
                agentInfo?.settings?.suggested_questions && (
                  <div className="grid grid-cols-2 gap-4 mt-10">
                    {agentInfo.settings.suggested_questions.map((item) => (
                      <Tooltip key={item.id} title={item.content}>
                        <div
                          className="h-11 px-4 border rounded-xl flex items-center cursor-pointer hover:shadow"
                          onClick={() =>
                            handleSend({ textContent: item.content })
                          }
                        >
                          <span className="text-sm text-[#1D1E1F] truncate">
                            {item.content}
                          </span>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                )}
            </div>
          )}

          {/* Chunk 弹窗 */}
          <Chunk
            ref={chunkRef}
            virtualRef={chunkSourceRef}
            fetchChunkDetail={handleFetchChunkDetail}
            renderMarkdown={handleRenderMarkdown}
          />
          {/* Graph 弹窗 */}
          <Graph
            ref={graphRef}
            virtualRef={graphSourceRef}
            onView={handleGraphView}
          />
        </div>
      </div>

      {/* 思考知识库侧边栏 */}
      {showThinkKnowledge && (
        <div className="h-full w-[418px] border-l">
          <ThinkKnowledge
            ref={thinkKnowledgeRef}
            onClose={() => setShowThinkKnowledge(false)}
          />
        </div>
      )}

      {/* 用户记忆侧边栏 */}
      {/* {showUserMemory && (
        <div className={isUserMemoryFullscreen ? "fixed inset-0 z-[201] bg-white" : "h-full w-[482px] border-l"}>
          <UserMemory
            agentId={agentInfo?.agent_id || ''}
            onClose={() => {
              setShowUserMemory(false)
              setIsUserMemoryFullscreen(false)
            }}
            onToggleFullscreen={() => setIsUserMemoryFullscreen(!isUserMemoryFullscreen)}
            isFullscreen={isUserMemoryFullscreen}
          />
        </div>
      )} */}

      {/* 添加回答为MD */}
      <AddAnswerAsMd ref={addAnswerAsMdRef} />
    </div>
  );
}

export default KnowledgeChatView;
