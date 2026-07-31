import React from "react";
import type { ActiveTab } from "./index";
import IndexView from "./views/IndexView";
import LogsView from "./views/LogsView";
import DetailView from "./views/DetailView";
import { useWikiStore } from "@/stores/modules/wiki";
import { WikiPermissionFrame } from "@/components/KMPermission/wiki-frame";

interface RightContentProps {
  activeTab: ActiveTab;
  selectedItemId: string;
}

/**
 * 动态知识右侧内容分发器：
 *   - "index" → 索引
 *   - "logs"  → 日志
 *   - "list"  / 默认 → 详情（带 wiki 页面权限校验）
 */
const RightContent: React.FC<RightContentProps> = ({
  activeTab,
  selectedItemId,
}) => {
  // 通过 slug 在已加载的页面列表中查到真实 pageId（详情视图需要）
  const currentPage = useWikiStore((state) =>
    state.pagesData.find((p) => p.slug === selectedItemId),
  );

  if (activeTab === "index") {
    return <IndexView />;
  }
  if (activeTab === "logs") {
    return <LogsView />;
  }

  // 使用 key 确保选中项变化时组件重新挂载
  return (
    <WikiPermissionFrame
      pageId={currentPage?.id}
      pageTitle={currentPage?.title}
    >
      <DetailView key={selectedItemId} selectedItemId={selectedItemId} />
    </WikiPermissionFrame>
  );
};

export default RightContent;
