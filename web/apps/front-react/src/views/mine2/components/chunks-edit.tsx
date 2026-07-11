import { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { Button, message, Modal, Spin } from "antd";
import { useSearchParams, useBlocker } from "react-router-dom";
import { useEditConflict } from "@/hooks/useEditConflict";
import { useFileLock } from "../hooks/useFileLock";
import { fileBodiesApi } from "@/api/modules/file-bodies";
import filesApi from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { debounce, getFormatTimeStamp } from "@km/shared-utils";
import { t } from "@/locales";
import { LibraryHeader } from "@/views/library/components/header";
import { useInlineEditLite, getDisplayName, buildNewPath } from "../useInlineEditLite";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import type { PreviewFile } from "../types";

const MarkdownChunkEditor = lazy(() => import("@/components/Markdown/ChunkEditor"));

interface ChunksEditViewProps {
  onBack: () => void;
  onRefresh: () => void;
  onRename: (fileId: string, newName: string) => Promise<void>;
}

export function ChunksEditView({ onBack, onRefresh, onRename }: ChunksEditViewProps) {
  const [searchParams] = useSearchParams();
  const fileId = searchParams.get("edit") || "";
  const isNewFile = searchParams.get("new") === "true";

  // File state
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [editContent, setEditContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const justSavedRef = useRef(false);
  const cancelledRef = useRef(false);
  const editContentRef = useRef(editContent);
  const initialContentRef = useRef(initialContent);
  const saveDebounceRef = useRef<((() => void) & { cancel: () => void }) | null>(null);
  const fileIdRef = useRef(fileId);
  const fileLibraryIdRef = useRef("");
  const cleanupEditStateRef = useRef<() => void>(() => {});
  const onRefreshRef = useRef(onRefresh);
  const onBackRef = useRef(onBack);

  // Keep refs in sync (simple values only - cleanupEditState synced after definition)
  editContentRef.current = editContent;
  initialContentRef.current = initialContent;
  fileIdRef.current = fileId;
  onRefreshRef.current = onRefresh;
  onBackRef.current = onBack;

  // Inline edit
  const { handleClick: handleInlineClick, handleBlur: handleInlineBlur, handleKeydown: handleInlineKeydown, handlePaste: handleInlinePaste } = useInlineEditLite();

  // Edit conflict
  const { hasConflict, conflictMessage, startEdit, endEdit } = useEditConflict(
    fileId,
    file?.library_id || ""
  );

  // File lock
  const { addLock, releaseLock, startTimer, stopTimer } = useFileLock({
    fileId,
    enabled: !!file?.library_id,
  });

  // Check unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    // If just saved, don't consider as unsaved
    if (justSavedRef.current) return false;
    return editContent !== initialContent;
  }, [editContent, initialContent]);

  // Cleanup
  const cleanupEditState = useCallback(() => {
    cancelledRef.current = true;
    saveDebounceRef.current?.cancel();
    stopTimer();
    releaseLock();
    endEdit();
  }, [stopTimer, releaseLock, endEdit]);

  // Sync cleanupEditState ref after definition
  cleanupEditStateRef.current = cleanupEditState;
  fileLibraryIdRef.current = file?.library_id || "";

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (hasUnsavedChanges()) {
      Modal.confirm({
        title: t("common.tip"),
        content: t("common.unsaved_changes"),
        okText: t("action.exit_edit"),
        cancelText: t("action.cancel"),
        onOk: () => {
          // 模仿Vue版本：更新initialContent，避免后续检查认为有更改
          setInitialContent(editContent);
          cleanupEditState();
          onBack();
        },
      });
      return;
    }
    cleanupEditState();
    onBack();
  }, [hasUnsavedChanges, editContent, cleanupEditState, onBack]);

  // Handle save - 使用debounce包装
  const handleSave = useCallback(() => {
    // 创建 debounce 函数并存储到 ref 以便取消（只创建一次）
    if (!saveDebounceRef.current) {
      saveDebounceRef.current = debounce(async () => {
        const currentFileId = fileIdRef.current;
        if (!currentFileId) return;

        const currentEditContent = editContentRef.current;
        const currentInitialContent = initialContentRef.current;
        const contentChanged = currentInitialContent !== currentEditContent;

        // 新建文件允许直接保存空内容，否则内容未更改时直接返回预览页
        if (!contentChanged && !isNewFile) {
          cleanupEditStateRef.current();
          onBackRef.current();
          return;
        }

        setIsSaving(true);

        try {
          await fileBodiesApi.create({
            content: currentEditContent,
            file_id: currentFileId,
            library_id: fileLibraryIdRef.current,
          });

          setInitialContent(currentEditContent);
          justSavedRef.current = true;
          message.success(t("status.save_success"));
          cleanupEditStateRef.current();
          onBackRef.current();
        } catch (error) {
          console.error("保存失败:", error);
          message.error(t("status.save_fail"));
        } finally {
          setIsSaving(false);
        }
      }, 1200);
    }
    saveDebounceRef.current();
  }, []); // 空依赖数组 - debounce 内部通过 ref 获取最新值

  // Handle title click for rename
  const handleClickTitle = (e: React.MouseEvent<HTMLElement>) => {
    if (!file) return;
    const rawData = file.rawData as { path?: string } | undefined;
    const originalPath = rawData?.path || "";
    handleInlineClick(e, {
      file: {
        id: file.id,
        name: file.name,
        file_ext: file.file_ext || "md",
      },
      isFile: true,
      permission: PERMISSION_TYPE.edit_knowledge,
      onRename: async (id, newName) => {
        await onRename(id, buildNewPath(originalPath, newName));
      },
    });
  };

  // Initialize
  useEffect(() => {
    const init = async () => {
      if (!fileId) return;

      try {
        // Load file info
        const fileData = await filesApi.get(fileId);
        const formattedFile = formatFile(fileData);
        const previewFile: PreviewFile = {
          id: formattedFile.id,
          name: formattedFile.name,
          icon: formattedFile.icon,
          file_url: formattedFile.file_url,
          file_ext: formattedFile.file_ext,
          file_mime: formattedFile.file_mime,
          library_id: formattedFile.library_id,
          updated_time: getFormatTimeStamp(formattedFile.updated_time),
          isFavorite: formattedFile.is_favorite,
          rawData: formattedFile,
        };
        setFile(previewFile);

        // Check edit conflict
        if (hasConflict) {
          setLockError(conflictMessage);
          setIsReady(true);
          return;
        }

        // Add file lock (if has library_id)
        if (formattedFile.library_id) {
          const lockResult = await addLock();
          if (!lockResult.success) {
            setLockError(lockResult.message);
            setIsReady(true);
            return;
          }

          // Start edit session
          if (!startEdit()) {
            setLockError(t("common.edit_conflict"));
            setIsReady(true);
            return;
          }

          // Start lock timer
          startTimer();
        }

        // Load content: 优先从 file-bodies 获取，获取不到则从 preview URL 拉取
        // 新建文件没有内容，跳过加载
        const res = await fileBodiesApi.find(fileId);
        if (res?.content) {
          setEditContent(res.content);
          setInitialContent(res.content);
        } else if (!isNewFile && previewFile.file_url) {
          try {
            const previewRes = await fetch(previewFile.file_url);
            const text = await previewRes.text();
            setEditContent(text);
            setInitialContent(text);
          } catch {
            setEditContent("");
            setInitialContent("");
          }
        } else {
          setEditContent("");
          setInitialContent("");
        }

        setIsReady(true);
      } catch (error) {
        console.error("初始化失败:", error);
        message.error("加载文件失败");
        onBack();
      }
    };

    init();

    return () => {
      cancelledRef.current = true;
      saveDebounceRef.current?.cancel();
      stopTimer();
      releaseLock();
      endEdit();
    };
  }, [fileId]);

  // Handle before unload
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (hasUnsavedChanges()) {
        const msg = t("common.unsaved_changes");
        event.preventDefault();
        event.returnValue = msg;
        return msg;
      }
      return undefined;
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Block navigation if unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    if (blocker.state === "blocked") {
      Modal.confirm({
        title: t("common.tip"),
        content: t("common.unsaved_changes"),
        okText: t("action.exit_edit"),
        cancelText: t("action.cancel"),
        onOk: () => {
          cleanupEditState();
          onBack();
          blocker.proceed();
        },
        onCancel: () => {
          blocker.reset();
        },
      });
    }
  }, [blocker, cleanupEditState, onBack, t]);

  if (lockError) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-white">
        <p className="text-red-500">{lockError}</p>
        <Button onClick={onBack}>{t("action.back")}</Button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-white">
      <LibraryHeader
        footer={
          <div className="flex items-center gap-2">
            <Button onClick={handleCancel}>退出编辑</Button>
            <Button type="primary" loading={isSaving} onClick={handleSave}>
              {t("action.save")}
            </Button>
          </div>
        }
      >
        {file && (
          <div className="flex-1 overflow-hidden">
            <h3
              className="py-0.5 text-base text-[#1D1E1F] truncate inline-editable"
              onClick={handleClickTitle}
              onBlur={handleInlineBlur}
              onKeyDown={handleInlineKeydown}
              onPaste={handleInlinePaste}
            >
              {getDisplayName(file.name, true, file.file_ext)}
            </h3>
            <p className="text-xs text-[#9A9A9A]">
              {t("common.recently_edit")}：{file.updated_time}
            </p>
          </div>
        )}
      </LibraryHeader>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        {isReady ? (
          <Suspense
            fallback={
              <div className="flex justify-center items-center h-full">
                <Spin size="large" />
              </div>
            }
          >
            <MarkdownChunkEditor
              value={editContent}
              onChange={setEditContent}
              height="100%"
            />
          </Suspense>
        ) : (
          <div className="flex justify-center items-center h-full">
            <Spin size="large" />
          </div>
        )}
      </div>
    </div>
  );
}

export default ChunksEditView;
