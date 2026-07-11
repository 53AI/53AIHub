import { useState, useEffect, useCallback, useRef } from "react";
import { Button, message, Modal } from "antd";
import { useNavigate, useParams, useBlocker } from "react-router-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { useEditConflict } from "@/hooks/useEditConflict";
import fileBodiesApi from "@/api/modules/file-bodies";
import filesApi from "@/api/modules/files";
import { debounce } from "@km/shared-utils";
import { api_host } from "@/utils/config";
import { t } from "@/locales";
import { LibraryHeader } from "../../components/header";
import { canEdit, getDisplayName, useInlineEdit } from "../../composables/useInlineEdit";
import { lazy, Suspense } from "react";

// Lazy load chunk editor
const MarkdownChunkEditor = lazy(() => import("@/components/Markdown/ChunkEditor"));

// Sleep utility
const sleep = (seconds: number) =>
  new Promise((resolve) => setTimeout(resolve, seconds * 1000));

/**
 * Chunks edit view component
 * 1:1 migration from chunks-edit.vue
 */
export function ChunksEditView() {
  const navigate = useNavigate();
  const { id, fid } = useParams<{ id: string; fid: string }>();

  // Subscribe to store state correctly using selectors
  const files = useLibraryStore((state) => state.files);
  const currentFileId = useLibraryStore((state) => state.currentFileId);
  const fileViewType = useLibraryStore((state) => state.fileViewType);
  const isRestore = useLibraryStore((state) => state.isRestore);
  const restoreContent = useLibraryStore((state) => state.restoreContent);
  const setCurrentFileId = useLibraryStore((state) => state.setCurrentFileId);
  const loadFile = useLibraryStore((state) => state.loadFile);
  const currentFile = files.find((item) => item.id === currentFileId);

  // State
  const [editContent, setEditContent] = useState("");
  const [initialContent, setInitialContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isInit, setIsInit] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const lockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const justSavedRef = useRef(false);
  // Use refs to track latest values for debounce closure
  const editContentRef = useRef(editContent);
  const initialContentRef = useRef(initialContent);
  const isRestoreRef = useRef(isRestore);

  // Keep refs in sync with state
  editContentRef.current = editContent;
  initialContentRef.current = initialContent;
  isRestoreRef.current = isRestore;

  // Inline edit handlers
  const { handleClick: handleInlineClick, handleBlur: handleInlineBlur, handleKeydown: handleInlineKeydown, handlePaste: handleInlinePaste } = useInlineEdit();

  // Edit conflict detection
  const { conflictMessage, startEdit, endEdit } = useEditConflict(
    fid || "",
    id || "",
  );

  // Watch for restore content
  useEffect(() => {
    if (restoreContent && isRestore) {
      setEditContent(restoreContent);
    }
  }, [restoreContent, isRestore]);

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
    if (isRestore && restoreContent) {
      // Restore mode - use restore content
      setEditContent(restoreContent);
      setInitialContent("");
    } else {
      const res = await fileBodiesApi.find(fid || "");
      setEditContent(res?.content || "");
      setInitialContent(res?.content || "");
    }
    // Ensure currentFile is available before marking as ready
    const currentFileFromStore = useLibraryStore.getState().files.find(
      (item) => item.id === useLibraryStore.getState().currentFileId,
    );
    if (currentFileFromStore) {
      setIsInit(true);
      setIsReady(true);
    }
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
    const { success, message } = await addFileLock(fid || "");
    if (!success) {
      return {
        success: false,
        message,
      };
    }

    // Initialize edit content
    initEditContent();

    // Start lock timer
    startLockTimer(fid || "");

    return {
      success: true,
      message: "",
    };
  };

  // ==================== Data Save ====================

  /**
   * Save file content
   */
  const fileSave = (content: string) => {
    return fileBodiesApi.create({
      content,
      file_id: fid || "",
      library_id: id || "",
    });
  };

  /**
   * Check if has unsaved changes
   */
  const hasUnsavedChanges = useCallback((): boolean => {
    // If just saved, don't consider as unsaved
    if (justSavedRef.current) return false;
    return editContent !== initialContent;
  }, [editContent, initialContent]);

  /**
   * Cleanup edit state
   */
  const cleanupEditState = useCallback(() => {
    stopLockTimer();
    if (fid) {
      releaseFileLock(fid);
    }
    // Use Zustand setState to update store
    useLibraryStore.setState({ isRestore: false, restoreContent: "" });
    endEdit();
  }, [stopLockTimer, releaseFileLock, fid, endEdit]);

  /**
   * Handle back navigation
   */
  const handleBack = useCallback(() => {
    if (fileViewType === "chunk") {
      navigate(`/library/${id}/file/${fid}/chunks?view=view`);
    } else {
      navigate(-1);
    }
  }, [fileViewType, navigate, id, fid]);

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
            setInitialContent(editContent); // Avoid double confirm
            cleanupEditState();
            handleBack();
          },
        });
        return;
      }

      cleanupEditState();
      if (back) {
        handleBack();
      }
    },
    [hasUnsavedChanges, cleanupEditState, handleBack, editContent, t],
  );

  /**
   * Handle save (debounced)
   * 使用 ref 跟踪最新值，避免闭包陷阱
   */
  const handleSave = useCallback(
    debounce(async () => {
      if (isRestoreRef.current) {
        Modal.confirm({
          title: t("common.tip"),
          content: t("history.restore_confirm"),
          okText: t("action.confirm"),
          cancelText: t("action.cancel"),
          onOk: async () => {
            await performSave();
          },
        });
        return;
      }
      await performSave();
    }, 1200),
    [t], // 只依赖 t，其他值通过 ref 获取
  );

  const performSave = async () => {
    // 使用 ref 获取最新值
    const currentEditContent = editContentRef.current;
    const currentInitialContent = initialContentRef.current;
    const contentChanged = currentInitialContent !== currentEditContent;

    setIsSaving(true);

    try {
      if (contentChanged) {
        await fileSave(currentEditContent);
        await sleep(2);
      }

      setInitialContent(currentEditContent);
      justSavedRef.current = true;
      message.success(t("status.save_success"));
      cleanupEditState();
      handleBack();
    } catch (error) {
      console.error("保存失败:", error);
      message.error(t("status.save_fail"));
    } finally {
      setIsSaving(false);
    }
  };

  // ==================== Lifecycle ====================

  /**
   * Handle before unload
   */
  useEffect(() => {
    const handleBeforeUnload = (
      event: BeforeUnloadEvent,
    ): string | undefined => {
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
      if (fid) {
        releaseFileLock(fid);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("unload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("unload", handleUnload);
    };
  }, [hasUnsavedChanges, stopLockTimer, releaseFileLock, fid, t]);

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
          cleanupEditState();
          blocker.proceed();
        },
        onCancel: () => {
          blocker.reset();
        },
      });
    }
  }, [blocker, cleanupEditState, t]);

  // Initialize on mount
  useEffect(() => {
    const init = async () => {
      if (!fid) return;

      // Ensure currentFileId is set and file is loaded into store
      if (!useLibraryStore.getState().currentFileId) {
        const file = await setCurrentFileId(fid);
        if (!file) return;
      }

      // Get currentFile from store directly (not from closure) to ensure it's fresh
      const currentFileId = useLibraryStore.getState().currentFileId;
      let currentFileFromStore = useLibraryStore.getState().files.find(
        (item) => item.id === currentFileId,
      );

      // If file not found in store, load it
      if (!currentFileFromStore) {
        await loadFile(fid || "");
        currentFileFromStore = useLibraryStore.getState().files.find(
          (item) => item.id === currentFileId,
        );
        if (!currentFileFromStore) {
          message.error(t("common.load_file_failed"));
          navigate(-1);
          return;
        }
      }

      const { success, message: editMessage } = await startEditing();
      if (!success) {
        navigate(-1);
        return;
      }
    };

    init();

    return () => {
      stopLockTimer();
      if (fid) {
        releaseFileLock(fid);
      }
    };
  }, [fid]);

  // Inline edit handlers for title
  const handleClickTitle = (e: React.MouseEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineClick(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: true,
        file_ext: currentFile.file_ext,
      },
      isFile: true,
      permission: currentFile.permission,
    });
  };

  const handleBlurTitle = (e: React.FocusEvent<HTMLElement>) => {
    if (!currentFile) return;
    handleInlineBlur(e, {
      file: {
        id: currentFile.id,
        name: currentFile.name,
        base_path: currentFile.base_path || "",
        isfile: true,
        file_ext: currentFile.file_ext,
      },
      isFile: true,
      permission: currentFile.permission,
    });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-white">
      <LibraryHeader
        footer={
          <div className="flex items-center gap-2">
            <Button onClick={() => handleCancel(true)}>
              退出编辑
            </Button>
            <Button type="primary" loading={isSaving} onClick={handleSave}>
              {t("action.save")}
            </Button>
          </div>
        }
        header={
          currentFile && (
            <div className="max-w-[30vw] flex-1 overflow-hidden">
              <h3
                className={`py-0.5 text-base text-[#1D1E1F] truncate ${canEdit(currentFile.permission) ? "inline-editable" : ""}`}
                onClick={handleClickTitle}
                onBlur={handleBlurTitle}
                onKeyDown={handleInlineKeydown}
                onPaste={handleInlinePaste}
              >
                {getDisplayName(currentFile.name, true, currentFile.file_ext)}
              </h3>
              <p className="text-xs text-[#9A9A9A]">
                {t("common.recently_edit")}：{currentFile.updated_at}
              </p>
            </div>
          )
        }
      />

      {/* Editor Content */}
      {isReady && (
        <Suspense
          fallback={
            <div className="flex-1 flex items-center justify-center">
              加载中...
            </div>
          }
        >
          <div className="flex-1 overflow-hidden">
            <MarkdownChunkEditor
              value={editContent}
              onChange={setEditContent}
              height="100%"
            />
          </div>
        </Suspense>
      )}
    </div>
  );
}

export default ChunksEditView;
