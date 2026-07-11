import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Button, Modal, Input, Spin } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useConversationStore, isRunRunning } from "./conversation";
import { agentRunApi } from "@/api/modules/agentRun";
import { t } from "@/locales";

const POLL_INTERVAL = 5000

interface HistoryProps {
  onCollapse?: () => void;
  onNewChat?: () => void;
  onConversation?: (id: string) => void;
}

export function ChatHistory({
  onCollapse,
  onNewChat,
  onConversation,
}: HistoryProps) {
  const convStore = useConversationStore();
  const [editVisible, setEditVisible] = useState(false);
  const [convForm, setConvForm] = useState({
    id: "" as string | number,
    title: "",
  });

  // 新增：哨兵元素引用
  const sentinelRef = useRef<HTMLDivElement>(null);

  // 轮询定时器引用
  const pollingTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map())
  // 记录上次已启动轮询的会话 ID
  const polledConvIdsRef = useRef<Set<string>>(new Set())

  // 轮询单个会话的 latest_run 状态
  const pollConversationRun = useCallback(async (conversationId: string) => {
    try {
      const res = await agentRunApi.latest(conversationId)
      const run = res.data || res
      if (!isRunRunning(run)) {
        // 状态已变为终态，停止轮询并更新状态
        convStore.updateConversationLatestRun(conversationId, null)
        const timer = pollingTimersRef.current.get(conversationId)
        if (timer) {
          clearInterval(timer)
          pollingTimersRef.current.delete(conversationId)
          polledConvIdsRef.current.delete(conversationId)
        }
      }
    } catch (error: any) {
      // 404 表示没有运行中的 run，停止轮询
      if (error?.response?.status === 404) {
        convStore.updateConversationLatestRun(conversationId, null)
        const timer = pollingTimersRef.current.get(conversationId)
        if (timer) {
          clearInterval(timer)
          pollingTimersRef.current.delete(conversationId)
          polledConvIdsRef.current.delete(conversationId)
        }
      }
    }
  }, [convStore])

  // 为单个会话启动轮询
  const startPolling = useCallback((conversationId: string) => {
    if (pollingTimersRef.current.has(conversationId)) return
    // 立即查询一次
    pollConversationRun(conversationId)
    // 设置定时轮询
    const timer = setInterval(() => pollConversationRun(conversationId), POLL_INTERVAL)
    pollingTimersRef.current.set(conversationId, timer)
    polledConvIdsRef.current.add(conversationId)
  }, [pollConversationRun])

  // 监听会话列表，对运行中的会话启动轮询，对删除的会话停止轮询
  useEffect(() => {
    const allConvIds = new Set(convStore.conversations.map((conv: any) => String(conv.id)))
    const runningConvIds = convStore.conversations
      .filter((conv: any) => isRunRunning(conv.latest_run))
      .map((conv: any) => String(conv.id))

    // 停止已删除会话的轮询
    for (const polledId of polledConvIdsRef.current) {
      if (!allConvIds.has(polledId)) {
        const timer = pollingTimersRef.current.get(polledId)
        if (timer) {
          clearInterval(timer)
          pollingTimersRef.current.delete(polledId)
        }
        polledConvIdsRef.current.delete(polledId)
      }
    }

    // 启动新的轮询
    for (const convId of runningConvIds) {
      if (!polledConvIdsRef.current.has(convId)) {
        startPolling(convId)
      }
    }
  }, [convStore.conversations, startPolling])

  // 组件卸载时清理所有轮询
  useEffect(() => {
    return () => {
      for (const timer of pollingTimersRef.current.values()) {
        clearInterval(timer)
      }
      pollingTimersRef.current.clear()
      polledConvIdsRef.current.clear()
    }
  }, [])

  // 新增：IntersectionObserver 监听
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && convStore.hasMore && !convStore.loadingMore) {
          convStore.loadMoreConversations();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [convStore.hasMore, convStore.loadingMore]);

  const groupedConversations = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    const conversations = convStore.conversations;
    return [
      {
        title: t("time.today"),
        conversations: conversations.filter(
          (conversation: any) => new Date(conversation.created_at) >= today,
        ),
      },
      {
        title: t("time.yesterday"),
        conversations: conversations.filter((conversation: any) => {
          const date = new Date(conversation.created_at);
          return date >= yesterday && date < today;
        }),
      },
      {
        title: t("time.within_7_days"),
        conversations: conversations.filter((conversation: any) => {
          const date = new Date(conversation.created_at);
          return date >= weekAgo && date < yesterday;
        }),
      },
      {
        title: t("time.over_7_days"),
        conversations: conversations.filter(
          (conversation: any) => new Date(conversation.created_at) < weekAgo,
        ),
      },
    ];
  }, [convStore.conversations]);

  const toggleCollapse = () => {
    onCollapse?.();
  };

  const handleNewChat = () => {
    onNewChat?.();
  };

  const selectConversation = (data: any) => {
    onConversation?.(data.id);
  };

  const handleEditConv = () => {
    return convStore.editConversation(convForm).then(() => {
      setEditVisible(false);
    });
  };

  const deleteConversation = async (conversation: any) => {
    Modal.confirm({
      title: t("action.del"),
      content: t("chat.conversation_confirm_delete"),
      okText: t("action.del"),
      okType: "danger",
      cancelText: t("action.cancel"),
      onOk: async () => {
        const isCurrent = convStore.current_conversationid === conversation.id
        await convStore.delConversation(conversation)
        if (isCurrent) {
          onNewChat?.()
        }
      },
    });
  };

  const handleMenuCommand = (command: string, conversation: any) => {
    switch (command) {
      case "edit":
        setConvForm({
          id: conversation.id,
          title: conversation.title,
        });
        setEditVisible(true);
        break;
      case "delete":
        deleteConversation(conversation);
        break;
    }
  };

  const getConversationMenuItems = (conversation: any): MenuProps["items"] => [
    {
      key: "edit",
      label: (
        <div className="flex items-center">
          <SvgIcon name="edit" className="w-4 h-4 mr-2" />
          {t("action.rename")}
        </div>
      ),
    },
    {
      key: "delete",
      label: (
        <div className="flex items-center">
          <SvgIcon name="del" className="w-4 h-4 mr-2" />
          {t("chat.delete_conversation")}
        </div>
      ),
    },
  ];

  return (
    <div className="h-full bg-white border-r border-gray-200 flex flex-col">
      {/* 头部区域 */}
      <div className="flex-none px-3 py-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 flex items-center justify-center">
              <SvgIcon name="history" className="w-4 h-4 text-gray-600" />
            </div>
            <h2 className="text-base font-medium text-gray-900">
              {t("chat.history_conversation")}
            </h2>
          </div>
          <Button type="link" size="small" onClick={toggleCollapse}>
            <SvgIcon name="double-left" className="w-4 h-4 text-gray-500" />
          </Button>
        </div>
      </div>

      {/* 新会话按钮 */}
      <div className="flex-none px-3">
        <div
          size="default"
          className="h-9 flex items-center justify-center cursor-pointer gap-2 border rounded-lg hover:shadow"
          onClick={handleNewChat}
        >
          <SvgIcon name="add-chat" className="w-4 h-4 mr-1 text-[#1D1E1F]" />
          <span className="text-sm text-[#1D1E1F]">{t("chat.new_chat")}</span>
        </div>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 px-3 py-4 overflow-y-auto">
        <div className="mb-4 space-y-1">
          {groupedConversations.map((group) => {
            if (group.conversations.length === 0) return null;
            return (
              <div key={group.title}>
                <h3 className="h-8 px-2 flex items-center text-sm text-[#999999]">
                  {group.title}
                </h3>
                {group.conversations.map((conversation: any) => (
                  <div key={conversation.id} className="relative group">
                    <div
                      className={`w-full h-9 px-2 rounded flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer ${convStore.current_conversationid === conversation.id ? "bg-blue-50" : "bg-white"}`}
                      onClick={() => selectConversation(conversation)}
                    >
                      <p className="text-sm text-gray-700 truncate flex-1">
                        {conversation.title}
                      </p>
                      {isRunRunning(conversation.latest_run) ? (
                        <div className="flex items-center justify-center w-5 h-5">
                          <Spin indicator={<LoadingOutlined style={{ fontSize: 14 }} spin />} />
                        </div>
                      ) : (
                        <Dropdown
                          trigger={["hover"]}
                          placement="bottom"
                          menu={{
                            items: getConversationMenuItems(conversation),
                            onClick: ({ key, domEvent }) => {
                              domEvent.stopPropagation();
                              handleMenuCommand(key, conversation);
                            },
                          }}
                        >
                          <div
                            className="invisible group-hover:visible transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <SvgIcon name="more-h" />
                          </div>
                        </Dropdown>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
        {/* 新增：哨兵元素和加载状态 */}
        <div ref={sentinelRef} className="h-10 flex items-center justify-center">
          {convStore.loadingMore && <Spin size="small" />}
          {!convStore.hasMore && convStore.conversations.length > 0 && (
            <span className="text-xs text-gray-400">没有更多了</span>
          )}
        </div>
      </div>

      {/* 编辑弹窗 */}
      <Modal
        open={editVisible}
        title={t("chat.edit_conversation")}
        onCancel={() => setEditVisible(false)}
        onOk={handleEditConv}
        okButtonProps={{ disabled: !convForm.title.trim() }}
        okText={t("action.confirm")}
        cancelText={t("action.cancel")}
        width={480}
      >
        <Input
          value={convForm.title}
          onChange={(e) => setConvForm({ ...convForm, title: e.target.value })}
          placeholder={t("form.input_placeholder")}
        />
      </Modal>
    </div>
  );
}

export default ChatHistory;
