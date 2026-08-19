import { useState, lazy, Suspense, useEffect, useContext } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { Spin } from "antd";
import { createPortal } from "react-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { LibraryHeader } from "../../components/header";
import PermissionSetting from "../components/permission-setting";
import FileShare from "./components/share";
import FileMore from "./components/more";
import FileFav from "./components/fav";
import EditBtn from "./components/edit-btn";
import DocumentApp from "./components/document-app";
import AssistantBtn from "./components/assistant-btn";
import {
  canEdit,
  getDisplayName,
  useInlineEdit,
} from "../../composables/useInlineEdit";
import { t } from "@/locales";
import { CatalogRefContext, useFileViewFullscreen } from "../index";
import agentsApi from "@/api/modules/agents";
import { AGENT_USAGES } from "@/constants/agent";
import { FullscreenToggle } from "@/components/FullscreenToggle";

const FileViewer = lazy(() => import("@/components/FileViewer/view"));
const LibraryAudioView = lazy(() => import("./views/library-audio"));
const VideoViewer = lazy(() => import("./views/video"));

interface FileViewState {
  isLoading: boolean;
  showPermission: boolean;
}

export function LibraryFileView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id, fid } = useParams<{ id: string; fid: string }>();
  const catalogRef = useContext(CatalogRefContext);

  const [state, setState] = useState<FileViewState>({
    isLoading: false,
    showPermission: false,
  });

  const [assistantSiderContainer, setAssistantSiderContainer] =
    useState<HTMLElement | null>(null);

  const {
    handleClick: handleInlineClick,
    handleBlur: handleInlineBlur,
    handleKeydown: handleInlineKeydown,
    handlePaste: handleInlinePaste,
  } = useInlineEdit();

  // Subscribe to store state correctly using selectors
  const files = useLibraryStore((state) => state.files);
  const currentFileId = useLibraryStore((state) => state.currentFileId);
  const currentFile = files.find((item) => item.id === currentFileId);
  const assistantVisible = useLibraryStore((state) => state.assistantVisible);
  const setAssistantVisible = useLibraryStore((state) => state.setAssistantVisible);

  // 全屏状态由外层 library/main/index.tsx 持有，通过 React Context 跨越中间
  // LibraryFileLayout 这一层 Outlet 传下来。
  // - `fullscreen` / `toggleFullscreen`：供 FullscreenToggle 按钮使用
  // - `composeFileViewClassName`：在外层 LibraryMainView 已经应用到包裹 <Outlet /> 的 div 上，
  //   这里只用来兜底 / 备用，不再额外应用到内层容器。
  const {
    fileViewFullscreen: fullscreen,
    toggleFileViewFullscreen: toggleFullscreen,
  } = useFileViewFullscreen();

  // Find assistant-sider container when assistantVisible becomes true
  useEffect(() => {
    if (!assistantVisible) return;

    const findContainer = () => {
      const container = document.querySelector(
        ".assistant-sider",
      ) as HTMLElement | null;
      if (container) {
        setAssistantSiderContainer(container);
      }
    };

    // Try immediately
    findContainer();

    // Also try after short delays in case the container is rendered later
    const timer1 = setTimeout(findContainer, 50);
    const timer2 = setTimeout(findContainer, 150);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  }, [assistantVisible]);

  // 加载 agent 数据，设置 assistantInstall 状态
  useEffect(() => {
    const loadAssistantInstall = async () => {
      try {
        const res = await agentsApi.list({
          agent_usages: `${AGENT_USAGES.KM_FILE_CHAT},${AGENT_USAGES.KM_FILE_MAP}`,
        });
        const hasEnabled = res.agents.some((item: any) => item.enable);
        useLibraryStore.getState().setAssistantInstall(hasEnabled);
      } catch {
        // ignore
      }
    };
    loadAssistantInstall();
  }, []);

  const handleChunksEdit = () => {
    if (!currentFile) return;
    navigate(
      `/library/${currentFile.library_id}/file/${currentFile.id}/chunks-edit`,
    );
  };

  const handleSourceEdit = () => {
    if (!currentFile) return;
    if (currentFile.file_mime === "md" || currentFile.file_mime === "txt") {
      handleChunksEdit();
      return;
    }
    navigate(
      `/library/${currentFile.library_id}/file/${currentFile.id}/source-edit`,
    );
  };

  // Inline edit handlers
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

  const isLibraryFileView =
    location.pathname.includes("/file/") &&
    !location.pathname.includes("/chunks") &&
    !location.pathname.includes("/edit");

  return (
    <div className="flex-1 flex min-h-0">
      <div className="flex-1 flex flex-col overflow-hidden">
        <LibraryHeader
          footer={
            !state.isLoading && currentFile ? (
              <>
                <EditBtn
                  isSourceEdit={true}
                  file={currentFile}
                  onEdit={handleSourceEdit}
                />
                <FileShare
                  fileId={currentFile.id}
                  fileName={currentFile.name}
                />
                <FileFav />
                <AssistantBtn />
                <FullscreenToggle
                  fullscreen={fullscreen}
                  onToggle={toggleFullscreen}
                />
                <FileMore
                  catalogRef={catalogRef?.current}
                  onPermission={() =>
                    setState((s) => ({ ...s, showPermission: true }))
                  }
                />
              </>
            ) : null
          }
        >
          {currentFile && (
            <div className="flex-1 flex items-center gap-2 overflow-hidden">
              <div className="flex-1 overflow-hidden">
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
                  {t("common.recently_edit")} ：{currentFile.updated_at}
                </p>
              </div>
            </div>
          )}
        </LibraryHeader>

        {!state.isLoading && (
          <div className="flex-1 flex overflow-hidden relative">
            {currentFile && (
              <div className="flex-1 flex overflow-hidden relative">
                {currentFile.file_mime === "mp3" ? (
                  <LibraryAudioView currentFile={currentFile} />
                ) : currentFile.file_mime === "mp4" ? (
                  <VideoViewer currentFile={currentFile} />
                ) : (
                  <Suspense
                    fallback={
                      <div className="flex-1 flex items-center justify-center">
                        <Spin />
                      </div>
                    }
                  >
                    <FileViewer currentFile={currentFile} />
                  </Suspense>
                )}
              </div>
            )}

            {state.showPermission && (
              <PermissionSetting
                className="w-[320px] flex-none border-l"
                onClose={() =>
                  setState((s) => ({ ...s, showPermission: false }))
                }
              />
            )}
          </div>
        )}
      </div>

      {/* DocumentApp portal 到外层 .assistant-sider 容器（由 library/main/index.tsx 渲染）。
           全屏时 .assistant-sider 在 layout 层提升 z-index 到 202 浮于覆盖层之上，行为与
           非全屏一致。 */}
      {!state.isLoading &&
        isLibraryFileView &&
        assistantVisible &&
        assistantSiderContainer &&
        createPortal(<DocumentApp onHide={() => setAssistantVisible(false)} />, assistantSiderContainer)}
    </div>
  );
}

export default LibraryFileView;
