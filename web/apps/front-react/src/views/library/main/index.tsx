import {
  useState,
  useRef,
  useEffect,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  Outlet,
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
} from "react-router-dom";
import { Avatar, Spin, message } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useLibraryStore } from "@/stores/modules/library";
import { useUserStore } from "@/stores/modules/user";
import { useEnterpriseStore, useIsSoftStyle } from "@/stores/modules/enterprise";
import { useNavigationStore } from "@/stores/modules/navigation";
import { ProfilePopover, MessageCenter } from "@/components/Layout";
import { Catalog, type CatalogRef } from "./catalog";
import { FileUpload } from "./components/file-upload";
import { ApplyDialog, type ApplyDialogRef } from "../components/apply";
import VirtualLogo from "@/components/VirtualLogo";
import { FileSearch } from "@/components/FileSearch";
import { MoreDropdown } from "@/components/MoreDropdown";
import { ProfileModal } from "@/views/profile";
import { RecordingFloat } from "@/components/RecordingFloat";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { LibraryPermission } from "../components/permission";
import { eventBus, copyToClip } from "@km/shared-utils";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import { useEnv } from "@/hooks/useEnv";
import { useFullscreen } from "@/hooks/useFullscreen";
import Breadcrumb from "@/components/Breadcrumb";
import "./index.css";

interface UploadItem {
  id: string;
  file: File;
  status: string;
  progress: number;
  fileId?: string;
}

// Catalog ref context
export const CatalogRefContext =
  createContext<React.RefObject<CatalogRef | null> | null>(null);

export const useCatalogRef = () => {
  return useContext(CatalogRefContext);
};

// 文件预览全屏状态 Context：跨越 LibraryFileLayout 这一中间 Outlet 层，
// 让 LibraryFileView 能直接消费（useOutletContext 只能读最近一层 Outlet）。
export interface FileViewFullscreenValue {
  fileViewFullscreen: boolean;
  toggleFileViewFullscreen: () => void;
  composeFileViewClassName: (base: string) => string;
}

export const FileViewFullscreenContext = createContext<FileViewFullscreenValue | null>(null);

export const useFileViewFullscreen = () => {
  const ctx = useContext(FileViewFullscreenContext);
  if (!ctx) {
    throw new Error(
      "useFileViewFullscreen 必须在 LibraryMainView 内部使用",
    );
  }
  return ctx;
};

export function LibraryMainView() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ id: string; fid: string }>();
  const [searchParams] = useSearchParams();
  const libraryStore = useLibraryStore();
  const userStore = useUserStore();
  const enterpriseStore = useEnterpriseStore();
  const isSoftStyle = useIsSoftStyle();
  const navigationStore = useNavigationStore();
  const { isDevEnv } = useEnv();

  // Use selectors for reactive updates
  const assistantExpanded = useLibraryStore((state) => state.assistantExpanded);
  const assistantCollapsed = useLibraryStore(
    (state) => state.assistantCollapsed,
  );
  const assistantVisible = useLibraryStore((state) => state.assistantVisible);

  // Refs
  const siderRef = useRef<HTMLDivElement>(null);
  const catalogRef = useRef<CatalogRef>(null);
  const fileUploadRef = useRef<{
    selectFiles: () => void;
    selectFolder: () => void;
  }>(null);
  const applyRef = useRef<ApplyDialogRef>(null);
  const resizerRef = useRef<HTMLDivElement>(null);

  // State
  const [loading, setLoading] = useState(true);
  const [showProfile, setShowProfile] = useState(false);
  const [messageCenterReady, setMessageCenterReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // 文件预览全屏状态提到这一层：让 .assistant-sider 能在全屏时提升 z-index，
  // 保证 DocumentApp 始终 portal 到外层容器渲染，与非全屏行为一致。
  const {
    fullscreen: fileViewFullscreen,
    toggle: toggleFileViewFullscreen,
    composeClassName: composeFileViewClassName,
  } = useFullscreen();

  // Computed values
  const libraryId = params.id || "";

  // Get current route name based on pathname
  const getRouteName = useCallback(() => {
    const pathname = location.pathname;
    const libraryBasePath = `/library/${libraryId}`;
    if (pathname === libraryBasePath || pathname === `${libraryBasePath}/`) {
      return "LibraryHome";
    }
    if (pathname === `${libraryBasePath}/chat`) return "LibraryChat";
    if (pathname.includes("/recall")) return "LibraryRecallTest";
    if (pathname.includes("/graph")) return "LibraryGraph";
    if (pathname.includes("/file/")) {
      if (pathname.includes("/chunks-edit")) return "LibraryFileChunksEdit";
      if (pathname.includes("/chunks")) return "LibraryFileChunks";
      return "LibraryFileView";
    }
    if (pathname.includes("/folder/")) return "LibraryFolder";
    return "";
  }, [location.pathname, libraryId]);

  const routeName = getRouteName();

  // 判断是否处于文件预览页（用于助手面板显隐 + 自动退出全屏）。
  const isFileView = routeName === "LibraryFileView";

  // 离开文件预览页时自动退出全屏，避免下次进入仍是全屏态。
  // 必须在所有早返回之前调用，遵守 Rules of Hooks。
  useEffect(() => {
    if (!isFileView && fileViewFullscreen) {
      toggleFileViewFullscreen();
    }
  }, [isFileView, fileViewFullscreen, toggleFileViewFullscreen]);

  // Helper functions for icon/block colors
  const getIconColor = (bool: boolean) => {
    return bool ? "text-[#2563EB]" : "text-[#979799]";
  };

  const getBlockColor = (bool: boolean) => {
    return bool ? "bg-[#EBF1FF] text-[#2563EB]" : "text-[#1D1E1F]";
  };

  // 加载库数据
  const loadLibraryData = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const store = useLibraryStore.getState();
      await store.setLibraryId(id);
      await store.loadFilesAll();
    } finally {
      setLoading(false);
    }
  }, []);

  // 监听路由参数变化
  useEffect(() => {
    if (libraryId) {
      loadLibraryData(libraryId);
    }
  }, [libraryId, loadLibraryData]);

  // Handle query.type for library type
  useEffect(() => {
    const type = searchParams.get("type");
    if (type) {
      libraryStore.setLibraryType(type as "preview" | "chunk" | "");
    }
  }, [searchParams]);

  // 初始化加载侧边栏宽度
  useEffect(() => {
    useLibraryStore.getState().loadSidebarWidth();
  }, []);

  // 清理状态 - 只在组件卸载时执行
  useEffect(() => {
    return () => {
      useLibraryStore.getState().clearState();
      eventBus.off("apply-open");
    };
  }, []);

  // 鼠标进入展开区域 - 展开侧边栏
  const handleMouseEnter = useCallback(() => {
    const store = useLibraryStore.getState();
    if (!store.siderVisible) {
      store.setSidebarCollapsed(true);
    }
  }, []);

  // 鼠标离开侧边栏 - 折叠侧边栏
  const handleMouseLeave = useCallback(() => {
    const store = useLibraryStore.getState();
    if (!store.siderVisible && store.sidebarCollapsed) {
      store.setSidebarCollapsed(false);
    }
  }, []);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const store = useLibraryStore.getState();
      if (!store.siderVisible && store.sidebarCollapsed && siderRef.current) {
        if (!siderRef.current.contains(e.target as Node)) {
          store.setSidebarCollapsed(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 拖拽调整侧栏宽度
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const store = useLibraryStore.getState();
    const startX = e.clientX;
    const startWidth = store.sidebarWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - startX;
      const newWidth = startWidth + deltaX;
      useLibraryStore.getState().setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  // 更多操作菜单处理
  const handleMore = useCallback(
    (command: string) => {
      setMoreOpen(false);
      const store = useLibraryStore.getState();
      const user = useUserStore.getState().info;
      if (command === "share") {
        const url = buildUrl(`/library/${store.library?.id}?eid=${user?.eid}`);
        copyToClip(url).then(() => {
          message.success(
            t("common.copied") + t("action.share") + t("common.link"),
          );
        });
      } else if (command === "manage") {
        if ((store.library?.permission ?? 0) >= PERMISSION_TYPE.manage) {
          navigate(`/library/${store.library?.id}/setting/info`);
        } 
      }
    },
    [navigate],
  );

  // 导航到首页
  const handleView = useCallback(() => {
    navigate({
      pathname: `/library/${libraryId}`,
    });
  }, [navigate, libraryId]);

  // 导航到 AI 搜问
  const handleNavigateChat = useCallback(() => {
    navigate(`/library/${libraryId}/chat`);
  }, [navigate, libraryId]);

  // 导航到召回测试
  const handleNavigateRecall = useCallback(() => {
    navigate(`/library/${libraryId}/recall`);
  }, [navigate, libraryId]);

  // 视图切换
  const handleViewChange = useCallback(
    (viewType: "preview" | "chunk") => {
      const store = useLibraryStore.getState();
      if (store.fileViewType === viewType) return;

      const currentPath = location.pathname;
      const isInFileView = currentPath.includes("/file/");

      if (isInFileView) {
        // 在文件视图中切换
        const fidMatch = currentPath.match(/\/file\/([^/]+)/);
        if (fidMatch) {
          const fid = fidMatch[1];
          if (viewType === "chunk") {
            navigate(`/library/${libraryId}/file/${fid}/chunks`, {
              replace: true,
            });
          } else {
            navigate(`/library/${libraryId}/file/${fid}`, { replace: true });
          }
        }
      } else {
        store.setLibraryType(viewType);
      }
    },
    [location.pathname, navigate, libraryId],
  );

  // 上传处理
  const handleUpload = useCallback(
    (type: "file" | "folder", basePath: string) => {
      if (type === "file") {
        fileUploadRef.current?.selectFiles(basePath);
      } else if (type === "folder") {
        fileUploadRef.current?.selectFolder(basePath);
      }
    },
    [],
  );

  // 上传完成
  const handleUploadComplete = useCallback(() => {
    useLibraryStore.getState().loadFilesAll();
  }, []);

  // 查看上传文件
  const handleViewFile = useCallback(
    (data: UploadItem) => {
      navigate(`/library/${libraryId}/file/${data.fileId}`);
    },
    [navigate, libraryId],
  );

  // 申请提交
  const handleApplySubmit = useCallback(() => {
    eventBus.emit("apply-submit");
  }, []);

  // 打开个人信息面板
  const handleOpenProfile = useCallback(() => {
    setShowProfile(true);
  }, []);

  // 关闭个人信息面板
  const handleCloseProfile = useCallback(() => {
    setShowProfile(false);
  }, []);

  // 监听申请打开事件
  useEffect(() => {
    const handleApplyOpen = (data: any) => {
      setMoreOpen(false);
      applyRef.current?.open(data);
    };
    eventBus.on("apply-open", handleApplyOpen);
    return () => eventBus.off("apply-open", handleApplyOpen);
  }, []);

  // 延迟加载消息中心
  useEffect(() => {
    const timer = setTimeout(() => {
      setMessageCenterReady(true);
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  // 路由变化时关闭个人信息面板
  useEffect(() => {
    setShowProfile(false);
  }, [location.pathname]);

  // 加载状态
  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <Spin size="large" />
      </div>
    );
  }

  // 错误状态
  if (libraryStore.error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[#F8F9FA]">
        <div className="text-center">
          <div className="text-6xl mb-4">📚</div>
          <h2 className="text-xl text-[#1D1E1F] mb-2">
            知识库不存在或无法访问
          </h2>
          <p className="text-sm text-[#999999] mb-6">
            {libraryStore.errorMessage}
          </p>
          <button
            className="px-4 py-2 bg-[#2563EB] text-white rounded hover:bg-[#1d4ed8]"
            onClick={() => navigate("/knowledge")}
          >
            返回知识库列表
          </button>
        </div>
      </div>
    );
  }

  return (
    <CatalogRefContext.Provider value={catalogRef}>
      <FileViewFullscreenContext.Provider
        value={{
          fileViewFullscreen,
          toggleFileViewFullscreen,
          composeFileViewClassName,
        }}
      >
      <div
        className={composeFileViewClassName(`h-full flex bg-[#F8FAFD] overflow-hidden ${fileViewFullscreen ? "z-50" : ""}`)}
      >
        {/* 外层：边框发光容器 */}
        <div
          className={`flex-1 min-h-0 h-full relative transition-all duration-500 overflow-hidden ${assistantExpanded ? "border-glow-wrapper border-glow-active" : ""}`}
        >
          {/* 蛇形光斑 */}
          {assistantExpanded && (
            <>
              <div
                className="snake-cloud"
                style={{ width: "300px", height: "60px", filter: "blur(40px)" }}
              />
              <div
                className="snake-cloud"
                style={{
                  width: "200px",
                  height: "40px",
                  filter: "blur(30px)",
                  animationDelay: "-2.5s",
                }}
              />
              <div
                className="snake-cloud"
                style={{
                  width: "400px",
                  height: "80px",
                  filter: "blur(50px)",
                  animationDelay: "-5s",
                }}
              />
            </>
          )}
          {/* 内层：白色背景 + 内发光 */}
          <div className="h-full flex relative bg-white">
            {/* 鼠标悬停展开区域 */}
            {!libraryStore.siderVisible && !libraryStore.sidebarCollapsed && (
              <div
                className="w-4 h-full absolute -left-2 top-0 z-10 hover:bg-gray-100/50 transition-colors"
                onMouseEnter={handleMouseEnter}
              />
            )}

            {/* 左边栏 */}
            {!fileViewFullscreen && <div
              ref={siderRef}
              className={`
            bg-[#fff] px-4 pt-5  flex flex-col transition-all duration-300 ease-linear absolute top-0 left-0 h-full z-10 border-r
            ${libraryStore.siderVisible ? "" : "-translate-x-full -ml-2"}
            ${!libraryStore.siderVisible && libraryStore.sidebarCollapsed ? "translate-x-0 shadow-xl" : ""}
          `}
              style={{ width: `${libraryStore.sidebarWidth}px` }}
              onMouseLeave={handleMouseLeave}
            >
              <div className="flex items-center gap-1 text-sm text-secondary">
                <Breadcrumb
                  className="text-sm"
                  items={[
                    {
                      path: `/knowledge`,
                      i18nKey: "module.knowledge",
                    },
                    {
                      path: libraryStore.space?.id
                        ? `/knowledge?space_id=${libraryStore.space?.id}`
                        : "/knowledge",
                      label: libraryStore.space?.name ?? t("module.space"),
                      linkable: true,
                    },
                  ]}
                />
              </div>

              {/* 库名称和更多操作 */}
              <div className="flex-none h-7 flex items-center gap-2.5 mt-4 group">
                <VirtualLogo text={libraryStore.library?.name} src={libraryStore.library?.icon} size={26} />
                <h2 className="flex-1 text-lg text-[#1D1E1F] truncate">
                  {libraryStore.library?.name}
                </h2>
                <MoreDropdown
                  icon="more-h"
                  size="20px"
                  triggerClassName="hidden group-hover:flex"
                  backgroundColor="#EDEEF0"
                  open={moreOpen}
                  onOpenChange={setMoreOpen}
                  onCommand={handleMore}
                  items={[
                    { key: "share", label: "分享", icon: "share-two" },
                    {
                      key: "manage",
                      label: "管理",
                      icon: "setting2",
                      wrapper: (children) => (
                        <LibraryPermission
                          required={PERMISSION_TYPE.manage}
                          inline={false}
                        >
                          {children}
                        </LibraryPermission>
                      ),
                    },
                  ]}
                />
              </div>


              {/* 文件搜索 */}
              <FileSearch className="mt-4" libraryId={libraryId} />

              {/* 导航菜单 */}
              <div className="flex flex-col gap-1 py-3">
                {/* 首页 */}
                <div
                  className={`h-9 flex items-center gap-2.5 pl-2 rounded cursor-pointer hover:bg-[#EEEFF0] ${getBlockColor(routeName === "LibraryHome")}`}
                  onClick={handleView}
                >
                  <div
                    className={`size-4 ${getIconColor(routeName === "LibraryHome")}`}
                  >
                    <SvgIcon name="folder-minus-fill" />
                  </div>
                  <p className="flex-1 text-sm">{t("library.home")}</p>
                </div>

                {/* AI搜问 - 仅在非 chunk 视图显示 */}
                {libraryStore.fileViewType !== "chunk" && (
                  <div
                    className={`h-9 flex items-center gap-2.5 pl-2 rounded cursor-pointer hover:bg-[#EEEFF0] ${getBlockColor(routeName === "LibraryChat")}`}
                    onClick={handleNavigateChat}
                  >
                    <div
                      className={`size-4 ${getIconColor(routeName === "LibraryChat")}`}
                    >
                      <SvgIcon name="ai-search" />
                    </div>
                    <p className="flex-1 text-sm">AI搜问</p>
                  </div>
                )}

                {/* 召回测试 - 仅在 chunk 视图显示 */}
                {libraryStore.fileViewType === "chunk" && (
                  <div
                    className={`h-9 flex items-center gap-2.5 pl-2 rounded cursor-pointer hover:bg-[#EEEFF0] ${getBlockColor(routeName === "LibraryRecallTest")}`}
                    onClick={handleNavigateRecall}
                  >
                    <div
                      className={`size-4 ${getIconColor(routeName === "LibraryRecallTest")}`}
                    >
                      <SvgIcon name="trace" />
                    </div>
                    <p className="flex-1 text-sm">召回测试</p>
                  </div>
                )}
              </div>

              {/* 目录树 */}
              {libraryStore.library_id ? (
                <Catalog
                  ref={catalogRef}
                  className="flex-1 -mx-4 overflow-hidden"
                  onUpload={handleUpload}
                />
              ) : (
                <div className="flex-1" />
              )}

              {/* 视图切换 */}
              {libraryStore.library?.permission >= PERMISSION_TYPE.edit_all && (
                <div className="px-2 py-3 flex-none">
                  <div className="flex items-center gap-2 rounded p-0.5 bg-[#EDEEF0]">
                    <div
                      className={`flex-1 h-[30px] flex items-center justify-center rounded cursor-pointer ${libraryStore.fileViewType === "preview" ? "text-[#1D1E1F] bg-[#FFFFFF]" : "text-[#4F5052]"}`}
                      onClick={() => handleViewChange("preview")}
                    >
                      <p className="text-sm">{t("library.knowledge_view")}</p>
                    </div>
                    <div
                      className={`flex-1 h-[30px] flex items-center justify-center rounded cursor-pointer ${libraryStore.fileViewType === "chunk" ? "text-[#1D1E1F] bg-[#FFFFFF]" : "text-[#4F5052]"}`}
                      onClick={() => handleViewChange("chunk")}
                    >
                      <p className="text-sm">{t("library.corpus_view")}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 用户区域 */}
              {!isSoftStyle && (
                <div className="flex-none -mx-3 p-4 flex items-center gap-1 relative">
                  <div className="border-t absolute top-0 left-2 right-2" />

                  <ProfilePopover onProfile={handleOpenProfile}>
                    <div className="flex-1 overflow-hidden flex items-center gap-2">
                      <Avatar
                        size={34}
                        src={userStore.info.avatar}
                        className="border border-white"
                      />
                      <div className="flex-1 overflow-hidden cursor-pointer">
                        <div className="text-sm font-medium text-[#1D1E1F] truncate">
                          {userStore.info.nickname || userStore.info.username}
                        </div>
                        <div className="text-xs text-[#999999] truncate">
                          {enterpriseStore.display_name}
                        </div>
                      </div>
                    </div>
                  </ProfilePopover>
                  {userStore.is_login &&
                    navigationStore.hasKnowledge &&
                    messageCenterReady && <MessageCenter />}
                </div>
              )}

              {/* 拖拽调整器 */}
              {libraryStore.siderVisible && (
                <div
                  ref={resizerRef}
                  className="absolute right-0 top-0 w-1 h-full bg-transparent hover:bg-blue-300 cursor-col-resize transition-colors duration-200 flex-shrink-0"
                  onMouseDown={handleResizeStart}
                />
              )}
            </div>}

            {/* 拖拽调整器 */}
            <div
              className="flex-1 flex min-h-0 relative  bg-white overflow-hidden"
              style={{
                marginLeft: libraryStore.siderVisible && !fileViewFullscreen
                  ? `${libraryStore.sidebarWidth}px`
                  : "0",
              }}
            >
              {loading ? null : <Outlet />}
            </div>

            {/* 个人信息弹窗 */}
            <ProfileModal open={showProfile} onClose={handleCloseProfile} />

            {/* 文件上传组件 */}
            <FileUpload
              ref={fileUploadRef}
              libraryId={libraryStore.library_id}
              onComplete={handleUploadComplete}
              onView={handleViewFile}
            />

            {/* 权限申请对话框 */}
            <ApplyDialog ref={applyRef} onSubmit={handleApplySubmit} />

            {/* 录音浮层 */}
            <RecordingFloat />
          </div>
        </div>

        {/* 右侧助手面板：全屏时提升 z-index 到 202，浮于 LibraryFileView 全屏覆盖层 (z-201) 之上。
             DocumentApp 通过 portal 渲染到这里，跟非全屏表现完全一致。 */}
        {isFileView && assistantVisible && (
          <div
            className={`assistant-sider flex bg-white relative rounded-lg overflow-hidden transition-all duration-300 ${
              fileViewFullscreen ? "z-[202]" : ""
            } ${
              assistantCollapsed
                ? "flex-none w-[452px]"
                : assistantExpanded
                  ? "flex-1 min-w-[452px]"
                  : "flex-none w-[48px]"
            }`}
          />
        )}
      </div>
      </FileViewFullscreenContext.Provider>
    </CatalogRefContext.Provider>
  );
}
