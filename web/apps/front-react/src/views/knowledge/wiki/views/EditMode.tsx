import React, { useState, useRef, useMemo, useCallback, useEffect } from "react";
import { Button, Spin, Modal, message } from "antd";
import { useSpaceStore } from "@/stores/modules/space";
import { useWikiStore } from "@/stores/modules/wiki";
import { wikiApi } from "@/api/modules/wiki";
import type { WikiPageDetail, WikiPageItem } from "@/api/modules/wiki";
import recentUsedApi from "@/api/modules/recent-used";
import { RECENT_USED_RESOURCE_TYPE } from "@/constants/recent-used";
import type { FileItem } from "@/api/modules/files/types";
import {
  buildFileIdToSourceMetaResolver,
  markdownLinkToWiki,
  wikiToMarkdownLink,
} from "../utils/wiki-markup";
import { SpaceDialog, SpaceDialogRef } from "@/components/Space/dialog";
import { DynamicKnowledgeDialog, DynamicKnowledgeDialogRef } from "@/components/DynamicKnowledge";
import { buildKnowledgeFileUrl, buildWikiPageUrl } from '@/utils/router';
import { t } from "@/locales";

// Lazy load markdown editor
const MarkdownEditor = React.lazy(() => import("@/components/Markdown/editor"));

interface EditModeProps {
  detail: WikiPageDetail;
  selectedItemId: string;
  onExit: () => void;
}

const EditMode: React.FC<EditModeProps> = ({ detail, selectedItemId, onExit }) => {
  const spaceId = useSpaceStore((state) => state.spaceId);
  const loadPage = useWikiStore((state) => state.loadPage);
  const restoreContent = useWikiStore((state) => state.restoreContent);
  const isRestore = useWikiStore((state) => state.isRestore);
  const clearRestore = useWikiStore((state) => state.clearRestore);

  // 如果是从历史版本恢复，使用恢复的内容；否则使用当前页面内容
  const bodyMarkdown = isRestore && restoreContent !== null ? restoreContent : (detail?.page?.body ?? "");
  const title = detail?.page?.title ?? "";
  const sources = detail?.page?.sources ?? [];

  const hrefBuilder = useMemo(
    () => (slug: string) => buildWikiPageUrl(spaceId || "", slug),
    [spaceId],
  );

  const fileIdResolver = useMemo(
    () => buildFileIdToSourceMetaResolver(sources),
    [sources],
  );

  // 初始编辑内容：同步计算，保证 MarkdownEditor 首次挂载即拿到正确 value。
  // 编辑器为非受控组件（仅读取初始 value），异步 setState 不会更新其内容——
  // 二次进入编辑时 chunk 已缓存、编辑器同步挂载，若此时 value 为空则内容丢失。
  const initialContent = useMemo(
    () => wikiToMarkdownLink(bodyMarkdown, hrefBuilder, fileIdResolver),
    [bodyMarkdown, hrefBuilder, fileIdResolver],
  );

  // 从历史版本恢复后，清除 restore 状态（只执行一次）
  useEffect(() => {
    if (isRestore) {
      clearRestore();
    }
  }, []);

  // 编辑状态
  const [editContent, setEditContent] = useState(initialContent);
  const [initialEditContent, setInitialEditContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);

  // link 配置
  const spaceDialogRef = useRef<SpaceDialogRef>(null);
  const dynamicKnowledgeDialogRef = useRef<DynamicKnowledgeDialogRef>(null);
  const linkCallbackRef = useRef<((result: { url: string; title: string }) => void) | null>(null);

  const linkConfig = useMemo(
    () => ({
      isOpen: true,
      pick: (event: { type: string; callback: (result: { url: string; title: string }) => void }) => {
        if (event.type === "knowledge") {
          linkCallbackRef.current = event.callback;
          spaceDialogRef.current?.open();
        } else if (event.type === "dynamicKnowledge") {
          linkCallbackRef.current = event.callback;
          dynamicKnowledgeDialogRef.current?.open();
        } else {
          const url = window.prompt(t("wiki.link_prompt_label"), "https://");
          if (url) {
            event.callback({ url, title: "" });
          }
        }
      },
    }),
    [],
  );

  const handleKnowledgeSelect = useCallback((files: FileItem[]) => {
    if (files.length > 0 && linkCallbackRef.current) {
      const file = files[0];
      const url = buildKnowledgeFileUrl(file.library_id, file.id);
      linkCallbackRef.current({ url, title: file.name });
      linkCallbackRef.current = null;
    }
  }, [spaceId]);

  const handleDynamicKnowledgeSelect = useCallback((page: WikiPageItem) => {
    if (linkCallbackRef.current) {
      const url = buildWikiPageUrl(spaceId || "", page.slug);
      linkCallbackRef.current({ url, title: page.title });
      linkCallbackRef.current = null;
    }
  }, [spaceId]);

  const hasUnsavedChanges = editContent !== initialEditContent;

  const handleCancelEdit = () => {
    if (hasUnsavedChanges) {
      Modal.confirm({
        title: t("common.tip"),
        content: t("wiki.exit_edit_confirm"),
        okText: t("action.exit_edit"),
        cancelText: t("wiki.continue_edit"),
        onOk: () => onExit(),
      });
      return;
    }
    onExit();
  };

  const handleSave = async () => {
    if (!detail?.page?.id || saving) return;

    const wikiContent = markdownLinkToWiki(editContent);

    setSaving(true);
    try {
      await wikiApi.updatePage(detail.page.id, {
        page_type: detail.page.page_type,
        title,
        content: wikiContent,
      });
      // 保存最近使用记录（Wiki 页面，space_id 必填）
      // fire-and-forget：失败仅吞掉，不影响保存主流程
      if (spaceId) {
        recentUsedApi
          .save({
            resource_type: RECENT_USED_RESOURCE_TYPE.WIKI_PAGE,
            resource_id: detail.page.id,
            space_id: spaceId,
          })
          .catch(() => {});
      }
      setInitialEditContent(editContent);
      message.success(t("status.save_success"));
      // 先刷新详情，再退出编辑：保证 DetailView 切到 ViewMode 时
      // store 里 pageDetails[slug] 已是最新值，避免 ViewMode 渲染旧数据
      try {
        if (spaceId && selectedItemId) {
          await loadPage(spaceId, selectedItemId, true);
        }
      } catch {
        // 刷新失败不影响退出编辑（页面已保存成功）
      }
      onExit();
    } catch (error) {
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <div className="flex-none px-8 pt-5 pb-3">
        <div className="flex justify-between items-center">
          <h1 className="text-[24px] font-medium text-primary">{title}</h1>
          <div className="flex items-center gap-2">
            <Button onClick={handleCancelEdit}>{t("action.exit_edit")}</Button>
            <Button
              type="primary"
              className="bg-[#1677ff]"
              loading={saving}
              onClick={handleSave}
            >
              {t("action.save")}
            </Button>
          </div>
        </div>
      </div>
      <React.Suspense
        fallback={
          <div className="flex-1 flex items-center justify-center">
            <Spin size="large" />
          </div>
        }
      >
        <div
          className="flex-1 overflow-hidden"
          style={{
            "--toolbar-background-color": "#fff",
            "--border-color": "transparent",
          } as React.CSSProperties}
        >
          <MarkdownEditor
            value={editContent}
            onChange={setEditContent}
            height="100%"
            link={linkConfig}
          />
        </div>
      </React.Suspense>

      {/* 知识选择弹窗 */}
      <SpaceDialog
        ref={spaceDialogRef}
        allowSelectLibrary={false}
        allowSelectSpace={false}
        singleSelect
        onConfirm={handleKnowledgeSelect}
      />

      {/* 动态知识选择弹窗 */}
      <DynamicKnowledgeDialog
        ref={dynamicKnowledgeDialogRef}
        onConfirm={handleDynamicKnowledgeSelect}
      />
    </div>
  );
};

export default EditMode;
