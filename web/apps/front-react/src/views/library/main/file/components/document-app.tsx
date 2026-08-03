import { useState, useEffect, useRef, lazy, Suspense, useCallback } from "react";
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
}

const DOCUMENT_APPLICATION = "document_application";

// Lazy load the AssistantIndex component
const AssistantIndex = lazy(() => import("../assistant"));

function DocumentApp({ onHide }: DocumentAppProps) {
  const location = useLocation();
  const libraryStore = useLibraryStore();

  const [install, setInstall] = useState(false);
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
    const res = await agentsApi.list({
      agent_usages: `${AGENT_USAGES.KM_FILE_CHAT},${AGENT_USAGES.KM_FILE_MAP}`,
    });
    const chat = res.agents.find(
      (item) => item.agent_usage === AGENT_USAGES.KM_FILE_CHAT,
    );
    const map = res.agents.find(
      (item) => item.agent_usage === AGENT_USAGES.KM_FILE_MAP,
    );
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

      if (cachedChat || cachedMap || cachedApps.length > 0) {
        setChatAgent(cachedChat);
        setMapAgent(cachedMap);
        setCustomApps(cachedApps);
        setInstall(!!(cachedChat || cachedMap || cachedApps.length > 0));
        setInitialized(true);
        autoSelectFirst(cachedChat, cachedMap, cachedApps);
        return;
      }

      // 无缓存时加载
      const apps = await loadDocumentAppList();
      const { chatInfo, mapInfo } = await loadAgent(apps);

      setInitialized(true);
      autoSelectFirst(chatInfo, mapInfo, apps);
    };
    init();
  }, [autoSelectFirst]);

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
