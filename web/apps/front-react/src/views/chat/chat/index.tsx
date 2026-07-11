import {
  useState,
  useMemo,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Checkbox, Tooltip, message } from "antd";
import {
  LeftOutlined, CloseOutlined,
  DownOutlined
} from "@ant-design/icons";
import { SvgIcon } from "@km/shared-components-react";
import { useAgentStore } from "@/stores/modules/agent";
import { useConversationStore } from "@/stores/modules/conversation";
import { useCurrentAgent } from "@/stores/modules/agent";
import { useEnterpriseStore, useIsSoftStyle } from "@/stores/modules/enterprise";
import { useShortcutsStore } from "@/stores/modules/shortcuts";
import { useChatSend } from "@/composables/useChatSend";
import { useChatStream } from "@/composables/useChatStream";
import { useRagStats } from "@/composables/useRagStats";
import { t } from "@/locales";
import { copyToClip } from "@km/shared-utils";
import { checkPermission } from "@/utils/permission";
import { API_HOST } from "@/api/host";
import conversationApi, {
  ConversationType,
} from "@/api/modules/conversation/index";
import uploadApi from "@/api/modules/upload";
import { sharesApi } from "@/api/modules/share";
import { buildUrl } from "@/utils/router";
import AgentTooltip from "./components/agent-tooltip";
import ChatHistory, { ChatHistoryRef } from "./components/history";
import ChatHelper from "../helper";
import { Sender, ShareHeader, SenderRef } from "@/components/Chat";
import { ExpandSidebarButton } from "@/components/Layout/ExpandSidebarButton";
import {
  BubbleList,
  BubbleListRef,
  BubbleUser,
  BubbleAssistant,
} from "@km/hub-ui-x-react";
import RelatedScene from "@/components/RelatedScene";
import AuthTagGroup from "@/components/AuthTagGroup";
import MoreDropdown from "@/components/MoreDropdown";
import { MessageMenu } from "@/components/Chat/MessageMenu";
import { getPublicPath } from "@/utils/config";
import { isOpenClawCompatibleChannelType } from "@km/shared-business/agent-create";
import "./Chat.css";

const DEFAULT_IMG = "/images/default_agent.png";

interface ChatIndexProps {
  hideMenuHeader?: boolean;
  showRecommend?: boolean;
  useCaseFixed?: boolean;
  hideBottomActions?: boolean;
}

export interface ChatIndexRef {
  showUseCase: () => void;
  hideUseCase: () => void;
  showShare: () => void;
}

interface ExtendedMessage extends Conversation.Message {
  isNew?: boolean;
  query?: string;
  user_files?: any[];
  reasoning_content?: string;
  reasoning_expanded?: boolean;
  rag_stats?: any;
  rag_search_text?: string;
  rag_temp?: {
    type: string;
    document_search?: any;
    document_quotations?: any;
    file_quotations?: any;
  };
  skillRunItems?: any[];
  specified_files?: any[];
}

interface Link {
  id: string;
  name: string;
  type: "agent" | "file" | "knowledge";
  library_id?: number;
}

const DISPLAY_MODE = {
  CHAT: "chat",
  SHARE: "share",
} as const;

const ERROR_INFO = {
  UPSTREAM_ERROR: "upstream_error",
  TOKEN_FAILED: "token验证失败",
  BAD_REQUEST: "BadRequest",
  PARAM_FAILED: "请求参数有误",
  AUTH_ERROR: "authentication_error",
  INVALID_REQUEST_ERROR: "invalid_request_error",
  RESOURCE_NOT_FOUND: "Resource not found",
  Unauthorized: "Unauthorized",
  InvalidApiKey: "InvalidApiKey",
} as const;

const ERROR_TYPES = [
  ERROR_INFO.UPSTREAM_ERROR,
  ERROR_INFO.BAD_REQUEST,
  ERROR_INFO.AUTH_ERROR,
  ERROR_INFO.INVALID_REQUEST_ERROR,
  ERROR_INFO.Unauthorized,
];

const ERROR_MESSAGES = [
  ERROR_INFO.TOKEN_FAILED,
  ERROR_INFO.PARAM_FAILED,
  ERROR_INFO.RESOURCE_NOT_FOUND,
];

const INVALID_AGENT_TYPES = [
  "coze_agent_cn",
  "fastgpt_agent",
  "app_builder",
  "tencent",
  "maxkb_agent",
  "dify_agent",
  "prompt",
];

const isParsedAnswerError = (obj: any): boolean => {
  const type = obj?.error?.type;
  const msg = obj?.error?.message;
  if (ERROR_TYPES.includes(type) || ERROR_MESSAGES.includes(msg)) return true;
  if (obj?.status === 401) return true;
  if (obj?.code === ERROR_INFO.InvalidApiKey) return true;
  return false;
};

const isParsedAnswerCatchError = (text: string): boolean => {
  if (!text) return false;
  if (text.startsWith("Upstream Error")) return true;
  if (text.includes("App access denied")) return true;
  return false;
};

const handleImageError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const target = e.target as HTMLImageElement;
  const fallback = getPublicPath(DEFAULT_IMG);
  if (target.src.endsWith(fallback)) return;
  target.src = fallback;
};

const ChatIndex = forwardRef<ChatIndexRef, ChatIndexProps>(
  (
    {
      hideMenuHeader = false,
      showRecommend = false,
      useCaseFixed = false,
      hideBottomActions = false,
    },
    ref,
  ) => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const agentStore = useAgentStore();
    const convStore = useConversationStore();
    const enterpriseStore = useEnterpriseStore();
    const shortcutsStore = useShortcutsStore();
    const isSoftStyle = useIsSoftStyle();
    const historyRef = useRef<ChatHistoryRef>(null);
    const senderRef = useRef<SenderRef>(null);
    const bubbleListRef = useRef<BubbleListRef>(null);
    const resizeObserverRef = useRef<ResizeObserver | null>(null);
    const skipNextLoadRef = useRef(false); // 跳过创建新对话后的重复加载

    const { sendMessage: sendMessageViaApi, handleStop: chatSendHandleStop } =
      useChatSend();
    const { processStreamData, clearBuffer } = useChatStream();
    const { formatRagStats } = useRagStats();

    // State
    const [showHelper, setShowHelper] = useState(false);
    const [messageList, setMessageList] = useState<ExtendedMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isLoadingMore, setIsLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const [displayMode, setDisplayMode] = useState<"chat" | "share">(
      DISPLAY_MODE.CHAT,
    );
    const [selectMessageIds, setSelectMessageIds] = useState<
      (string | number)[]
    >([]);
    const [selectAll, setSelectAll] = useState(false);
    const [links, setLinks] = useState<Link[]>([]);

    const limit = 10;

    // Computed - 使用 Zustand selector 订阅状态变化
    const currentConversationId = useConversationStore(
      (state) => state.current_conversationid,
    );
    const conversations = useConversationStore((state) => state.conversations);

    const currentAgent = useCurrentAgent();
    const currentConv = useMemo(() => {
      // conversation_id 可以是字符串或数字，统一使用字符串比较
      const targetId = String(currentConversationId);
      const conversation = conversations.find(
        (item) => String(item.conversation_id) === targetId,
      );
      if (conversation) {
        return conversation;
      }
      // 如果找不到会话但设置了 currentConversationId，返回包含该 ID 的虚拟对象
      // 这样 useEffect 能检测到 conversation_id 变化并加载消息
      if (
        currentConversationId &&
        currentConversationId !== 0 &&
        currentConversationId !== "0"
      ) {
        return {
          conversation_id: currentConversationId,
          title: "",
          virtual_id: Date.now().toString(),
        };
      }
      return {
        conversation_id: 0,
        title: "",
        virtual_id: "",
      };
    }, [conversations, currentConversationId]);
    const customConfigObj = useMemo(
      () => currentAgent?.custom_config_obj || {},
      [currentAgent],
    );
    const settingsObj = useMemo(
      () => currentAgent?.settings_obj || {},
      [currentAgent],
    );

    const enableUpload = useMemo(
      () =>
        Boolean(
          settingsObj?.file_parse?.enable ||
          settingsObj?.image_parse?.enable,
        ),
      [settingsObj],
    );
    const uploadAccept = useMemo(() => {
      let accept = "";
      if (settingsObj?.file_parse?.enable)
        accept +=
          ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.html,.json,.xml,.md";
      if (settingsObj?.image_parse?.enable) accept += ",image/*";
      return accept;
    }, [settingsObj]);
    const allowSendWithFiles = useMemo(() => {
      return ["53ai_agent", "fastgpt_agent"].includes(
        customConfigObj?.agent_type,
      );
    }, [customConfigObj]);

    const relatedAgentList = useMemo(() => {
      return agentStore.agentList
        .filter((item) => item.agent_id !== currentAgent?.agent_id)
        .slice(0, 4);
    }, [agentStore.agentList, currentAgent?.agent_id]);

    const showWelcome = useMemo(() => {
      const settings = currentAgent?.settings_obj;
      if (!settings) return false;
      if (
        settings.opening_statement &&
        settings.opening_statement.replace(/\s/g, "")
      )
        return true;
      if (
        settings.suggested_questions &&
        settings.suggested_questions.length &&
        settings.suggested_questions.some((item: any) =>
          item.content?.replace(/\s/g, ""),
        )
      ) {
        return true;
      }
      return false;
    }, [currentAgent?.settings_obj]);

    const isShortcut = useMemo(() => {
      if (!currentAgent?.agent_id) return false;
      return shortcutsStore.isShortcut("agent", currentAgent?.agent_id);
    }, [currentAgent?.agent_id, shortcutsStore]);

    const isShareMode = useMemo(
      () => displayMode === DISPLAY_MODE.SHARE,
      [displayMode],
    );

    const displayMessageList = useMemo(() => {
      return messageList.map((m: any) => {
        // 确保 query 是字符串
        let query = m.query ?? m.question ?? "";
        if (typeof query === "object" && query !== null) {
          query =
            query.textContent || query.pureTextContent || JSON.stringify(query);
        }
        return {
          ...m,
          query: String(query),
        };
      });
    }, [messageList]);

    // Handle back navigation
    const handleBack = useCallback(() => {
      const from = searchParams.get("from");
      if (from === "my") {
        navigate({ pathname: "/agent", search: "?from=my" });
      } else {
        navigate("/agent");
      }
    }, [navigate, searchParams]);

    // Message utilities
    const messageUtils = useMemo(
      () => ({
        formatMessage: (item: any): ExtendedMessage => {
          const data: any = {
            ...item,
            query: "",
          };
          const messageContent = item.message
            ? JSON.parse(item.message)[0]
            : {};
          const { content } = messageContent || {};
          try {
            const parsedAnswer = data.answer && JSON.parse(data.answer);
            if (parsedAnswer && typeof parsedAnswer === "object") {
              if (isParsedAnswerError(parsedAnswer)) {
                data.answer = t("agent.failed_tip");
              }
            } else if (
              (!parsedAnswer &&
                INVALID_AGENT_TYPES.includes(
                  currentAgent?.custom_config_obj?.agent_type,
                )) ||
              (typeof parsedAnswer === "string" &&
                parsedAnswer.includes("Invalid token"))
            ) {
              data.answer = t("agent.failed_tip");
            }
          } catch (err) {
            if (isParsedAnswerCatchError(data.answer)) {
              data.answer = t("agent.failed_tip");
            }
          }
          try {
            const arr = content ? JSON.parse(content) : [];
            const query = arr.find(
              (item: any) => item.type === "text",
            )?.content;
            // 确保 query 是字符串
            data.query =
              typeof query === "object"
                ? query.textContent || query.pureTextContent || ""
                : query;
            data.uploaded_files = arr.filter(
              (item: any) => item.type === "image",
            );
          } catch (error) {
            // 确保 query 是字符串
            data.query =
              typeof content === "object"
                ? content.textContent || content.pureTextContent || ""
                : content;
          }
          return data;
        },

        formatFiles: (user_files: any[]): Conversation.UserFile[] =>
          user_files?.map((item) => ({
            type: "image",
            content: `file_id:${item.id}`,
            filename: item.name,
            size: item.size,
            mime_type: item.mime_type,
            url: item.url,
          })) || [],
      }),
      [currentAgent],
    );

    // Load messages
    const loadMessages = useCallback(
      async (
        conversation_id: number | string,
        offset: number,
        limit: number,
      ) => {
        try {
          const res = await conversationApi.messasges(String(conversation_id), {
            offset,
            limit,
          });
          const list = res.data.messages.map(msg => ({
            ...messageUtils.formatMessage(msg),
            conversation_id,
          }));
          return {
            messages: list,
            hasMore: list.length === limit,
          };
        } catch (err) {
          console.error("Failed to load messages:", err);
          return { messages: [], hasMore: false };
        }
      },
      [messageUtils],
    );

    const handleLoadListMore = useCallback(async () => {
      if (isLoadingMore || !hasMore) return;

      const conversationId = currentConversationId;
      if (!conversationId || conversationId === 0 || conversationId === "0")
        return;

      setIsLoadingMore(true);
      const newOffset = offset + limit;
      setOffset(newOffset);

      try {
        const { messages, hasMore: more } = await loadMessages(
          conversationId,
          newOffset,
          limit,
        );
        setHasMore(more);
        setMessageList((prev) => [...messages, ...prev]);
      } catch (err) {
        setOffset((prev) => Math.max(0, prev - limit));
      } finally {
        setIsLoadingMore(false);
      }
    }, [
      isLoadingMore,
      hasMore,
      currentConversationId,
      offset,
      loadMessages,
      limit,
    ]);

    const loadList = useCallback(
      async (conversationId?: number | string) => {
        const targetId = conversationId || currentConversationId;
        // conversation_id 可以是字符串或数字，只要不是 0 或空值就有效
        if (!targetId || targetId === 0 || targetId === "0") return;

        setIsLoadingMore(true);
        setOffset(0);
        setHasMore(true);

        try {
          const { messages, hasMore: more } = await loadMessages(
            targetId,
            0,
            limit,
          );
          setHasMore(more);
          setMessageList(messages);
        } finally {
          setIsLoadingMore(false);
        }
      },
      [currentConversationId, loadMessages, limit],
    );

    // HTTP request for file upload
    const httpRequest = useCallback(
      (dataFile: File): Promise<any> => {
        return new Promise((resolve, reject) => {
          const isPermission = checkPermission({
            groupIds: currentAgent?.user_group_ids || [],
            onClick: async () => {
              try {
                const res = await uploadApi.upload(dataFile, "my_uploads");
                resolve({
                  id: res.data.id,
                  url: `${API_HOST}/api/preview/${res.data.preview_key || ""}`,
                  size: res.data.size,
                  name: res.data.file_name,
                  mime_type: res.data.mime_type,
                });
              } catch (error) {
                reject(error);
              }
            },
          });
          if (!isPermission) {
            reject(new Error(t("authority.login_not_permission")));
          }
        });
      },
      [currentAgent],
    );

    // Send message
    const sendMessage = useCallback(
      async (
        query: string,
        user_files: Conversation.UserFile[],
        providedConversationId?: string,
      ) => {
        if (isStreaming) return;

        const { agent_id } = currentAgent;
        const conversation_id =
          providedConversationId || currentConversationId;
        const configs = JSON.parse(currentAgent?.configs || "{}");
        const completion_params = configs.completion_params || {};

        setIsStreaming(true);
        try {
          await sendMessageViaApi({
            question: query,
            agent_id,
            conversation_id,
            messageList: [],
            completion_params,
            files: user_files || [],
            agentInfo: currentAgent,
            minimalParams: true,
            type: "agent",
            onMessageListChange: (updater) => setMessageList(updater),
          });
        } catch (err: any) {
          if (err?.message !== "canceled") {
            message.warning(t("agent.failed_tip"));
          }
        } finally {
          setIsStreaming(false);
        }
      },
      [isStreaming, currentAgent, currentConversationId, sendMessageViaApi],
    );

    // Handlers
    const handleSend = useCallback(
      (
        data:
          | { textContent?: string; pureTextContent?: string; files?: any[] }
          | string,
        user_files: any[] = [],
      ) => {
        // 兼容 Sender 组件传递的对象格式和直接传递字符串的情况
        const question =
          typeof data === "string"
            ? data
            : data.textContent || data.pureTextContent || "";
        const files =
          typeof data === "string" ? user_files : data.files || user_files;

        checkPermission({
          groupIds: currentAgent?.user_group_ids || [],
          onClick: async () => {
            const { agent_id } = currentAgent;
            const from = searchParams.get("from") || "";
            // 判断是否为 Openclaw 渠道类型
            const isOpenclaw = isOpenClawCompatibleChannelType(currentAgent?.channel_type);
            if (!agent_id) {
              message.warning(t("chat.no_available_agent"));
              return;
            }
            const conversationIdNum = currentConversationId;
            if (!conversationIdNum || conversationIdNum === 0) {
              try {
                // from === 'my' 或 Openclaw 智能体使用 FORMAL 类型
                const conversation_type =
                  from === "my" || isOpenclaw ? ConversationType.FORMAL : undefined;
                const conversation = await convStore.createConversation(
                  agent_id,
                  question,
                  "",
                  conversation_type,
                );
                convStore.addConversation({
                  ...conversation,
                  virtual_id: Date.now().toString(),
                });
                // 设置标记，跳过 useEffect 中因 conversation_id 变化触发的 loadList
                skipNextLoadRef.current = true;
                convStore.setCurrentState(
                  conversation.agent_id,
                  conversation.conversation_id,
                );
                await sendMessage(
                  question,
                  messageUtils.formatFiles(files),
                  conversation.conversation_id,
                );
                return true;
              } catch (err) {
                console.error("Failed to create conversation:", err);
              }
            }
            await sendMessage(question, messageUtils.formatFiles(files));
            return true;
          },
        });
      },
      [
        currentAgent,
        currentConversationId,
        convStore,
        sendMessage,
        messageUtils,
        searchParams,
      ],
    );

    const handleNewConversation = useCallback(() => {
      convStore.setCurrentState(currentAgent?.agent_id || 0, 0);
      setMessageList([]);
      setOffset(0);
      setHasMore(true);
    }, [convStore, currentAgent]);

    const handleHistory = useCallback(() => {
      historyRef.current?.open();
    }, []);

    const handleStop = useCallback(() => {
      chatSendHandleStop();
      setIsStreaming(false);
    }, [chatSendHandleStop]);

    const handleRegenerate = useCallback(
      async (msg: ExtendedMessage) => {
        const question = msg.query ?? msg.question ?? "";
        const files =
          msg.uploaded_files ??
          (msg.specified_files?.length
            ? messageUtils.formatFiles(msg.specified_files)
            : []);
            
        const conversationId = currentConversationId || currentConv?.conversation_id;
        await sendMessage(question, files, conversationId);
      },
      [sendMessage, messageUtils, currentConversationId],
    );

    const handleSuggestion = useCallback(
      (suggestion: string) => {
        handleSend(suggestion, []);
      },
      [handleSend],
    );

    const handleOpenShare = useCallback(
      (msg?: ExtendedMessage) => {
        setSelectAll(false);
        setSelectMessageIds([]);
        if (msg) {
          setDisplayMode(DISPLAY_MODE.SHARE);
        } else {
          setDisplayMode(
            displayMode === DISPLAY_MODE.SHARE
              ? DISPLAY_MODE.CHAT
              : DISPLAY_MODE.SHARE,
          );
        }
      },
      [displayMode],
    );

    const handleSelectAll = useCallback(() => {
      if (displayMode === DISPLAY_MODE.SHARE) {
        setSelectMessageIds(
          selectAll ? [] : messageList.map((item) => item.id),
        );
        setSelectAll(!selectAll);
      }
    }, [displayMode, selectAll, messageList]);

    const handleSelectMessage = useCallback(
      (msg: ExtendedMessage) => {
        if (displayMode === DISPLAY_MODE.SHARE) {
          if (selectMessageIds.includes(msg.id)) {
            setSelectMessageIds((prev) => prev.filter((id) => id !== msg.id));
            setSelectAll(false);
          } else {
            setSelectMessageIds((prev) => [...prev, msg.id]);
          }
        }
      },
      [displayMode, selectMessageIds],
    );

    const handleCreateShare = useCallback(() => {
      const conversationId =
        currentConversationId || currentConv?.conversation_id;
      if (!conversationId) return;
      return sharesApi
        .create({
          message_ids: selectMessageIds,
          conversation_id: conversationId,
          select_all: selectAll,
        })
        .then((res: any) => {
          const link = buildUrl(
            `/share/chat?share_id=${res.share_id}&from=agent`,
          );
          copyToClip(link).then(() => {
            message.success(t("chat.completion_share_link"));
          });
          setDisplayMode(DISPLAY_MODE.CHAT);
        });
    }, [
      selectMessageIds,
      currentConversationId,
      currentConv?.conversation_id,
      selectAll,
    ]);

    const handleToggleGuide = useCallback(() => {
      setShowHelper((prev) => !prev);
    }, []);

    const onSelectAgent = useCallback(
      (agent: Agent.State) => {
        // 判断是否为 Openclaw 渠道类型
        const isOpenclaw = isOpenClawCompatibleChannelType(agent.channel_type);

        if (isOpenclaw) {
          // Openclaw 智能体：通过 navigate 更新 URL 参数
          navigate({
            pathname: '/chat',
            search: `?agent_id=${agent.agent_id}&hide_bottom_actions=true&type=openclaw`,
          });
        } else {
          // 其他智能体：清除 type=openclaw 参数，恢复完整功能
          navigate({
            pathname: '/chat',
            search: `?agent_id=${agent.agent_id}`,
          });
        }
      },
      [navigate],
    );

    const handleMore = useCallback(
      async (command: string) => {
        if (command === "add-shortcut") {
          await shortcutsStore.addShortcut(
            "agent",
            convStore.current_agentid.toString(),
          );
        } else if (command === "remove-shortcut") {
          await shortcutsStore.removeShortcut(
            "agent",
            convStore.current_agentid.toString(),
          );
        }
      },
      [shortcutsStore, convStore],
    );

    const handleHeightChange = useCallback(
      (height: number) => {
        agentStore.setBoxHeight(height);
      },
      [agentStore],
    );

    // Expose methods via ref
    useImperativeHandle(
      ref,
      () => ({
        showUseCase: () => setShowHelper(true),
        hideUseCase: () => setShowHelper(false),
        showShare: () => handleOpenShare(),
      }),
      [handleOpenShare],
    );

    // Effects
    useEffect(() => {
      // 跳过创建新对话后的重复加载（sendMessage 已通过 onMessageListChange 更新了消息列表）
      if (skipNextLoadRef.current) {
        skipNextLoadRef.current = false;
        return;
      }
      // conversation_id 可以是字符串或数字
      const conversationId = currentConversationId;
      if (conversationId && conversationId !== 0 && conversationId !== "0") {
        loadList(conversationId);
      } else {
        // conversation_id 为 0 时清空消息列表（新建对话场景）
        setMessageList([]);
        setOffset(0);
        setHasMore(true);
      }
    }, [currentConversationId, loadList]);

    // Handle next_agent_prepare
    useEffect(() => {
      const prepare = convStore.next_agent_prepare;
      if (prepare.agent_id) {
        const question = prepare.parameters?.input || "";
        if (question) {
          senderRef.current?.setPrompt(question);
        }
        if (prepare.execution_rule === "auto") {
          senderRef.current?.setPrompt("");
          handleSend(question, []);
        }
        convStore.setNextAgentPrepare({});
      }
    }, [convStore.next_agent_prepare, handleSend]);

    // ResizeObserver setup - 对齐 Vue 版本
    useEffect(() => {
      const el = bubbleListRef.current?.getWrapperElement?.();
      if (!el) return;

      resizeObserverRef.current = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { height } = entry.contentRect;
          handleHeightChange(height);
        }
      });

      resizeObserverRef.current.observe(el);

      return () => {
        resizeObserverRef.current?.disconnect();
      };
    }, [handleHeightChange]);

    return (
      <div className="flex flex-col min-h-full">
        {/* Share Header */}
        {isShareMode && (
          <ShareHeader
            showRecommend={showRecommend}
            selectAll={selectAll}
            selectMessageIds={selectMessageIds}
            onSelectAll={handleSelectAll}
            onCreateShare={handleCreateShare}
            onOpenShare={() => handleOpenShare()}
          />
        )}

        {/* Header */}
        {!hideMenuHeader && !isShareMode && (
          <header className="flex-none h-[70px] border-b sticky top-0 z-10 bg-white">
            <div className="mx-auto px-4 flex items-center justify-between h-full">
              <div className="flex-1 flex items-center gap-2 overflow-hidden">
                {isSoftStyle && <ExpandSidebarButton />}
                <Tooltip title={t("action.back")}>
                  <div
                    className="flex-none size-7 rounded-md flex-center cursor-pointer max-md:hidden hover:bg-[#ECEDEE]"
                    onClick={handleBack}
                  >
                    <LeftOutlined className="text-regular cursor-pointer" />
                  </div>
                </Tooltip>
                <div
                  className="text-base text-primary line-clamp-1 max-md:flex-1 max-md:text-center"
                  title={currentConv?.title || currentAgent?.name || ""}
                >
                  {currentConv?.title || currentAgent?.name || ""}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {/* Mobile back button */}
                <span
                  className="flex items-center gap-1 text-sm cursor-pointer md:hidden"
                  onClick={() => navigate(-1)}
                >
                  <SvgIcon name="return" size={18} stroke />
                </span>
                {messageList.length > 0 && (
                  <Tooltip title={t("action.share")}>
                    <div
                      className="h-6 px-1 rounded flex-center gap-1 cursor-pointer hover:bg-[#E1E2E3] text-[#4F5052]"
                      onClick={() => handleOpenShare()}
                    >
                      <SvgIcon
                        name="share-two"
                        size={18}
                        color="#4F5052"
                        stroke
                      />
                    </div>
                  </Tooltip>
                )}
                <Tooltip title={t("chat.usage_guide")}>
                  <div
                    className="h-6 px-1 rounded flex-center gap-1 cursor-pointer hover:bg-[#E1E2E3]"
                    onClick={handleToggleGuide}
                  >
                    <SvgIcon name="layout-split" size={18} />
                  </div>
                </Tooltip>
                <MoreDropdown
                  items={[
                    !isShortcut
                      ? {
                          key: "add-shortcut",
                          icon: "add-mode",
                          label: t("shortcut.add"),
                        }
                      : {
                          key: "remove-shortcut",
                          icon: "delete-mode",
                          label: t("shortcut.remove"),
                        },
                  ].filter(Boolean)}
                  onCommand={handleMore}
                />
              </div>
            </div>
          </header>
        )}

        {/* Message List */}
        <div className="flex-1 flex mt-5">
          <BubbleList
            ref={bubbleListRef}
            autoScroll={false}
            messages={displayMessageList}
            className="flex-1"
            mainClass={
              showRecommend
                ? "w-[95%]"
                : "w-11/12 lg:w-4/5 max-w-[800px] mx-auto"
            }
            enablePullUp={hasMore && !isLoadingMore}
            onPullUp={handleLoadListMore}
          >
            {/* Welcome Header - 对齐 Vue #header slot */}
            {currentAgent?.settings_obj && messageList.length === 0 && (
              <>
                <div
                  className="w-full mt-2 flex items-center gap-3 box-border p-6 rounded-xl overflow-hidden"
                  style={{
                    background:
                      "linear-gradient(90deg, rgba(243, 249, 254, 1) 0%, rgba(247, 243, 255, 1) 100%)",
                  }}
                >
                  <img
                    className="flex-none size-10 rounded-full overflow-hidden"
                    src={currentAgent.logo}
                    alt={currentAgent.name}
                    onError={handleImageError}
                  />
                  <div className="flex-1 flex flex-col gap-1">
                    <div className="text-xl font-semibold text-primary">
                      {currentAgent.name}
                    </div>
                    <div className="text-sm text-regular break-words whitespace-pre-wrap">
                      {currentAgent.description}
                    </div>
                  </div>
                </div>
                <div className="mt-2 mb-10">
                  {!hideBottomActions && (
                    <AuthTagGroup value={currentAgent.user_group_ids || []} />
                  )}
                  {hideBottomActions && (
                    <div className="max-w-[520px] mt-5 mb-3 px-4 py-3 bg-[#F4F5F7] rounded-xl">
                      现在就在下方输入第一条消息，无需任何繁琐配置，直接开启对话。
                    </div>
                  )}
                </div>
                {showWelcome && (
                  <BubbleAssistant
                    type="welcome"
                    content={currentAgent.settings_obj.opening_statement}
                    suggestions={currentAgent.settings_obj.suggested_questions}
                    onSuggestion={handleSuggestion}
                  />
                )}
              </>
            )}

            {/* Messages - 对齐 Vue #item slot */}
            {displayMessageList.map((msg, index) => (
              <div key={msg.id}>
                {/* User Message */}
                <div
                  className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
                  onClick={() => handleSelectMessage(msg)}
                >
                  {isShareMode && (
                    <Checkbox checked={selectMessageIds.includes(msg.id)} />
                  )}
                  <div className="flex-1">
                    <BubbleUser
                      content={msg.query || ""}
                      files={msg.uploaded_files || msg.specified_files}
                      menu={
                        !isShareMode ? (
                          <MessageMenu type="user" content={msg.query || ""} />
                        ) : undefined
                      }
                    />
                  </div>
                </div>

                {/* Assistant Message */}
                <div
                  className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
                  onClick={() => handleSelectMessage(msg)}
                >
                  {isShareMode && (
                    <Checkbox checked={selectMessageIds.includes(msg.id)} />
                  )}
                  <div className="flex-1">
                    <BubbleAssistant
                      content={msg.answer}
                      streaming={msg.loading}
                      reasoning={msg.reasoning_content}
                      reasoningExpanded={msg.reasoning_expanded}
                      name={currentAgent?.name}
                      alwaysShowMenu={index === messageList.length - 1}
                      menu={
                        !msg.loading && !isShareMode ? (
                          <MessageMenu
                            type="assistant"
                            content={msg.answer}
                            showShare={true}
                            showAddMd={false}
                            showFeedback={false}
                            onRegenerate={() => handleRegenerate(msg)}
                            onShare={() => handleOpenShare(msg)}
                          />
                        ) : undefined
                      }
                    />
                  </div>
                </div>

                {/* Related Scene */}
                {index === messageList.length - 1 &&
                  !msg.loading &&
                  !isShareMode && <RelatedScene output={msg.answer} />}
              </div>
            ))}
          </BubbleList>

          {/* Recommend Panel */}
          {showRecommend && (
            <div
              className={`flex-none w-2/6 flex flex-col gap-4 pb-5 ${isShareMode ? "-mt-[70px]" : ""}`}
            >
              <h2 className="flex-none text-base font-semibold text-regular">
                {t("common.related_agent")}
              </h2>
              {currentAgent?.agent_id && (
                <div className="flex-1 overflow-y-auto flex flex-col gap-2.5">
                  {relatedAgentList.map((item) => (
                    <div
                      key={item.agent_id}
                      className="flex-none h-24 border rounded p-4 cursor-pointer hover:bg-[#F1F2F3]"
                      onClick={() => onSelectAgent(item)}
                    >
                      <div className="flex items-center gap-2">
                        <img
                          className="size-6 rounded-full"
                          src={item.logo}
                          alt={item.name}
                          onError={handleImageError}
                        />
                        <span className="text-sm text-primary">
                          {item.name}
                        </span>
                      </div>
                      <div
                        className="text-sm text-regular line-clamp-2 mt-1.5"
                        title={item.description}
                      >
                        {item.description || t("common.no_description")}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input Area */}
        {!isShareMode && (
          <div
            className={`py-5 sticky bottom-0 bg-white ${showRecommend ? "w-4/6" : "w-11/12 lg:w-4/5 max-w-[800px] mx-auto"}`}
          >
            {/* 底部操作区域 */}
            <div className="flex gap-2 mb-2.5">
              {/* 智能体切换 - Openclaw 或非 hideBottomActions 时显示 */}
              {(isOpenClawCompatibleChannelType(currentAgent?.channel_type) || !hideBottomActions) && (
                <AgentTooltip onSelect={onSelectAgent}>
                  <div className="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] cursor-pointer hover:bg-[#E1E2E3]">
                    <img
                      className="size-4 rounded-full"
                      src={currentAgent?.logo}
                      alt={currentAgent?.name}
                      onError={handleImageError}
                    />
                    <span className="text-sm text-primary">
                      {currentAgent?.name}
                    </span>
                    <DownOutlined
                      style={{ color: "#333333", fontSize: "14px" }}
                    />
                  </div>
                </AgentTooltip>
              )}

              <div className="flex-1"></div>

              {/* 历史会话和新会话 - 仅非 hideBottomActions 时显示 */}
              {!hideBottomActions && (
                <>
                  <div
                    className="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] text-sm text-primary cursor-pointer hover:bg-[#E1E2E3]"
                    onClick={handleHistory}
                  >
                    <SvgIcon name="history" size={16} />
                    {t("chat.history_conversation")}
                  </div>

                  <div
                    className="h-8 px-2 rounded-full flex-center gap-1.5 bg-[#F1F2F3] text-sm text-primary cursor-pointer hover:bg-[#E1E2E3]"
                    onClick={handleNewConversation}
                  >
                    <SvgIcon name="plus" size={16} />
                    {t("chat.new_conversation")}
                  </div>
                </>
              )}
            </div>

            <Sender
              ref={senderRef}
              showAt={false}
              placeholder={t("chat.input_placeholder")}
              loading={isStreaming}
              links={links}
              onSend={handleSend}
              onStop={handleStop}
              onRemoveLink={(link) =>
                setLinks((prev) => prev.filter((l) => l.id !== link.id))
              }
              enableUpload={enableUpload}
              acceptTypes={uploadAccept}
              httpRequest={httpRequest}
              allowSendWithFiles={allowSendWithFiles}
              allowMultiple
              enableDragUpload
            />

            {/* Copyright */}
            {enterpriseStore.copyright?.toLowerCase() !== "true" && (
              <div className="flex justify-center items-center my-2">
                {/* <img src={getPublicPath('/images/chat/footer.png')} className="h-3" alt="" /> */}
              </div>
            )}
          </div>
        )}

        {/* Helper Panel */}
        {showHelper && (
          <div
            className={`border-l bg-white left-0 right-0 top-0 bottom-0 z-10 overflow-hidden ${useCaseFixed ? "fixed" : "absolute"}`}
          >
            <div className="h-[70px] flex-center border-b relative">
              <h4 className="text-lg text-primary">{t("chat.usage_guide")}</h4>
              <div
                className="flex-center size-6 absolute right-2 top-1/2 -translate-y-1/2 rounded cursor-pointer hover:bg-[#ECEDEE]"
                onClick={handleToggleGuide}
              >
                <CloseOutlined />
              </div>
            </div>
            <ChatHelper agent={currentAgent} />
          </div>
        )}

        <ChatHistory ref={historyRef} onNew={handleNewConversation} />
      </div>
    );
  },
);

ChatIndex.displayName = "ChatIndex";

export default ChatIndex;
