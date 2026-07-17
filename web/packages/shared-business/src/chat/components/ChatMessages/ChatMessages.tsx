import { memo, useCallback, useMemo, useRef } from "react";
import { LoadingOutlined } from "@ant-design/icons";
import { BubbleList, type BubbleListRef } from "@km/hub-ui-x-react";
import Welcome from "../Welcome";
import RelatedScene from "../related-scene/RelatedScene";
import MessageItem from "../message/MessageItem";
import { useTranslation } from "../../i18n";
import type { ChatMessagesFeatures } from "../../types/message";
import type { ChatMessagesProps } from "./types";

/**
 * 默认功能配置
 * 注意：除 menu 外的功能已改为数据驱动，此处的配置仅用于向后兼容
 */
const DEFAULT_FEATURES: ChatMessagesFeatures = {
  menu: {
    copy: true,
    regenerate: false,
    share: false,
    addAsMd: false,
    feedback: false,
  },
  // 以下字段已废弃，保留以维持向后兼容
  outputFiles: false,
  fileFavorite: false,
  sourceRef: false,
  processFlow: false,
  specifiedFiles: false,
  specifiedFilesType: 'no_jump',
  skillTag: false,
};

const DEFAULTS = {
  selection: { selectedMessageIds: [] as (string | number)[] },
  welcome: { show: true },
  agentRecommend: { showRelatedScene: false },
  openclaw: { enabled: false },
  loadMore: { hasMore: false, isLoadingMore: false, isConversationLoading: false },
} as const;

function ChatMessagesInner({
  messageList,
  agentInfo,
  userAvatar,
  isStreaming,
  features,
  openclaw: openclawConfig,
  slots,
  selection,
  agentRecommend,
  welcome,
  loadMore,
  messageAction,
  fileAction,
  sourceAction,
  isShareMode = false,
  t: externalT,
  boxClassName,
}: ChatMessagesProps) {
  // 解构分组属性，提供默认值
  const selectedMessageIds = selection?.selectedMessageIds ?? DEFAULTS.selection.selectedMessageIds;
  const showWelcome = welcome?.show ?? DEFAULTS.welcome.show;
  const showRelatedScene = agentRecommend?.showRelatedScene ?? DEFAULTS.agentRecommend.showRelatedScene;
  const openclawFeature = typeof openclawConfig === "object" ? openclawConfig : undefined;
  const legacyOpenClaw = typeof openclawConfig === "boolean" ? openclawConfig : undefined;
  const openclawEnabled = openclawFeature?.enabled ?? legacyOpenClaw ?? DEFAULTS.openclaw.enabled;
  const onOpenClawInteractionSubmit =
    openclawFeature?.onInteractionSubmit;
  const {
    hasMore = DEFAULTS.loadMore.hasMore,
    isLoadingMore = DEFAULTS.loadMore.isLoadingMore,
    isConversationLoading = DEFAULTS.loadMore.isConversationLoading,
    onLoadMore,
  } = loadMore ?? {};

  // 解构消息操作
  const {
    onSuggestionClick,
    onRegenerate,
    onShare,
    onAddAsMd,
    onFeedback,
    onFeedbackClose,
    onFeedbackToggle,
    onFeedbackDescriptionChange,
    onFeedbackSubmit,
    onShowErrorDetails,
  } = messageAction ?? {};

  // 解构文件操作
  const {
    onClick: onFileClick,
    onFavorite: onOutputFileFavorite,
    onPreview: onOutputFilePreview,
    onCheckFavorite: onCheckFavorite,
  } = fileAction ?? {};

  // 解构源文件操作
  const {
    onClick: onSourceClick,
    onOpenKnow,
    onReferenceClick: onSourceReferenceClick,
  } = sourceAction ?? {};

  // 解构插槽
  const {
    messageMenu: renderMessageMenu,
    authTags: renderAuthTags,
    source: renderSource,
    fileLink: renderFileLink,
  } = slots ?? {};

  // 解构选择操作
  const onMessageSelect = selection?.onSelect;

  // 解构智能体推荐
  const {
    onNavigateNext: onNextAgent,
    onRefresh: onInitAgent,
  } = agentRecommend ?? {};
  const { t: internalT } = useTranslation();
  const t = externalT || internalT;
  const bubbleListRef = useRef<BubbleListRef>(null);

  const mergedFeatures = { ...DEFAULT_FEATURES, ...features };
  const shouldShowWelcome = showWelcome && messageList.length === 0 && !isConversationLoading;
  const lastMessageId = messageList.length > 0 ? messageList[messageList.length - 1]?.id : undefined;
  const translatedLoadingMessages = t("chat.loading_messages");
  const loadingMessage =
    translatedLoadingMessages && translatedLoadingMessages !== "chat.loading_messages"
      ? translatedLoadingMessages
      : "加载消息...";

  const preserveScrollDuringToggle = useCallback((callback: () => void) => {
    const wrapper = bubbleListRef.current?.getWrapperElement();
    if (!wrapper) {
      callback();
      return;
    }

    const scrollTop = wrapper.scrollTop;
    const scrollLeft = wrapper.scrollLeft;
    callback();

    const restore = () => {
      if (!wrapper.isConnected) return;
      wrapper.scrollTop = scrollTop;
      wrapper.scrollLeft = scrollLeft;
    };

    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      restore();
      return;
    }

    window.requestAnimationFrame(() => {
      restore();
      window.requestAnimationFrame(restore);
    });
  }, []);

  // 稳定传给 MessageItem 的 props 对象，避免 ChatMessages 任何重渲染都触发所有
  // 历史消息完整重渲染（md.parse + renderTokens）。这是历史消息渲染卡死的根因之一。
  const memoizedMessageAction = useMemo(
    () => ({
      onSelect: onMessageSelect,
      onRegenerate,
      onShare,
      onAddAsMd,
      onFeedback,
      onFeedbackClose,
      onFeedbackToggle,
      onFeedbackDescriptionChange,
      onFeedbackSubmit,
      onShowErrorDetails,
    }),
    [
      onMessageSelect,
      onRegenerate,
      onShare,
      onAddAsMd,
      onFeedback,
      onFeedbackClose,
      onFeedbackToggle,
      onFeedbackDescriptionChange,
      onFeedbackSubmit,
      onShowErrorDetails,
    ],
  );

  const memoizedFileAction = useMemo(
    () => ({
      onClick: onFileClick,
      onFavorite: onOutputFileFavorite,
      onPreview: onOutputFilePreview,
      onCheckFavorite,
    }),
    [onFileClick, onOutputFileFavorite, onOutputFilePreview, onCheckFavorite],
  );

  const memoizedSourceAction = useMemo(
    () => ({
      onClick: onSourceClick,
      onOpenKnow,
      onReferenceClick: onSourceReferenceClick,
    }),
    [onSourceClick, onOpenKnow, onSourceReferenceClick],
  );

  const memoizedSlots = useMemo(
    () => ({
      messageMenu: renderMessageMenu,
      source: renderSource,
      fileLink: renderFileLink,
    }),
    [renderMessageMenu, renderSource, renderFileLink],
  );

  const memoizedOpenclaw = useMemo(
    () => ({
      enabled: openclawEnabled,
      onInteractionSubmit: onOpenClawInteractionSubmit,
    }),
    [openclawEnabled, onOpenClawInteractionSubmit],
  );

  const memoizedFeatures = useMemo(
    () => ({ ...DEFAULT_FEATURES, ...features }),
    [features],
  );

  return (
    <main className="flex-1 py-4 overflow-hidden flex relative">
      <BubbleList
        ref={bubbleListRef}
        messages={messageList}
        autoScroll
        className="flex-1"
        mainClass={boxClassName || "w-11/12 md:w-4/5 max-w-[1200px] mx-auto"}
        enablePullUp={hasMore && !isLoadingMore}
        pullUpText="正在加载更早的消息..."
        onPullUp={onLoadMore}
      >
        {shouldShowWelcome && (
          <Welcome
            agentInfo={agentInfo}
            onSuggestion={onSuggestionClick}
            renderAuthTags={renderAuthTags}
          />
        )}
        {openclawEnabled && messageList.length === 0 && (
          <div className="max-w-[520px] mt-5 mb-3 px-4 py-2 bg-[#F4F5F7] rounded-xl">
            {t("chat.openclaw_welcome_hint")}
          </div>
        )}

        {messageList.map((msg, index) => (
          <div key={msg.id}>
            {/* Message Item */}
            <MessageItem
              message={msg}
              index={index}
              total={messageList.length}
              agentInfo={agentInfo}
              userAvatar={userAvatar}
              features={memoizedFeatures}
              isStreaming={isStreaming && msg.id === lastMessageId}
              isShareMode={isShareMode}
              selectedMessageIds={selectedMessageIds}
              isSelected={selectedMessageIds.includes(msg.id)}
              openclaw={memoizedOpenclaw}
              messageAction={memoizedMessageAction}
              fileAction={memoizedFileAction}
              sourceAction={memoizedSourceAction}
              slots={memoizedSlots}
              preserveScrollDuringToggle={preserveScrollDuringToggle}
              t={t}
            />

            {/* Related Scene - 只在最后一条消息后显示 */}
            {index === messageList.length - 1 &&
              !msg.loading &&
              !isStreaming &&
              !isShareMode &&
              showRelatedScene && (
                <RelatedScene
                  output={msg.answer || ""}
                  relateAgents={agentInfo?.settings_obj?.relate_agents}
                  currentAgentId={agentInfo?.agent_id}
                  onNextAgent={onNextAgent}
                  onInitAgent={onInitAgent}
                />
              )}
          </div>
        ))}
      </BubbleList>

      {isConversationLoading && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 pointer-events-auto">
          <div className="flex items-center gap-2 text-gray-500">
            <LoadingOutlined className="text-xl animate-spin" />
            <span>{loadingMessage}</span>
          </div>
        </div>
      )}
    </main>
  );
}

const ChatMessages = memo(ChatMessagesInner);
ChatMessages.displayName = "ChatMessages";

export default ChatMessages;
export { DEFAULT_FEATURES };
