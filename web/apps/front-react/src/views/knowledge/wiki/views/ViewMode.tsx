import React, { useMemo, useRef, useState } from "react";
import { Button, Modal, message } from "antd";
import { useSearchParams } from "react-router-dom";
import { MoreDropdown, MenuItem } from "@/components/MoreDropdown";
import { AI_ICON_URL } from "@/views/library/main/file/components/sidebar-app-item";
import { useKnowledgeAssistantStore } from "@/stores/modules/knowledge-assistant";
import { useWikiStore } from "@/stores/modules/wiki";
import { t } from "@/locales";
import { wikiApi } from "@/api/modules/wiki";
import type { WikiPageDetail } from "@/api/modules/wiki";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { useFullscreen } from "@/hooks/useFullscreen";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { IconButton } from "@/components/IconButton";
import { useWikiPagePermission } from "@/hooks/useWikiPagePermission";
import KnowledgeHistoryDrawer, {
  KnowledgeHistoryDrawerRef,
} from "./components/KnowledgeHistoryDrawer";
import { WikiPagePreview } from "./components/WikiPagePreview";
import WikiFav from "./components/fav";
import WikiPermissionSetting from "./components/WikiPermissionSetting";
import PermissionWiki from "./components/PermissionWiki";

interface ViewModeProps {
  detail: WikiPageDetail;
  onEdit: () => void;
  onExport: () => void;
}

const ViewMode: React.FC<ViewModeProps> = ({ detail, onEdit, onExport }) => {
  const [, setSearchParams] = useSearchParams();

  const assistantVisible = useKnowledgeAssistantStore((state) => state.visible);
  const assistantInstall = useKnowledgeAssistantStore((state) => state.assistantInstall);
  const assistantToggle = useKnowledgeAssistantStore((state) => state.toggle);

  const historyRef = useRef<KnowledgeHistoryDrawerRef>(null);
  const [showPermission, setShowPermission] = useState(false);
  const { fullscreen, toggle: toggleFullscreen, composeClassName } = useFullscreen();

  const pageId = detail?.page?.id;
  const wikiPermission = useWikiPagePermission(pageId);
  const wikiResource = useMemo(
    () => ({
      id: pageId ?? "",
      icon: "",
      name: detail?.page?.title ?? "",
    }),
    [pageId, detail?.page?.title],
  );

  const title = detail?.page?.title ?? "";

  const handleMore = (command: string | number) => {
    switch (command) {
      case "new-tab": {
        window.open(window.location.href, "_blank");
        break;
      }
      case "export":
        onExport();
        break;
      case "permission":
        setShowPermission(true);
        break;
      case "history":
        historyRef.current?.open();
        break;
      case "delete": {
        const pageId = detail?.page?.id;
        if (!pageId) return;
        Modal.confirm({
          title: t("wiki.delete_page"),
          content: t("wiki.delete_page_confirm", { title }),
          okText: t("action.del"),
          okButtonProps: { danger: true },
          cancelText: t("action.cancel"),
          onOk: async () => {
            await wikiApi.deletePage(pageId);
            message.success(t("status.delete_success"));
            // 把被删除页面标记为本地隐藏，useWikiPageList 会在渲染前直接过滤掉，
            // 无需重新请求接口即可让左侧列表与远端保持一致。
            useWikiStore.getState().hidePageId(pageId);
            setSearchParams(
              (prev) => {
                prev.set("sub", "index");
                prev.delete("selected");
                prev.delete("vd-type");
                return prev;
              },
              { replace: true },
            );
          },
        });
        break;
      }
    }
  };

  const items: MenuItem[] = [
    { key: "new-tab", icon: "arrow-right-up", label: t("action.tab_open") },
    { key: "divider-1", divided: true },
    {
      key: "export",
      icon: "export",
      label: t("wiki.menu.export_download"),
      wrapper: (children) => (
        <PermissionWiki
          permission={wikiPermission}
          required={PERMISSION_TYPE.view_and_export}
          resource={wikiResource}
        >
          {children}
        </PermissionWiki>
      ),
    },
    {
      key: "permission",
      icon: "peoples",
      label: t("permission.member_and_role"),
      wrapper: (children) => (
        <PermissionWiki
          permission={wikiPermission}
          required={PERMISSION_TYPE.manage}
          resource={wikiResource}
        >
          {children}
        </PermissionWiki>
      ),
    },
    {
      key: "history",
      icon: "time",
      label: t("common.history"),
      wrapper: (children) => (
        <PermissionWiki
          permission={wikiPermission}
          required={PERMISSION_TYPE.edit_all}
          resource={wikiResource}
        >
          {children}
        </PermissionWiki>
      ),
    },
    { key: "divider-2", divided: true },
    {
      key: "delete",
      icon: "del",
      label: t("action.del"),
      danger: true,
      wrapper: (children) => (
        <PermissionWiki
          permission={wikiPermission}
          required={PERMISSION_TYPE.edit_all}
          resource={wikiResource}
        >
          {children}
        </PermissionWiki>
      ),
    },
  ];

  return (
    <div className={composeClassName("flex-1 min-h-0 flex overflow-hidden")}>

      {/* 主内容区：标题 → 别名 → 类型 → 反向链接 → 正文（含 footer：来源文档 / 相关知识） */}
      <WikiPagePreview
        version={{
          ...detail.current_version,
          title: detail.page.title,
          aliases: detail.page.aliases,
          page_type: detail.page.page_type,
          updated_time: detail.page.updated_time,
          body: detail.page.body,
          sources: detail.page.sources,
          links: detail.page.links,
          backlinks: detail.page.backlinks,
        }}
        enableTextSelection
        headerActions={
          <>
            <PermissionWiki
              permission={wikiPermission}
              required={PERMISSION_TYPE.edit_knowledge}
              resource={wikiResource}
            >
              <Button type="primary" className="bg-[#1677ff]" onClick={onEdit}>
                {t("action.edit")}
              </Button>
            </PermissionWiki>
            <WikiFav resource_id={pageId} />
            {assistantInstall && (
              <IconButton
                title={t("library.document_chat")}
                size="medium"
                onClick={assistantToggle}
                activeClassName={assistantVisible ? "bg-[#F2F6FE]" : ""}
              >
                <img className="size-5" src={AI_ICON_URL} alt="" />
              </IconButton>
            )}
            <FullscreenToggle fullscreen={fullscreen} onToggle={toggleFullscreen} />
            <MoreDropdown items={items} onCommand={handleMore} placement="bottomRight" />
          </>
        }
      />

      {/* 历史版本抽屉 */}
      <KnowledgeHistoryDrawer
        ref={historyRef}
        pageId={detail.page.id}
        pageType={detail.page.page_type}
        pageTitle={detail.page.title}
        onRestore={(content: string) => {
          // 历史版本恢复：保存内容到 store，然后进入编辑模式
          const wikiStore = useWikiStore.getState();
          wikiStore.restoreContent = content;
          wikiStore.isRestore = true;
          message.success(t("history.restore_success"));
          onEdit();
        }}
      />

      {/* 权限面板 */}
      {showPermission && (
        <WikiPermissionSetting
          className="w-[320px] flex-none border-l"
          pageId={detail.page.id}
          onClose={() => setShowPermission(false)}
        />
      )}
    </div>
  );
};

export default ViewMode;
