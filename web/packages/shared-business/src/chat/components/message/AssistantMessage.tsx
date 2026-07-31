// packages/shared-business/src/chat/components/message/AssistantMessage.tsx

import { memo, useState, useCallback, useMemo } from "react";
import { Checkbox, message as antdMessage } from "antd";
import { BubbleAssistant } from "@km/hub-ui-x-react";
import { MessageMenu } from "../MessageMenu";
import { FeedbackPanel } from "../feedback";
import { ProcessFlowHeader, type TranslateFn } from "../process-flow";
import { OutputFiles } from "../output";
import OpenClawTimeline from "./OpenClawTimeline";
import { Quotation } from "../source";
import { useTranslation, useKnowledgePanel } from "../../i18n";
import { useRagStats } from "../../hooks/useRagStats";
import type { Message, ChatMessagesFeatures } from "../../types/message";
import type {
  MessageActionFeature,
  FileActionFeature,
  SourceActionFeature,
  OpenClawFeature,
  ChatMessagesSlots,
} from "../ChatMessages/types";
import { getOutputFileDownloadStrategy } from "../../utils/output-file-download";

// === Main Props ===

export interface AssistantMessageProps {
  // === 核心 ===
  /** 消息数据 */
  message: Message;
  /** Agent 信息 */
  agentInfo?: {
    agent_id?: string | number;
    name?: string;
    logo?: string;
    settings?: {
      opening_statement?: string;
      answer_remarks_config?: { enable: boolean; content: string };
    };
  };
  /** 功能开关 */
  features?: ChatMessagesFeatures;
  /** 外部传入的翻译函数 */
  t?: TranslateFn;

  // === 功能分组 ===
  /** 流式状态 */
  isStreaming?: boolean;
  /** 是否是最后一条消息 */
  isLastMessage?: boolean;
  /** 分享模式 */
  isShareMode?: boolean;
  /** 是否被选中（分享模式） */
  isSelected?: boolean;
  /** OpenClaw 模式 */
  openclaw?: OpenClawFeature;

  // === 回调分组 ===
  /** 消息操作回调 */
  messageAction?: MessageActionFeature;
  /** 文件操作回调 */
  fileAction?: FileActionFeature;
  /** 源引用操作回调 */
  sourceAction?: SourceActionFeature;

  // === UI 插槽 ===
  slots?: ChatMessagesSlots;

  // === 其他 ===
  /** 自定义类名 */
  className?: string;
  /** 自定义样式 */
  style?: React.CSSProperties;
  /** 折叠/展开 OpenClaw 时间线时保持外层滚动位置 */
  preserveScrollDuringToggle?: (callback: () => void) => void;
}

const FEEDBACK_OPTIONS_SATISFIED = new Map([
  ["准确", false],
  ["有帮助", false],
  ["快速", false],
  ["其它", false],
]);

const FEEDBACK_OPTIONS_UNSATISFIED = new Map([
  ["不准确", false],
  ["不完整", false],
  ["不相关", false],
  ["其它", false],
]);

function getOpenClawAssistantContent(message: Message) {
  const projectedAnswer = message.openclawProjection?.visibleAnswer?.trim();
  if (projectedAnswer) return projectedAnswer;
  return "";
}

function AssistantMessageInner({
  message,
  agentInfo,
  features,
  isStreaming = false,
  isLastMessage = false,
  isShareMode = false,
  isSelected = false,
  className,
  style,
  openclaw,
  messageAction,
  fileAction,
  sourceAction,
  slots,
  preserveScrollDuringToggle,
  t: externalT,
}: AssistantMessageProps) {
  const { t: internalT } = useTranslation();
  const t = externalT || internalT;
  const onOpenKnowledgePanel = useKnowledgePanel();
  const openclawEnabled = openclaw?.enabled ?? false;
  const { formatRagStats } = useRagStats();

  // 从 process_records 兜底计算 rag_stats（不依赖流式处理器是否调用 formatRagStats）
  const computedRagStats = useMemo(() => {
    if (message.rag_stats && message.rag_stats.files_search?.length) {
      return message.rag_stats;
    }
    if (!message.process_records || message.process_records.length === 0) {
      return message.rag_stats;
    }
    const hasKnowledgeSearch = message.process_records.some(
      (r: any) => r.step_code === "knowledge_search"
    );
    if (!hasKnowledgeSearch) return message.rag_stats;
    const ragTemp = (message as any).rag_temp || {};
    const computed = formatRagStats(ragTemp, message.process_records);
    if (computed) return computed;
    return message.rag_stats;
  }, [message.rag_stats, message.process_records, (message as any).rag_temp, formatRagStats]);

  const ragStats = computedRagStats || message.rag_stats;

  // 反馈状态 - 支持外部控制或内部状态
  const feedbackVisible = message.feedbackVisible ?? false;
  const feedbackType = message.feedback_type ?? "";
  const feedbackTypeOptions = message.feedbackTypeOptions ?? null;
  const feedbackSuccessful = message.feedbackSuccessful ?? false;
  const description = message.description ?? "";

  // 内部反馈状态（当没有外部回调时使用）
  const [internalFeedbackVisible, setInternalFeedbackVisible] = useState(false);
  const [internalFeedbackType, setInternalFeedbackType] = useState<"satisfied" | "unsatisfied" | "">("");
  const [internalFeedbackOptions, setInternalFeedbackOptions] = useState<Map<string, boolean>>(new Map());
  const [internalDescription, setInternalDescription] = useState("");
  const [internalFeedbackSuccessful, setInternalFeedbackSuccessful] = useState(false);
  // 内部错误详情状态
  const [internalShowErrorDetails, setInternalShowErrorDetails] = useState(false);

  // 使用外部状态还是内部状态（当有 onFeedback 和 onFeedbackClose 时使用外部状态）
  const useExternalFeedback = !!(messageAction?.onFeedback && messageAction?.onFeedbackClose);
  const actualFeedbackVisible = useExternalFeedback ? feedbackVisible : internalFeedbackVisible;
  const actualFeedbackType = useExternalFeedback ? feedbackType : internalFeedbackType;
  const actualFeedbackOptions = useExternalFeedback ? feedbackTypeOptions : internalFeedbackOptions;
  const actualFeedbackSuccessful = useExternalFeedback ? feedbackSuccessful : internalFeedbackSuccessful;
  const actualDescription = useExternalFeedback ? description : internalDescription;

  // 错误详情显示状态（优先使用外部状态）
  const showErrorDetails = message.showErrorDetails ?? internalShowErrorDetails;

  const handleSelect = useCallback(() => {
    if (isShareMode && messageAction?.onSelect) {
      messageAction.onSelect(message);
    }
  }, [isShareMode, messageAction, message]);

  const handleRegenerate = useCallback(() => {
    messageAction?.onRegenerate?.(message);
  }, [messageAction, message]);

  const handleShare = useCallback(() => {
    messageAction?.onShare?.();
  }, [messageAction]);

  const handleAddAsMd = useCallback(() => {
    messageAction?.onAddAsMd?.(message);
  }, [messageAction, message]);

  const handleFeedback = useCallback((type: "satisfied" | "unsatisfied") => {
    if (useExternalFeedback) {
      messageAction?.onFeedback?.(message, type);
    } else {
      setInternalFeedbackType(type);
      setInternalFeedbackOptions(type === "satisfied" ? new Map(FEEDBACK_OPTIONS_SATISFIED) : new Map(FEEDBACK_OPTIONS_UNSATISFIED));
      setInternalFeedbackVisible(true);
      setInternalDescription("");
      setInternalFeedbackSuccessful(false);
    }
  }, [useExternalFeedback, messageAction, message]);

  const handleFeedbackToggle = useCallback((key: string) => {
    if (useExternalFeedback && messageAction?.onFeedbackToggle) {
      messageAction.onFeedbackToggle(message, key);
    } else {
      setInternalFeedbackOptions((prev) => {
        const next = new Map(prev);
        next.set(key, next.get(key) !== true);
        return next;
      });
    }
  }, [useExternalFeedback, messageAction, message]);

  const handleFeedbackSubmit = useCallback(() => {
    const options = useExternalFeedback ? feedbackTypeOptions : internalFeedbackOptions;

    const selectedOptions = Array.from((options || new Map()).entries())
      .filter(([, value]) => value)
      .map(([key]) => key);

    if (selectedOptions.length === 0) {
      antdMessage.warning(t("chat.select_feedback_option") || "请选择至少一个反馈选项");
      return;
    }

    // Guard: ensure feedbackType is valid before submitting
    const fbType = useExternalFeedback ? feedbackType : internalFeedbackType;
    if (fbType !== "satisfied" && fbType !== "unsatisfied") {
      return;
    }

    if (useExternalFeedback && messageAction?.onFeedbackSubmit) {
      messageAction.onFeedbackSubmit(message);
    } else if (!useExternalFeedback) {
      setInternalFeedbackSuccessful(true);
      setInternalFeedbackVisible(false);
      // 2秒后重置成功状态
      setTimeout(() => {
        setInternalFeedbackSuccessful(false);
      }, 2000);
    }
  }, [useExternalFeedback, feedbackTypeOptions, internalFeedbackOptions, description, internalDescription, feedbackType, internalFeedbackType, messageAction, message, t]);

  const handleFeedbackClose = useCallback(() => {
    if (useExternalFeedback && messageAction?.onFeedbackClose) {
      messageAction.onFeedbackClose(message);
    } else {
      setInternalFeedbackVisible(false);
      setInternalFeedbackType("");
      setInternalDescription("");
    }
  }, [useExternalFeedback, messageAction, message]);

  const handleDescriptionChange = useCallback((value: string) => {
    if (useExternalFeedback && messageAction?.onFeedbackDescriptionChange) {
      messageAction.onFeedbackDescriptionChange(message, value);
    } else {
      setInternalDescription(value);
    }
  }, [useExternalFeedback, messageAction, message]);

  const handleOutputFilePreview = useCallback((file: any) => {
    if (fileAction?.onPreview) {
      fileAction.onPreview(file, message);
      return;
    }

    const triggerAnchorDownload = (url: string, filename?: string) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "";
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    const triggerBlobDownload = async (blob: Blob, filename?: string) => {
      const url = URL.createObjectURL(blob);
      triggerAnchorDownload(url, filename);
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };

    const resolveMessageOutputUrl = async () => {
      if (!file.message_id) return "";
      const accessToken = localStorage.getItem("access_token") || "";
      const response = await fetch(`/api/messages/${file.message_id}/files`, {
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
        credentials: "include",
      });
      if (!response.ok) return "";
      const payload = await response.json();
      const records = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload) ? payload : [];
      const matched = records.find((item: any) => {
        const ids = [item?.id, item?.file?.origin_ref_id].map((value) => String(value || ""));
        return ids.includes(String(file.id || "")) || String(item?.file_name || "") === String(file.file_name || "");
      });
      return matched?.signed_download_url || matched?.download_url || "";
    };

    const preview = async () => {
      const filename = file.file_name || "download";
      const strategy = getOutputFileDownloadStrategy(file);
      if (strategy.kind === "direct_url") {
        triggerAnchorDownload(strategy.url, filename);
        return;
      }
      if (strategy.kind === "data_url") {
        const response = await fetch(strategy.url);
        await triggerBlobDownload(await response.blob(), filename);
        return;
      }
      if (strategy.kind === "message_lookup") {
        const resolvedUrl = await resolveMessageOutputUrl();
        if (resolvedUrl) {
          triggerAnchorDownload(resolvedUrl, filename);
        }
      }
    };

    void preview();
  }, [message, fileAction]);

  const handleOutputFileFavorite = useCallback((file: any) => {
    fileAction?.onFavorite?.(file, message);
  }, [fileAction, message]);

  const handleOutputFileCheckFavorite = useCallback((fileIds: string[]) => {
    fileAction?.onCheckFavorite?.(fileIds, message);
  }, [fileAction, message]);

  const handleSourceClick = useCallback((source: any) => {
    // 优先使用 context 中的回调
    if (onOpenKnowledgePanel) {
      const handled = onOpenKnowledgePanel({ type: 'source_click', source });
      if (handled !== false) return;
    }
    // 回退到外部 props
    sourceAction?.onClick?.(source, message);
  }, [onOpenKnowledgePanel, sourceAction, message]);

  const handleOpenKnow = useCallback(() => {
    // 优先使用 context 中的回调
    if (onOpenKnowledgePanel) {
      const files = ragStats?.files_search || [];
      const handled = onOpenKnowledgePanel({ type: 'knowledge_search', files });
      if (handled !== false) return;
    }
    // 回退到外部 props
    sourceAction?.onOpenKnow?.(message);
  }, [onOpenKnowledgePanel, sourceAction, message]);

  const handleSourceReferenceClick = useCallback((data: any) => {
    sourceAction?.onReferenceClick?.(data, message);
  }, [sourceAction, message]);

  const handleRenderSource = useCallback((type: string, number: number) => {
    if (slots?.source) {
      return slots.source({ type, number, message });
    }
    // 默认渲染
    return `${type}-${number}`;
  }, [slots, message]);

  const handleShowErrorDetails = useCallback(() => {
    if (messageAction?.onShowErrorDetails) {
      messageAction.onShowErrorDetails(message);
    } else {
      // 没有外部回调时，使用内部状态切换
      setInternalShowErrorDetails(true);
    }
  }, [messageAction, message]);

  const menuFeatures = useMemo(() => ({
    copy: features?.menu?.copy ?? true,
    regenerate: features?.menu?.regenerate ?? true,
    share: features?.menu?.share ?? false,
    feedback: features?.menu?.feedback ?? false,
    addAsFile: features?.menu?.addAsMd ?? false,
  }), [features?.menu]);

  const assistantMenuContent = openclawEnabled ? getOpenClawAssistantContent(message) : (message.answer || message.content || "");
  const showMenu = !message.loading && !isShareMode;
  // 数据驱动：有 process_records 数据就显示 ProcessFlow
  const showProcessFlow = message.process_records && message.process_records.length > 0;
  // 数据驱动：有 outputFiles 数据就显示输出文件
  const showOutputFiles = !openclawEnabled && message.outputFiles && message.outputFiles.length > 0;
  // 数据驱动：有 file_quotations 数据就显示引用
  const showQuotation = ragStats?.file_quotations && ragStats.file_quotations.length > 0;
  const showAnswerRemarks = agentInfo?.settings?.answer_remarks_config?.enable && !message.loading;

  // 稳定 BubbleAssistant 的 React 元素 prop 引用：
  // - BubbleAssistant 的 memo 会比较 header / footer / menu / error 引用，
  //   数据未变时复用旧元素可避免 MdRenderer 重跑 markdown 解析（性能关键）。
  // - 数据变化时（如 message.process_records 流式追加），新元素让 memo 失效，
  //   触发 ProcessFlowHeader 重渲染以反映最新数据。
  // rag_stats?.files_search 在 useChatStream 内会被整体替换为新数组对象，
  // 这里通过 JSON 序列化捕获其内容变化，避免引用漂移导致漏渲染。
  const knowledgeSearchFilesSnapshot = useMemo(
    () => JSON.stringify(ragStats?.files_search ?? []),
    [ragStats?.files_search],
  );

  const headerNode = useMemo(() => {
    if (!showProcessFlow) return undefined;
    return (
      <ProcessFlowHeader
        t={t}
        processRecords={message.process_records}
        streaming={message.loading || (isStreaming && isLastMessage)}
        hasContent={!!(message.answer || message.content)}
        getKnowledgeSearchFiles={() => ragStats?.files_search || []}
        onOpenKnow={handleOpenKnow}
        onSourceClick={handleSourceClick}
      />
    );
  }, [
    showProcessFlow,
    t,
    message.process_records,
    message.loading,
    isStreaming,
    isLastMessage,
    message.answer,
    message.content,
    knowledgeSearchFilesSnapshot,
    handleOpenKnow,
    handleSourceClick,
  ]);

  const footerNode = useMemo(() => {
    return (
      <>
        {showOutputFiles && (
          <OutputFiles
            files={message.outputFiles!}
            onPreview={handleOutputFilePreview}
            onFavorite={fileAction?.onFavorite ? handleOutputFileFavorite : undefined}
            onCheckFavorite={fileAction?.onCheckFavorite ? handleOutputFileCheckFavorite : undefined}
          />
        )}
        {showAnswerRemarks && (
          <div className="text-sm text-[#999999] break-words my-2">
            {agentInfo?.settings?.answer_remarks_config?.content}
          </div>
        )}
        {showQuotation && (
          <Quotation
            type={ragStats?.type}
            files={ragStats?.file_quotations}
          />
        )}
      </>
    );
  }, [
    showOutputFiles,
    message.outputFiles,
    ragStats?.type,
    ragStats?.file_quotations,
    showAnswerRemarks,
    agentInfo?.settings?.answer_remarks_config?.content,
    showQuotation,
    handleOutputFilePreview,
    fileAction?.onFavorite,
    fileAction?.onCheckFavorite,
    fileAction?.onClick,
    handleOutputFileFavorite,
    handleOutputFileCheckFavorite,
  ]);

  const menuNode = useMemo(() => {
    if (!showMenu) return undefined;
    return slots?.messageMenu ? (
      slots.messageMenu({ type: "assistant", message })
    ) : (
      <MessageMenu
        type="assistant"
        content={assistantMenuContent}
        features={menuFeatures}
        feedbackType={message.feedback_type}
        onRegenerate={handleRegenerate}
        onShare={handleShare}
        onFeedback={handleFeedback}
        onAddAsFile={handleAddAsMd}
      />
    );
  }, [
    showMenu,
    slots?.messageMenu,
    message.id,
    message.feedback_type,
    assistantMenuContent,
    menuFeatures,
    handleRegenerate,
    handleShare,
    handleFeedback,
    handleAddAsMd,
  ]);

  const errorNode = useMemo(() => {
    if (!message.error) return undefined;
    return (
      <div className="text-[#262626]">
        {t("chat.error_tip") || "回答出错"}
        <span
          className="text-blue-500 cursor-pointer underline ml-1"
          onClick={(e) => {
            e.stopPropagation();
            handleShowErrorDetails();
          }}
        >
          {t("chat.error_details") || "查看详情"}
        </span>
        {showErrorDetails && (
          <div className="mt-2 whitespace-pre-wrap text-sm">
            {message.answer || message.content}
          </div>
        )}
      </div>
    );
  }, [
    message.error,
    message.answer,
    message.content,
    showErrorDetails,
    handleShowErrorDetails,
    t,
  ]);

  if (
    openclawEnabled &&
    message.openclawProjection &&
    (message.openclawProjection.timelineItems.length > 0 || message.openclawProjection.outputFiles.length > 0)
  ) {
    return (
      <div
        className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
        onClick={handleSelect}
      >
        {isShareMode && <Checkbox checked={isSelected} />}
        <div className="flex-1 overflow-hidden space-y-3">
          <OpenClawTimeline
            message={message}
            items={message.openclawProjection.timelineItems}
            agentInfo={agentInfo}
            isStreaming={message.loading || (isStreaming && isLastMessage)}
            features={features}
            renderSource={slots?.source ? (type, number) => slots.source!({ type, number, message }) : undefined}
            onSourceReferenceClick={sourceAction?.onReferenceClick ? (data) => sourceAction.onReferenceClick!(data, message) : undefined}
            onOutputFilePreview={handleOutputFilePreview}
            onOutputFileFavorite={fileAction?.onFavorite ? handleOutputFileFavorite : undefined}
            onOutputFileCheckFavorite={fileAction?.onCheckFavorite ? handleOutputFileCheckFavorite : undefined}
            onInteractionSubmit={openclaw?.onInteractionSubmit ? (activity, option) => openclaw.onInteractionSubmit!(activity, option, message) : undefined}
            preserveScrollDuringToggle={preserveScrollDuringToggle}
            answerMenu={
              showMenu ? (
                slots?.messageMenu ? (
                  slots.messageMenu({ type: "assistant", message })
                ) : (
                  <MessageMenu
                    type="assistant"
                    content={assistantMenuContent}
                    features={menuFeatures}
                    feedbackType={message.feedback_type}
                    onRegenerate={handleRegenerate}
                    onShare={handleShare}
                    onFeedback={handleFeedback}
                    onAddAsFile={handleAddAsMd}
                  />
                )
              ) : undefined
            }
          />

          {showAnswerRemarks && (
            <div className="text-sm text-[#999999] break-words">
              {agentInfo?.settings?.answer_remarks_config?.content}
            </div>
          )}

          {showQuotation && (
            <Quotation
              type={ragStats?.type}
              files={ragStats?.file_quotations}
            />
          )}

          {features?.menu?.feedback && (
            <FeedbackPanel
              visible={actualFeedbackVisible}
              feedbackType={actualFeedbackType}
              feedbackTypeOptions={actualFeedbackOptions}
              submitBtnDisabled={message.submitBtnDisabled !== false}
              feedbackSuccessful={actualFeedbackSuccessful}
              description={actualDescription}
              onClose={handleFeedbackClose}
              onToggle={handleFeedbackToggle}
              onSubmit={handleFeedbackSubmit}
              onDescriptionChange={handleDescriptionChange}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-5 rounded-xl ${isShareMode ? "mb-4 px-3 py-4 bg-[#F5F5F5]" : ""}`}
      onClick={handleSelect}
    >
      {isShareMode && <Checkbox checked={isSelected} />}

      <div className="flex-1 overflow-hidden">
        <BubbleAssistant
          content={message.answer || ""}
          streaming={message.loading || (isStreaming && isLastMessage)}
          reasoning={message.reasoning_content}
          reasoningExpanded={message.reasoning_expanded}
          avatar={agentInfo?.logo}
          alwaysShowMenu={isLastMessage || actualFeedbackVisible}
          className={className}
          style={style}
          sourceEnabled={true}
          renderSource={handleRenderSource}
          onSourceReferenceClick={handleSourceReferenceClick}
          showError={message.error}
          header={headerNode}
          footer={footerNode}
          menu={menuNode}
          error={errorNode}
        />

        {/* Feedback Panel */}
        {features?.menu?.feedback && (
          <FeedbackPanel
            visible={actualFeedbackVisible}
            feedbackType={actualFeedbackType}
            feedbackTypeOptions={actualFeedbackOptions}
            submitBtnDisabled={message.submitBtnDisabled !== false}
            feedbackSuccessful={actualFeedbackSuccessful}
            description={actualDescription}
            onClose={handleFeedbackClose}
            onToggle={handleFeedbackToggle}
            onSubmit={handleFeedbackSubmit}
            onDescriptionChange={handleDescriptionChange}
          />
        )}
      </div>
    </div>
  );
}

const AssistantMessage = memo(AssistantMessageInner);
AssistantMessage.displayName = "AssistantMessage";

export default AssistantMessage;
