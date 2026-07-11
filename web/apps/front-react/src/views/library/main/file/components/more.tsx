import { useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { message } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import PermissionFile from "../../../components/permission/File";
import { HistoryDrawer, HistoryDrawerRef } from "../../history";
import { copyToClip } from "@km/shared-utils";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import { MoreDropdown, MenuItem } from "@/components/MoreDropdown";
import type { FileItem } from "@/api/modules/files/types";

interface FileMoreProps {
  mode?: "preview" | "chunk";
  onPermission?: () => void;
  catalogRef?: {
    newTab: (file: FileItem) => void;
    renameFile: (file: FileItem) => void;
    deleteFile: (file: FileItem) => void;
  } | null;
}

export function FileMore({
  mode = "preview",
  onPermission,
  catalogRef,
}: FileMoreProps) {
  const navigate = useNavigate();
  const params = useParams();
  const libraryStore = useLibraryStore();
  const historyDrawerRef = useRef<HistoryDrawerRef>(null);

  const currentFile = libraryStore.currentFile();

  const fileOperations = {
    async share() {
      if (!currentFile) return;
      const url = buildUrl(`/library/share/${currentFile.id}`, {
        name: currentFile.name,
      });
      await copyToClip(url);
      message.success(
        t("common.copied") + t("action.share") + t("common.link"),
      );
    },

    async export() {
      try {
        const file = currentFile;
        if (!file?.file_url) {
          message.error("文件不存在或无法下载");
          return;
        }
        const url = file.file_url;
        try {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          const blob = await response.blob();
          const blobUrl = URL.createObjectURL(blob);

          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = file.name || "download";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);

          setTimeout(() => {
            URL.revokeObjectURL(blobUrl);
          }, 100);
        } catch (error) {
          console.error("下载失败:", error);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name || "download";
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }

        message.success(t("status.export_success"));
      } catch (error) {
        console.error("导出失败:", error);
        message.error(t("status.export_failed") || "导出失败");
      }
    },
  };

  const handleMore = (command: string | number) => {
    if (!currentFile) return;

    switch (command) {
      case "new-tab":
        catalogRef?.newTab(currentFile);
        break;
      case "share":
        fileOperations.share();
        break;
      case "export":
        fileOperations.export();
        break;
      case "history":
        historyDrawerRef.current?.open();
        break;
      case "rename":
        catalogRef?.renameFile(currentFile);
        break;
      case "delete":
        catalogRef?.deleteFile(currentFile);
        break;
      case "permission":
        onPermission?.();
        break;
    }
  };

  const handleRestore = async (content: string) => {
    libraryStore.restoreContent = content;
    libraryStore.isRestore = true;
    message.success(t("history.restore_success"));
    navigate(`/library/${params.id}/file/${params.fid}/chunks/edit`);
  };

  const items: MenuItem[] = [
    {
      key: "new-tab",
      icon: "arrow-right-up",
      label: t("common.new_tab_page") + t("action.open"),
    },
    { key: "divider", divided: true },
    {
      key: "rename",
      icon: "edit",
      label: t("action.rename"),
      wrapper: (children) => (
        <PermissionFile required={PERMISSION_TYPE.edit_all}>
          {children}
        </PermissionFile>
      ),
    },
    {
      key: "export",
      icon: "export",
      label: "导出/下载",
      wrapper: (children) => (
        <PermissionFile required={PERMISSION_TYPE.view_and_export}>
          {children}
        </PermissionFile>
      ),
    },
    {
      key: "permission",
      icon: "peoples",
      label: "成员与权限",
      wrapper: (children) => (
        <PermissionFile required={PERMISSION_TYPE.manage}>
          {children}
        </PermissionFile>
      ),
    },
    {
      key: "history",
      icon: "time",
      label: "历史版本",
      wrapper: (children) => (
        <PermissionFile required={PERMISSION_TYPE.edit_all}>
          {children}
        </PermissionFile>
      ),
    },
    { key: "divider2", divided: true },
    {
      key: "delete",
      icon: "del",
      iconClass: "text-[#FA5151]",
      label: t("action.del"),
      danger: true,
      wrapper: (children) => (
        <PermissionFile required={PERMISSION_TYPE.edit_all}>
          {children}
        </PermissionFile>
      ),
    },
  ];

  return (
    <>
      <MoreDropdown
        size="32px"
        icon="more-h"
        iconSize={16}
        tooltip={t("action.more")}
        backgroundColor="#F2F6FE"
        items={items}
        onCommand={handleMore}
      />

      <HistoryDrawer ref={historyDrawerRef} onRestore={handleRestore} />
    </>
  );
}

export default FileMore;
