import React, { useEffect, useRef, useState } from "react";
import { Spin, message } from "antd";
import { useSpaceStore } from "@/stores/modules/space";
import { useWikiStore } from "@/stores/modules/wiki";
import agentsApi from "@/api/modules/agents";
import { AGENT_USAGES } from "@/constants/agent";
import type { WikiPageDetail } from "@/api/modules/wiki";
import { downloadFile } from "@km/shared-utils";
import { useKnowledgeAssistantStore } from "@/stores/modules/knowledge-assistant";
import { t } from "@/locales";
import { buildWikiPageUrl } from "@/utils/router";
import {
  buildFileIdToSourceMetaResolver,
  transformWikiInlineMarkup,
} from "../utils/wiki-markup";
import EditMode from "./EditMode";
import ViewMode from "./ViewMode";

interface DetailViewProps {
  selectedItemId: string;
}

const DetailView: React.FC<DetailViewProps> = ({ selectedItemId }) => {
  const spaceId = useSpaceStore((state) => state.spaceId);
  const loadPage = useWikiStore((state) => state.loadPage);

  const detailLoading = useWikiStore((state) =>
    selectedItemId ? state.pageDetailLoading[selectedItemId] : false,
  );

  const pageDetails = useWikiStore((state) => state.pageDetails);
  const detail = selectedItemId ? pageDetails[selectedItemId] ?? null : null;

  const [isEditing, setIsEditing] = useState(false);

  // 防止重复触发的 guard
  const loadDetailTriggeredRef = useRef<string | null>(null);

  const setAssistantInstall = useKnowledgeAssistantStore((state) => state.setAssistantInstall);

  // 加载详情
  useEffect(() => {
    if (!spaceId || !selectedItemId) {
      return;
    }
    // 如果本次 selectedItemId 和上次相同，跳过（防止 React StrictMode 或重复渲染触发）
    if (loadDetailTriggeredRef.current === selectedItemId) {
      return;
    }
    loadDetailTriggeredRef.current = selectedItemId;
    loadPage(spaceId, selectedItemId);
  }, [spaceId, selectedItemId, loadPage]);

  // 加载 agent 信息
  useEffect(() => {
    const loadAssistantInstall = async () => {
      try {
        const res = await agentsApi.list({
          agent_usages: `${AGENT_USAGES.KM_FILE_CHAT}`,
        });
        const hasEnabled = res.agents.some((item: any) => item.enable);
        setAssistantInstall(hasEnabled);
      } catch {
        // ignore
      }
    };
    loadAssistantInstall();
  }, [setAssistantInstall]);

  // 切换 tab 时重置编辑态
  useEffect(() => {
    setIsEditing(false);
  }, [selectedItemId]);

  const handleExport = () => {
    const bodyMarkdown = detail?.page?.body ?? "";
    const title = detail?.page?.title ?? "";
    if (bodyMarkdown && title) {
      // 与 WikiPagePreview 保持一致：导出前把 wiki 内链 / 来源引用 / 引用标记格式化为 markdown
      const fileIdResolver = buildFileIdToSourceMetaResolver(detail?.page?.sources);
      const formatted = transformWikiInlineMarkup(
        bodyMarkdown,
        (slug: string) => buildWikiPageUrl(spaceId || "", slug),
        fileIdResolver,
      );
      downloadFile(formatted, `${title}.md`);
      message.success(t("status.export_success"));
    }
  };

  // 加载中无数据
  if (detailLoading && !detail) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  // 已有数据但正在刷新（如保存后 1s 自动刷新）：显示遮罩式加载
  const isRefreshing = !!(detailLoading && detail);

  // 选中项为空或加载失败
  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#9CA3AF]">
        {t("wiki.select_page_tip")}
      </div>
    );
  }

  return (
    <div className="flex h-full relative">
      {isEditing ? (
        <EditMode
          detail={detail}
          selectedItemId={selectedItemId}
          onExit={() => setIsEditing(false)}
        />
      ) : (
        <ViewMode
          detail={detail}
          onEdit={() => setIsEditing(true)}
          onExport={handleExport}
        />
      )}

      {/* 已有数据但正在刷新（如保存后 1s 自动刷新）：遮罩式加载 */}
      {isRefreshing && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <Spin size="large" tip={t("common.loading")} />
        </div>
      )}
    </div>
  );
};

export default DetailView;