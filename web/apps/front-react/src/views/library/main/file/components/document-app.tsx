import { useState, useEffect, useRef, lazy, Suspense, useCallback, cloneElement, type ReactElement } from "react";
import { useLocation } from "react-router-dom";
import { Tooltip } from "antd";
import agentsApi from "@/api/modules/agents";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import { AGENT_USAGES } from "@/constants/agent";
import { settingApi } from "@/api/modules/setting";
import { useLibraryStore } from "@/stores/modules/library";
import { SvgIcon } from "@km/shared-components-react";
import { t } from "@/locales";
import { eventBus } from "@km/shared-utils";
import { getPublicPath } from "@/utils/config";
import SidebarAppItem, { AI_ICON_URL, MAP_ICON_URL } from "./sidebar-app-item";
interface CustomAppItem {
  setting_id: string;
  logo: string;
  name: string;
}

interface AgentInfo {
  agent_id: string;
  name: string;
  logo: string;
  enable: boolean;
  agent_usage: number;
  settings: Record<string, any>;
  tools: Record<string, any>;
  use_cases: Record<string, any>;
  custom_config: Record<string, any>;
  configs: Record<string, any>;
  [key: string]: any;
}

interface DocumentAppProps {
  onHide?: () => void;
  /** 聊天 agent_usage，默认 KM_FILE_CHAT (2) */
  chatAgentUsage?: number;
  /**
   * 地图 agent_usage，默认 KM_FILE_MAP (3)。
   * 显式传 null 表示禁用知识地图（如录音端只提供聊天）。
   */
  mapAgentUsage?: number | null;
  /**
   * 是否展示「参谋洞察」入口。仅录音端 + 后台开关 insight_regenerate_enabled = true 时为 true。
   * 知识库场景默认 false，保持组件行为不变。
   */
  showInsightRegenerate?: boolean;
  /**
   * 「参谋洞察」入口对应的内联面板节点（无 Modal 包装）。
   * 由调用方（RecordingPreview）注入，避免本组件反向依赖 recording 模块。
   * 仅当 showInsightRegenerate=true 时会被消费。
   */
  insightRegeneratePanel?: ReactElement;
  /** 参谋洞察入口的图标 URL（默认 insight.png） */
  insightRegenerateIconUrl?: string;
  /** 参谋洞察入口的标题文本（默认取 t('recording.insight_regenerate')） */
  insightRegenerateLabel?: string;
  /**
   * 参谋洞察接口调用成功后的回调。
   * DocumentApp 内部会先关闭洞察面板，再调用此回调（用于父级刷新列表 / 轮询等）。
   */
  onInsightRegenerateStarted?: () => void;
  /**
   * 任意解析阶段是否还在跑（pending/parsing/processing）。由父级透传给 insightRegeneratePanel，
   * 用于面板在生成中再次提交时弹出确认提示 / 锁住按钮。仅录音端使用。
   */
  parseStatusRunning?: boolean;
}

const DOCUMENT_APPLICATION = "document_application";

// Lazy load the AssistantIndex component
const AssistantIndex = lazy(() => import("../assistant"));

function DocumentApp({
  onHide,
  chatAgentUsage,
  mapAgentUsage,
  showInsightRegenerate = false,
  insightRegeneratePanel,
  insightRegenerateIconUrl,
  insightRegenerateLabel,
  onInsightRegenerateStarted,
  parseStatusRunning,
}: DocumentAppProps) {
  const location = useLocation();
  const libraryStore = useLibraryStore();

  const [install, setInstall] = useState(false);
  // activeMenu 取值：
  //   ''            - 面板未打开
  //   'chat'        - 文档助手
  //   'map'         - 知识地图
  //   'insight-regenerate' - 录音端「参谋洞察」（kebab-case 与文案保持字面一致，
  //                         prop 系列保留 camelCase：insightRegenerate*）
  //   <setting_id>  - 自定义应用
  const [activeMenu, setActiveMenu] = useState("");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [chatAgent, setChatAgent] = useState<AgentInfo | null>(null);
  const [mapAgent, setMapAgent] = useState<AgentInfo | null>(null);
  const [customApps, setCustomApps] = useState<CustomAppItem[]>([]);
  const [curAgentInfo, setCurAgentInfo] = useState<CustomAppItem | null>(null);
  const [visible, setVisible] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // 订阅 store 的 assistantVisible，用于处理用户快速点击的情况
  const storeAssistantVisible = useLibraryStore((state) => state.assistantVisible);

  const assistantIndexRef = useRef<any>(null);
  const toggleRef = useRef<() => void>(() => {});
  const onHideRef = useRef<(() => void) | undefined>(onHide);

  const loadAgent = async (apps: CustomAppItem[] = []) => {
    const resolvedChatUsage = chatAgentUsage ?? AGENT_USAGES.KM_FILE_CHAT;
    // mapAgentUsage === null 表示显式禁用；undefined 走默认 KM_FILE_MAP
    const resolvedMapUsage =
      mapAgentUsage === null
        ? null
        : (mapAgentUsage ?? AGENT_USAGES.KM_FILE_MAP);
    const usages =
      resolvedMapUsage == null
        ? `${resolvedChatUsage}`
        : `${resolvedChatUsage},${resolvedMapUsage}`;
    const res = await agentsApi.list({
      agent_usages: usages,
    });
    const chat = res.agents.find(
      (item) => item.agent_usage === resolvedChatUsage,
    );
    const map =
      resolvedMapUsage == null
        ? undefined
        : res.agents.find((item) => item.agent_usage === resolvedMapUsage);
    const chatInfo = chat && chat.enable ? transformAgentInfo(chat) : null;
    const mapInfo = map && map.enable ? transformAgentInfo(map) : null;

    if (chatInfo) setChatAgent(chatInfo);
    if (mapInfo) setMapAgent(mapInfo);

    const hasInstall = res.agents.some((item: any) => item.enable) || apps.length > 0;
    setInstall(hasInstall);
    useLibraryStore.getState().setAssistantInstall(hasInstall);

    // 缓存到 store
    useLibraryStore.getState().setAssistantAgents(chatInfo, mapInfo, apps);

    return { chatInfo, mapInfo };
  };

  const loadDocumentAppList = async () => {
    const result =
      await settingApi.documentApp.agentAppList(DOCUMENT_APPLICATION);
    if (result.data && result.data.length > 0) {
      const apps = result.data
        .filter((item: any) => !item.isAdd)
        .map((item: any) => {
          return {
            ...JSON.parse(item.value),
            setting_id: item.setting_id,
          };
        });
      setCustomApps(apps);
      return apps;
    } else {
      setCustomApps([]);
      return [];
    }
  };

  // 自动选中第一个可用项
  const autoSelectFirst = useCallback(
    (chat: AgentInfo | null, map: AgentInfo | null, apps: CustomAppItem[]) => {
      if (chat?.enable) {
        setActiveMenu("chat");
        setIsCollapsed(true);
      } else if (map?.enable) {
        setActiveMenu("map");
        setIsCollapsed(true);
      } else if (apps.length > 0) {
        setActiveMenu(apps[0].setting_id);
        setCurAgentInfo(apps[0]);
        setIsCollapsed(true);
      }
    },
    [],
  );
  
  const handleToggleMenu = () => {
    // 如果已有选中的菜单项，直接关闭整个面板
    if (activeMenu) {
      assistantIndexRef.current?.close();
      setActiveMenu("");
      setIsCollapsed(false);
      onHideRef.current?.();
      return;
    }
    // 否则选择第一个可用的菜单项
    if (chatAgent?.enable) {
      handleClickMenu("chat");
      return;
    }
    if (mapAgent?.enable) {
      handleClickMenu("map");
      return;
    }
    const firstApp = customApps[0];
    if (firstApp) {
      handleClickMenu(firstApp.setting_id, firstApp);
    }
  };

  // Keep ref updated with latest handler
  useEffect(() => {
    toggleRef.current = handleToggleMenu;
    onHideRef.current = onHide;
  }, [activeMenu, chatAgent, mapAgent, customApps, onHide]);

  const handleBottomToggle = () => {
    if (!activeMenu) {
      setActiveMenu("chat");
    }
    setIsCollapsed(!isCollapsed);
    assistantIndexRef.current?.open(isCollapsed);
    libraryStore.setAssistantCollapsed(!isCollapsed);
  };

  const handleClickMenu = (menu: string, item?: CustomAppItem) => {
    // 点击已选中的菜单项，不做任何操作
    if (activeMenu === menu) {
      return;
    }
    setActiveMenu(menu);
    if (item) {
      setCurAgentInfo(item);
    }
    // 点击菜单项时总是以 collapsed = true 打开（452px）
    setIsCollapsed(true);
    assistantIndexRef.current?.open(true);
  };

  const handleVisible = useCallback((value: boolean) => {
    setVisible(value);
    libraryStore.setAssistantExpanded(value);
  }, [libraryStore]);

  const handleCollapsed = useCallback((value: boolean) => {
    setIsCollapsed(value);
    libraryStore.setAssistantCollapsed(value);
  }, [libraryStore]);

  // Watch route query changes
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get("openAi") === "true") {
      handleToggleMenu();
    }
  }, [location.search]);

  // Watch route path changes - 切换文件时关闭面板
  useEffect(() => {
    if (visible || activeMenu) {
      assistantIndexRef.current?.close();
      setActiveMenu("");
      setIsCollapsed(false);
      onHideRef.current?.();
    }
  }, [location.pathname]);

  useEffect(() => {
    const init = async () => {
      // 检查缓存，有则直接使用
      const cachedState = useLibraryStore.getState();
      const cachedChat = cachedState.assistantChatAgent;
      const cachedMap = cachedState.assistantMapAgent;
      const cachedApps = cachedState.assistantCustomApps;
      // 缓存必须匹配当前期望的 agent_usage，避免录音（usage=5）污染知识库（usage=2/3）
      const expectedChatUsage = chatAgentUsage ?? AGENT_USAGES.KM_FILE_CHAT;
      const expectedMapUsage =
        mapAgentUsage === null
          ? null
          : (mapAgentUsage ?? AGENT_USAGES.KM_FILE_MAP);
      const chatMatches =
        !cachedChat || cachedChat.agent_usage === expectedChatUsage;
      const mapMatches =
        expectedMapUsage == null
          ? !cachedMap
          : !cachedMap || cachedMap.agent_usage === expectedMapUsage;
      const cacheValid = chatMatches && mapMatches;

      if (
        cacheValid &&
        (cachedChat || cachedMap || cachedApps.length > 0)
      ) {
        setChatAgent(cachedChat);
        setMapAgent(cachedMap);
        setCustomApps(cachedApps);
        setInstall(!!(cachedChat || cachedMap || cachedApps.length > 0));
        setInitialized(true);
        autoSelectFirst(cachedChat, cachedMap, cachedApps);
        return;
      }

      // 缓存失效或不存在，重新加载
      const apps = await loadDocumentAppList();
      const { chatInfo, mapInfo } = await loadAgent(apps);

      setInitialized(true);
      autoSelectFirst(chatInfo, mapInfo, apps);
    };
    init();
  }, [autoSelectFirst, chatAgentUsage, mapAgentUsage]);

  // 当 activeMenu 设置后，等待 AssistantIndex 挂载然后打开
  useEffect(() => {
    if (!initialized || !activeMenu) return;

    let attempts = 0;
    const maxAttempts = 50;

    const tryOpen = () => {
      if (assistantIndexRef.current) {
        assistantIndexRef.current.open(true);
        handleVisible(true);
      } else if (attempts < maxAttempts) {
        attempts++;
        requestAnimationFrame(tryOpen);
      }
    };

    requestAnimationFrame(tryOpen);
  }, [initialized, activeMenu]);

  // 处理用户快速点击：当面板打开但数据未加载时，等待加载完成后自动选中第一项
  useEffect(() => {
    if (!storeAssistantVisible || !initialized || activeMenu) return;
    autoSelectFirst(chatAgent, mapAgent, customApps);
  }, [storeAssistantVisible, initialized, activeMenu, chatAgent, mapAgent, customApps, autoSelectFirst]);

  // Listen for external toggle event
  useEffect(() => {
    const handleToggle = () => {
      toggleRef.current();
    };
    eventBus.on("assistant-toggle", handleToggle);
    return () => {
      eventBus.off("assistant-toggle", handleToggle);
    };
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      libraryStore.setAssistantExpanded(false);
    };
  }, []);


  const currentFile = libraryStore.currentFile();

  return (
    <div className="w-full h-full rounded-lg bg-white shadow-lg flex justify-between overflow-hidden sticky right-0">
      <Suspense fallback={null}>
        <AssistantIndex
          ref={assistantIndexRef}
          activeMenu={activeMenu}
          chatAgent={chatAgent}
          mapAgent={mapAgent}
          fileInfo={currentFile}
          curCustomApp={curAgentInfo}
          onVisible={handleVisible}
          onCollapsed={handleCollapsed}
          onClose={() => setActiveMenu("")}
          insightRegeneratePanel={
            showInsightRegenerate && insightRegeneratePanel
              ? cloneElement(insightRegeneratePanel, {
                  parseStatusRunning,
                  onRegenerateStarted: () => {
                    // 仅透传给父级去刷新主视图洞察 Tab；不要在这里 close() / setActiveMenu("")，
                    // 否则下次点「文档助手」按钮时 handleToggleMenu 会因为 activeMenu 为空而
                    // 自动打开第一个可用项（chat），表现为「提交后自动跳到文档助手」。
                    // 让用户保留在「参谋洞察」面板内，背景可继续修改，按钮反馈由面板自身处理。
                    onInsightRegenerateStarted?.();
                  },
                })
              : null
          }
          insightRegenerateHeader={
            showInsightRegenerate
              ? {
                  title: insightRegenerateLabel || t("recording.insight_regenerate"),
                  img: insightRegenerateIconUrl || getPublicPath("/images/recording/insight.png"),
                }
              : undefined
          }
        />
      </Suspense>
      <div></div>
      <div
        className={`flex-none w-12 h-full relative z-[2] bg-white flex flex-col border-l ${!visible ? "border-l-transparent" : ""}`}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col items-center gap-3 pt-4">
          <Tooltip
            placement="left"
            title={activeMenu ? t("action.collapse") : t("action.expand")}
          >
            <div
              className={`size-[38px] flex-center rounded-md cursor-pointer hover:shadow-[0_2px_8px_#0b1b403d] relative ${activeMenu ? "text-[#2563EB]" : ""}`}
              onClick={handleToggleMenu}
            >
              <SvgIcon
                name={activeMenu ? "expand-left" : "expand-right"}
                size={20}
              />
            </div>
          </Tooltip>
          <div className="border-t w-[38px] mt-px"></div>
          {chatAgent?.enable && (
            <SidebarAppItem
              icon={AI_ICON_URL}
              title={t("library.document_chat")}
              active={activeMenu === "chat"}
              onClick={() => handleClickMenu("chat")}
            />
          )}
          {mapAgent?.enable && (
            <SidebarAppItem
              icon={MAP_ICON_URL}
              title={t("library.knowledge_map")}
              active={activeMenu === "map"}
              onClick={() => handleClickMenu("map")}
            />
          )}
          {showInsightRegenerate && (
            <SidebarAppItem
              icon={insightRegenerateIconUrl || getPublicPath("/images/recording/insight.png")}
              title={insightRegenerateLabel || t("recording.insight_regenerate")}
              active={activeMenu === "insight-regenerate"}
              onClick={() => handleClickMenu("insight-regenerate")}
            />
          )}
          {customApps.map((item) => (
            <SidebarAppItem
              key={item.setting_id}
              icon={item.logo}
              title={item.name}
              active={activeMenu === item.setting_id}
              iconSize="small"
              onClick={() => handleClickMenu(item.setting_id, item)}
            />
          ))}
        </div>
        {visible && (
          <div
            className="size-[38px] flex-center mx-auto cursor-pointer rounded-md hover:shadow-[0_2px_8px_#0b1b403d]"
            onClick={handleBottomToggle}
          >
            <SvgIcon
              name={
                !isCollapsed
                  ? "right-bar-bottom-collapse"
                  : "right-bar-bottom-expand"
              }
              size={19}
              color="#999"
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default DocumentApp;
