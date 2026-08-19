/**
 * IndexChat - 工作台 AI 聊天主界面
 *
 * 核心功能：
 * 1. 会话管理：新建、切换、加载会话
 * 2. 消息收发：发送消息、流式输出、停止生成
 * 3. 技能系统：技能选择、技能提及
 * 4. 文件处理：上传、预览、下载、收藏
 * 5. 反馈系统：点赞/点踩、反馈提交
 * 6. 知识来源：Chunk、Graph、知识面板
 * 7. 分享功能：选择消息、创建分享
 */
import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Checkbox, Spin,
  message,
  Button,
  Empty
} from "antd";
import { DownOutlined } from "@ant-design/icons";
import { SvgIcon, OverflowTooltip, SidePanel } from "@km/shared-components-react";

// ============ Stores ============
import { useConversationStore } from "./conversation";
import { useAgentRunStore } from "@/stores/modules/agentRun";
import { useUserStore } from "@/stores/modules/user";
import { useNavigationStore } from "@/stores/modules/navigation";
import { useSkillsStore } from "@/stores/modules/skills";
import { useEnterpriseStore } from "@/stores/modules/enterprise";

// ============ API ============
import { TERMINAL_EVENTS } from "@/api/modules/agentRun/types";
import { agentRunApi } from "@/api/modules/agentRun";
import agentsApi from "@/api/modules/agents/index";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import filesApi from "@/api/modules/files";
import favoritesApi from "@/api/modules/favorites";
import mySpaceApi from "@/api/modules/my-space";
import { formatFile } from "@/api/modules/files/transform";
import chunksApi from "@/api/modules/chunks";
import uploadApi from "@/api/modules/upload";

// ============ Hooks & Composables ============
import {
  useChatFeedback,
  useChatMessages,
  useChatSend,
  useChatShare,
  useRagStats,
  applyAgentRunProjectionEvents,
  mergeAgentRunProjectionIntoMessage,
  type AgentRunMessageProjection,
} from "@km/shared-business/chat";

// ============ Components ============
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
  OutputFiles,
  AddAnswerAsMd,
} from "@/components/Chat";
import { BubbleList, BubbleUser, BubbleAssistant } from "@km/hub-ui-x-react";
import { UserMemory } from "@/components/UserMemory";
import { ProcessFlowHeader, ChatConfigProvider, projectReasoningIntoProcessRecords, type KnowledgePanelData } from "@km/shared-business/chat";
import { chatAdapters } from "@/adapters/chat-adapters";
import FileViewerWrapper from "@/components/FileViewer/view";
import FileViewer from "@/components/FileViewer";

// ============ Utils & Constants ============
import { t } from "@/locales";
import { eventBus, formatFileInfo } from "@km/shared-utils";
import { checkPermission, checkLoginStatus } from "@/utils/permission";
import { buildKnowledgeFileUrl, buildUrl } from "@/utils/router";
import { AGENT_USAGES } from "@/constants/agent";
import { EVENT_NAMES } from "@/constants/events";
import { getPublicPath } from '@/utils/config';
import { buildPreviewUrl } from '@/utils/preview';
import ChatHistory from "./history";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import { markdownPreview } from "@/components/Markdown/helper";

// ============ Styles ============
import "./IndexChat.css";

// ============================================================
// Type Definitions
// ============================================================

interface AgentInfo {
  agent_id: string;
  name: string;
  logo: string;
  description?: string;
  settings?: {
    opening_statement?: string;
    suggested_questions?: { id: string; content: string }[];
    web_search_setting?: { enable: boolean };
    answer_remarks_config?: { enable: boolean; content: string };
    deep_thinking_config?: { channel_id: number; temperature: number };
    fast_reasoning_config?: { channel_id: number; temperature: number };
    rerank_config?: any;
  };
  configs?: {
    completion_params?: any;
  };
}

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

export interface ChatMessage {
  id: string | number;
  role: "user" | "assistant";
  content: string;
  time: string;
  loading?: boolean;
  error?: boolean;
  showErrorDetails?: boolean;
  question?: string;
  original_question?: string;
  answer?: string;
  reasoning_content?: string;
  reasoning_expanded?: boolean;
  feedbackVisible?: boolean;
  feedback_type?: "satisfied" | "unsatisfied" | "";
  feedbackTypeOptions?: Map<string, boolean>;
  submitBtnDisabled?: boolean;
  feedbackSuccessful?: boolean;
  description?: string;
  feedbackId?: number | null;
  rag_stats?: any;
  rag_search_text?: string;
  user_files?: any[];
  specified_files?: any[];
  uploaded_files?: any[];
  skill?: string;
  outputFiles?: { id: string | number; file_name?: string; url?: string }[];
  process_records?: any[];
}

// ============================================================
// Constants
// ============================================================

/** 示例问题列表 */
const EXAMPLE_QUESTIONS = [
  { id: "1", content: "华为的管理体系对互联网创业公司有什么启发" },
  { id: "2", content: "帮我审核一下这份欧派集团的续费合同" },
  { id: "3", content: "通过深入研究，帮助人们理解不同文化背景下" },
  { id: "4", content: "根据用户的描述，自动生成Mermaid图表代码。" },
];

// ============================================================
// 外层组件：注入 ChatConfigProvider
// ============================================================

/**
 * IndexChatView 外层包装
 *
 * 将 ChatConfigProvider 提升到组件顶层，确保 useChatFeedback 等 hook
 * 能正确读取到 adapters 上下文（React Context 只读祖先，不读自身 JSX）
 */
export function IndexChatView() {
  const locale = useEnterpriseStore((state) => state.language);

  return (
    <ChatConfigProvider lang={locale} adapters={chatAdapters}>
      <IndexChatViewInner />
    </ChatConfigProvider>
  );
}

// ============================================================
// 内层组件：使用 ChatConfigProvider 的 context
// ============================================================

function IndexChatViewInner() {
  // ==================== Router ====================
  const location = useLocation();
  const navigate = useNavigate();

  // ==================== Refs ====================
  const senderRef = useRef<any>(null);
  const chunkRef = useRef<any>(null);
  const thinkKnowledgeRef = useRef<any>(null);
  const chunkSourceRef = useRef<any>(null);
  const graphRef = useRef<any>(null);
  const graphSourceRef = useRef<any>(null);
  const addAnswerAsMdRef = useRef<any>(null);
  const loadConversationRequestId = useRef(0);
  const latestRunFetchedRef = useRef(false);
  /** AgentRun 订阅的独立增量投影，避免与主 SSE 双写同一 answer */
  const agentRunProjectionRef = useRef<AgentRunMessageProjection | null>(null);
  /** 刷新恢复时没有主 SSE，由 AgentRun 投影接管实时状态；主动发送时由主 SSE 单写 */
  const agentRunOwnsLiveStateRef = useRef(true);
  const checkedFilesRef = useRef<Set<string>>(new Set());
  const currentGraphMessage = useRef<any>(null);

  // ==================== Stores ====================
  const convStore = useConversationStore();
  const agentRunStore = useAgentRunStore();
  const agentRunEvents = useAgentRunStore(state => state.events);
  const agentRunCurrentRun = useAgentRunStore(state => state.currentRun);
  const userStore = useUserStore();
  const navigationStore = useNavigationStore();
  const skillsStore = useSkillsStore();
  const locale = useEnterpriseStore((state) => state.language);


  // ==================== Permissions ====================
  /** 知识库权限：开关 + 模块权限 */
  const hasKnowledgeBase = navigationStore.hasKnowledge && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE);

  // ==================== State - UI Visibility ====================
  const [showHistory, setShowHistory] = useState(false);
  const [showThinkKnowledge, setShowThinkKnowledge] = useState(false);
  const [showMySkillsPanel, setShowMySkillsPanel] = useState(false);

  // ==================== State - Agent & Model ====================
  const [showUserMemory, setShowUserMemory] = useState(false);
  const [isUserMemoryFullscreen, setIsUserMemoryFullscreen] = useState(false);
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null);
  const [agentModels, setAgentModels] = useState<ModelItem[]>([]);
  const [model, setModel] = useState("");

  // ==================== State - Chat Config ====================
  const [library, setLibrary] = useState({
    name: "全部知识库",
    value: ["all"],
    isSpace: false,
  });
  const [networkSearch, setNetworkSearch] = useState(false);
  const [selectedSkills, setSelectedSkills] = useState<
    Array<{
      display_name: string;
      skill_name?: string;
    }>
  >([]);

  // ==================== State - Loading States ====================
  const [isStreaming, setIsStreaming] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);


  // ==================== State - File Preview ====================
  const [filePreviewState, setFilePreviewState] = useState({
    visible: false,
    loading: false,
    currentFile: {} as any,
    fileContent: "",
    isOutput: false,
  });

  // ==================== Computed Values ====================

  /** 当前会话 */
  const currentConv = useMemo(
    () => convStore.currentConversation(),
    [convStore.conversations, convStore.current_conversationid],
  );

  /** 当前模型配置 */
  const currentModel = useMemo(() => {
    return agentModels.find((item) => item.value === model);
  }, [agentModels, model]);

  /** 我的技能列表（已启用） */
  const mySkillList = useMemo(
    () =>
      skillsStore.mySkillList.filter(
        (item: any) => item.binding_status === "enabled",
      ),
    [skillsStore.mySkillList],
  );

  /** 技能列表（从 agentInfo.settings.skills 获取，并匹配探索列表的完整技能信息） */
  const skillList = useMemo(() => {
    const agentSkills = (agentInfo as any)?.settings?.skills || [];
    const exploreSkills = skillsStore.skillList;
    return agentSkills
      .map((agentSkill: any) =>
        exploreSkills.find((s: any) => s.id === agentSkill.skill_id),
      )
      .filter(Boolean);
  }, [agentInfo, skillsStore.skillList]);

  // ==================== Hooks - Chat Feedback ====================
  const {
    loadFeedbackConfig,
    handleClickFeedbackBtn: handleClickFeedbackBtnBase,
    handleToggleFeedbackBtn,
    handleCloseFeedback,
    handleSubmitFeedback,
    loadMessageFeedback,
    resetFeedbackSuccessState,
  } = useChatFeedback();

  // ==================== Hooks - Chat Messages ====================
  const {
    state: messageState,
    handleLoadListMore: handleLoadListMoreBase,
    loadMessageList: loadMessageListBase,
    handleRegenerate: handleRegenerateBase,
    renderSource,
    handleSourceReferenceHover: handleSourceReferenceHoverBase,
    handleOpenKnow: handleOpenKnowBase,
    clearMessageList,
    updateMessageList,
  } = useChatMessages({ limit: 10 });

  // ==================== Hooks - Chat Send ====================
  const { sendMessage: sendMessageBase, handleStop: handleStopBase } =
    useChatSend();

  // ==================== Hooks - Chat Share ====================
  const {
    state: shareState,
    isShareMode,
    handleSelectAll: handleSelectAllBase,
    handleOpenShare: handleOpenShareBase,
    handleSelectMessage: handleSelectMessageBase,
    handleCreateShare: handleCreateShareBase,
  } = useChatShare();

  // ==================== Hooks - RAG Stats ====================
  const { formatRagStats } = useRagStats({ formatFileInfo });

  // ==================== Computed Values (依赖 Hooks) ====================

  /** 消息列表 - 必须在 messageState 定义之后 */
  const messageList = useMemo(
    () => messageState.messageList,
    [messageState.messageList],
  );

  // ============================================================
  // Callbacks - File Upload
  // ============================================================

  /**
   * 文件上传请求处理
   * 默认同步到"我上传的"知识库
   */
  const httpRequest = useCallback((dataFile: File) => {
    return new Promise((resolve, reject) => {
      let isHandled = false;
      const hasPermission = checkPermission({
        onClick: async () => {
          try {
            // upload_target=my_uploads 表示同步到个人知识库
            const res = await uploadApi.upload(dataFile, "my_uploads");
            resolve({
              id: res.data?.id,
              name: dataFile.name,
              size: dataFile.size,
              mime_type: dataFile.type,
              preview_key: res.data?.preview_key,
              url: buildPreviewUrl(res.data?.preview_key) ?? "",
            });
          } catch (error) {
            reject(error);
          }
        },
        onFailed: () => {
          isHandled = true;
          reject(new Error("Permission denied"));
        },
      });
      if (!hasPermission && !isHandled) {
        reject(new Error("Permission denied"));
      }
    });
  }, []);

  // ============================================================
  // Callbacks - Agent & Model Loading
  // ============================================================

  /**
   * 加载智能体可用模型列表
   */
  const loadModels = useCallback(async (agent: any) => {
    const res = await agentsApi.models.list(agent.agent_id);
    const deepThinkingConfig = agent.settings?.deep_thinking_config || {
      temperature: 0.5,
    };
    const fastReasoningConfig = agent.settings?.fast_reasoning_config || {
      temperature: 0.5,
    };

    const models = res.agent_models
      .map((item: any) => {
        const isDeepThinking =
          item.channel_id === deepThinkingConfig.channel_id;
        const modelItem = {
          ...item,
          type: isDeepThinking ? "deep_reasoning" : "fast_reasoning",
          icon: isDeepThinking ? "star-link" : "lightning",
          name: isDeepThinking ? "深度思考" : "快速回答",
          temperature: isDeepThinking
            ? deepThinkingConfig.temperature
            : fastReasoningConfig.temperature,
          value: item.channel_id + "_" + item.channel_type + "_" + item.model,
        };
        return modelItem;
      })
      .filter(
        (item: any, index: number, self: any[]) =>
          index === self.findIndex((t: any) => t.type === item.type),
      );
    if (models.length) {
      setModel((models[0] as any).value);
    }
    setAgentModels(models);
  }, []);

  /**
   * 加载智能体信息
   */
  const loadAgent = useCallback(async () => {
    const res = await agentsApi.list({
      agent_usages: String(AGENT_USAGES.WORK_AI),
    });
    const agent = res.agents[0] ? transformAgentInfo(res.agents[0]) : null;
    setAgentInfo(agent);
    if (agent) {
      loadModels(agent);
      convStore.setAgentId(agent.agent_id);
    }
    return agent;
  }, [loadModels, convStore]);

  // ============================================================
  // Callbacks - Message Operations
  // ============================================================

  /**
   * 加载更多历史消息
   */
  const handleLoadListMore = useCallback(
    async (done: () => void): Promise<void> => {
      const { id } = currentConv;
      if (!id) return done();
      return handleLoadListMoreBase(done, id, { skillList, mySkillList });
    },
    [currentConv, handleLoadListMoreBase, skillList, mySkillList],
  );

  /**
   * 加载会话消息列表
   */
  const loadMessageList = useCallback(
    async (conversationId?: string | number, options?: { isRunning?: boolean; runningMessageId?: string | number }) => {
      const id = conversationId || currentConv.id;
      if (!id) return;
      await loadMessageListBase(id, { skillList, mySkillList, ...options });
    },
    [currentConv, loadMessageListBase, skillList, mySkillList],
  );

  /**
   * 创建新会话
   */
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

  /**
   * 发送消息
   * @param question 问题内容
   * @param links @提及链接
   * @param files 上传文件
   * @param overrideSkill 覆盖技能（重新生成场景）
   */
  const sendMessage = useCallback(
    async (question: string, links: any[] = [], files: any[] = [], overrideSkill?: { skill_name?: string; display_name?: string }) => {
      if (isStreaming) return;
      setShowHistory(false);
      setShowThinkKnowledge(false);

      setIsStreaming(true);
      latestRunFetchedRef.current = false;
      agentRunOwnsLiveStateRef.current = false;

      const agent_id = agentInfo?.agent_id;
      // 创建会话并获取 conversation_id
      let conversation_id = currentConv.id;
      if (!conversation_id) {
        conversation_id = await createConversation(agent_id || 0, question);
      }

      const completion_params = agentInfo?.configs?.completion_params;
      const modelId = currentModel?.id || "";

      // 优先使用传入的 skill（重新生成场景），否则使用当前选中的技能
      const selectedSkill = overrideSkill?.skill_name
        ? overrideSkill
        : selectedSkills[0];

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
          links,
          files,
          networkSearch,
          library,
          agentInfo,
          skill: {
            skill_name: selectedSkill?.skill_name || "",
            display_name: selectedSkill?.display_name || "",
          },
          type: "work-ai",
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

        setSelectedSkills([]);
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
      networkSearch,
      library,
      selectedSkills,
      updateMessageList,
    ],
  );

  /**
   * 发送消息入口
   */
  const handleSend = useCallback(
    (data: any) => {
      const { textContent, atList, files = [], skill } = data;
      checkPermission({
        onClick: () => {
          if (!textContent.trim() && files.length === 0) return;
          if (!agentInfo || !agentInfo.agent_id) {
            message.warning(t("index.work_ai_setup_tip"));
          } else {
            sendMessage(textContent, atList || [], files, skill);
          }
        },
      });
    },
    [agentInfo, sendMessage, selectedSkills],
  );

  /**
   * 停止生成
   */
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

  /**
   * 重新生成回答
   */
  const handleRegenerate = useCallback(
    (message: any) => {
      if (isStreaming) return;
      handleRegenerateBase(message, handleSend);
    },
    [isStreaming, handleRegenerateBase, handleSend],
  );

  /**
   * 显示错误详情
   */
  const handleShowErrorDetails = useCallback(
    (msg: any) => {
      updateMessageList((list) =>
        list.map((item) =>
          item.id === msg.id ? { ...item, showErrorDetails: true } : item,
        ),
      );
    },
    [updateMessageList],
  );

  /**
   * 解析消息内容（处理技能前缀）
   */
  const handleParseContent = useCallback((msg: any) => {
    let content = "";
    try {
      const question = JSON.parse(msg.original_question || msg.question);
      if (question && Array.isArray(question)) {
        const textItem = question.find((item: any) => item.type === "text");
        if (textItem?.content) {
          content = textItem.content;
        }
      }
    } catch (err) {
      // Not JSON format, use raw string
      content = msg.original_question || msg.question || "";
    }

    // Strip skill prefix if skill info is available
    // Format: "/skill_name actual_question"
    if (msg.skill?.skill_name && content.startsWith(`/${msg.skill.skill_name} `)) {
      return content.substring(msg.skill.skill_name.length + 2);
    }

    return content;
  }, []);

  // ============================================================
  // Callbacks - Feedback
  // ============================================================

  /**
   * 点击点赞/点踩按钮
   */
  const handleClickFeedbackBtn = useCallback(
    async (msg: any, type: "satisfied" | "unsatisfied") => {
      // 先关闭其他消息的反馈面板
      updateMessageList((list) =>
        list.map((item) =>
          item.id !== msg.id ? { ...item, feedbackVisible: false } : item,
        ),
      );
      // 然后更新当前消息
      const updatedMsg = await handleClickFeedbackBtnBase(msg, type);
      updateMessageList((list) =>
        list.map((item) => (item.id === updatedMsg.id ? updatedMsg : item)),
      );
    },
    [handleClickFeedbackBtnBase, updateMessageList],
  );

  // ============================================================
  // Callbacks - Knowledge Panel
  // ============================================================

  /**
   * Source 引用悬停处理
   */
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

  /**
   * 打开知识面板
   */
  const handleOpenKnow = useCallback(
    (msg: any) => {
      handleOpenKnowBase(msg, thinkKnowledgeRef, setShowThinkKnowledge);
    },
    [handleOpenKnowBase],
  );

  /**
   * 处理 Source 点击事件，打开 think-knowledge 并选中对应项
   */
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

  /**
   * 处理 Graph 的 view 事件，打开 think-knowledge 并选中对应项
   */
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

  /**
   * Chunk 详情获取回调
   */
  const handleFetchChunkDetail = useCallback(async (chunkId: string) => {
    const chunk = await chunksApi.get(chunkId);
    return {
      content: chunk.content,
      token_count: chunk.token_count,
      chunk_index: chunk.chunk_index,
    };
  }, []);

  /**
   * Markdown 渲染回调
   */
  const handleRenderMarkdown = useCallback(
    async (element: HTMLDivElement, content: string) => {
      await markdownPreview(element, content);
    },
    []
  );

  /**
   * 知识面板打开回调（统一处理 ProcessFlow 中的点击事件）
   */
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

  // ============================================================
  // Callbacks - Conversation Management
  // ============================================================

  /**
   * 新建会话
   */
  const handleNewChat = useCallback(() => {
    if (!checkLoginStatus()) return;
    convStore.setCurrentState("", true);
    setShowHistory(false);
    setShowThinkKnowledge(false);
    setSelectedSkills([]);
    clearMessageList();
    agentRunStore.disconnect();
    setIsStreaming(false);
    // 新建对话时清除收藏状态缓存
    checkedFilesRef.current.clear();
    setFilePreviewState({
      visible: false,
      loading: false,
      currentFile: {},
      fileContent: "",
      isOutput: false,
    });
  }, [convStore, clearMessageList]);

  /**
   * 加载会话消息并恢复运行中的 run
   * @returns Promise<boolean> 是否成功加载（用于判断是否需要等待）
   */
  const loadConversation = useCallback(
    async (conversation_id: string): Promise<boolean> => {
      const requestId = ++loadConversationRequestId.current;
      agentRunOwnsLiveStateRef.current = true;

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

  /**
   * 选择会话
   */
  const onSelectConversation = useCallback(
    async (conversation_id: string) => {
      agentRunStore.disconnect();
      convStore.setCurrentState(conversation_id);
      setShowHistory(false);
      setShowThinkKnowledge(false);
      // 切换对话时清除收藏状态缓存
      checkedFilesRef.current.clear();
      setFilePreviewState({
        visible: false,
        loading: false,
        currentFile: {},
        fileContent: "",
        isOutput: false,
      });
      await loadConversation(conversation_id);
    },
    [convStore, agentRunStore, loadConversation],
  );

  // ============================================================
  // Callbacks - Share
  // ============================================================

  const handleSelectAll = useCallback(() => {
    handleSelectAllBase(messageList);
  }, [handleSelectAllBase, messageList]);

  const handleOpenShare = handleOpenShareBase;
  const handleSelectMessage = handleSelectMessageBase;

  const handleCreateShare = useCallback(() => {
    handleCreateShareBase(
      convStore.current_conversationid as string,
      "index",
      currentConv?.title,
    );
  }, [handleCreateShareBase, convStore.current_conversationid, currentConv]);

  const handleAddAsMd = useCallback((msg: any) => {
    addAnswerAsMdRef.current?.open({
      answer: msg.answer || msg.content,
      question: msg.original_question || msg.question || msg.content,
    });
  }, []);

  // ============================================================
  // Callbacks - Skill Selection
  // ============================================================

  /**
   * 选择技能
   */
  const handleSelectSkill = useCallback(
    (display_name: string, source: "explore" | "my" = "explore") => {
      // 根据来源在对应列表查找
      const targetList =
        source === "explore" ? skillsStore.skillList : mySkillList;
      const skill = targetList.find(
        (s: any) => s.display_name === display_name,
      );

      senderRef.current?.clearSkillTags?.();
      senderRef.current?.insertSkill?.({ label: display_name });

      setSelectedSkills([
        {
          display_name,
          skill_name: skill?.skill_name || display_name,
        },
      ]);
    },
    [skillsStore.skillList, mySkillList],
  );

  /**
   * 通过 id 选择技能
   */
  const handleSelectSkillById = useCallback(
    (skillId: string, source: "explore" | "my" = "explore") => {
      const targetList =
        source === "explore" ? skillsStore.skillList : mySkillList;
      const skill = targetList.find((s: any) => s.id === skillId);
      if (skill) {
        handleSelectSkill(skill.display_name, source);
      }
    },
    [skillsStore.skillList, mySkillList, handleSelectSkill],
  );

  /**
   * 移除技能
   */
  const handleRemoveSkill = useCallback(() => {
    setSelectedSkills([]);
  }, []);

  /**
   * 跳转到技能库
   */
  const handleOpenSkillLibrary = useCallback(() => {
    navigate("/skills");
  }, [navigate]);

  /**
   * 从弹框中选择技能（默认从我的列表）
   */
  const handleSelectSkillFromMention = useCallback(
    (skill: { label: string; icon: string }) => {
      handleSelectSkill(skill.label, "my");
    },
    [handleSelectSkill],
  );

  // ============================================================
  // Callbacks - File Operations
  // ============================================================

  /**
   * 点击文件预览
   */
  const handleFileClick = useCallback(async (file: any) => {
    if (file.isfolder) return;

    setFilePreviewState((prev) => ({
      ...prev,
      loading: true,
      fileContent: "",
      currentFile: {},
    }));

    try {
      if (file.url || file.preview_key) {
        const fileUrl =
          file.url || buildPreviewUrl(file.preview_key) || "";
        setFilePreviewState({
          visible: true,
          loading: false,
          currentFile: {
            id: file.id,
            name: file.name,
            file_url: fileUrl,
            file_ext: file.name?.split(".").pop() || "",
            file_mime: file.mime_type,
          },
          fileContent: "",
          isOutput: false,
        });
      } else {
        const res = await filesApi.get(file.id as string);
        const fileData = formatFile(res);
        let fileContent = "";

        if (!fileData.file_url && fileData.file_ext === "md") {
          const chunksRes = await chunksApi.files.list(file.id as string);
          fileContent = chunksRes.chunks.map((c: any) => c.content).join("\n");
        }

        setFilePreviewState({
          visible: true,
          loading: false,
          currentFile: fileData,
          fileContent,
          isOutput: false,
        });
      }
    } catch (error) {
      console.error("Failed to load file:", error);
      setFilePreviewState((prev) => ({ ...prev, loading: false }));
    }
  }, []);

  /**
   * 关闭文件预览
   */
  const closeFilePreview = useCallback(() => {
    if (filePreviewState.currentFile.file_url?.startsWith("blob:")) {
      URL.revokeObjectURL(filePreviewState.currentFile.file_url);
    }
    setFilePreviewState({
      visible: false,
      loading: false,
      currentFile: {},
      fileContent: "",
      isOutput: false,
    });
  }, [filePreviewState.currentFile.file_url]);

  /**
   * 查看文件详情
   */
  const handleViewFileDetail = useCallback(() => {
    const url = buildKnowledgeFileUrl(
      filePreviewState.currentFile.library_id,
      filePreviewState.currentFile.id,
    );
    window.open(url);
  }, [filePreviewState.currentFile]);

  /**
   * 下载文件
   */
  const handleDownloadFile = useCallback(async () => {
    const file = filePreviewState.currentFile;
    const fileName = file.name || "download";

    try {
      if (file.file_url) {
        const a = document.createElement("a");
        a.href = file.file_url;
        a.download = fileName;
        a.target = "_blank";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      } else if (file.id) {
        const res = await filesApi.downloadFile(file.id);
        const url = URL.createObjectURL(res as any);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch {
      message.error(t("action.download") + " " + t("status.failed"));
    }
  }, [filePreviewState.currentFile]);

  /**
   * 预览输出文件
   */
  const handlePreviewOutputFile = useCallback(
    (file: { id: string | number; file_name?: string; url?: string }) => {
      const url = new URL(file.url);
      const baseUrl = url.origin + url.pathname;
      setFilePreviewState({
        visible: true,
        loading: false,
        currentFile: {
          id: file.id,
          name: file.file_name || `文件 ${file.id}`,
          file_url: baseUrl + '?token=' + userStore.info.access_token,
          file_ext: file.file_name?.split(".").pop() || "",
        },
        fileContent: "",
        isOutput: true,
      });
    },
    [],
  );

  /**
   * 检查输出文件收藏状态（进入视野时触发）
   */
  const handleCheckOutputFilesFavorite = useCallback(
    (fileIds: string[]) => {
      if (!hasKnowledgeBase) return;

      // 过滤已检查的文件
      const uncheckedIds = fileIds.filter(id => !checkedFilesRef.current.has(id));
      if (uncheckedIds.length === 0) return;

      mySpaceApi.check({
        resource_type: 9999,
        ids: uncheckedIds.slice(0, 100)  // uploadFileID
      }).then((res) => {
        const favoritedIds = res.favorited_ids || [];
        uncheckedIds.forEach(id => checkedFilesRef.current.add(id));

        updateMessageList((list) =>
          list.map((item: any) => {
            if (item.outputFiles?.length) {
              return {
                ...item,
                outputFiles: item.outputFiles.map((f: any) => ({
                  ...f,
                  is_favorite: favoritedIds.includes(String(f.id)),
                })),
              };
            }
            return item;
          }),
        );
      }).catch(() => {});
    },
    [hasKnowledgeBase, updateMessageList],
  )

  /**
   * 收藏/取消收藏输出文件
   */
  const handleToggleOutputFileFavorite = useCallback(
    async (file: any, msg: any) => {
      try {
        await favoritesApi.toggle({
          resource_type: 9999,
          resource_id: String(file.id), // uploadFileID
        });
        message.success(file.is_favorite ? "已取消收藏" : "收藏成功");
        // 更新消息列表中的文件收藏状态
        updateMessageList((list) =>
          list.map((item: any) => {
            if (item.id === msg.id && item.outputFiles) {
              return {
                ...item,
                outputFiles: item.outputFiles.map((f: any) =>
                  f.id === file.id ? { ...f, is_favorite: !f.is_favorite } : f,
                ),
              };
            }
            return item;
          }),
        );
      } catch (error) {
        message.error("操作失败");
      }
    },
    [updateMessageList],
  );

  // ============================================================
  // Callbacks - Initialization
  // ============================================================

  /**
   * 初始化聊天界面
   *
   * 优化策略：
   * 1. 核心数据（agent、会话）优先加载，阻塞初始化
   * 2. 非核心数据（技能列表、反馈配置）并行加载，不阻塞
   * 3. 确保 loadMessageList 完成后才结束初始化
   */
  const initChat = useCallback(async (signal?: AbortSignal) => {
    setIsInitializing(true);
    try {
      // ===== 1. 加载智能体（核心，阻塞） =====
      const agent = await loadAgent();

      if (signal?.aborted) return;

      // 如果没有智能体，提前结束
      if (!agent?.agent_id) {
        setIsInitializing(false);
        return;
      }

      convStore.setBasePath(location.pathname);
      convStore.setAgentId(agent.agent_id);

      // ===== 2. 并行加载非核心数据（不阻塞） =====
      // 技能列表：用于空状态显示和消息解析，但不是立即需要
      // 反馈配置：用于点赞/点踩，延迟加载
      const nonCriticalPromise = Promise.all([
        skillsStore.loadSkillList({ isRefresh: true }).catch(e => {
          return [];
        }),
        skillsStore.loadMySkillList(true).catch(e => {
          return [];
        }),
        loadFeedbackConfig("work_ai").catch(e => {
        }),
      ]);

      // ===== 3. 加载会话（核心，阻塞） =====
      const conversation_id = new URLSearchParams(location.search).get(
        "conversation_id",
      ) as string;

      // URL 有指定会话时，直接加载（不等待会话列表）
      if (conversation_id) {
        convStore.setCurrentState(conversation_id, false);
        // 等待消息加载完成
        const loaded = await loadConversation(conversation_id);
        if (!loaded) {
          // 如果加载失败（可能是 404），尝试加载历史会话
          const conversations = await convStore.loadConversations(signal);
          if (signal?.aborted) return;
          if (conversations.length > 0) {
            convStore.setCurrentState(conversations[0].id, true);
            await loadConversation(conversations[0].id);
          }
        }
        // 后台加载会话列表（不阻塞）
        // convStore.loadConversations().catch(() => {});
      } else {
        // 无指定会话，加载历史会话列表
        const conversations = await convStore.loadConversations(signal);

        if (signal?.aborted) return;

        if (conversations.length > 0) {
          // 加载最新会话
          const latestConversation = conversations[0];
          convStore.setCurrentState(latestConversation.id, true);
          // 等待消息加载完成
          await loadConversation(latestConversation.id);
        }
      }

      // ===== 4. 等待非核心数据加载完成（可选） =====
      // 如果希望技能列表在初始化完成前准备好，取消下面的注释
      await nonCriticalPromise;

    } catch (error) {
      // 忽略取消错误
      if (signal?.aborted) return;
      console.error("Failed to initialize chat:", error);
    } finally {
      // 只有未取消时才更新状态
      if (!signal?.aborted) {
        setIsInitializing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAgent, loadConversation, convStore, skillsStore, location.pathname, location.search]);


  // ============================================================
  // Effects
  // ============================================================

  /**
   * 监听实时 SSE 事件并更新消息
   */
  useEffect(() => {
    const events = agentRunEvents
    const lastEvent = events[events.length - 1]
    const currentRun = agentRunCurrentRun
    const messageId = currentRun?.message_id

    if (!events.length || !messageId) return
    const isTerminalEvent = TERMINAL_EVENTS.includes(lastEvent.type || lastEvent.event_type)
    if (isTerminalEvent) {
      setIsStreaming(false)
    }
    updateMessageList((list) => {
      const targetIndex = list.findIndex((m: any) => String(m.id) === String(messageId))
      if (targetIndex === -1) return list

      const projection = applyAgentRunProjectionEvents(
        agentRunProjectionRef.current,
        events as any[],
        messageId,
        formatRagStats,
        `${currentRun.run_id}:${messageId}`,
      )
      if (projection === agentRunProjectionRef.current) return list

      const newList = [...list]
      newList[targetIndex] = mergeAgentRunProjectionIntoMessage(
        list[targetIndex],
        projection.message,
        { projectionOwnsLiveState: agentRunOwnsLiveStateRef.current },
      )
      // 只有目标消息存在且事件真正应用后才推进游标；恢复时不会丢历史事件。
      agentRunProjectionRef.current = projection
      return newList
    })
  }, [agentRunEvents, agentRunCurrentRun, updateMessageList, formatRagStats])

  /**
   * 组件初始化
   */
  useEffect(() => {
    const abortController = new AbortController();

    initChat(abortController.signal);

    if (new URLSearchParams(location.search).get("query")) {
      const query = new URLSearchParams(location.search).get("query");
      setTimeout(() => {
        senderRef.current?.insertText(query);
      }, 100);
    }

    const handleLoginSuccess = () => {
      initChat(abortController.signal);
    };
    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);

    // 处理从技能详情页跳转过来的情况
    const skillId = new URLSearchParams(location.search).get("skill_id");
    if (skillId) {
      const skillType =
        (new URLSearchParams(location.search).get("type") as
          | "explore"
          | "my") || "explore";
      const checkAndInsert = () => {
        if (abortController.signal.aborted) return;
        if (senderRef.current?.insertSkill) {
          handleSelectSkillById(skillId, skillType);
        } else {
          setTimeout(checkAndInsert, 100);
        }
      };
      checkAndInsert();
    }

    return () => {
      abortController.abort();
      eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
    };
  }, []);

  /**
   * 监听路由重置事件
   */
  useEffect(() => {
    const handleResetRouteState = () => {
      if (convStore.current_conversationid) {
        convStore.setCurrentState("", true);
        setShowHistory(false);
        setShowThinkKnowledge(false);
        setSelectedSkills([]);
        clearMessageList();
      }
    };

    window.addEventListener("reset-route-state", handleResetRouteState);
    return () => {
      window.removeEventListener("reset-route-state", handleResetRouteState);
    };
  }, [convStore, clearMessageList]);

  /**
   * 组件卸载清理
   */
  useEffect(() => {
    return () => {
      convStore.clearCurrentState();
      agentRunStore.disconnect();
    };
  }, []);

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="w-full h-full overflow-hidden flex">
      {/* ============ 历史侧边栏 ============ */}
      {showHistory && (
        <div className="w-60">
          <ChatHistory
            onCollapse={() => setShowHistory(false)}
            onNewChat={handleNewChat}
            onConversation={onSelectConversation}
          />
        </div>
      )}

      {/* ============ 主聊天区域 ============ */}
      <div
        className={`flex-1 overflow-hidden flex flex-col ${filePreviewState.visible ? "w-1/2" : ""}`}
      >
        {/* 头部 */}
        {isShareMode ? (
          <ShareHeader
            selectAll={shareState.selectAll}
            selectMessageIds={shareState.selectMessageIds}
            onSelectAll={handleSelectAll}
            onCreateShare={handleCreateShare}
            onOpenShare={handleOpenShare}
          />
        ) : (
          <Header
            expandSidebar={false}
            back={false}
            title={currentConv?.title || ""}
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
            right={
              <div
                className={`size-7 cursor-pointer rounded flex items-center justify-center ${showUserMemory ? 'bg-[#F5F5F7]' : 'hover:bg-[#F5F5F7]'}`}
                onClick={() => setShowUserMemory(true)}
              >
                <SvgIcon name="brain" />
              </div>
            }
          />
        )}

        {/* 消息区域 */}
        <div
          className={`flex-1 py-5 flex flex-col overflow-hidden ${messageList.length ? "" : "items-center justify-center"}`}
        >
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
              {messageList.map((msg: any, index: number) => (
                <div key={msg.id}>
                  {/* 用户消息气泡 */}
                  <div
                    className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
                    onClick={() => handleSelectMessage(msg)}
                  >
                    {isShareMode && (
                      <Checkbox
                        checked={shareState.selectMessageIds.includes(msg.id)}
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      <BubbleUser
                        content={handleParseContent(msg)}
                        files={msg.user_files}
                        className={isShareMode ? "!mb-0" : ""}
                        style={{
                          "--hubx-color-bg-message": "#EBF1FF",
                        }}
                        header={
                          <SpecifiedFiles
                            files={[
                              ...(msg.specified_files || []),
                              ...(msg.uploaded_files || []),
                            ]}
                            type="no_jump"
                            onFileClick={handleFileClick}
                          />
                        }
                        contentBefore={
                          msg.skill?.display_name ? (
                            <span className="bg-[#e6e9f2] rounded py-1 px-2 text-sm mr-2">
                              {msg.skill.display_name}
                            </span>
                          ) : null
                        }
                        menu={
                          !isShareMode ? (
                            <MessageMenu
                              type="user"
                              content={handleParseContent(msg)}
                            />
                          ) : null
                        }
                      />
                    </div>
                  </div>

                  {/* AI助手消息气泡 */}
                  <div
                    className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
                    onClick={() => handleSelectMessage(msg)}
                  >
                    {isShareMode && (
                      <Checkbox
                        checked={shareState.selectMessageIds.includes(msg.id)}
                      />
                    )}
                    <div className="flex-1 overflow-hidden">
                      <BubbleAssistant
                        content={msg.answer}
                        reasoning={msg.reasoning_content}
                        reasoningExpanded={msg.reasoning_expanded}
                        showReasoning={!msg.process_records?.length}
                        streaming={msg.loading}
                        alwaysShowMenu={
                          index === messageList.length - 1 ||
                          msg.feedbackVisible
                        }
                        className={isShareMode ? "!mb-0" : ""}
                        renderSource={(type: string, number: number) =>
                          renderSource(type, number, msg)
                        }
                        sourceEnabled
                        onSourceReferenceClick={(data: any) =>
                          handleSourceReferenceHover(data, msg)
                        }
                        style={{
                          "--hubx-color-bg-message": "transparent",
                        }}
                        showError={msg.error}
                        header={
                          <ChatConfigProvider lang={locale} adapters={chatAdapters} onOpenKnowledgePanel={handleOpenKnowledgePanel(msg)}>
                            <ProcessFlowHeader
                              processRecords={projectReasoningIntoProcessRecords(
                                msg.process_records,
                                msg.reasoning_content,
                                msg.loading,
                              )}
                              streaming={msg.loading}
                              hasContent={!!(msg.answer || msg.content)}
                              getKnowledgeSearchFiles={() => msg.rag_stats?.files_search || []}
                            />
                          </ChatConfigProvider>
                        }
                        footer={
                          <>
                            {/* 输出文件展示 */}
                            <OutputFiles
                              files={msg.outputFiles}
                              onPreview={handlePreviewOutputFile}
                              onFavorite={hasKnowledgeBase ? (file) => handleToggleOutputFileFavorite(file, msg) : undefined}
                              onCheckFavorite={hasKnowledgeBase ? handleCheckOutputFilesFavorite : undefined}
                            />
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
                                type={msg.rag_stats.type}
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
                              onShare={handleOpenShare}
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
                      updateMessageList((list) =>
                        list.map((item) =>
                          item.id === updatedMsg.id ? updatedMsg : item,
                        ),
                      );
                    }}
                    onToggle={(key: string) => {
                      const updatedMsg = handleToggleFeedbackBtn(msg, key);
                      updateMessageList((list) =>
                        list.map((item) =>
                          item.id === updatedMsg.id ? updatedMsg : item,
                        ),
                      );
                    }}
                    onSubmit={async () => {
                      const updatedMessage = await handleSubmitFeedback(msg);
                      updateMessageList((list) =>
                        list.map((item) =>
                          item.id === updatedMessage.id ? updatedMessage : item,
                        ),
                      );
                      // 2秒后重置成功状态
                      setTimeout(() => {
                        const resetMsg =
                          resetFeedbackSuccessState(updatedMessage);
                        updateMessageList((list) =>
                          list.map((item) =>
                            item.id === resetMsg.id ? resetMsg : item,
                          ),
                        );
                      }, 2000);
                    }}
                    onDescriptionChange={(value: string) => {
                      updateMessageList((list) =>
                        list.map((item) =>
                          item.id === msg.id
                            ? { ...item, description: value }
                            : item,
                        ),
                      );
                    }}
                  />
                </div>
              ))}
            </BubbleList>
          ) : (
            !isStreaming && !isInitializing && (
              <div className="flex-none w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
                <h2 className="text-2xl text-center">
                  {agentInfo?.settings?.opening_statement ||
                    t("work_ai.welcome_use")}
                </h2>
              </div>
            )
          )}

          {/* 输入区域 */}
          {!isShareMode && !isInitializing && (
            <div className="flex-none w-11/12 lg:w-4/5 max-w-[1200px] mx-auto">
              <Sender
                ref={senderRef}
                className="mt-9"
                showSkill={userStore.is_login}
                showAt={
                  userStore.is_login &&
                  userStore.info.is_internal &&
                  (hasKnowledgeBase || checkVersion(VERSION_MODULE.WORKBENCH) || checkVersion(VERSION_MODULE.RECORDING))
                }
                disabledAt={networkSearch}
                atToolTip={t("work_ai.knowledge_placeholder")}
                placeholder={t("work_ai.chat_placeholder")}
                loading={isStreaming}
                library={undefined}
                enhancedMention={true}
                hasKnowledgeBase={hasKnowledgeBase}
                allowSelectLibrary={true}
                allowSelectSpace={true}
                selectedSkills={selectedSkills.map((s) => s.display_name)}
                enableUpload={userStore.is_login}
                allowMultiple={true}
                allowSendWithFiles={true}
                acceptTypes=".pdf,.doc,.docx,.txt,.md,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.zip,.rar,.mp3"
                httpRequest={httpRequest}
                onSend={handleSend}
                onStop={handleStop}
                onSelectSkill={handleSelectSkillFromMention}
                onRemoveSkill={handleRemoveSkill}
                onOpenSkillLibrary={handleOpenSkillLibrary}
                actionPosition="extras"
              />

              {/* 技能和示例区域 */}
              {messageList.length === 0 && !isStreaming && !isInitializing && (
                <div className="pt-4 relative">
                  {/* 技能按钮 */}
                  <div className="flex items-center justify-center gap-2 flex-wrap">
                    {skillList.map((skill: any) => (
                      <div
                        key={skill.skill_id || skill.id}
                        role="button"
                        tabIndex={0}
                        className="max-w-[132px] h-10 px-4 rounded-full border border-[#E6E8EB] flex items-center gap-1.5 cursor-pointer hover:bg-[#F2F3F5] transition-all"
                        onClick={() =>
                          handleSelectSkill(skill.display_name, "explore")
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectSkill(skill.display_name, "explore");
                          }
                        }}
                      >
                        <span className="text-sm truncate">
                          {skill.display_name}
                        </span>
                      </div>
                    ))}
                    <div
                      role="button"
                      tabIndex={0}
                      className="h-10 px-4 rounded-full border border-[#E6E8EB] flex items-center gap-1 cursor-pointer hover:bg-[#F2F3F5] transition-all"
                      onClick={() => setShowMySkillsPanel(true)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setShowMySkillsPanel(true);
                        }
                      }}
                    >
                      <span className="text-sm">{t("work_ai.more")}</span>
                      <DownOutlined style={{ fontSize: "14px" }} />
                    </div>
                  </div>

                  {/* 我的技能弹窗 */}
                  {showMySkillsPanel && (
                    <div className="absolute top-0 left-0 right-0 mb-2 bg-[#F9FAFCFF] rounded-b-xl border border-[#E6E8EB] shadow-lg">
                      <div className="flex items-center justify-between px-4 py-3">
                        <span className="text-sm text-[#9CA3AF]">我的技能</span>
                        <div className="flex items-center gap-4">
                          <div
                            role="button"
                            tabIndex={0}
                            className="flex items-center gap-1 text-sm text-[#9CA3AF] hover:text-[#2563EB] transition-colors cursor-pointer"
                            onClick={handleOpenSkillLibrary}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleOpenSkillLibrary();
                              }
                            }}
                          >
                            <SvgIcon name="skills" size={14} />
                            前往技能库
                          </div>
                          <div
                            role="button"
                            tabIndex={0}
                            className="size-5 flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7] rounded"
                            onClick={() => setShowMySkillsPanel(false)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setShowMySkillsPanel(false);
                              }
                            }}
                          >
                            <SvgIcon name="close" size={14} color="#9CA3AF" />
                          </div>
                        </div>
                      </div>
                      {mySkillList.length > 0 ? (
                        <div className="pl-2 pr-4 pb-4 grid grid-cols-6 gap-3">
                          {mySkillList.map((skill: any) => (
                            <div
                              key={skill.display_name}
                              role="button"
                              tabIndex={0}
                              className={`flex items-center gap-2 p-2 rounded-lg transition-all ${
                                skill.binding_status === "enabled"
                                  ? "cursor-pointer hover:bg-[#F5F5F7]"
                                  : "cursor-not-allowed opacity-50"
                              }`}
                              onClick={() => {
                                if (skill.binding_status === "enabled") {
                                  handleSelectSkill(skill.display_name, "my");
                                  setShowMySkillsPanel(false);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (
                                  (e.key === "Enter" || e.key === " ") &&
                                  skill.binding_status === "enabled"
                                ) {
                                  e.preventDefault();
                                  handleSelectSkill(skill.display_name, "my");
                                  setShowMySkillsPanel(false);
                                }
                              }}
                            >
                              <div className="size-8 bg-[#F0F2F5] rounded flex items-center justify-center shrink-0">
                                <SvgIcon
                                  name="skill"
                                  size={18}
                                  color="#2563EB"
                                />
                              </div>
                              <span className="text-sm truncate">
                                {skill.display_name}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="w-full text-center text-sm py-4">
                          <Empty
                            description="没有更多技能"
                            image={getPublicPath(
                              "/images/chat/completion_empty.png",
                            )}
                            imageStyle={{ height: 80 }}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* 示例问题 */}
                  {EXAMPLE_QUESTIONS.length > 0 && (
                    <>
                      <div className="text-sm text-[#1D1E1F] mt-10 mb-3">
                        {t("work_ai.suggested_questions")}
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        {EXAMPLE_QUESTIONS.map((example) => (
                          <div
                            key={example.id}
                            className="py-3 px-5 rounded-xl border border-[#E6E8EB] cursor-pointer hover:bg-[#F2F3F5] transition-all"
                            onClick={() =>
                              handleSend({ textContent: example.content })
                            }
                          >
                            <OverflowTooltip multiline>
                              <span className="text-[13px] text-[#6B7280] line-clamp-2">
                                {example.content}
                              </span>
                            </OverflowTooltip>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
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

      {/* ============ 文件预览面板 ============ */}
      {filePreviewState.visible && (
        <div className="w-1/2 h-full border-l flex flex-col bg-white">
          <div className="flex items-center gap-2 px-4 py-3 border-b">
            {filePreviewState.currentFile.icon && (
              <img
                src={filePreviewState.currentFile.icon}
                className="size-5"
                alt=""
              />
            )}
            <div className="flex-1 text-base text-[#1D1E1F] truncate">
              {filePreviewState.currentFile.name || "--"}
            </div>
            {(filePreviewState.currentFile.id ||
              filePreviewState.currentFile.file_url) && (
              <Button
                color="primary"
                variant="link"
                onClick={handleDownloadFile}
              >
                {t("action.download")}
                <SvgIcon name="download" size={14} />
              </Button>
            )}
            {filePreviewState.currentFile.library_id &&
              filePreviewState.currentFile.id && (
                <Button
                  color="primary"
                  variant="link"
                  onClick={handleViewFileDetail}
                >
                  {t("work_ai.view_document")}
                  <SvgIcon name="share" size={14} />
                </Button>
              )}
            <div
              className="size-7 cursor-pointer rounded flex items-center justify-center hover:bg-[#F5F5F7]"
              onClick={closeFilePreview}
            >
              <SvgIcon name="close" />
            </div>
          </div>
          <div className="flex-1 overflow-hidden">
            {filePreviewState.loading ? (
              <div className="flex-1 flex items-center justify-center">
                <Spin size="large" />
              </div>
            ) : filePreviewState.isOutput ? (
              <FileViewer
                url={filePreviewState.currentFile.file_url}
                extension={filePreviewState.currentFile.file_ext}
              />
            ) : (
              <FileViewerWrapper
                currentFile={filePreviewState.currentFile}
                content={filePreviewState.fileContent}
              />
            )}
          </div>
        </div>
      )}

      {/* ============ 思考知识库侧边栏 ============ */}
      <SidePanel side="right" width={418} open={showThinkKnowledge}>
        <div className="h-full border-l">
          <ThinkKnowledge
            ref={thinkKnowledgeRef}
            onClose={() => setShowThinkKnowledge(false)}
          />
        </div>
      </SidePanel>

      {/* 用户记忆侧边栏 */}
      {showUserMemory && (
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
      )}

      {/* ============ 添加回答为MD ============ */}
      <AddAnswerAsMd ref={addAnswerAsMdRef} />
    </div>
  );
}

export default IndexChatView;
