import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Popover,
  Checkbox,
  Button,
  Avatar,
  message,
  Dropdown,
  Image,
  Tooltip,
} from "antd";
import {
  CloseOutlined,
  MessageOutlined,
  LoadingOutlined,
  DownOutlined,
  CheckOutlined,
} from "@ant-design/icons";
import { useUserStore } from "@/stores/modules/user";
import notificationsApi from "@/api/modules/notifications";
import approvalsApi from "@/api/modules/approvals";
import { getPublicPath } from "@/utils/config";
import { RolePopover } from "@/components/KMPermission";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
} from "@/components/KMPermission/constant";
import type { PermissionType } from "@/components/KMPermission/constant";
import type { RawNotificationItem } from "@/api/modules/notifications/types";
import { getFormatTimeStamp } from "@km/shared-utils";
import "./MessageCenter.css";
import { SvgIcon } from "@km/shared-components-react";

const APPROVE_STATUS = {
  pending: 0,
  approved: 1,
  rejected: 2,
} as const;

const MESSAGE_TYPE = {
  system: "system",
  pending: "pending",
  mention_comment: "mention_comment",
} as const;

interface MessageCenterProps {
  externalOpen?: boolean;
  onExternalClose?: () => void;
  anchor?: React.ReactNode;
  children?: React.ReactNode;
}

export function MessageCenter({ externalOpen, onExternalClose, anchor, children }: MessageCenterProps = {}) {
  const navigate = useNavigate();
  const userStore = useUserStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef(0);

  const [isOpen, setIsOpen] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [activeTab, setActiveTab] = useState("all");
  const [messages, setMessages] = useState<RawNotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [markAllReadLoading, setMarkAllReadLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [messageStats, setMessageStats] = useState({
    system: 0,
    pending: 0,
    mention_comment: 0,
  });
  const statsTimerRef = useRef<NodeJS.Timeout | null>(null);

  const limit = 20;

  const tabs = useMemo(
    () => [
      { key: "all", label: "全部", count: unreadCount },
      { key: "pending", label: "待处理", count: messageStats.pending },
      {
        key: "mention_comment",
        label: "@与评论",
        count: messageStats.mention_comment,
      },
      { key: "system", label: "系统消息", count: messageStats.system },
    ],
    [unreadCount, messageStats],
  );

  const filteredMessages = useMemo(() => {
    let filtered = messages;

    // 按标签页过滤
    if (activeTab !== "all") {
      filtered = filtered.filter((m) => m.type === activeTab);
    }

    // 按未读状态过滤
    if (onlyUnread) {
      filtered = filtered.filter((m) => !m.is_read);
    }

    return filtered;
  }, [messages, activeTab, onlyUnread]);

  // 格式化时间
  const formatTime = (timestamp: number) => {
    try {
      const date = new Date(timestamp);
      return getFormatTimeStamp(date.toISOString());
    } catch {
      return new Date(timestamp).toLocaleString();
    }
  };

  // 获取资源类型名称
  const getResourceTypeName = (resourceType: number) => {
    switch (resourceType) {
      case RESOURCE_TYPE.space:
        return "申请团队空间权限";
      case RESOURCE_TYPE.library:
        return "申请知识库权限";
      case RESOURCE_TYPE.file:
        return "申请文件权限";
      default:
        return "申请权限";
    }
  };

  // 处理资源点击
  const handleResourceClick = (notification: RawNotificationItem) => {
    const resource = notification.content_parsed?.resource;
    const resourceType = notification.content_parsed?.resource_type;

    if (!resource) return;

    if (resourceType === RESOURCE_TYPE.space) {
      navigate(`/knowledge/${resource.id}`);
    } else if (resourceType === RESOURCE_TYPE.library) {
      navigate(`/library/${resource.id}`);
    } else if (resourceType === RESOURCE_TYPE.file) {
      navigate(`/library/${resource.library_id}/file/${resource.id}`);
    }
  };

  // 获取消息统计
  const fetchMessageStats = async () => {
    try {
      const response = await notificationsApi.stats({ scope: "unread" });
      setUnreadCount(response.total);
      setMessageStats(response.counts);
    } catch (error) {
      console.error("获取消息统计失败:", error);
    }
  };

  // 获取消息列表
  const fetchMessages = useCallback(
    async (
      reset: boolean,
      tabOverride?: string,
      onlyUnreadOverride?: boolean,
    ) => {
      if (loading) return;

      setLoading(true);

      try {
        const currentTab = tabOverride ?? activeTab;
        const currentOnlyUnread = onlyUnreadOverride ?? onlyUnread;
        const currentOffset = reset ? 0 : offsetRef.current;

        const params: any = {
          type: currentTab === "all" ? undefined : currentTab,
          is_read: currentOnlyUnread ? "unread" : undefined,
          offset: currentOffset,
          limit,
        };

        const response = await notificationsApi.list(params);
        const newMessages = response.list || [];

        if (reset) {
          setMessages(newMessages);
          const newOffset = response.offset + newMessages.length;
          setOffset(newOffset);
          offsetRef.current = newOffset;
        } else {
          setMessages((prev) => [...prev, ...newMessages]);
          const newOffset = response.offset + newMessages.length;
          setOffset(newOffset);
          offsetRef.current = newOffset;
        }

        setHasMore(newMessages.length === limit);
      } catch (error) {
        console.error("获取消息列表失败:", error);
      } finally {
        setLoading(false);
      }
    },
    [activeTab, onlyUnread, loading, limit],
  );

  // 标记消息为已读
  const markAsRead = async (notification: RawNotificationItem) => {
    try {
      await notificationsApi.read(notification.id);
      notification.is_read = true;
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (error) {
      console.error("标记消息已读失败:", error);
    }
  };

  // 更新消息状态
  const updateMessageStatus = (
    notificationId: number,
    status: number,
    approverInfo: any,
  ) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === notificationId
          ? {
              ...m,
              is_read: true,
              approval: {
                ...m.approval,
                status,
                approver_info: approverInfo,
              },
            }
          : m,
      ),
    );
  };

  // 处理同意
  const handleApprove = async (notification: RawNotificationItem) => {
    try {
      const approvalId = notification.approval_id;
      const permission = notification.content_parsed?.permission;

      await approvalsApi.approve(approvalId, {
        permission: (permission ?? PERMISSION_TYPE.viewer) as PermissionType,
      });
      await markAsRead(notification);

      // 更新消息状态
      updateMessageStatus(notification.id, APPROVE_STATUS.approved, {
        user_id: userStore.info.user_id,
        nickname: userStore.info.nickname,
        avatar: userStore.info.avatar,
      });

      await fetchMessageStats();
      message.success("申请已通过");
    } catch (error) {
      console.error("同意申请失败:", error);
    }
  };

  // 处理拒绝
  const handleReject = async (notification: RawNotificationItem) => {
    try {
      const approvalId = notification.approval_id;

      await approvalsApi.reject(approvalId);
      await markAsRead(notification);

      // 更新消息状态
      updateMessageStatus(notification.id, APPROVE_STATUS.rejected, {
        user_id: userStore.info.user_id,
        nickname: userStore.info.nickname,
        avatar: userStore.info.avatar,
      });

      await fetchMessageStats();
      message.success("申请已拒绝");
    } catch (error) {
      console.error("拒绝申请失败:", error);
    }
  };

  // 处理标签页切换
  const handleTabChange = (tabKey: string) => {
    setActiveTab(tabKey);
    setOffset(0);
    offsetRef.current = 0;
    setHasMore(true);
    fetchMessages(true, tabKey);
  };

  // 处理滚动事件
  const handleScroll = useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;

      // 当滚动到底部附近时加载更多
      if (
        scrollHeight - scrollTop - clientHeight < 100 &&
        hasMore &&
        !loading
      ) {
        fetchMessages();
      }
    },
    [hasMore, loading],
  );

  // 处理清空已读
  const handleMarkAllRead = async () => {
    if (markAllReadLoading) return;
    setMarkAllReadLoading(true);
    try {
      await notificationsApi.read_all();
      setMessages((prev) => prev.map((m) => ({ ...m, is_read: true })));
      setUnreadCount(0);
      await fetchMessageStats();
      message.success("所有消息已标记为已读");
    } catch (error) {
      console.error("标记所有消息已读失败:", error);
    } finally {
      setMarkAllReadLoading(false);
    }
  };

  // 处理消息悬停
  const handleMessageHover = async (notification: RawNotificationItem) => {
    if (!notification.is_read) {
      try {
        await notificationsApi.read(notification.id);
        notification.is_read = true;
        setUnreadCount((prev) => Math.max(0, prev - 1));
      } catch (error) {
        console.error("标记消息已读失败:", error);
      }
    }
  };

  // 处理关闭
  const handleClose = () => {
    if (externalOpen !== undefined) {
      onExternalClose?.();
    } else {
      setIsOpen(false);
    }
  };

  // 渲染待处理消息内容
  const renderPendingMessage = (notification: RawNotificationItem) => (
    <>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-sm font-medium text-[#1D1E1F] truncate">
            {notification.sender?.nickname || "系统"}
          </span>
          <span className="text-sm text-[#1D1E1F] whitespace-nowrap">
            {getResourceTypeName(
              notification.content_parsed?.resource_type ?? 0,
            )}
          </span>
          <RolePopover
            value={
              (notification.content_parsed?.permission ??
                PERMISSION_TYPE.viewer) as PermissionType
            }
            onChange={(value: PermissionType) => {
              if (notification.content_parsed) {
                notification.content_parsed.permission = value;
              }
              setMessages([...messages]);
            }}
            disabled={notification.approval?.status !== APPROVE_STATUS.pending}
            type={
              notification.approval?.status === APPROVE_STATUS.pending
                ? "primary"
                : "default"
            }
          />
        </div>

        {/* 部门标签 */}
        {notification.content_parsed?.resource && (
          <div
            className="flex items-center gap-2 cursor-pointer"
            onClick={() => handleResourceClick(notification)}
          >
            <Image
              src={notification.content_parsed.resource.icon}
              width={16}
              height={16}
              preview={false}
            />
            <span className="text-xs text-[#4F5052]">
              {notification.content_parsed.resource.name}
            </span>
          </div>
        )}

        {/* 申请理由 */}
        {notification.content_parsed?.reason && (
          <div className="text-xs text-[#999999] mt-2 break-words">
            申请理由: {notification.content_parsed.reason}
          </div>
        )}
      </div>

      <div className="w-[60px] flex-none">
        {/* 已同意状态 */}
        {notification.approval?.status === APPROVE_STATUS.approved && (
          <div className="mt-2 text-xs text-[#999999]">
            <div className="truncate">
              {notification.approval?.approver_info?.nickname}
            </div>
            已同意
          </div>
        )}

        {/* 已拒绝状态 */}
        {notification.approval?.status === APPROVE_STATUS.rejected && (
          <div className="mt-2 text-xs text-[#999999]">
            <div className="truncate">
              {notification.approval?.approver_info?.nickname}
            </div>
            已拒绝
          </div>
        )}

        {/* 待处理状态 - 带下拉菜单 */}
        {notification.approval?.status === APPROVE_STATUS.pending && (
          <div className="h-7 flex items-center rounded-md bg-[#F5F5F5] overflow-hidden">
            <button
              className="flex-1 text-xs text-[#2563EB]"
              onClick={() => handleApprove(notification)}
            >
              同意
            </button>
            <Dropdown
              menu={{
                items: [
                  {
                    key: "approve",
                    label: (
                      <span className="flex items-center">
                        同意
                        <CheckOutlined className="ml-6 text-[#2563EB]" />
                      </span>
                    ),
                    onClick: () => handleApprove(notification),
                  },
                  {
                    key: "reject",
                    label: "拒绝",
                    onClick: () => handleReject(notification),
                  },
                ],
              }}
              trigger={["click"]}
            >
              <div className="h-7 px-0.5 border-l flex items-center cursor-pointer">
                <DownOutlined className="text-xs" />
              </div>
            </Dropdown>
          </div>
        )}
      </div>
    </>
  );

  // 渲染系统消息内容
  const renderSystemMessage = (notification: RawNotificationItem) => (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-1 mb-1">
        {notification.approval?.approver_info && (
          <span className="text-sm font-medium text-[#1D1E1F] truncate">
            {notification.approval.approver_info.nickname}
          </span>
        )}
        <span className="text-sm text-[#1D1E1F] whitespace-nowrap">
          {notification.approval?.status === APPROVE_STATUS.approved
            ? "已通过你的申请"
            : "已拒绝你的申请"}
        </span>
        <RolePopover
          value={
            (notification.content_parsed?.permission ??
              PERMISSION_TYPE.viewer) as PermissionType
          }
          disabled={true}
        />
        <span className="text-sm text-[#1D1E1F] whitespace-nowrap">权限</span>
      </div>

      {/* 资源标签 */}
      {notification.content_parsed?.resource && (
        <div
          className="flex items-center gap-2 cursor-pointer"
          onClick={() => handleResourceClick(notification)}
        >
          <Image
            src={notification.content_parsed.resource.icon}
            width={16}
            height={16}
            preview={false}
          />
          <span className="text-xs text-[#4F5052]">
            {notification.content_parsed.resource.name}
          </span>
        </div>
      )}
    </div>
  );

  useEffect(() => {
    fetchMessages(true);
    fetchMessageStats();

    // 设置定时器，每60秒获取一次未读消息统计
    statsTimerRef.current = setInterval(() => {
      fetchMessageStats();
    }, 60000);

    return () => {
      if (statsTimerRef.current) {
        clearInterval(statsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setOffset(0);
    setHasMore(true);
    fetchMessages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyUnread]); // 仅在 onlyUnread 变化时触发，不依赖 fetchMessages 避免循环

  const content = (
    <div className="h-full bg-white rounded-lg shadow-lg flex flex-col">
      {/* 头部 */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-gray-100">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-medium text-[#1D1E1F]">消息中心</h3>
          <Checkbox
            checked={onlyUnread}
            onChange={(e) => setOnlyUnread(e.target.checked)}
            className="text-sm text-[#666666]"
          >
            只看未读
          </Checkbox>
        </div>
        <div className="flex items-center">
          <Tooltip title="清空已读消息">
            <Button
              type="text"
              className="hover:!text-red-500"
              onClick={handleMarkAllRead}
              loading={markAllReadLoading}
            >
              <SvgIcon name="clear" size="16" />
            </Button>
          </Tooltip>
          <Button type="text" icon={<CloseOutlined />} onClick={handleClose} />
        </div>
      </div>

      {/* 标签页 */}
      <div className="flex-none px-5 pb-4 flex gap-2.5 border-gray-100 pt-3">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? "text-[#2563EB] border-[#2563EB] bg-[#F2F6FF]"
                : "text-[#999999] bg-[#F5F6F8] hover:bg-[#F5F6F8]"
            }`}
            onClick={() => handleTabChange(tab.key)}
          >
            {tab.label}
            {tab.count > 0 && <span className="ml-1">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto px-2"
          onScroll={handleScroll}
        >
          {filteredMessages.map((notification) => (
            <div
              key={notification.id}
              className="px-4 py-3 rounded-md border-gray-50 hover:bg-[#F5F6F8] transition-colors"
              onMouseEnter={() => handleMessageHover(notification)}
            >
              {/* 时间戳 */}
              <div className="flex items-center gap-1 pb-1">
                <span className="text-xs text-[#999999] whitespace-nowrap">
                  {formatTime(notification.created_time)}
                </span>
                {!notification.is_read && (
                  <div className="w-2 h-2 bg-red-500 rounded-full" />
                )}
              </div>

              <div className="flex items-start gap-2">
                {/* 头像 */}
                <Avatar
                  size={40}
                  src={
                    notification.sender?.avatar ||
                    getPublicPath("/images/default_avatar.png")
                  }
                  className="flex-shrink-0"
                />

                {/* 待处理消息 */}
                {notification.type === MESSAGE_TYPE.pending &&
                  renderPendingMessage(notification)}

                {/* @与评论消息 */}
                {notification.type === MESSAGE_TYPE.mention_comment && (
                  <div className="flex-1 min-w-0"></div>
                )}

                {/* 系统消息 */}
                {notification.type === MESSAGE_TYPE.system &&
                  renderSystemMessage(notification)}
              </div>
            </div>
          ))}

          {/* 加载状态 */}
          {loading && (
            <div className="flex justify-center py-4">
              <LoadingOutlined spin />
            </div>
          )}

          {/* 空状态 */}
          {!loading && messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                <MessageOutlined className="text-2xl text-gray-400" />
              </div>
              <p className="text-sm text-[#999999]">暂无消息</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const isPopoverOpen = externalOpen !== undefined ? externalOpen : isOpen;

  return (
    <Popover
      open={isPopoverOpen}
      content={content}
      trigger={externalOpen !== undefined ? [] : "click"}
      placement="rightBottom"
      getPopupContainer={externalOpen !== undefined ? () => document.body : undefined}
      classNames={{ root: "message-popover" }}
      styles={{ root: { width: 425 } }}
      onOpenChange={(visible) => {
        if (externalOpen !== undefined) {
          // 外部控制模式
          if (!visible) {
            onExternalClose?.();
          }
        } else {
          // 内部控制模式 - 同步 isOpen 状态
          setIsOpen(visible);
          if (visible) {
            fetchMessages(true);
          }
        }
      }}
    >
      {children ?? anchor ?? (externalOpen === undefined ? (
        <div
          className="flex items-center justify-center size-6 rounded cursor-pointer hover:bg-[#EDEDED] relative"
        >
          <SvgIcon name="remind" size="18" className="text-[#4F5052]" />
          {unreadCount > 0 && (
            <div className="absolute top-0 right-0 w-1.5 h-1.5 bg-red-500 rounded-full" />
          )}
        </div>
      ) : null)}
    </Popover>
  );
}

export default MessageCenter;
