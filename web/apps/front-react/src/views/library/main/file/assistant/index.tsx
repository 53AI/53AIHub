import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useCallback,
} from "react";
import { CloseOutlined } from "@ant-design/icons";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { ChatAssistant, ChatRef } from "./Chat";
import { MapAssistant } from "./Map";
import { AgentApp } from "./AgentApp";
import { ChatConfigProvider } from "@km/shared-business/chat";
import { chatAdapters } from "@/adapters/chat-adapters";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { AI_ICON_URL, MAP_ICON_URL } from "../components/sidebar-app-item";
import "./index.css";

interface CustomAppItem {
  setting_id: string;
  logo: string;
  name: string;
}

interface AssistantProps {
  chatAgent: any;
  mapAgent: any;
  fileInfo: any;
  activeMenu: string;
  curCustomApp?: CustomAppItem | null;
  onClose?: () => void;
  onOpen?: () => void;
  onVisible?: (value: boolean) => void;
  onCollapsed?: (value: boolean) => void;
}

export interface AssistantRef {
  open: (isCollapsed?: boolean) => void;
  close: () => void;
  toggle: (isCollapsed?: boolean) => void;
}

const AssistantView = forwardRef<AssistantRef, AssistantProps>(
  (
    {
      chatAgent,
      mapAgent,
      fileInfo,
      activeMenu,
      curCustomApp,
      onClose,
      onOpen,
      onVisible,
      onCollapsed,
    },
    ref,
  ) => {
    const [visible, setVisible] = useState(false);
    const [showChat, setShowChat] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
    const pendingMessageRef = useRef<{ textContent: string; from: string } | null>(null);

    const chatAppRef = useRef<ChatRef>(null);
    const locale = useEnterpriseStore((state) => state.language);

    const maxWidth = "100%";
    const minWidth = "452px";

    const curApp = useMemo(() => {
      if (activeMenu === "chat") {
        return {
          title: t("library.document_chat"),
          img: AI_ICON_URL,
        };
      } else if (activeMenu === "map") {
        return {
          title: t("library.knowledge_map"),
          img: MAP_ICON_URL,
        };
      } else {
        return {
          title: curCustomApp?.name || "",
          img: curCustomApp?.logo || "",
        };
      }
    }, [activeMenu, curCustomApp]);

    const setFileRightSiderStyle = useCallback(() => {
      const fileRightSider = document.querySelector(
        ".file-right-sider",
      ) as HTMLElement;
      if (fileRightSider) {
        fileRightSider.style.cssText = visible
          ? isCollapsed
            ? "flex: 1; overflow: hidden;"
            : "width: 452px; flex: 0 0 452px; overflow: auto;"
          : "";
      }
    }, [visible, isCollapsed]);

    const handleManualSelectEnabled = () => {
      const newValue = !autoSelectEnabled;
      setAutoSelectEnabled(newValue);
      window.dispatchEvent(
        new CustomEvent("viewer-event", {
          detail: { type: "auto-select-enabled", data: newValue },
        }),
      );
    };

    const handleClose = () => {
      setVisible(false);
      setShowChat(false);
      setFileRightSiderStyle();
      onCollapsed?.(false);
      onClose?.();
    };

    const handleOpen = async (collapsed = false) => {
      setVisible(true);
      setIsCollapsed(collapsed);
      onCollapsed?.(collapsed);
      // React equivalent of nextTick - use requestAnimationFrame
      requestAnimationFrame(() => {
        setFileRightSiderStyle();
      });
      onOpen?.();
    };

    const onOpenChat = () => {
      // 如果已经打开，不改变宽度状态
      if (!visible) {
        handleOpen(false);
      }
    };

    const handleMermaidClick = (event: any) => {
      pendingMessageRef.current = {
        textContent: event.text,
        from: "map",
      };
      setShowChat(true);
    };

    useImperativeHandle(ref, () => ({
      open(isCollapsed = false) {
        if (!visible) {
          handleOpen(isCollapsed);
          return;
        }
        setIsCollapsed(isCollapsed);
        setFileRightSiderStyle();
      },
      close() {
        handleClose();
      },
      toggle(isCollapsed = false) {
        if (visible) {
          handleClose();
          return;
        }
        handleOpen(isCollapsed);
      },
    }));

    useEffect(() => {
      onVisible?.(visible);
    }, [visible]);

    // 当 showChat 变为 true 且有待发送消息时，发送消息
    useEffect(() => {
      if (showChat && pendingMessageRef.current) {
        // 等待 ChatAssistant 组件挂载
        const checkAndSend = () => {
          if (chatAppRef.current) {
            chatAppRef.current.send(pendingMessageRef.current!);
            pendingMessageRef.current = null;
          } else {
            requestAnimationFrame(checkAndSend);
          }
        };
        requestAnimationFrame(checkAndSend);
      }
    }, [showChat]);

    useEffect(() => {
      return () => {
        window.dispatchEvent(
          new CustomEvent("viewer-event", {
            detail: { type: "menu", data: [] },
          }),
        );
        handleClose();
      };
    }, []);

    const supportedFileExts = [
      "md",
      "pdf",
      "doc",
      "docx",
      "txt",
      "html",
      "htm",
      "csv",
      "xml",
    ];

    if (!visible) return null;

    return (
      <ChatConfigProvider lang={locale} adapters={chatAdapters}>
        <div
          className="file-chat flex-1 h-full flex flex-col bg-white border-l relative overflow-hidden transition-all duration-300"
          style={{ width: isCollapsed ? maxWidth : minWidth }}
        >
        {/* Header */}
        <div className="flex-none h-[68px] py-1 px-5 flex items-center gap-2 border-b">
          <img
            className="size-5"
            src={curApp.img}
            alt=""
            onError={(e) => {
              (e.target as HTMLImageElement).src = AI_ICON_URL;
            }}
          />
          <div className="flex-1 text-base text-[#1D1E1F]">{curApp.title}</div>
          {supportedFileExts.includes(fileInfo?.file_ext) &&
            activeMenu === "chat" && (
              <div
                className={`size-5 rounded flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7] ${
                  autoSelectEnabled ? "text-[#2563EB]" : ""
                }`}
                title={
                  autoSelectEnabled
                    ? t("library.close_auto_select")
                    : t("library.open_auto_select")
                }
                onClick={handleManualSelectEnabled}
              >
                <SvgIcon name="open-auto-select" />
              </div>
            )}
        </div>

        {/* Chat Section */}
        {((activeMenu === "chat" && chatAgent) || showChat) && (
          <div
            className={
              activeMenu !== "chat"
                ? "absolute inset-0 z-[1001] bg-[rgba(0,0,0,0.5)] flex flex-col"
                : "flex-1 overflow-hidden"
            }
          >
            {showChat && (
              <>
                <CloseOutlined
                  className="absolute top-[90px] right-2 z-[1002] cursor-pointer"
                  onClick={() => setShowChat(false)}
                />
                <div className="h-20" />
              </>
            )}
            <ChatAssistant
              agentInfo={chatAgent}
              fileInfo={fileInfo}
              autoSelectEnabled={autoSelectEnabled}
              ref={chatAppRef}
              onOpenAi={onOpenChat}
            />
          </div>
        )}

        {/* Map Section */}
        {activeMenu === "map" && mapAgent && (
          <MapAssistant
            agentInfo={mapAgent}
            fileInfo={fileInfo}
            onMermaidClick={handleMermaidClick}
          />
        )}

        {/* Custom Agent Section */}
        {activeMenu !== "chat" && activeMenu !== "map" && curCustomApp && (
          <AgentApp agentInfo={curCustomApp} fileInfo={fileInfo} />
        )}
      </div>
      </ChatConfigProvider>
    );
  },
);

AssistantView.displayName = "AssistantView";

export { AssistantView };
export default AssistantView;
