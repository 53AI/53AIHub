import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Button, message } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { usePoll } from "@/hooks/usePoll";
import { splitMarkdownIntoChunks } from "@/utils/markdown";
import fileBodiesApi from "@/api/modules/file-bodies";
import { useNavigate } from "react-router-dom";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { ChunkView } from "@/components/Markdown";
import { SvgIcon } from "@km/shared-components-react";
import { copyToClip } from "@km/shared-utils";
import PermissionFile from "../../../components/permission/File";
import { EditBtn } from "../components/edit-btn";
import { t } from "@/locales";
import "./view.css";

const copy = async (text: string) => {
    const success = await copyToClip(text);
    if (success) {
      message.success(t("common.copied"));
    } else {
      message.error(t("common.copy_failed") || "复制失败");
    }
  };

/**
 * Document parsing view component
 * Vue migration from view.vue
 */
export function DocumentView() {
  const libraryStore = useLibraryStore();
  const navigate = useNavigate();

  const [filebody, setFilebody] = useState("");
  const [bodyChunks, setBodyChunks] = useState<
    Array<{ content: string; id: number }>
  >([]);

  const currentFile = libraryStore.currentFile();

  // Format date helper (matches Vue's $filters.formatDate)
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "";
    try {
      const date = new Date(dateStr);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const hours = String(date.getHours()).padStart(2, "0");
      const minutes = String(date.getMinutes()).padStart(2, "0");
      const seconds = String(date.getSeconds()).padStart(2, "0");
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    } catch {
      return dateStr;
    }
  };

  // Reload chunks
  const reloadChunks = useCallback(async () => {
    if (!currentFile?.id) return;

    try {
      const res = await fileBodiesApi.find(currentFile.id);
      const content = res?.content || "";
      setFilebody(content);
      // 使用智能拆分函数，保持块级元素完整性，避免过长导致页面卡顿
      setBodyChunks(
        splitMarkdownIntoChunks(content, {
          maxChunkLength: 3000, // 单个 chunk 最大 3000 字符
          maxChunkLines: 50, // 单个 chunk 最大 50 行
          minChunkLength: 500, // 小于 500 字符的文本块会合并
        }),
      );
    } catch (error) {
      console.error("Failed to load file body:", error);
    }
  }, [currentFile?.id]);

  // Poll for content
  const { start: startPoll, stop: stopPoll } = usePoll(async () => {
    if (!currentFile) return;

    await reloadChunks();

    // 内容加载成功后停止轮询
    if (filebody.trim() !== "") {
      stopPoll();
    }
  });

  // Handle chunks edit
  const handleChunksEdit = () => {
    if (!currentFile) return;
    navigate(
      `/library/${currentFile.library_id}/file/${currentFile.id}/chunks-edit?type=chunk`,
    );
  };

  // Handle export file
  const handleExportFile = () => {
    if (!currentFile) return;
    const previewContent = filebody;
    // 去掉文件后缀，添加 .md 后缀
    let name = currentFile.name.replace(/\.[^.]+$/, "") + ".md";

    const fileObj = new File([previewContent], name);
    const url = URL.createObjectURL(fileObj);

    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.target = "_blank";
    a.click();
    URL.revokeObjectURL(url);
    message.success(t("status.export_success"));
  };

  // Handle retry parse
  const onRetryParse = async (type: string) => {
    if (!currentFile) return;
    await fileBodiesApi.reconvert(currentFile.id, { parse_type: type });
    startPoll();
    message.success(t("status.submitted"));
  };

  // On mount, start polling
  useEffect(() => {
    startPoll();
    return () => stopPoll();
  }, []);

  return (
    <div className="flex-1 h-full flex flex-col overflow-hidden">
      {currentFile?.file_url && (
        <div className="flex-none h-[52px] px-5 flex items-center gap-2 relative">
          <div className="flex-1 flex items-center gap-2">
            {!!currentFile?.last_body_time && (
              <p className="text-sm text-[#4F5052]">
                上次解析时间：{formatDate(currentFile.last_body_time)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {currentFile && (
              <EditBtn file={currentFile} onEdit={handleChunksEdit}>
                <Button type="link" className="px-0">
                  <SvgIcon name="edit" />
                  编辑
                </Button>
              </EditBtn>
            )}
            <Button type="link" onClick={() => copy(filebody)} className="px-0">
              <SvgIcon name="copy" />
              复制
            </Button>
            <PermissionFile
              placement="right"
              required={PERMISSION_TYPE.view_and_export}
            >
              <Button type="link" onClick={handleExportFile} className="px-0">
                <SvgIcon name="download-four" />
                导出
              </Button>
            </PermissionFile>
          </div>
        </div>
      )}
      <ChunkView
        chunks={bodyChunks}
        showDisplayMode={false}
        mode="pdf"
        className="flex-1 bg-[#F8FAFC]"
      />
    </div>
  );
}

export default DocumentView;
