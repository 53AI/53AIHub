import { useState, useEffect, useMemo, useRef } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { Modal, Skeleton, message } from "antd";
import { SvgIcon, Dropdown } from "@km/shared-components-react";
import type { MenuProps } from "@km/shared-components-react";
import { ExpandSidebarButton } from "@/components/Layout/ExpandSidebarButton";
import { GroupList } from "@/views/agent/components/GroupList";
import { MyList } from "@/views/agent/components/MyList";
import agentShortcutsApi from "@/api/modules/agent-shortcuts";
import type { AgentShortcutItem } from "@/api/modules/agent-shortcuts/types";
import { useAgentStore } from "@/stores/modules/agent";
import { AGENT_USAGES } from "@/constants/agent";
import { t } from "@/locales";
import { getFormatTimeStamp, eventBus } from "@km/shared-utils";
import { EVENT_NAMES } from "@/constants/events";
import { checkLoginStatus } from "@/utils/permission";
import "./index.css";
import { MoreOutlined, DeleteOutlined } from "@ant-design/icons";
import { getPublicPath } from '@/utils/config';



/** 动态导航项类型 */
interface NavItem {
  path: string;
  label: string;
  description: string;
  lastMessageContent: string
  logo?: string;
  agentId?: string;
  shortcutId: string;
  isFixed: boolean;
  isPinned: boolean;
  agentUsage?: number;
  lastMessageTime?: number;
  is_system?: boolean
}

/** 将快捷方式列表项转换为导航项 */
function shortcutToNavItem(shortcut: AgentShortcutItem): NavItem {
  return {
    path: `/agent/agent?agent_id=${shortcut.agent_id}`,
    label: shortcut.agent_name,
    lastMessageContent: shortcut.last_message_content,
    description: shortcut.agent_description,
    logo: shortcut.agent_logo,
    agentId: shortcut.agent_id,
    shortcutId: shortcut.agent_id,
    isFixed: false,
    isPinned: shortcut.is_pinned,
    agentUsage: shortcut.agent_usage,
    lastMessageTime: shortcut.last_message_time,
    is_system: shortcut.is_system
  };
}

export function IndexSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [showExploreModal, setShowExploreModal] = useState(false);
  const [shortcuts, setShortcuts] = useState<AgentShortcutItem[]>([]);
  const [loading, setLoading] = useState(true);
  const activeItemRef = useRef<HTMLAnchorElement>(null);
  const [activeType, setActiveType] = useState('explore')

  // 将快捷方式列表转换为导航项，并根据权限过滤
  const navItems = useMemo(() => {
    return shortcuts
      .map(shortcutToNavItem)
  }, [shortcuts]);

  // 获取快捷方式列表
  const fetchShortcuts = useMemo(() => async (loading = true) => {
    try {
      setLoading(loading);
      // 拉取用户快捷方式：未登录或未配置时会失败/为空
      let data: AgentShortcutItem[] = [];
      try {
        data = (await agentShortcutsApi.list()) || [];
      } catch (err) {
        // 未登录鉴权失败时静默处理，落到下面的默认 agent 逻辑
        data = [];
      }
      
      // 快捷方式为空时，通过 agent store 的 loadAgentList 获取默认智能体
      if (data.length === 0) {
        try {
          const agentList = await useAgentStore.getState().loadAgentList();
          const agent = agentList.find(
            (item) => item.agent_usage === AGENT_USAGES.KM_AI_SEARCH,
          ) as Agent.State | undefined;
          if (agent) {
            data = [
              {
                id: 0,
                agent_id: String(agent.agent_id),
                is_pinned: false,
                last_message_time: 0,
                last_message_content: "",
                agent_name: agent.name || "",
                agent_logo: agent.logo || "",
                agent_description: agent.description || "",
                agent_usage: AGENT_USAGES.KM_AI_SEARCH,
                channel_type: agent.channel_type || 0,
                created_time: 0,
                updated_time: 0,
                is_system: agent.is_system
              },
            ];
          }
        } catch (err) {
          console.error("Failed to load default agent:", err);
        }
      }

      setShortcuts(
        data.map((item) => {
          if (item.agent_usage === AGENT_USAGES.KM_AI_SEARCH) {
            item.agent_name = item.agent_name || "AI搜问";
            item.agent_logo = item.agent_logo || getPublicPath("/images/chat/knowledge.png");
          } else if (item.agent_usage === AGENT_USAGES.WORK_AI) {
            item.agent_name = item.agent_name || "小助理";
            item.agent_logo = item.agent_logo || getPublicPath("/images/chat/workbench.png");
          }
          return item;
        }),
      );
    } catch (error) {
      console.error("Failed to fetch agent shortcuts:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载快捷方式列表
  useEffect(() => {
    fetchShortcuts();
  }, [fetchShortcuts]);

  // 当加载完成且路径为 /agent/agent 无 agent_id 时，导航到默认智能体
  // 优先选 KM_AI_SEARCH（chat/AI搜问）的快捷方式，找不到再退回 navItems[0]
  // 显示顺序保持 API 原顺序不变，本逻辑仅影响默认导航目标
  useEffect(() => {
    if (!loading && navItems.length > 0) {
      const params = new URLSearchParams(location.search);
      const currentAgentId = params.get("agent_id");

      if (!currentAgentId) {
        const chatItem = navItems.find((item) => item.agentUsage === AGENT_USAGES.KM_AI_SEARCH && item.is_system);
        const defaultItem = chatItem || navItems[0];
        if (defaultItem.agentId) {
          navigate(`/agent/agent?agent_id=${defaultItem.agentId}`, { replace: true });
        }
      }
    }
  }, [loading, navItems, location.search, navigate]);

  // 监听快捷方式添加事件，刷新列表
  useEffect(() => {
    const handleShortcutAdded = () => {
      fetchShortcuts();
    };
    eventBus.on(EVENT_NAMES.SHORTCUT_ADDED, handleShortcutAdded);
    return () => {
      eventBus.off(EVENT_NAMES.SHORTCUT_ADDED, handleShortcutAdded);
    };
  }, [fetchShortcuts]);

  // 监听快捷方式更新事件（聊天后刷新 last_message_time）
  useEffect(() => {
    const handleShortcutUpdated = () => {
      fetchShortcuts(false);  // 静默刷新，不显示 loading
    };
    eventBus.on(EVENT_NAMES.SHORTCUT_UPDATED, handleShortcutUpdated);
    return () => {
      eventBus.off(EVENT_NAMES.SHORTCUT_UPDATED, handleShortcutUpdated);
    };
  }, [fetchShortcuts]);

  // 监听登录成功事件，刷新快捷方式列表
  useEffect(() => {
    const handleLoginSuccess = () => {
      fetchShortcuts();
    };
    eventBus.on(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
    return () => {
      eventBus.off(EVENT_NAMES.LOGIN_SUCCESS, handleLoginSuccess);
    };
  }, [fetchShortcuts]);

  // 刷新后滚动到选中的智能体
  useEffect(() => {
    if (!loading && activeItemRef.current) {
      activeItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [loading]);

  // 置顶/取消置顶（静默更新）
  const handlePin = async (item: NavItem) => {
    if (!item.agentId) return;
    try {
      await agentShortcutsApi.pin(item.agentId, !item.isPinned);
      message.success(item.isPinned ? t('action.unpin_success') : t('action.pin_success'));
      fetchShortcuts(false);
    } catch (error) {
      message.error(t('action.operation_failed'));
    }
  };

  // 删除快捷方式（二次确认）
  const handleDelete = (item: NavItem) => {
    if (!item.agentId) return;

    // 判断是否是当前正在聊的智能体
    const params = new URLSearchParams(location.search);
    const currentAgentId = params.get("agent_id");
    const isActiveAgent = !item.isFixed && currentAgentId === item.agentId;

    Modal.confirm({
      title: t('common.confirm_delete'),
      okText: t('action.confirm'),
      okType: 'danger',
      cancelText: t('action.cancel'),
      onOk: async () => {
        try {
          await agentShortcutsApi.delete(item.agentId);
          const remainingShortcuts = shortcuts.filter(s => s.agent_id !== item.agentId);
          setShortcuts(remainingShortcuts);
          message.success(t('action.delete_success'));
          // 如果删除的是当前正在聊的智能体，跳转到列表第一个
          if (isActiveAgent && remainingShortcuts.length > 0) {
            const firstShortcut = remainingShortcuts[0];
            navigate(`/agent/agent?agent_id=${firstShortcut.agent_id}`);
          }
        } catch (error) {
          message.error(t('action.operation_failed'));
        }
      },
    });
  };

  return (
    <div className="w-[252px] h-full py-3 bg-[#fff] border-r border-[#E5E7EB] flex flex-col shrink-0">
      <div className="px-5 h-9 flex items-center gap-2">
        <ExpandSidebarButton />
        <div className="flex-1 text-sm text-[#1D1E1F]">{t('workbench.title')}</div>
        <div className="cursor-pointer flex items-center gap-1 text-primary" onClick={() => {
          if (!checkLoginStatus()) return
          setShowExploreModal(true);
        }}>
          <SvgIcon name="add-one" size={16} />
          <span className="text-sm">
            { t('action.add') }
          </span>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto p-2 space-y-1">
        {/* 加载中显示骨架屏 */}
        {loading && (
          <div className="p-3">
            <Skeleton active paragraph={{ rows: 0 }} />
          </div>
        )}

        {/* 按API返回顺序渲染导航项 */}
        {!loading &&
          navItems.map((item) => {
            // 自定义 active 判断
            const params = new URLSearchParams(location.search);
            const currentAgentId = params.get("agent_id");
            // 固定项按路径匹配，动态智能体按 agent_id 参数匹配
            const isActive = location.pathname === "/agent/agent" && currentAgentId === item.agentId;

            // 下拉菜单项
            const menuItems: MenuProps['items'] = [
              // {
              //   key: 'pin',
              //   icon: <VerticalAlignTopOutlined />,
              //   label: item.isPinned ? t('action.unpin') : t('action.pin'),
              //   onClick: () => handlePin(item),
              // },
            ];

            // 非固定项才显示删除
            if (item.is_system ? item.agentUsage !== AGENT_USAGES.KM_AI_SEARCH : true) {
              menuItems.push({
                key: 'delete',
                icon: <DeleteOutlined />,
                label: t('action.delete'),
                danger: true,
                onClick: () => handleDelete(item),
              });
            }

            return (
              <NavLink
                key={item.shortcutId}
                to={item.path}
                ref={isActive ? activeItemRef : null}
                className={() =>
                  `group flex items-center gap-2.5 p-3 rounded-xl transition-colors ${
                    isActive
                      ? "bg-[#E7EFFB]"
                        : item.isPinned
                          ? "bg-[#F5F0FF]"
                          : "hover:bg-[#E7EFFB]"
                  }`
                }
              >
                <div className="flex-none size-9 rounded-full overflow-hidden">
                  {item.logo ? (
                    <img
                      src={item.logo}
                      alt={item.label}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <SvgIcon name="agent" size={18} />
                  )}
                </div>
                <div className="flex-1 overflow-hidden">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex-1 text-sm text-[#1D1E1F] truncate">{item.label}</p>
                    {/* 时间和三个点互斥显示 */}
                    {item.lastMessageTime > 0 && (
                      <span className={`text-xs text-[#9CA3AF] ${ menuItems.length > 0 ? 'group-hover:hidden' : '' }  `}>
                        {getFormatTimeStamp(new Date(item.lastMessageTime).toISOString())}
                      </span>
                    )}
                    
                  </div>
                  <p className="text-xs text-[#888994] truncate mt-0.5">
                    { item.lastMessageContent || item.description || '--'}
                  </p>
                </div>
                { menuItems.length > 0 &&  <Dropdown
                  menu={{ items: menuItems }}
                  trigger={['click']}
                  placement="bottomRight"
                >
                  <div
                    className="hidden group-hover:flex size-6 items-center justify-center rounded hover:bg-[#E5E7EB] transition-opacity"
                    onClick={(e) => e.preventDefault()}
                  >
                    <MoreOutlined className="text-[#6B7280]" />
                  </div>
                </Dropdown>}
              </NavLink>
            );
          })}
      </nav>

      {/* AI门户弹窗 */}
      <Modal
        open={showExploreModal}
        onCancel={() => setShowExploreModal(false)}
        footer={null}
        width={1260}
        align-center
        destroyOnClose
        maskClosable={false}
      >
        <div className="h-[732px] flex flex-col">
          <div
            className="flex items-center gap-5"
          >
            <div
              className={`text-lg leading-6 font-medium flex items-center cursor-pointer relative  ${activeType === "explore" ? "text-[#1D1E1F]" : "text-[#999999]"}`}
              onClick={() => {
                setActiveType("explore");
              }}
            >
              {t("agent.explore")}
              {activeType === "explore" && (
                <SvgIcon
                  name="explore"
                  size={20}
                  className="absolute -right-5 -top-2"
                  color="var(--el-color-primary, #2563eb)"
                />
              )}
            </div>
            <div
              className={`text-lg leading-6 font-medium flex  items-center cursor-pointer relative  ${activeType === "my" ? "text-[#1D1E1F]" : "text-[#999999]"}`}
              onClick={() => {
                setActiveType("my");
              }}
            >
              {t("module.mine")}
              {activeType === "my" && (
                <SvgIcon
                  name="explore"
                  size={20}
                  className="absolute -right-5 -top-2"
                  color="var(--el-color-primary, #2563eb)"
                />
              )}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto pt-3">
            {activeType === "explore" ? (
              <GroupList
                sticky={false}
                canView={false}
                paginated
                onSelect={() => setShowExploreModal(false)}
              />
            ) : (
              <MyList
                canView={false}
                paginated
                onSelect={() => setShowExploreModal(false)}
              />
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default IndexSidebar;
