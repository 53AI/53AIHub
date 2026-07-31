import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Tooltip, Spin } from "antd";
import { t } from "@/locales";
import { SvgIcon } from "@km/shared-components-react";
import { ChatConfigProvider } from "@km/shared-business/chat";
import { chatAdapters } from "@/adapters/chat-adapters";
import { useEnterpriseStore } from "@/stores/modules/enterprise";
import { useKnowledgeAssistantStore } from "@/stores/modules/knowledge-assistant";
import { useSpaceStore } from "@/stores/modules/space";
import { AI_ICON_URL } from "@/views/library/main/file/components/sidebar-app-item";
import wikiApi from "@/api/modules/wiki";
import agentsApi from "@/api/modules/agents";
import { transformAgentInfo } from "@/api/modules/agents/transform";
import { AGENT_USAGES } from "@/constants/agent";

// Lazy load ChatAssistant
const ChatAssistant = lazy(() => import("@/views/library/main/file/assistant/Chat"));

/**
 * 文档引用统一（v0.4.2 §3.4 / §5.4 / §6.4）：
 * - 动态知识助手始终把当前页面作为「Wiki 单文档」会话打开。
 * - fileInfo.id 必须是 Wiki 页面的 Hashid（detail.page.id），下游链路用它作为
 *   document_id 与 wiki_search_config.wiki_page_ids；slug 仅用于路由。
 * - fileInfo.document_type = 'wiki'：让 ChatAssistant/createConversation 与
 *   useChatSend 切到 Wiki 单文档模式分支。
 */
type DocumentType = "file" | "wiki";

interface KnowledgeFileInfo {
  id: string;
  document_type: DocumentType;
  name: string;
  summary: string;
  questions: string[];
  file_ext: string;
  icon: string;
  library_id?: string;
  slug?: string;
  space_id?: string
}

function buildEmptyFileInfo(selectedItemId: string): KnowledgeFileInfo {
  // 没有详情时也要带上 document_type='wiki'，保证首次进入时也能触发 Wiki 单文档模式
  return {
    id: selectedItemId,
    document_type: "wiki",
    name: "",
    summary: "",
    questions: [],
    file_ext: "md",
    icon: "",
    slug: selectedItemId,
    space_id: ''
  };
}

interface KnowledgeAssistantProps {
  selectedItemId: string;
}

function KnowledgeAssistant({ selectedItemId }: KnowledgeAssistantProps) {
  const collapsed = useKnowledgeAssistantStore((state) => state.collapsed);
  const setCollapsed = useKnowledgeAssistantStore((state) => state.setCollapsed);
  const setVisible = useKnowledgeAssistantStore((state) => state.setVisible);
  const spaceId = useSpaceStore((state) => state.spaceId);

  const chatRef = useRef<any>(null);
  const locale = useEnterpriseStore((state) => state.language);

  // 真实的 agent 信息
  const [chatAgent, setChatAgent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // 页面详情 → 构造 fileInfo（按文档引用统一规范，id 必须是 page.id 即 Hashid）
  const [fileInfo, setFileInfo] = useState<KnowledgeFileInfo>(() =>
    buildEmptyFileInfo(selectedItemId),
  );

  // 加载 agent 信息
  useEffect(() => {
    const loadAgent = async () => {
      try {
        setLoading(true);
        const res = await agentsApi.list({
          agent_usages: `${AGENT_USAGES.KM_FILE_CHAT}`,
        });
        const chat = res.agents.find(
          (item) => item.agent_usage === AGENT_USAGES.KM_FILE_CHAT,
        );
        if (chat && chat.enable) {
          setChatAgent(transformAgentInfo(chat));
        }
      } catch (error) {
        console.error("加载 agent 信息失败:", error);
      } finally {
        setLoading(false);
      }
    };
    loadAgent();
  }, []);

  // 加载页面详情（按 selectedItemId 即 slug）；并把 page.id（Hashid）作为 fileInfo.id
  useEffect(() => {
    if (!spaceId || !selectedItemId) {
      setFileInfo(buildEmptyFileInfo(selectedItemId));
      return;
    }
    let mounted = true;
    wikiApi
      .page(spaceId, selectedItemId)
      .then((res) => {
        if (!mounted) return;
        const title = res?.current_version?.title ?? res?.page?.title ?? "";
        const body = res?.current_version?.body ?? res?.page?.body ?? "";
        const pageId = res?.page?.id ?? selectedItemId;
        const libraryId = res?.page?.library_id;
        setFileInfo({
          id: pageId,
          document_type: "wiki",
          name: title,
          summary: ' ',
          questions: [],
          file_ext: "md",
          icon: "",
          library_id: libraryId,
          slug: selectedItemId,
          space_id: spaceId
        });
      })
      .catch(() => {
        if (!mounted) return;
        // 详情失败时仍保持 Wiki 单文档模式，但 id 退回 slug 以便路由仍能定位
        setFileInfo(buildEmptyFileInfo(selectedItemId));
      });
    return () => {
      mounted = false;
    };
  }, [spaceId, selectedItemId]);

  // 顶部按钮：切换面板显示/隐藏
  const handleTogglePanel = () => {
    setVisible(false);
  };

  // 底部按钮：切换面板宽度
  const handleToggleWidth = () => {
    setCollapsed(!collapsed);
  };

  // 划词选区开关（v0.4.2 §3.4 配套）：切换后通过 viewer-event 通知
  // ChunkView（已挂载的）更新 highlighter 状态。KnowledgeAssistant 面板打开
  // 即视为「开启划词」，关闭面板时派发关闭事件，避免 Wiki 页面在关闭面板后
  // 仍能触发 selection-change。
  const [autoSelectEnabled, setAutoSelectEnabled] = useState(false);
  const handleToggleAutoSelect = () => {
    const next = !autoSelectEnabled;
    setAutoSelectEnabled(next);
    window.dispatchEvent(
      new CustomEvent("viewer-event", {
        detail: { type: "auto-select-enabled", data: next },
      }),
    );
  };

  return (
    <ChatConfigProvider lang={locale} adapters={chatAdapters}>
      <div className="w-full h-full flex overflow-hidden">
        {/* Chat 内容区：Header + 聊天面板 */}
        <div className="flex-1 h-full flex flex-col overflow-hidden">
          {/* Header：图标 + 标题 + 划词开关（对齐 library/main/file/assistant/index.tsx 的 Header） */}
          <div className="flex-none h-[68px] py-1 pl-5 pr-3 flex items-center gap-2 border-b">
            <img className="size-5" src={AI_ICON_URL} alt="" />
            <div className="flex-1 text-base text-[#1D1E1F] truncate">
              {t("library.document_chat")}
            </div>
            <Tooltip
              placement="bottom"
              title={
                autoSelectEnabled
                  ? t("library.close_auto_select")
                  : t("library.open_auto_select")
              }
            >
              <div
                className={`size-7 rounded flex items-center justify-center cursor-pointer hover:bg-[#F5F5F7] ${
                  autoSelectEnabled ? "text-[#2563EB]" : ""
                }`}
                onClick={handleToggleAutoSelect}
              >
                <SvgIcon name="open-auto-select" />
              </div>
            </Tooltip>
          </div>

          {/* 聊天面板 */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {loading ? (
              <div className="w-full h-full flex items-center justify-center">
                <Spin />
              </div>
            ) : chatAgent ? (
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center">
                    <Spin />
                  </div>
                }
              >
                <ChatAssistant agentInfo={chatAgent} fileInfo={fileInfo} />
              </Suspense>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-sm text-[#999]">
                {t("library.chat_agent_not_configured")}
              </div>
            )}
          </div>
        </div>

        {/* 右侧图标栏 */}
        <div className="flex-none w-12 h-full bg-white flex flex-col border-l">
          <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col items-center gap-3 pt-4">
            {/* 收起按钮 */}
            <Tooltip placement="left" title={t("action.collapse")}>
              <div
                className="size-[38px] flex-center rounded-md cursor-pointer hover:shadow-[0_2px_8px_#0b1b403d] text-[#2563EB]"
                onClick={handleTogglePanel}
              >
                <SvgIcon name="expand-left" size={20} />
              </div>
            </Tooltip>

            <div className="border-t w-[38px] mt-px"></div>

            {/* Chat 按钮 - 始终高亮 */}
            <Tooltip placement="left" title={t("library.document_chat")}>
              <div className="size-[38px] flex-center rounded-md cursor-pointer hover:shadow-[0_2px_8px_#0b1b403d] bg-[#E6EEFF]">
                <img className="size-6" src={AI_ICON_URL} alt="" />
              </div>
            </Tooltip>
          </div>

          {/* 底部宽度切换按钮 */}
          <Tooltip placement="left" title={collapsed ? t("action.expand") : t("action.collapse")}>
            <div
              className="size-[38px] flex-center mx-auto mb-4 cursor-pointer rounded-md hover:shadow-[0_2px_8px_#0b1b403d]"
              onClick={handleToggleWidth}
            >
              <SvgIcon
                name={collapsed ? "right-bar-bottom-expand" : "right-bar-bottom-collapse"}
                size={19}
                color="#999"
              />
            </div>
          </Tooltip>
        </div>
      </div>
    </ChatConfigProvider>
  );
}

export default KnowledgeAssistant;