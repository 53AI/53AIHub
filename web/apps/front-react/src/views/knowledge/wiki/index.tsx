import React, { useState, lazy, Suspense, useEffect } from "react";
import { Spin } from "antd";
import { useSearchParams } from "react-router-dom";
import LeftSidebar from "./LeftSidebar";
import RightContent from "./RightContent";
import { useKnowledgeAssistantStore } from "@/stores/modules/knowledge-assistant";
import { useSpaceStore } from "@/stores/modules/space";
import { useWikiStore } from "@/stores/modules/wiki";
import { useUrlEnumState } from "@/hooks/useUrlEnumState";

export type ActiveTab = "list" | "index" | "logs" | "graph";

// Lazy load the KnowledgeAssistant component
const KnowledgeAssistant = lazy(() => import("./components/KnowledgeAssistant"));

const DynamicKnowledge: React.FC = () => {
  const [searchParams] = useSearchParams();

  // 子 tab（list / index / logs）从 URL ?sub= 读取，刷新后保持
  // URL 缺 sub 时按 selected 推断：有 selected → "list"（直链进入详情），否则 → "index"
  const [activeTab, setActiveTab] = useUrlEnumState<ActiveTab>({
    urlKey: "sub",
    validValues: ["list", "index", "logs"],
    defaultValue: searchParams.get("sub")
      ? "index"
      : searchParams.get("selected")
        ? "list"
        : "index",
  });

  // selectedItemId 存放页面 slug（与 wikiApi.page(space_id, slug) 的入参一致），
  // 优先从 URL ?selected= 读取，否则由 LeftSidebar 列表加载完成后设置默认值
  const [selectedItemId, setSelectedItemId] = useState<string>(() => {
    return searchParams.get("selected") || "";
  });

  const spaceId = useSpaceStore((state) => state.spaceId);
  const loadPages = useWikiStore((state) => state.loadPages);
  const resetAll = useWikiStore((state) => state.resetAll);

  // 首次加载：URL ?selected= 已在 useState 初始化时读取，无需再处理

  // 后续导航（被链接/相关知识点击 navigate(...)）→ 同步 selectedItemId
  const selectedFromUrl = searchParams.get("selected") || "";
  useEffect(() => {
    if (!selectedFromUrl) return;
    if (selectedFromUrl === selectedItemId) return;
    setSelectedItemId(selectedFromUrl);
    setActiveTab("list");
  }, [selectedFromUrl, selectedItemId, setActiveTab]);

  // 组件挂载时清空缓存并重新加载页面列表
  useEffect(() => {
    if (!spaceId) return;
    resetAll();
    loadPages(spaceId);
  }, [spaceId, loadPages, resetAll]);

  const assistantVisible = useKnowledgeAssistantStore((state) => state.visible);
  const assistantCollapsed = useKnowledgeAssistantStore((state) => state.collapsed);

  return (
    <div className="flex h-full w-full bg-white overflow-hidden text-sm min-h-0">
      {/* 动态知识的左侧列表 */}
      <div className="flex shrink-0 h-full min-h-0 z-10 relative">
        <LeftSidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          selectedItemId={selectedItemId}
          setSelectedItemId={setSelectedItemId}
        />
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        <RightContent
          activeTab={activeTab}
          selectedItemId={selectedItemId}
        />
      </div>

      {/* 右侧助手面板 */}
      {assistantVisible && (
        <div
          className={`flex bg-white relative overflow-hidden transition-all duration-300 border-l border-t border-[#E6E8EB] rounded-l-lg ${
            assistantCollapsed
              ? "flex-none w-[452px]"
              : "flex-1 min-w-[452px]"
          }`}
        >
          <Suspense
            fallback={
              <div className="w-full h-full flex items-center justify-center">
                <Spin />
              </div>
            }
          >
            <KnowledgeAssistant selectedItemId={selectedItemId} />
          </Suspense>
        </div>
      )}
    </div>
  );
};

export default DynamicKnowledge;
