import {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
} from "react";
import { Drawer, Modal, Input, Button, Spin } from "antd";
import { LoadingOutlined } from "@ant-design/icons";
import { Dropdown, SvgIcon } from "@km/shared-components-react";
import type { ConversationInfo } from "../types";
import { isRunRunning, useConversationStore } from "../stores/conversation";
import { useChatAdapters, useTranslation } from "../i18n";

/** 轮询间隔（毫秒），与 knowledge/history.tsx 保持一致 */
const POLL_INTERVAL = 5000;

export interface ChatHistoryRef {
  open: () => void;
}

export interface ChatHistoryProps {
  onNew?: () => void;
  /**
   * 切换历史会话项时的回调。传入则由父组件接管切换副作用（运行态清理、
   * setCurrentState、clearMessageList 等）；未传则退回内部默认行为
   * （直接 setCurrentState，无清理）。
   *
   * 沿用 onNew 的"意图上抛"模式，让父组件（ChatView）负责跨 hook 的清理。
   */
  onSelect?: (conv: ConversationInfo) => void;
  title?: string;
  showCreate?: boolean;
  showItemActions?: boolean;
  /** 侧边栏模式 - 外部控制显示 */
  sidebarMode?: boolean;
  /** 侧边栏模式下的显示状态 */
  open?: boolean;
  /** 侧边栏模式下的关闭回调 */
  onClose?: () => void;
}

const ChatHistory = forwardRef<ChatHistoryRef, ChatHistoryProps>(
  (
    {
      onNew,
      onSelect,
      title,
      showCreate = true,
      showItemActions = true,
      sidebarMode = false,
      open: externalOpen,
      onClose,
    },
    ref,
  ) => {
    const { t } = useTranslation();
    const [internalVisible, setInternalVisible] = useState(false);
    const [editVisible, setEditVisible] = useState(false);
    const [convForm, setConvForm] = useState({
      conversation_id: 0 as string | number,
      title: "",
    });

    // 侧边栏模式使用外部状态，Drawer 模式使用内部状态
    const visible = sidebarMode ? externalOpen : internalVisible;
    const setVisible = sidebarMode
      ? (v: boolean) => {
          if (!v) onClose?.();
        }
      : setInternalVisible;

    const setCurrentState = useConversationStore(
      (state) => state.setCurrentState,
    );
    const delConversationStore = useConversationStore(
      (state) => state.delConversation,
    );
    const editConversationStore = useConversationStore(
      (state) => state.editConversation,
    );
    const conversations = useConversationStore((state) => state.conversations);
    const currentConversationId = useConversationStore(
      (state) => state.current_conversationid,
    );
    const updateConversationLatestRun = useConversationStore(
      (state) => state.updateConversationLatestRun,
    );
    const hasMore = useConversationStore((state) => state.hasMore);
    const loadingMore = useConversationStore((state) => state.loadingMore);
    const loadMoreConversations = useConversationStore(
      (state) => state.loadMoreConversations,
    );

    const adapters = useChatAdapters();
    const agentRunApi = adapters?.agentRun;

    // 轮询定时器引用（每个会话独立）
    const pollingTimersRef = useRef<
      Map<string, ReturnType<typeof setInterval>>
    >(new Map());
    // 记录已启动轮询的会话 ID
    const polledConvIdsRef = useRef<Set<string>>(new Set());

    // 停止指定会话的轮询并清空 latest_run
    const stopPollingAndClear = useCallback(
      (conversationId: string) => {
        updateConversationLatestRun(conversationId, null);
        const timer = pollingTimersRef.current.get(conversationId);
        if (timer) {
          clearInterval(timer);
          pollingTimersRef.current.delete(conversationId);
          polledConvIdsRef.current.delete(conversationId);
        }
      },
      [updateConversationLatestRun],
    );

    // 轮询单个会话的 latest_run 状态
    const pollConversationRun = useCallback(
      async (conversationId: string) => {
        if (!agentRunApi) return;
        try {
          const { run, isrunning } = await agentRunApi.latest(conversationId);
          if (!isrunning || !run) {
            stopPollingAndClear(conversationId);
          }
        } catch (error: any) {
          // 404 表示没有运行中的 run，停止轮询
          if (error?.response?.status === 404) {
            stopPollingAndClear(conversationId);
          }
        }
      },
      [agentRunApi, stopPollingAndClear],
    );

    // 为单个会话启动轮询
    const startPolling = useCallback(
      (conversationId: string) => {
        if (pollingTimersRef.current.has(conversationId)) return;
        // 立即查询一次
        pollConversationRun(conversationId);
        // 设置定时轮询
        const timer = setInterval(
          () => pollConversationRun(conversationId),
          POLL_INTERVAL,
        );
        pollingTimersRef.current.set(conversationId, timer);
        polledConvIdsRef.current.add(conversationId);
      },
      [pollConversationRun],
    );

    // 监听会话列表，对运行中的会话启动轮询，对已删除的会话停止轮询
    useEffect(() => {
      if (!agentRunApi) return;

      // 如果历史面板未打开，则清理所有轮询，避免后台偷偷发起请求
      if (!visible) {
        for (const timer of pollingTimersRef.current.values()) {
          clearInterval(timer);
        }
        pollingTimersRef.current.clear();
        polledConvIdsRef.current.clear();
        return;
      }

      const allConvIds = new Set(
        conversations.map((c) => String(c.conversation_id)),
      );
      const runningConvIds = conversations
        .filter((c) => isRunRunning(c.latest_run))
        .map((c) => String(c.conversation_id));

      // 停止已删除会话的轮询
      for (const polledId of polledConvIdsRef.current) {
        if (!allConvIds.has(polledId)) {
          const timer = pollingTimersRef.current.get(polledId);
          if (timer) {
            clearInterval(timer);
            pollingTimersRef.current.delete(polledId);
          }
          polledConvIdsRef.current.delete(polledId);
        }
      }

      // 启动新的轮询
      for (const convId of runningConvIds) {
        if (!polledConvIdsRef.current.has(convId)) {
          startPolling(convId);
        }
      }
    }, [conversations, agentRunApi, startPolling, visible]);

    // 组件卸载时清理所有轮询
    useEffect(() => {
      return () => {
        for (const timer of pollingTimersRef.current.values()) {
          clearInterval(timer);
        }
        pollingTimersRef.current.clear();
        polledConvIdsRef.current.clear();
      };
    }, []);

    // 哨兵元素引用：IntersectionObserver 观察它是否进入视口
    // 注：故意保留 useEffect + useRef 模式（与 knowledge/history.tsx 一致），不用 callback ref 模式，
    // 因为 callback ref + 条件渲染在 React 18 strict mode / 异步提交下出现过 observer 不触发的回归。
    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
      const el = sentinelRef.current;
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (entries[0]?.isIntersecting && hasMore && !loadingMore) {
            loadMoreConversations();
          }
        },
        { threshold: 0.1 },
      );

      observer.observe(el);
      return () => observer.disconnect();
    }, [hasMore, loadingMore, loadMoreConversations]);

    useImperativeHandle(ref, () => ({
      open: () => {
        if (!sidebarMode) {
          setInternalVisible(true);
        }
      },
    }));

    const handleCreate = useCallback(() => {
      onNew?.();
      setVisible(false);
    }, [onNew, setVisible]);

    const handleEditConv = useCallback(async () => {
      if (!convForm.title.trim()) return;
      await editConversationStore({
        conversation_id: convForm.conversation_id,
        title: convForm.title,
      });
      setEditVisible(false);
    }, [convForm, editConversationStore]);

    const delConversation = useCallback(
      async (conv: ConversationInfo) => {
        Modal.confirm({
          title: t("chat.conversation_confirm_delete"),
          content: t("action.del"),
          okText: t("action.del"),
          cancelText: t("action.cancel"),
          okButtonProps: { danger: true },
          onOk: () => delConversationStore(conv),
        });
      },
      [delConversationStore, t],
    );

    const handleCommandConv = useCallback(
      (event: string, conv: ConversationInfo) => {
        if (event === "del") {
          delConversation(conv);
        } else if (event === "edit") {
          setConvForm({
            conversation_id: conv.conversation_id,
            title: conv.title || "",
          });
          setEditVisible(true);
        }
      },
      [delConversation],
    );

    const handleSelect = useCallback(
      (conv: ConversationInfo) => {
        // 优先走 onSelect 上抛（父组件负责运行态清理），未传时退回原行为。
        // 保留 setCurrentState 订阅作为兜底：未注入 onSelect 的旧调用方仍可用。
        if (onSelect) {
          onSelect(conv);
        } else {
          setCurrentState(conv.agent_id || 0, conv.conversation_id);
        }
        setVisible(false);
      },
      [onSelect, setCurrentState, setVisible],
    );

    const menuItems = useCallback(
      (_item: ConversationInfo) => [
        {
          key: "edit",
          icon: <SvgIcon name="edit" className="mr-1" />,
          label: t("action.rename"),
        },
        {
          key: "del",
          danger: true,
          icon: <SvgIcon name="del" className="mr-1" />,
          label: t("action.del"),
        },
      ],
      [t],
    );

    const currentId = String(currentConversationId);

    // 按时间分类会话
    const groupedConversations = useMemo(() => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);

      const weekAgo = new Date(today);
      weekAgo.setDate(weekAgo.getDate() - 7);

      return [
        {
          title: t("time.today"),
          conversations: conversations.filter((item) => {
            const createdTime = item.created_time
              ? new Date(item.created_time)
              : null;
            return createdTime && createdTime >= today;
          }),
        },
        {
          title: t("time.yesterday"),
          conversations: conversations.filter((item) => {
            const createdTime = item.created_time
              ? new Date(item.created_time)
              : null;
            return (
              createdTime && createdTime >= yesterday && createdTime < today
            );
          }),
        },
        {
          title: t("time.within_7_days"),
          conversations: conversations.filter((item) => {
            const createdTime = item.created_time
              ? new Date(item.created_time)
              : null;
            return (
              createdTime && createdTime >= weekAgo && createdTime < yesterday
            );
          }),
        },
        {
          title: t("time.over_7_days"),
          conversations: conversations.filter((item) => {
            const createdTime = item.created_time
              ? new Date(item.created_time)
              : null;
            return createdTime && createdTime < weekAgo;
          }),
        },
      ];
    }, [conversations, t]);

    // 统一的列表内容
    const content = (
      <>
        {/* 新会话按钮 */}
        {showCreate && (
          <div className="flex-none px-3">
            <div
              className="h-9 flex items-center justify-center cursor-pointer gap-2 border rounded-lg hover:shadow"
              onClick={handleCreate}
            >
              <SvgIcon
                name="add-chat"
                className="w-4 h-4 mr-1 text-[#1D1E1F]"
              />
              <span className="text-sm text-[#1D1E1F]">
                {t("chat.new_conversation")}
              </span>
            </div>
          </div>
        )}

        {/* 对话列表 */}
        <div
          className={`flex-1 px-3 py-4 overflow-y-auto ${showCreate ? "" : "pt-0"}`}
        >
          <div className="space-y-1">
            {groupedConversations.map((group) => {
              if (group.conversations.length === 0) return null;
              return (
                <div key={group.title}>
                  <h3 className="h-8 px-2 flex items-center text-sm text-[#999999]">
                    {group.title}
                  </h3>
                  {group.conversations.map((item, index) => (
                    <div
                      key={item.conversation_id || `conv-${index}`}
                      className="relative group"
                    >
                      <div
                        className={`w-full h-9 px-2 rounded flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer ${
                          String(item.conversation_id) === currentId
                            ? "bg-blue-50"
                            : "bg-white"
                        }`}
                        onClick={() => handleSelect(item)}
                      >
                        <p className="text-sm text-gray-700 truncate flex-1">
                          {item.title || t("chat.no_title")}
                        </p>
                        {isRunRunning(item.latest_run) ? (
                          <div className="flex items-center justify-center w-5 h-5">
                            <Spin
                              indicator={
                                <LoadingOutlined
                                  style={{ fontSize: 14 }}
                                  spin
                                />
                              }
                            />
                          </div>
                        ) : (
                          showItemActions && (
                            <Dropdown
                              menu={{
                                items: menuItems(item),
                                onClick: ({ key }) =>
                                  handleCommandConv(key, item),
                              }}
                              trigger={["hover"]}
                              placement="bottom"
                            >
                              <div
                                className="invisible group-hover:visible transition-opacity"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <SvgIcon name="more-h" />
                              </div>
                            </Dropdown>
                          )
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* 分页哨兵 + 状态展示：始终渲染，useEffect 在 sentinelRef.current 变化时挂载 observer */}
          <div
            ref={sentinelRef}
            className="h-10 flex items-center justify-center"
          >
            {loadingMore && <Spin size="small" />}
            {!hasMore && conversations.length > 0 && (
              <span className="text-xs text-gray-400">{t("chat.no_more")}</span>
            )}
          </div>
        </div>
      </>
    );

    // 编辑弹窗
    const editModal = (
      <Modal
        open={editVisible}
        onCancel={() => setEditVisible(false)}
        title={t("chat.edit_conversation")}
        onOk={handleEditConv}
        okButtonProps={{ disabled: !convForm.title.trim() }}
        width={480}
      >
        <Input
          size="large"
          value={convForm.title}
          onChange={(e) =>
            setConvForm({
              ...convForm,
              title: e.target.value,
            })
          }
          placeholder={t("chat.conversation_title_placeholder")}
          maxLength={20}
          showCount
        />
      </Modal>
    );

    // 侧边栏模式：返回固定侧边栏
    if (sidebarMode) {
      return (
        <>
          <div className="h-full bg-white border-r border-gray-200 flex flex-col">
            {/* 头部区域 */}
            <div className="flex-none px-3 py-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-5 h-5 flex items-center justify-center">
                    <SvgIcon name="history" className="w-4 h-4 text-gray-600" />
                  </div>
                  <h2 className="text-base font-medium text-gray-900">
                    {title || t("chat.history_conversation")}
                  </h2>
                </div>
                <Button type="link" size="small" onClick={onClose}>
                  <SvgIcon
                    name="double-left"
                    className="w-4 h-4 text-gray-500"
                  />
                </Button>
              </div>
            </div>
            {content}
          </div>
          {editModal}
        </>
      );
    }

    // Drawer 模式（默认）
    return (
      <>
        <Drawer
          open={visible}
          onClose={() => setVisible(false)}
          title={title || t("chat.history_conversation")}
          styles={{
            wrapper: { width: 300 },
            body: { padding: "var(--ant-padding-lg) 0" },
          }}
        >
          {content}
        </Drawer>
        {editModal}
      </>
    );
  },
);

ChatHistory.displayName = "ChatHistory";

export default ChatHistory;
