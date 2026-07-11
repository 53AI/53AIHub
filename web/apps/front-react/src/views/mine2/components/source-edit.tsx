import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { useSearchParams, useBlocker } from "react-router-dom";
import { Button, message, Modal, Spin } from "antd";
import { useFileMode } from "@/hooks/useFileMode";
import { useEditConflict } from "@/hooks/useEditConflict";
import { useFileLock } from "../hooks/useFileLock";
import chunksApi, { type KnowledgeChunk } from "@/api/modules/chunks";
import filesApi from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { debounce, getFormatTimeStamp, isOfficeFile } from "@km/shared-utils";
import { t } from "@/locales";
import { LibraryHeader } from "@/views/library/components/header";
import { useInlineEditLite, getDisplayName, buildNewPath } from "../useInlineEditLite";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import type { PreviewFile } from "../types";

// Lazy load editors
const MarkdownEditor = lazy(() => import("@/components/Markdown/editor"));
const UEditor = lazy(() => import("@/components/UEditor"));
const WpsOffice = lazy(() => import("@/components/WpsOffice"));

interface SourceEditViewProps {
  onBack: () => void;
  onRefresh: () => void;
  onRename: (fileId: string, newName: string) => Promise<void>;
}

export function SourceEditView({ onBack, onRefresh, onRename }: SourceEditViewProps) {
  const [searchParams] = useSearchParams();
  const fileId = searchParams.get("edit") || "";

  const { officeType, wpsStatus, officeLoading, checkFileMode } = useFileMode();

  // Inline edit
  const { handleClick: handleInlineClick, handleBlur: handleInlineBlur, handleKeydown: handleInlineKeydown, handlePaste: handleInlinePaste } = useInlineEditLite();

  // State
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [editContent, setEditContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isInit, setIsInit] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

  const cancelledRef = useRef(false);
  const saveDebounceRef = useRef<((() => void) & { cancel: () => void }) | null>(null);
  const ueditorRef = useRef<{
    setValue: (v: string) => Promise<void>;
    setValueSilent: (v: string) => Promise<void>;
    getHtml: () => Promise<string>;
    getRawHtml: () => Promise<string>;
  } | null>(null);
  const wpsOfficeRef = useRef<{ save: () => Promise<void> } | null>(null);
  // Track content changes for UEditor and WPS (since they don't update React state)
  const hasUeditorChangesRef = useRef(false);
  const hasWpsChangesRef = useRef(false);
  // Refs for debounce to access latest values
  const fileIdRef = useRef(fileId);
  const editContentRef = useRef(editContent);
  const initialContentRef = useRef(initialContent);
  const cleanupEditStateRef = useRef<() => void>(() => {});
  const onRefreshRef = useRef(onRefresh);
  const onBackRef = useRef(onBack);

  // Keep refs in sync (simple values only - cleanupEditState synced after definition)
  fileIdRef.current = fileId;
  editContentRef.current = editContent;
  initialContentRef.current = initialContent;
  onRefreshRef.current = onRefresh;
  onBackRef.current = onBack;

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
    // For Markdown editor (md files): compare state
    if (editContent !== initialContent) return true;
    // For UEditor (html files): check flag
    if (hasUeditorChangesRef.current) return true;
    // For WPS (office files): check flag
    if (hasWpsChangesRef.current) return true;
    return false;
  }, [editContent, initialContent]);

  // UEditor change handler
  const handleUeditorChange = useCallback(() => {
    hasUeditorChangesRef.current = true;
  }, []);

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

  // Handle cancel
  const handleCancel = useCallback(() => {
    if (hasUnsavedChanges()) {
      Modal.confirm({
        title: t("common.tip"),
        content: t("common.unsaved_changes"),
        okText: t("action.exit_edit"),
        cancelText: t("action.cancel"),
        onOk: () => {
          // Reset flags to avoid triggering subsequent checks
          hasUeditorChangesRef.current = false;
          hasWpsChangesRef.current = false;
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

  // Handle save
  const handleSave = useCallback(() => {
    // 创建 debounce 函数（只创建一次）
    if (!saveDebounceRef.current) {
      saveDebounceRef.current = debounce(async () => {
        const currentFileId = fileIdRef.current;
        if (!currentFileId) return;

        setIsSaving(true);

        try {
          // WPS save - wait for save to complete
          if (wpsOfficeRef.current) {
            await wpsOfficeRef.current.save();
            hasWpsChangesRef.current = false;
            message.success(t("status.save_success"));
            cleanupEditStateRef.current();
            onBackRef.current();
            return;
          }

          // UEditor save - check if content changed via flag
          if (ueditorRef.current) {
            // 如果没有修改，直接返回预览页
            if (!hasUeditorChangesRef.current) {
              cleanupEditStateRef.current();
              onBackRef.current();
              return;
            }
            const html = await ueditorRef.current.getHtml();
            if (!html) {
              message.error("内容为空");
              return;
            }
            await filesApi.raw(currentFileId, { content: html });
            hasUeditorChangesRef.current = false;
          }

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
        file_ext: file.file_ext || "",
      },
      isFile: true,
      permission: PERMISSION_TYPE.edit_knowledge,
      onRename: async (id, newName) => {
        await onRename(id, buildNewPath(originalPath, newName));
      },
    });
  };

  // Initialize edit content
  const initEditContent = async (currentFile: PreviewFile) => {
    if (!fileId) return;

    if ((currentFile.file_ext === "html" || currentFile.file_ext === "htm") && currentFile.file_url) {
      // HTML: fetch from URL
      const res = await fetch(currentFile.file_url);
      const text = await res.text();
      setEditContent(text);
      setInitialContent(text);
      if (ueditorRef.current) {
        // 使用 setValueSilent 避免触发 onChange 导致 hasUeditorChangesRef 被设为 true
        ueditorRef.current.setValueSilent(text);
      }
    } else {
      // Other files: load chunks
      const res = await chunksApi.files.list(fileId);
      const content = res.chunks
        .map(
          (item: KnowledgeChunk) =>
            `\n\n:::{ "chunkid":${item.id} }:::\n\n${item.content}`
        )
        .join("\n");
      setEditContent(content);
      setInitialContent(content);
    }

    setIsInit(true);
  };

  // Initialize
  useEffect(() => {
    let isCancelled = false;

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

        // Check file mode
        const determinedOfficeType = await checkFileMode({
          library_id: formattedFile.library_id,
          file_ext: formattedFile.file_ext,
          type: "editor",
        });

        if (isCancelled) return;

        // Check if file is editable
        if (
          (!isOfficeFile(formattedFile.file_mime) &&
            formattedFile.file_mime !== "html" &&
            formattedFile.file_mime !== "htm") ||
          determinedOfficeType === "web"
        ) {
          message.error(t("status.not_support_source_edit"));
          onBack();
          return;
        }

        // Mark WPS as potentially changed once initialized (WPS doesn't expose change events)
        if (determinedOfficeType === "wps") {
          hasWpsChangesRef.current = true;
        }

        // Check edit conflict
        if (hasConflict) {
          setLockError(conflictMessage);
          setIsInit(true);
          return;
        }

        // Add file lock
        if (formattedFile.library_id) {
          const lockResult = await addLock();
          if (!lockResult.success) {
            setLockError(lockResult.message);
            setIsInit(true);
            return;
          }

          // Start edit session
          if (!startEdit()) {
            setLockError(t("common.edit_conflict"));
            setIsInit(true);
            return;
          }

          // Start lock timer
          startTimer();
        }

        // Init content
        await initEditContent(previewFile);

      } catch (error) {
        console.error("初始化失败:", error);
        message.error("加载文件失败");
        onBack();
      }
    };

    init();

    return () => {
      isCancelled = true;
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
          // Reset flags to avoid triggering subsequent checks
          hasUeditorChangesRef.current = false;
          hasWpsChangesRef.current = false;
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

      {/* Editor Content */}
      {officeLoading ? (
        <div className="flex justify-center items-center h-full">
          <Spin size="large" />
        </div>
      ) : officeType === "wps" ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Spin size="large" />
            </div>
          }
        >
          <WpsOffice
            ref={wpsOfficeRef}
            fileId={file?.id || ""}
            fileExt={file?.file_ext || ""}
            appId={wpsStatus?.app_id || ""}
          />
        </Suspense>
      ) : officeType === "baidu_editor" ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Spin size="large" />
            </div>
          }
        >
          <UEditor ref={ueditorRef} onChange={handleUeditorChange} />
        </Suspense>
      ) : isInit ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Spin size="large" />
            </div>
          }
        >
          <div className="flex-1 overflow-hidden">
            <MarkdownEditor value={editContent} onChange={setEditContent} />
          </div>
        </Suspense>
      ) : (
        <div className="flex justify-center items-center h-full">
          <Spin size="large" />
        </div>
      )}
    </div>
  );
}

export default SourceEditView;