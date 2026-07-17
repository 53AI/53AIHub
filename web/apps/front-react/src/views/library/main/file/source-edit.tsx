import {
  useState,
  useEffect,
  useCallback,
  useRef,
  lazy,
  Suspense,
} from "react";
import { useParams, useNavigate, useBlocker } from "react-router-dom";
import { Button, message, Modal, Spin } from "antd";
import { useLibraryStore } from "@/stores/modules/library";
import { t } from "@/locales";
import { useFileMode } from "@/hooks/useFileMode";
import { useEditConflict } from "@/hooks/useEditConflict";
import chunksApi, { type KnowledgeChunk } from "@/api/modules/chunks";
import filesApi from "@/api/modules/files";
import { debounce, isOfficeFile } from "@km/shared-utils";
import { api_host } from "@/utils/config";
import { LibraryHeader } from "../../components/header";

// Lazy load editors
const MarkdownEditor = lazy(() => import("@/components/Markdown/editor"));
const UEditor = lazy(() => import("@/components/UEditor"));
const WpsOffice = lazy(() => import("@/components/WpsOffice"));

export function SourceEditView() {
  const navigate = useNavigate();
  const params = useParams<{ id: string; fid: string }>();
  const { officeType, wpsStatus, officeLoading, checkFileMode } = useFileMode();
  const { conflictMessage, startEdit, endEdit } = useEditConflict(
    params.fid || "",
    params.id || "",
  );

  // State
  const [editContent, setEditContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isInit, setIsInit] = useState(false);
  const [chunks, setChunks] = useState<KnowledgeChunk[]>([]);

  const lockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const ueditorRef = useRef<{
    setValue: (v: string) => void;
    setValueSilent: (v: string) => Promise<void>;
    getHtml: () => Promise<string>;
    getRawHtml: () => Promise<string>;
  } | null>(null);
  const wpsOfficeRef = useRef<{ save: () => void } | null>(null);
  // Track content changes for UEditor and WPS (since they don't update React state)
  const hasUeditorChangesRef = useRef(false);
  const hasWpsChangesRef = useRef(false);

  // Subscribe to store state correctly using selectors
  const files = useLibraryStore((state) => state.files);
  const currentFileId = useLibraryStore((state) => state.currentFileId);
  const currentFile = files.find((item) => item.id === currentFileId);
  const libraryId = params.id;
  const fileId = params.fid;

  // Check for unsaved changes
  const hasUnsavedChanges = useCallback(() => {
    // For Markdown editor: compare state
    if (editContent !== initialContent) return true;
    // For UEditor: check flag
    if (hasUeditorChangesRef.current) return true;
    // For WPS: check flag
    if (hasWpsChangesRef.current) return true;
    return false;
  }, [editContent, initialContent]);

  // UEditor change handler
  const handleUeditorChange = useCallback(() => {
    hasUeditorChangesRef.current = true;
  }, []);

  // ==================== Lock Management ====================

  /**
   * Add file lock
   */
  const addFileLock = async (
    fileId: string,
  ): Promise<{ success: boolean; message: string }> => {
    try {
      const res = await filesApi.lock(fileId, { action: "add" });
      return {
        success: res.success,
        message: res.message,
      };
    } catch (error: unknown) {
      console.error("添加文件锁失败:", error);
      const err = error as {
        response?: { data?: { data?: { message?: string } } };
      };
      return {
        success: false,
        message: err?.response?.data?.data?.message || "添加文件锁失败",
      };
    }
  };

  /**
   * Release file lock
   */
  const releaseFileLock = useCallback((fileId: string, sync = false) => {
    try {
      fetch(`${api_host}/api/files/${fileId}/edit-lock`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${localStorage.getItem("access_token")}`,
        },
        keepalive: true,
        body: JSON.stringify({ action: "delete" }),
      });
    } catch (error) {
      console.error("释放文件锁失败:", error);
    }
  }, []);

  /**
   * Stop lock timer
   */
  const stopLockTimer = useCallback(() => {
    if (lockTimerRef.current) {
      clearInterval(lockTimerRef.current);
      lockTimerRef.current = null;
    }
  }, []);

  /**
   * Interval file lock refresh
   */
  const intervalFileLock = async (fileId: string) => {
    try {
      await filesApi.lock(fileId, { action: "add" });
    } catch (error) {
      console.error("定时刷新文件锁失败:", error);
    }
  };

  /**
   * Start lock timer
   */
  const startLockTimer = useCallback(
    (fileId: string) => {
      stopLockTimer();
      lockTimerRef.current = setInterval(() => {
        intervalFileLock(fileId);
      }, 15 * 1000);
    },
    [stopLockTimer],
  );

  /**
   * Initialize edit content
   */
  const initEditContent = async () => {
    if (!currentFile || !fileId) return;

    if (currentFile.file_ext === "html") {
      const res = await fetch(currentFile.file_url);
      const text = await res.text();
      setEditContent(text);
      setInitialContent(text);
      if (ueditorRef.current) {
        // 使用静默设置，不触发 contentChange 事件
        await ueditorRef.current.setValueSilent(text);
      }
    } else {
      const res = await chunksApi.files.list(fileId);
      setChunks(res.chunks);
      const content = res.chunks
        .map(
          (item: KnowledgeChunk) =>
            `${item.content}`,
        )
        .join("\n");
      setEditContent(content);
      setInitialContent(content);
    }

    setIsInit(true);
  };

  /**
   * Start editing
   */
  const startEditing = async () => {
    // Check edit conflict
    if (!startEdit()) {
      return {
        success: false,
        message: conflictMessage,
      };
    }

    // Check file lock
    if (!fileId) {
      return { success: false, message: "No file ID" };
    }

    const { success, message: lockMessage } = await addFileLock(fileId);
    if (!success) {
      return {
        success: false,
        message: lockMessage,
      };
    }

    // Initialize edit content
    initEditContent();

    // Start lock timer
    startLockTimer(fileId);

    return { success: true, message: "" };
  };

  // ==================== Cleanup ====================

  /**
   * Cleanup edit state
   */
  const cleanupEditState = useCallback(() => {
    stopLockTimer();
    if (fileId) {
      releaseFileLock(fileId);
    }
    // Use Zustand setState to update store
    useLibraryStore.setState({ isRestore: false, restoreContent: "" });
    endEdit();
  }, [stopLockTimer, releaseFileLock, fileId, endEdit]);

  /**
   * Handle cancel
   */
  const handleCancel = useCallback(
    async (back = true) => {
      if (back && hasUnsavedChanges()) {
        Modal.confirm({
          title: t("common.tip"),
          content: t("common.unsaved_changes"),
          okText: t("action.exit_edit"),
          cancelText: t("action.cancel"),
          onOk: () => {
            // Reset flags to avoid triggering subsequent checks
            hasUeditorChangesRef.current = false;
            hasWpsChangesRef.current = false;
            setInitialContent(editContent); // Update to avoid double confirm
            cleanupEditState();
            navigate(-1);
          },
        });
        return;
      }

      cleanupEditState();
      if (back) {
        navigate(-1);
      }
    },
    [hasUnsavedChanges, cleanupEditState, editContent, navigate, t],
  );

  /**
   * Handle save (debounced)
   */
  const handleSave = useCallback(
    debounce(async () => {
      if (!fileId) return;

      if (wpsOfficeRef.current) {
        wpsOfficeRef.current.save();
        hasWpsChangesRef.current = false;
        message.success(t("status.save_success"));
        setInitialContent(editContent);
        cleanupEditState();
        navigate(-1);
        return;
      }
      if (ueditorRef.current) {
        // 如果用户没有修改内容，保存原始内容，避免 UEditor 的过滤规则修改 HTML 结构
        // 如果用户修改了内容，则获取编辑器的当前内容
        const html = hasUeditorChangesRef.current
          ? await ueditorRef.current.getRawHtml()
          : initialContent;
        if (!html) return;
        await filesApi.raw(fileId, { content: html });
        hasUeditorChangesRef.current = false;
      }
      message.success(t("status.save_success"));
      setInitialContent(editContent);
      cleanupEditState();
      navigate(-1);
    }, 1200),
    [fileId, cleanupEditState, navigate, t, editContent],
  );

  // ==================== Lifecycle ====================

  /**
   * Handle before unload
   */
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

    const handleUnload = () => {
      stopLockTimer();
      if (fileId) {
        releaseFileLock(fileId, true);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("unload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("unload", handleUnload);
    };
  }, [hasUnsavedChanges, stopLockTimer, releaseFileLock, fileId, t]);

  // Track if initialization completed to avoid premature cleanup
  const initCompletedRef = useRef(false);

  // Initialize on mount
  useEffect(() => {
    let isCancelled = false;

    const init = async () => {
      if (!currentFile || !fileId) return;

      // Check file mode and get result directly
      const determinedOfficeType = await checkFileMode({
        library_id: currentFile.library_id,
        file_ext: currentFile.file_ext,
        type: "editor",
      });

      // Check cancelled after async operation
      if (isCancelled) return;

      // Check if file is editable using the returned type
      if (
        (!isOfficeFile(currentFile.file_mime) &&
          currentFile.file_mime !== "html") ||
        determinedOfficeType === "web"
      ) {
        message.error(t("status.not_support_source_edit"));
        navigate(-1);
        return;
      }

      // Mark WPS as potentially changed once initialized (WPS doesn't expose change events)
      if (determinedOfficeType === "wps") {
        hasWpsChangesRef.current = true;
      }

      const { success } = await startEditing();
      if (isCancelled) return;

      if (!success) {
        navigate(-1);
        return;
      }

      initCompletedRef.current = true;
    };

    init();

    return () => {
      isCancelled = true;
      // Only cleanup if initialization completed
      if (initCompletedRef.current) {
        cleanupEditState();
      }
    };
  }, [fileId]); // Keep dependencies minimal to prevent re-runs

  // Block navigation if unsaved changes
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasUnsavedChanges() && currentLocation.pathname !== nextLocation.pathname,
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
          blocker.proceed();
        },
        onCancel: () => {
          blocker.reset();
        },
      });
    }
  }, [blocker, cleanupEditState, t]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <LibraryHeader
        footer={
          <div className="flex items-center gap-2">
            <Button onClick={() => handleCancel(true)}>退出编辑</Button>
            <Button type="primary" loading={isSaving} onClick={handleSave}>
              {t("action.save")}
            </Button>
          </div>
        }
      >
        {currentFile && (
          <div className="max-w-[30vw] flex-1 overflow-hidden">
            <h3 className="text-base text-[#1D1E1F] truncate">
              {currentFile.name}
            </h3>
            <p className="text-xs text-[#9A9A9A]">
              {t("common.recently_edit")}：{currentFile.updated_at}
            </p>
          </div>
        )}
      </LibraryHeader>

      {/* Editor Content */}
      {officeLoading ? null : officeType === "wps" ? (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              <Spin size="large" />
            </div>
          }
        >
          <WpsOffice
            ref={wpsOfficeRef}
            fileId={currentFile?.id || ""}
            fileExt={currentFile?.file_ext || ""}
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
      ) : null}
    </div>
  );
}

export default SourceEditView;
