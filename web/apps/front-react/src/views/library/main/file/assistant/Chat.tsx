import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useCallback,
} from "react";
import { Button, Tooltip, Checkbox, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { Sender, MessageMenu } from "@/components/Chat";
import {
  FeedbackPanel,
  RagHeader,
  Quotation,
  SpecifiedFiles,
  ShareHeader,
  Chunk,
  ThinkKnowledge
} from "@km/shared-business/chat";
import { AddAnswerAsMd } from "@/components/Chat/AddAnswerAsMd";
import { ModelView } from "@/components/Model/view";
import { ChatHistoryDrawer } from "./components/ChatHistoryDrawer";
import {
  BubbleList,
  BubbleListRef,
  BubbleUser,
  BubbleAssistant,
} from "@km/hub-ui-x-react";
import { useFileConversationStore } from "./conversation";
import { useUserStore } from "@/stores/modules/user";
import { useSpaceStore } from "@/stores/modules/space";
import { usePoll } from "@/hooks/usePoll";
import {
  useChatMessages,
  useChatSend,
  useChatFeedback,
  useChatShare,
} from "@km/shared-business/chat";
import { getGreetingByTime } from "@km/shared-utils";
import { GROUP_TYPE } from "@/constants/group";
import { RUN_STATUS } from "@/constants/chunk";
import agentsApi from "@/api/modules/agents";
import filesApi from "@/api/modules/files";
import promptApi from "@/api/modules/prompt";
import chunksApi from "@/api/modules/chunks";
import { markdownPreview } from "@/components/Markdown/helper";
import "./Chat.css";

interface ModelItem {
  id: number;
  value: string;
  channel_id: number;
  channel_type: string;
  model: string;
  name: string;
  icon: string;
  temperature: number;
}

interface ChatProps {
  agentInfo: any;
  fileInfo: any;
  autoSelectEnabled?: boolean;
  onOpenAi?: () => void;
}

export interface ChatRef {
  send: (data: { textContent: string; from?: string }) => void;
  collapse: () => void;
}

const ChatAssistant = forwardRef<ChatRef, ChatProps>(
  ({ agentInfo, fileInfo, autoSelectEnabled = false, onOpenAi }, ref) => {
    const userStore = useUserStore();
    const convStore = useFileConversationStore();
    const spaceStore = useSpaceStore();

    // 使用 hooks
    const {
      state: messageState,
      loadMessageList,
      handleLoadListMore: handleLoadListMoreBase,
      handleRegenerate: handleRegenerateBase,
      handleSourceReferenceHover: handleSourceReferenceHoverBase,
      renderSource: renderSourceBase,
      handleOpenKnow,
      clearMessageList,
      updateMessageList,
    } = useChatMessages({ limit: 20, supportSpecifiedContent: true });

    const { sendMessage: sendMessageBase, handleStop: handleStopBase } =
      useChatSend();

    const {
      loadFeedbackConfig,
      handleClickFeedbackBtn: handleClickFeedbackBtnBase,
      handleToggleFeedbackBtn,
      handleCloseFeedback,
      handleSubmitFeedback,
      resetFeedbackSuccessState,
    } = useChatFeedback();

    const {
      state: shareState,
      isShareMode,
      handleSelectAll: handleSelectAllBase,
      handleOpenShare: handleOpenShareBase,
      handleSelectMessage,
      handleCreateShare: handleCreateShareBase,
    } = useChatShare();

    const [isStreaming, setIsStreaming] = useState(false);
    const [model, setModel] = useState("");
    const [showHistory, setShowHistory] = useState(false);
    const [networkSearch, setNetworkSearch] = useState(false);
    const [slideContent, setSlideContent] = useState("");
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [showThinkKnowledge, setShowThinkKnowledge] = useState(false);
    const [viewportWidth, setViewportWidth] = useState(
      typeof window !== "undefined" ? window.innerWidth : 1920,
    );
    const [textContent, setTextContent] = useState("");

    const [agentModels, setAgentModels] = useState<ModelItem[]>([]);
    const [quickCommands, setQuickCommands] = useState<any[]>([]);

    const senderRef = useRef<any>(null);
    const addAnswerAsMdRef = useRef<any>(null);
    const chunkRef = useRef<any>(null);
    const chunkSourceRef = useRef<HTMLElement | null>(null);
    const thinkKnowledgeRef = useRef<any>(null);
    const bubbleListRef = useRef<BubbleListRef>(null);

    const greeting = useMemo(() => getGreetingByTime(), []);

    const currentModel = useMemo(() => {
      return agentModels.find((item) => item.value === model);
    }, [agentModels, model]);

    const currentConv = useMemo(() => {
      return convStore.currentConversation();
    }, [convStore.current_conversationid]);

    const commands = useMemo(() => {
      return slideContent || autoSelectEnabled ? [] : quickCommands;
    }, [slideContent, autoSelectEnabled, quickCommands]);

    const showCommandLength = useMemo(() => {
      if (isCollapsed) return 2;
      return viewportWidth <= 1600 ? 3 : 4;
    }, [isCollapsed, viewportWidth]);

    const loadModels = async () => {
      if (!agentInfo?.agent_id) return;

      try {
        const res = await agentsApi.models.list(agentInfo.agent_id);
        const deepThinkingConfig = agentInfo.settings?.deep_thinking_config || {
          temperature: 0.5,
        };
        const fastReasoningConfig = agentInfo.settings
          ?.fast_reasoning_config || {
          temperature: 0.5,
        };
        // 通过匹配配置来判断是否为深度思考模型（与 Vue 版本保持一致）
        const deepValue =
          deepThinkingConfig.channel_id +
          "_" +
          deepThinkingConfig.channel_type +
          "_" +
          deepThinkingConfig.model_name;

        const models = (res.agent_models || [])
          .map((item: any) => {
            const value =
              item.channel_id + "_" + item.channel_type + "_" + item.model;
            const isDeepThinking = value === deepValue;
            return {
              ...item,
              type: isDeepThinking ? "deep_reasoning" : "fast_reasoning",
              icon: isDeepThinking ? "star-link" : "lightning",
              name: isDeepThinking
                ? t("chat.deep_thinking")
                : t("chat.fast_response"),
              temperature: isDeepThinking
                ? deepThinkingConfig.temperature
                : fastReasoningConfig.temperature,
              value: value,
            };
          })
          .filter(
            (item: any, index: number, self: any[]) =>
              index === self.findIndex((t) => t.type === item.type),
          );

        if (models.length) {
          setModel((models[0] as ModelItem).value);
        }
        setAgentModels(models);
      } catch (error) {
        console.error("Failed to load models:", error);
      }
    };

    const loadQuickCommands = async () => {
      try {
        const res = await promptApi.list({
          group_type: GROUP_TYPE.KM_FILE_CHAT_QUICK_COMMAND,
          limit: 100,
        });
        setQuickCommands(res.prompts || []);
      } catch (error) {
        console.error("Failed to load quick commands:", error);
      }
    };

    const loadSlideCommands = async () => {
      try {
        const res = await promptApi.list({
          group_type: GROUP_TYPE.KM_FILE_CHAT_SLIDE_COMMAND,
          limit: 100,
        });
        window.dispatchEvent(
          new CustomEvent("viewer-event", {
            detail: { type: "menu", data: res.prompts || [] },
          }),
        );
      } catch (error) {
        console.error("Failed to load slide commands:", error);
      }
    };

    const handleNewChat = () => {
      convStore.setCurrentState(convStore.current_agentid, 0, false);
      clearMessageList();
    };

    const onSelectConversation = (conversationId: string) => {
      convStore.setCurrentState(
        convStore.current_agentid,
        conversationId,
        false,
      );
      setShowHistory(false);
      loadMessageList(conversationId);
    };

    const createConversation = async (question: string) => {
      const currentConversation = convStore.currentConversation();
      if (currentConversation?.conversation_id) return currentConversation;

      const conversation = await convStore.createConversation(
        agentInfo?.agent_id,
        question,
        fileInfo?.id,
      );

      convStore.addConversation({
        ...conversation,
        id: conversation.conversation_id,
        virtual_id: (currentConversation as any)?.virtual_id,
      });
      convStore.setCurrentState(
        agentInfo?.agent_id,
        conversation.conversation_id,
        false,
      );

      return conversation;
    };

    const sendMessage = async (
      question: string,
      links: any[] = [],
      options: any = {},
      overrideOptions?: { networkSearch?: boolean },
    ) => {
      if (isStreaming || !question.trim()) return;

      const fileLinks = fileInfo?.id
        ? [
            {
              id: fileInfo.id,
              name: fileInfo.name,
              icon: fileInfo.icon,
              library_id: fileInfo.library_id,
            },
          ]
        : links;

      setShowHistory(false);
      setSlideContent("");

      await createConversation(question);

      setIsStreaming(true);

      const agent_id = agentInfo?.agent_id;
      // 参考Vue版本：直接从store获取conversation_id，避免useMemo异步更新问题
      const conversation_id = convStore.currentConversation()?.conversation_id;
      const completion_params = agentInfo?.configs?.completion_params;
      const modelId = currentModel?.id || "";

      try {
        await sendMessageBase({
          question,
          agent_id,
          conversation_id: conversation_id as number,
          modelId,
          completion_params: {
            ...completion_params,
            temperature: currentModel?.temperature,
          },
          messageList: messageState.messageList,
          links: fileLinks,
          networkSearch,
          library: undefined,
          agentInfo,
          fileInfo,
          options: {
            prompt: options.prompt,
            text: options.text,
          },
          onMessageListChange: updateMessageList,
        });
      } catch (err: any) {
        console.log(err);
      } finally {
        setIsStreaming(false);
      }
    };

    const handleSend = (data: { textContent: string; from?: string, specifiedContent?: string }) => {
      const { textContent: content, from, specifiedContent = '' } = data;
      if (from === "map") {
        setTextContent(content);
      }
      if (!content.trim()) return;

      if (!agentInfo?.agent_id) {
        message.warning(t("chat.no_available_agent"));
        return;
      }

      const processedContent =
        from === "map"
          ? `${t("library.explain_knowledge_point")}："${content}"`
          : content;

      sendMessage(processedContent, [], {
        prompt: slideContent || specifiedContent,
        text: slideContent || specifiedContent,
      });
    };

    const handleStop = () => {
      handleStopBase();
      setIsStreaming(false);
    };

    const handleRegenerate = (message: any) => {
      if (isStreaming) return;
      handleRegenerateBase(message, handleSend);
    };

    const handleClickFeedbackBtn = async (
      msg: any,
      type: "satisfied" | "unsatisfied",
    ) => {
      // 先关闭其他消息的反馈面板
      updateMessageList((list: any[]) =>
        list.map((item) =>
          item.id !== msg.id ? { ...item, feedbackVisible: false } : item,
        ),
      );
      // 然后更新当前消息
      const updatedMsg = await handleClickFeedbackBtnBase(msg, type);
      updateMessageList((list: any[]) =>
        list.map((item) => (item.id === updatedMsg.id ? updatedMsg : item)),
      );
    };

    const handleOpenKnowWrapper = (msg: any) => {
      handleOpenKnow(msg, thinkKnowledgeRef, setShowThinkKnowledge);
    };

    // 加载更多消息
    const handleLoadListMore = async (done: () => void): Promise<void> => {
      const conversationId = currentConv?.conversation_id;
      if (!conversationId) return done();
      return handleLoadListMoreBase(done, String(conversationId));
    };

    // 来源引用悬浮处理
    const handleSourceReferenceHover = (data: any, msg: any) => {
      handleSourceReferenceHoverBase(data, msg, chunkRef, chunkSourceRef);
    };

    // Chunk 详情获取回调
    const handleFetchChunkDetail = useCallback(async (chunkId: string) => {
      const chunk = await chunksApi.get(Number(chunkId));
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

    // 来源编号渲染
    const renderSource = (type: string, number: number, msg: any) => {
      if (msg.rag_stats?.type === "web_search") {
        return number;
      }
      return number;
    };

    const handleAddAsMd = (msg: any) => {
      addAnswerAsMdRef.current?.open({
        answer: msg.answer,
        question: msg.question,
      });
    };

    const handleQuickCommand = (promptId: string) => {
      const command = commands.find((item) => item.prompt_id === promptId);
      if (!command) return;
      sendMessage(command.name, [], {
        prompt: command.content?.replace(/\{划词内容\}/g, slideContent),
        text: slideContent,
      });
    };

    const handleChangeModel = (modelValue: string) => {
      setModel(modelValue);
    };

    const handleChangeNetworkSearch = () => {
      if (!slideContent) return;
      setNetworkSearch(!networkSearch);
    };

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
            {item.value === model && <SvgIcon name="check" />}
          </div>
        ),
        onClick: () => handleChangeModel(item.value),
      }));
    }, [agentModels, model]);

    const handleResize = useCallback(() => {
      setViewportWidth(window.innerWidth);
    }, []);

    const onSelectionChange = useCallback((event: any) => {
      const { text } = event.detail;
      setSlideContent(text);
    }, []);

    const onQuickCommand = useCallback(
      (event: any) => {
        const { name, prompt, text } = event.detail;
        sendMessage(name, [], {
          prompt: prompt?.replace(/\{划词内容\}/g, text),
          text,
        });
        onOpenAi?.();
      },
      [onOpenAi],
    );

    // Poll for summary/questions generation
    const { start: startPoll, stop: stopPoll } = usePoll(async () => {
      setSummaryLoading(true);
      const currentFileInfo = fileInfo || { summary: "", questions: [] };

      if (currentFileInfo.summary && currentFileInfo.questions?.length > 0) {
        stopPoll();
        setSummaryLoading(false);
      } else if (
        [RUN_STATUS.SUCCESS, RUN_STATUS.FAILED].includes(
          currentFileInfo.cleaning_info?.status,
        )
      ) {
        try {
          const res = await filesApi.generateQuestionAndSummary(
            currentFileInfo.id,
          );
          if (res.status !== "pending") {
            stopPoll();
            setSummaryLoading(false);
            spaceStore.loadFile(currentFileInfo.id, true);
          }
        } catch (error) {
          console.error("Failed to generate questions and summary:", error);
        }
      }
    }, 1000);

    const handleSelectAll = () => handleSelectAllBase(messageState.messageList);
    const handleOpenShare = handleOpenShareBase;
    const handleCreateShare = () => {
      handleCreateShareBase(
        currentConv?.conversation_id || "",
        "file",
        fileInfo?.name,
        spaceStore.space?.name,
      );
    };

    useImperativeHandle(ref, () => ({
      send: handleSend,
      collapse: () => setIsCollapsed((prev) => !prev),
    }));

    useEffect(() => {
      loadModels();
      loadFeedbackConfig("file_chat");
      loadQuickCommands();
      loadSlideCommands();

      window.addEventListener("selection-change", onSelectionChange as any);
      window.addEventListener("quick-command", onQuickCommand as any);
      window.addEventListener("resize", handleResize);

      if (
        agentInfo?.settings?.generate_summary?.enable ||
        agentInfo?.settings?.generate_suggested_questions?.enable
      ) {
        startPoll();
      }

      return () => {
        window.removeEventListener(
          "selection-change",
          onSelectionChange as any,
        );
        window.removeEventListener("quick-command", onQuickCommand as any);
        window.removeEventListener("resize", handleResize);
        handleStop();
        stopPoll();
      };
    }, []);

    return (
      <div className="h-full flex flex-col bg-white overflow-hidden relative pt-5 file-chat">
        {isShareMode && (
          <ShareHeader
            selectAll={shareState.selectAll}
            selectMessageIds={shareState.selectMessageIds}
            customClass="w-full px-5"
            onSelectAll={handleSelectAll}
            onCreateShare={handleCreateShare}
            onOpenShare={handleOpenShare}
          />
        )}

        <BubbleList
          ref={bubbleListRef}
          autoScroll={true}
          messages={messageState.messageList}
          className="flex-1"
          mainClass="mx-5"
          enablePullUp={messageState.hasMore && !messageState.isLoadingMore}
          onPullUp={handleLoadListMore}
        >
          {/* Header - 对齐 Vue #header slot */}
          {!isShareMode && (
            <>
              {!textContent ? (
                <h3 className="text-lg text-[#1D1E1F]">
                  {greeting}，{" "}
                  {userStore.info?.nickname || userStore.info?.username}
                </h3>
              ) : (
                <div className="relative">
                  <div className="absolute top-1/2 -translate-y-1/2 left-0 text-xs flex items-center gap-1">
                    <div className="size-2 bg-[#2563EB] rounded-full" />
                    {t("library.knowledge_point")}
                  </div>
                  <h3 className="text-center text-lg text-[#1D1E1F]">
                    {textContent}
                  </h3>
                </div>
              )}

              {fileInfo?.summary &&
                agentInfo?.settings?.generate_summary?.enable && (
                  <BubbleAssistant
                    type="assistant"
                    content={fileInfo.summary}
                    alwaysShowMenu
                  />
                )}

              {summaryLoading && (
                <div className="my-5 h-5 flex items-center justify-center">
                  <SvgIcon name="loading" className="animate-spin" />
                </div>
              )}

              {!summaryLoading && (
                <div className="border-b border-dashed mt-3 mb-5" />
              )}

              {!!fileInfo?.questions?.length &&
                agentInfo?.settings?.generate_suggested_questions?.enable && (
                  <div className="flex flex-col gap-2 mb-5">
                    <div className="text-sm text-[#939499]">试试这样问：</div>
                    {fileInfo.questions.map((item: string, index: number) => (
                      <div key={index}>
                        <div
                          className="inline-flex h-9 px-3 rounded-lg border items-center cursor-pointer hover:bg-[#E1E2E3]"
                          onClick={() => handleSend({ textContent: item })}
                        >
                          <div className="text-sm text-[#1D1E1F] truncate">
                            {item}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
            </>
          )}

          {/* Message Items - 对齐 Vue #item slot */}
          {messageState.messageList.map((msg, index) => (
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
                <div className="flex-1">
                  <BubbleUser
                    content={msg.question}
                    files={msg.user_files}
                    messageStyle={
                      {
                        "--hubx-color-bg-message": "#EBF1FF",
                      } as React.CSSProperties
                    }
                    header={
                      msg.specified_content ? (
                        <SpecifiedFiles
                          files={msg.specified_files}
                          content={msg.specified_content}
                        />
                      ) : undefined
                    }
                    menu={
                      !isShareMode ? (
                        <MessageMenu type="user" content={msg.question} />
                      ) : undefined
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
                    streaming={msg.loading}
                    alwaysShowMenu={
                      index === messageState.messageList.length - 1
                    }
                    renderSource={(type: string, number: number) =>
                      renderSource(type, number, msg)
                    }
                    sourceEnabled
                    showError={msg.error}
                    onSourceReferenceClick={(data: any) =>
                      handleSourceReferenceHover(data, msg)
                    }
                    header={
                      msg.rag_stats ? (
                        <RagHeader
                          ragStats={msg.rag_stats}
                          loading={msg.loading}
                          ragSearchText={msg.rag_search_text}
                          specifiedContent={msg.specified_content}
                          showLibraryCount={false}
                          onOpenKnow={() => handleOpenKnowWrapper(msg)}
                        />
                      ) : undefined
                    }
                    footer={
                      msg.rag_stats?.file_quotations?.length ? (
                        <Quotation
                          type={msg.rag_stats.type}
                          files={msg.rag_stats.file_quotations}
                        />
                      ) : undefined
                    }
                    menu={
                      (!msg.loading ||
                        msg.feedbackVisible ||
                        msg.feedbackSuccessful) &&
                      !isShareMode ? (
                        <MessageMenu
                          type="assistant"
                          content={msg.answer}
                          feedbackType={msg.feedback_type}
                          features={{ share: true, feedback: true, addAsFile: true }}
                          onRegenerate={() => handleRegenerate(msg)}
                          onFeedback={(type) =>
                            handleClickFeedbackBtn(msg, type)
                          }
                          onShare={() => handleOpenShare(msg)}
                          onAddAsFile={() => handleAddAsMd(msg)}
                        />
                      ) : undefined
                    }
                    error={
                      <div className="text-[#262626]">
                        {t("agent.error_tip")}
                        <span
                          className="text-blue-500 cursor-pointer underline ml-1"
                          onClick={() => {
                            updateMessageList((list: any[]) =>
                              list.map((item) =>
                                item.id === msg.id
                                  ? { ...item, showErrorDetails: !item.showErrorDetails }
                                  : item,
                              ),
                            );
                          }}
                        >
                          {t("agent.error_details")}
                        </span>
                        {msg.showErrorDetails && (
                          <div className="mt-2 whitespace-pre-wrap break-words text-red-500">
                            {msg.answer}
                          </div>
                        )}
                      </div>
                    }
                  />
                  <FeedbackPanel
                    visible={msg.feedbackVisible || false}
                    feedbackType={msg.feedback_type}
                    feedbackTypeOptions={msg.feedbackTypeOptions || new Map()}
                    submitBtnDisabled={msg.submitBtnDisabled ?? true}
                    feedbackSuccessful={msg.feedbackSuccessful || false}
                    description={msg.description || ""}
                    onClose={() => {
                      const updatedMsg = handleCloseFeedback(msg);
                      updateMessageList((list: any[]) =>
                        list.map((item) =>
                          item.id === updatedMsg.id ? updatedMsg : item,
                        ),
                      );
                    }}
                    onToggle={(key) => {
                      const updatedMsg = handleToggleFeedbackBtn(msg, key);
                      updateMessageList((list: any[]) =>
                        list.map((item) =>
                          item.id === updatedMsg.id ? updatedMsg : item,
                        ),
                      );
                    }}
                    onSubmit={async () => {
                      const updatedMessage = await handleSubmitFeedback(msg);
                      updateMessageList((list: any[]) =>
                        list.map((item) =>
                          item.id === updatedMessage.id ? updatedMessage : item,
                        ),
                      );
                      // 2秒后重置成功状态
                      setTimeout(() => {
                        const resetMsg =
                          resetFeedbackSuccessState(updatedMessage);
                        updateMessageList((list: any[]) =>
                          list.map((item) =>
                            item.id === resetMsg.id ? resetMsg : item,
                          ),
                        );
                      }, 2000);
                    }}
                    onDescriptionChange={(value) => {
                      updateMessageList((list: any[]) =>
                        list.map((item) =>
                          item.id === msg.id
                            ? { ...item, description: value }
                            : item,
                        ),
                      );
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </BubbleList>

        {/* Input Area */}
        {!isShareMode && (
          <div className="flex-none mx-5">
            {/* Quick Commands */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 flex gap-2 overflow-hidden">
                {commands.slice(0, showCommandLength).map((item) => (
                  <Tooltip key={item.prompt_id} title={item.name}>
                    <div
                      className="max-w-32 h-8 px-4 flex items-center gap-1 rounded-full border cursor-pointer text-[#1D1E1F] hover:bg-[#F5F5F7] overflow-hidden"
                      onClick={() => handleQuickCommand(item.prompt_id)}
                    >
                      <span className="text-sm truncate">{item.name}</span>
                    </div>
                  </Tooltip>
                ))}
                {commands.length > showCommandLength && (
                  <Dropdown
                    menu={{
                      items: commands.slice(showCommandLength).map((item) => ({
                        key: item.prompt_id,
                        label: item.name,
                        onClick: () => handleQuickCommand(item.prompt_id),
                      })),
                    }}
                    trigger={["click"]}
                    placement="topLeft"
                  >
                    <div className="h-8 px-2 flex items-center justify-center gap-1 rounded-full border cursor-pointer text-[#1D1E1F] hover:bg-[#F5F5F7]">
                      <SvgIcon name="more-v" />
                    </div>
                  </Dropdown>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Tooltip title="新建对话">
                  <div
                    className="size-8 border rounded flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7]"
                    onClick={handleNewChat}
                  >
                    <SvgIcon name="add-chat" />
                  </div>
                </Tooltip>
                <Tooltip title="查看历史对话">
                  <div
                    className="size-8 border rounded flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7]"
                    onClick={() => setShowHistory(true)}
                  >
                    <SvgIcon name="history" />
                  </div>
                </Tooltip>
              </div>
            </div>

            <Sender
              showAt={false}
              placeholder={t("chat.input_placeholder")}
              loading={isStreaming}
              onSend={(data) =>
                handleSend({
                  textContent: data.pureTextContent || data.textContent || "",
                })
              }
              onStop={handleStop}
              header={
                <>
                  {slideContent && (
                    <div className="h-7 px-2 rounded-md bg-[#F3F4F6] flex items-center gap-2 text-[#4F5052] overflow-hidden mb-2">
                      <SvgIcon className="flex-none" name="corner-down-right" />
                      <p className="flex-1 text-sm truncate">{slideContent}</p>
                      <Button
                        type="text"
                        size="small"
                        icon={<SvgIcon name="close" />}
                        onClick={() => setSlideContent("")}
                      />
                    </div>
                  )}
                  {!slideContent && fileInfo && (
                    <div className="h-7 px-2 rounded-md bg-[#F3F4F6] flex items-center gap-2 text-[#4F5052] overflow-hidden mb-2">
                      <SvgIcon
                        className="flex-none text-[#999999]"
                        name="corner-down-right"
                      />
                      <img src={fileInfo.icon} className="size-4" alt="" />
                      <p className="text-sm truncate">{fileInfo.name}</p>
                    </div>
                  )}
                </>
              }
              extras={
                <div className="flex items-center gap-1">
                  <Dropdown
                    menu={{ items: modelMenuItems }}
                    trigger={["click"]}
                    placement="topLeft"
                  >
                    <div className="max-w-52 h-8 px-4 flex items-center justify-center gap-1 rounded-full border border-[#E3EEFF] bg-[#F3F8FF] cursor-pointer text-[#2563EB] overflow-hidden">
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
                      <SvgIcon name="down-one-filled" size={12} />
                    </div>
                  </Dropdown>

                  {agentInfo?.settings?.web_search_setting?.enable &&
                    slideContent && (
                      <div
                        className={`h-8 px-4 flex items-center justify-center gap-1 rounded-full border cursor-pointer border-[#E3EEFF] ${
                          networkSearch
                            ? "text-[#2563EB] bg-[#F3F8FF]"
                            : "text-[#999999]"
                        }`}
                        onClick={handleChangeNetworkSearch}
                      >
                        <SvgIcon name="network" />
                        <span className="text-sm whitespace-nowrap">
                          {t("chat.web_search")}
                        </span>
                      </div>
                    )}
                </div>
              }
            />

            <div className="h-10 flex items-center justify-center text-xs text-[#999999]">
              回答内容均由AI生成，仅供参考
            </div>
          </div>
        )}

        {/* Chunk popup */}
        <Chunk
          ref={chunkRef}
          virtualRef={chunkSourceRef}
          fetchChunkDetail={handleFetchChunkDetail}
          renderMarkdown={handleRenderMarkdown}
        />

        {/* Think Knowledge sidebar */}
        {showThinkKnowledge && (
          <ThinkKnowledge
            className="w-[418px] border-l fixed right-0 top-0 bottom-0"
            onClose={() => setShowThinkKnowledge(false)}
            ref={thinkKnowledgeRef}
          />
        )}

        {/* History drawer */}
        {showHistory && (
          <ChatHistoryDrawer
            open={showHistory}
            agentId={agentInfo?.agent_id}
            fileId={fileInfo?.id}
            onClose={() => setShowHistory(false)}
            onConversation={onSelectConversation}
          />
        )}

        {/* Add Answer as MD */}
        <AddAnswerAsMd ref={addAnswerAsMdRef} />
      </div>
    );
  },
);

ChatAssistant.displayName = "ChatAssistant";

export { ChatAssistant };
export default ChatAssistant;
