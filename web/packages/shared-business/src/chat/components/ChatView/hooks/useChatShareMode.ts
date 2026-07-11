// packages/shared-business/src/chat/components/ChatView/hooks/useChatShareMode.ts
//
// 集中管理 ChatView 的"分享模式":
//   - shareMode / selectMessageIds / selectAll / shareLoading 状态
//   - 5 个 share 回调(打开 / 取消 / 全选 / 单选 / 创建链接)
//
// 创建成功后会:
//   - 调用 share.onCreate(messageIds, conversationId, selectAll) 获取链接
//   - copyToClip 自动复制到剪贴板
//   - antdMessage.success 提示"分享链接已复制"
//   - 自动关闭 share 模式、清空选择

import { useCallback, useState } from "react";
import { message as antdMessage } from "antd";
import { copyToClip } from "@km/shared-utils";
import type { Message } from "../../../types/message";
import type { ShareFeature } from "../types";

export interface UseChatShareModeParams {
  /** ChatView 的 share prop(包含 onCreate 回调) */
  share?: ShareFeature;
  /** 当前会话 ID */
  currentConversationId?: string | number;
  /** 当前消息列表(用于 selectAll) */
  messageList: Message[];
  /** i18n t 函数 */
  t: (key: string) => string;
}

export interface UseChatShareModeResult {
  /** 是否处于分享模式 */
  shareMode: boolean;
  /** 当前选中的消息 ID 列表 */
  selectMessageIds: (string | number)[];
  /** 是否全选 */
  selectAll: boolean;
  /** share 回调集合(传给 ShareHeader / ChatMessages 的 selection prop) */
  shareHandlers: {
    onOpenShare: () => void;
    onCancelShare: () => void;
    onSelectAll: () => void;
    onSelectMessage: (msgId: string | number) => void;
    onCreateShare: () => Promise<void>;
  };
}

export function useChatShareMode(params: UseChatShareModeParams): UseChatShareModeResult {
  const { share, currentConversationId, messageList, t } = params;

  const [shareMode, setShareMode] = useState(false);
  const [selectMessageIds, setSelectMessageIds] = useState<(string | number)[]>([]);
  const [selectAll, setSelectAll] = useState(false);
  // shareLoading 在原 ChatView 中用 setState 但只 set 未读(主要给 antdMessage 异步提示用)
  const [, setShareLoading] = useState(false);

  const onOpenShare = useCallback(() => {
    setShareMode(true);
    setSelectAll(false);
    setSelectMessageIds([]);
  }, []);

  const onCancelShare = useCallback(() => {
    setShareMode(false);
    setSelectAll(false);
    setSelectMessageIds([]);
  }, []);

  const onSelectAll = useCallback(() => {
    if (selectAll) {
      setSelectMessageIds([]);
      setSelectAll(false);
    } else {
      setSelectMessageIds(messageList.map((item: Message) => item.id));
      setSelectAll(true);
    }
  }, [selectAll, messageList]);

  const onSelectMessage = useCallback(
    (msgId: string | number) => {
      if (selectMessageIds.includes(msgId)) {
        setSelectMessageIds((prev) => prev.filter((id) => id !== msgId));
        setSelectAll(false);
      } else {
        setSelectMessageIds((prev) => [...prev, msgId]);
      }
    },
    [selectMessageIds]
  );

  const onCreateShare = useCallback(async () => {
    if (!share?.onCreate || !currentConversationId) return;
    setShareLoading(true);
    try {
      const link = await share.onCreate(selectMessageIds, currentConversationId, selectAll);
      await copyToClip(link);
      antdMessage.success(t("share.create_success") || "分享链接已复制");
      setShareMode(false);
      setSelectAll(false);
      setSelectMessageIds([]);
    } catch (err) {
      console.error("Failed to create share:", err);
    } finally {
      setShareLoading(false);
    }
  }, [share?.onCreate, selectMessageIds, currentConversationId, selectAll, t]);

  return {
    shareMode,
    selectMessageIds,
    selectAll,
    shareHandlers: {
      onOpenShare,
      onCancelShare,
      onSelectAll,
      onSelectMessage,
      onCreateShare,
    },
  };
}