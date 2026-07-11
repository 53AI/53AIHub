import { useState, useEffect, lazy, Suspense, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Spin, Modal, Input, message } from "antd";
import { useBasicLayout } from "@/hooks/useBasicLayout";
import { useEnv } from "@/hooks/useEnv";
import {
  FileUpload,
  type FileUploadRef,
} from "@/views/library/main/components/file-upload";
import { type UploadItem } from "@/stores/modules/library";
import { filesApi } from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { buildUrl } from "@/utils/router";
import Header from "@/components/Layout/Header";
import { useRecordingStore } from "@/stores/modules/recording";
import { useNavigationStore } from "@/stores/modules/navigation";
import { t } from "@/locales";
import { getFormatTimeStamp } from "@km/shared-utils";
import { checkVersion } from "@/utils/version";
import { VERSION_MODULE } from "@/constants/enterprise";
import recordingApi from "@/api/modules/recording";
import type { RecordingConfig } from "@/api/modules/recording/types";
import type { PreviewFile, MineTabKey } from "./types";
import type { MineAudioViewRef } from "./views/audio";
import { MINE_TAB_LIST, AUDIO_ACCEPT, createCreateMenuItems, createImportMenuItems, AUDIO_EXT_REGEX, AUDIO_DOUBLE_EXT_REGEX } from "./constants";
import { useMySpaceContext } from "./hooks/useMySpaceContext";
import { useAudioImport } from "./hooks/useAudioImport";
import { MineHeader } from "./components/MineHeader";
import { PreviewPanel } from "./components/PreviewPanel";
import { CreateFolderModal } from "./components/CreateFolderModal";
import { extractFileName } from "./useInlineEditLite";
import "./mine.css";

// Lazy load sub-views
const FavView = lazy(() => import("./views/fav"));
const VisitView = lazy(() => import("./views/visit"));
const AIGeneratedView = lazy(() => import("./views/ai-generated"));
const UploadedView = lazy(() => import("./views/uploaded"));
const MineAudioView = lazy(() => import("./views/audio"));
const ChunksEditView = lazy(() => import("./components/chunks-edit"));
const SourceEditView = lazy(() => import("./components/source-edit"));

export function MineView2() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isMdScreen } = useBasicLayout();
  const { isOpLocalEnv, isPrivatePremEnv } = useEnv();
  const navigationStore = useNavigationStore();

  // 版本权限判断
  const hasKnowledgeBase = navigationStore.hasKnowledge && checkVersion(VERSION_MODULE.KNOWLEDGE_BASE);
  const hasRecording = checkVersion(VERSION_MODULE.RECORDING);

  // Filter tab list based on version modules, navigation state and environment
  const filteredTabList = useMemo(() => {
    let tabs = MINE_TAB_LIST;

    // 我收藏的和最近访问：KNOWLEDGE_BASE 权限 + 知识库开关
    if (!hasKnowledgeBase) {
      tabs = tabs.filter((tab) => !["fav", "visit"].includes(tab.value));
    }

    // 我的录音：RECORDING
    if (!hasRecording) {
      tabs = tabs.filter((tab) => tab.value !== "audio");
    }

    // 环境判断（op-local 和 private-prem 不显示录音）
    if (isOpLocalEnv || isPrivatePremEnv) {
      tabs = tabs.filter((tab) => tab.value !== "audio");
    }

    return tabs;
  }, [isOpLocalEnv, isPrivatePremEnv, hasKnowledgeBase, hasRecording]);

  // 默认 tab 为过滤后的第一个
  const defaultTab = filteredTabList[0]?.value || "fav";

  // Tab state
  const [activeTab, setActiveTab] = useState<MineTabKey>(defaultTab);
  const [keyword, setKeyword] = useState("");

  // Recording status
  const recordingStatus = useRecordingStore((s) => s.status);
  const hasActiveRecording = recordingStatus !== "idle";
  const prevRecordingStatusRef = useRef(recordingStatus);
  const [recordingConfig, setRecordingConfig] = useState<RecordingConfig | null>(null);

  // Refresh list when recording stops (status changes to idle)
  useEffect(() => {
    if (prevRecordingStatusRef.current !== "idle" && recordingStatus === "idle") {
      setRefreshKey((prev) => prev + 1);
    }
    prevRecordingStatusRef.current = recordingStatus;
  }, [recordingStatus]);

  // 判断是否显示录音按钮
  const showRecordingButton = useMemo(() => {
    return !isOpLocalEnv && !isPrivatePremEnv && hasRecording && !!recordingConfig?.enabled;
  }, [isOpLocalEnv, isPrivatePremEnv, hasRecording, recordingConfig]);

  // Personal space context
  const {
    libraryId,
    contextReady,
    contextInitializing,
    ensureLibraryId,
    fetchContext,
  } = useMySpaceContext();

  // File preview state
  const [previewMode, setPreviewMode] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null);
  const [previewContent, setPreviewContent] = useState("");

  // 标记预览页是否有修改操作（编辑保存/收藏/重命名/删除）
  const previewModifiedRef = useRef(false);

  // Edit mode: 'none' | 'chunks' | 'source'
  const [editMode, setEditMode] = useState<'none' | 'chunks' | 'source'>('none');

  // Upload state
  const fileUploadRef = useRef<FileUploadRef>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileRefreshKey, setFileRefreshKey] = useState(0);
  const [dirRefreshKey, setDirRefreshKey] = useState(0);
  const currentPath = searchParams.get("path") || "/";

  // Cache for unique name generation
  const existingFileNamesRef = useRef<string[]>([]);
  const existingFolderNamesRef = useRef<string[]>([]);

  // Audio view ref
  const audioViewRef = useRef<MineAudioViewRef>(null);

  // Rename modal state
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renamingFile, setRenamingFile] = useState<PreviewFile | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Create folder modal state
  const [createFolderModalVisible, setCreateFolderModalVisible] = useState(false);
  const [createFolderValue, setCreateFolderValue] = useState("");

  // Audio import hook
  const audioImport = useAudioImport({
    ensureLibraryId,
    currentPath,
    onSuccess: () => setRefreshKey((prev) => prev + 1),
  });

  // 加载录音配置
  const loadRecordingConfig = useCallback(async () => {
    try {
      const config = await recordingApi.getConfig();
      setRecordingConfig(config);
    } catch (e) {
      console.error("Failed to load recording config:", e);
    }
  }, []);

  // 初始化加载录音配置
  useEffect(() => {
    loadRecordingConfig();
  }, [loadRecordingConfig]);

  // URL tab sync
  useEffect(() => {
    const urlTab = searchParams.get("tab") as MineTabKey | null;
    // 验证 URL 中的 tab 是否有效（在 filteredTabList 中存在）
    const isValidTab = urlTab && filteredTabList.some((t) => t.value === urlTab);
    setActiveTab(isValidTab ? urlTab : defaultTab);
  }, [searchParams, filteredTabList, defaultTab]);

  // URL preview param
  useEffect(() => {
    const previewFileId = searchParams.get("preview");
    if (previewFileId && !previewMode && !previewFile) {
      const loadPreviewFile = async () => {
        try {
          const fileData = await filesApi.get(previewFileId);
          const formattedFile = formatFile(fileData);
          handleOpenPreview({
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
          });
        } catch (error) {
          console.error("加载预览文件失败:", error);
        }
      };
      loadPreviewFile();
    }
  }, [searchParams]);

  // URL edit param - detect and set edit mode
  useEffect(() => {
    const editFileId = searchParams.get("edit");
    if (editFileId) {
      // We need to load file info to determine edit type
      const loadEditFile = async () => {
        try {
          const fileData = await filesApi.get(editFileId);
          const formattedFile = formatFile(fileData);
          const ext = formattedFile.file_ext?.toLowerCase() || "";
          // md/txt use chunks-edit, others use source-edit
          if (["md", "txt"].includes(ext)) {
            setEditMode("chunks");
          } else {
            setEditMode("source");
          }
          // Exit preview mode when entering edit
          setPreviewMode(false);
          // Also set preview file for reference
          setPreviewFile({
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
          });
        } catch (error) {
          console.error("加载编辑文件失败:", error);
          message.error("加载文件失败");
          // Remove edit param and go back
          const newParams = new URLSearchParams(searchParams);
          newParams.delete("edit");
          setSearchParams(newParams);
        }
      };
      loadEditFile();
    } else {
      setEditMode("none");
    }
  }, [searchParams]);

  // Fetch context when upload tab active
  useEffect(() => {
    if (activeTab === "upload") {
      fetchContext();
    }
  }, [activeTab, fetchContext]);

  // Cache names callback
  const handleCacheNames = useCallback((files: any[], folders: any[]) => {
    existingFileNamesRef.current = files.map((item) => {
      const p = item.path?.startsWith("/") ? item.path.slice(1) : item.path || "";
      return p.replace(".md", "");
    });
    existingFolderNamesRef.current = folders.map((item) => {
      return item.path?.startsWith("/") ? item.path.slice(1) : item.path || "";
    });
  }, []);

  // Generate unique name
  const generateUniqueName = useCallback((baseName: string, existing: string[]): string => {
    if (!existing.includes(baseName)) return baseName;
    const pattern = new RegExp(`^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\((\\d+)\\)$`);
    const numbers: number[] = [];
    existing.forEach((name) => {
      const match = name.match(pattern);
      if (match) numbers.push(parseInt(match[1], 10));
    });
    const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
    return `${baseName}(${maxNumber + 1})`;
  }, []);

  // Tab change
  const handleTabChange = useCallback((tab: MineTabKey) => {
    setActiveTab(tab);
    setSearchParams({ tab });
    setKeyword("");
  }, [setSearchParams]);

  // Open preview
  const handleOpenPreview = useCallback((file: PreviewFile, content?: string) => {
    previewModifiedRef.current = false;
    setPreviewLoading(true);
    setPreviewFile(file);
    setPreviewContent(content || "");
    setPreviewMode(true);
    setPreviewLoading(false);
  }, []);

  // Back to list
  const handleBackToList = useCallback(() => {
    setPreviewMode(false);
    setPreviewFile(null);
    setPreviewContent("");
    if (previewModifiedRef.current) {
      // fav/visit 使用 refreshKey，其他 tab 使用 fileRefreshKey
      if (activeTab === "fav" || activeTab === "visit") {
        setRefreshKey((prev) => prev + 1);
      } else {
        setFileRefreshKey((prev) => prev + 1);
      }
    }
    previewModifiedRef.current = false;
    if (searchParams.has("preview")) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete("preview");
      setSearchParams(newParams);
    }
  }, [searchParams, setSearchParams, activeTab]);

  // Upload handlers
  const handleUploadFile = useCallback(() => {
    fileUploadRef.current?.selectFiles();
  }, []);

  const handleUploadFolder = useCallback(() => {
    fileUploadRef.current?.selectFolder();
  }, []);

  const handleUploadComplete = useCallback(() => {
    message.success(t("mine.upload_complete"));
    setRefreshKey((prev) => prev + 1);
  }, []);

  const handleViewUploadedFile = useCallback(
    async (item: UploadItem) => {
      if (item.fileId) {
        const url = buildUrl(`/mine?tab=upload&preview=${item.fileId}`);
        window.open(url, "_blank");
      }
    },
    []
  );

  // Create folder - open modal
  const handleCreateFolder = useCallback(() => {
    const existingNames = existingFolderNamesRef.current;
    const folderName = generateUniqueName(t("mine.untitled_folder"), existingNames);
    setCreateFolderValue(folderName);
    setCreateFolderModalVisible(true);
  }, [generateUniqueName]);

  // Create file - create md file and jump to edit page
  const handleCreateFile = useCallback(async () => {
    try {
      const libId = await ensureLibraryId();
      const existingNames = existingFileNamesRef.current;
      const baseName = generateUniqueName(t("mine.untitled_knowledge"), existingNames);
      const fileName = `${baseName}.md`;
      const filePath = currentPath === "/" ? `/${fileName}` : `${currentPath}/${fileName}`;

      const res = await filesApi.create({
        path: filePath,
        type: 1, // 文件类型
        library_id: libId,
        permissions: [],
      });

      existingFileNamesRef.current.push(baseName);
      message.success(t("mine.created"));

      // 跳转到编辑页，标记为新建文件
      const newParams = new URLSearchParams(searchParams);
      newParams.set("edit", res.id);
      newParams.set("new", "true");
      setSearchParams(newParams);
    } catch (error) {
      message.error(t("mine.create_failed"));
    }
  }, [ensureLibraryId, currentPath, generateUniqueName, searchParams, setSearchParams]);

  // Create folder confirm
  const handleCreateFolderConfirm = useCallback(async () => {
    const libraryId = await ensureLibraryId();
    const name = createFolderValue.trim() || t("mine.untitled_folder");
    const folderPath = currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;

    try {
      await filesApi.create({
        path: folderPath,
        type: 0,
        library_id: libraryId,
        permissions: [],
      });

      existingFolderNamesRef.current.push(name);
      message.success(t("mine.created"));
      setCreateFolderModalVisible(false);
      setRefreshKey((prev) => prev + 1);
    } catch (error) {
      message.error(t("mine.create_failed"));
    }
  }, [ensureLibraryId, currentPath, createFolderValue]);

  // Create recording folder - delegate to audio view
  const handleCreateRecordingFolder = useCallback(() => {
    audioViewRef.current?.createFolder();
  }, []);

  // 打开编辑器 - 通过 URL 参数跳转
  const handleOpenEditor = useCallback(() => {
    if (!previewFile) return;
    // Set edit param in URL, the useEffect will handle the mode switch
    const newParams = new URLSearchParams(searchParams);
    newParams.set("edit", previewFile.id);
    setSearchParams(newParams);
  }, [previewFile, searchParams, setSearchParams]);

  // 退出编辑 - 返回预览页
  const handleBackFromEdit = useCallback(async () => {
    previewModifiedRef.current = true;
    const newParams = new URLSearchParams(searchParams);
    newParams.delete("edit");
    newParams.delete("new");
    setSearchParams(newParams);
    setEditMode("none");
    setPreviewMode(true);  // 返回预览页而不是列表页

    // 重新加载文件信息以获取最新内容（file_url 会变化）
    const fileId = previewFile?.id;
    if (fileId) {
      try {
        const fileData = await filesApi.get(fileId);
        const formattedFile = formatFile(fileData);
        setPreviewFile({
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
        });
      } catch (error) {
        console.error("重新加载文件失败:", error);
      }
    }
  }, [searchParams, setSearchParams, previewFile?.id]);

  // Preview more command
  const handlePreviewCommand = useCallback(
    async (cmd: string) => {
      if (!previewFile) return;

      if (cmd === "new-tab") {
        const url = buildUrl(`/mine?tab=${activeTab}&preview=${previewFile.id}`);
        window.open(url, "_blank");
      } else if (cmd === "favorite" || cmd === "favorite-added" || cmd === "favorite-removed") {
        const favoritesApi = (await import("@/api/modules/favorites")).default;
        const newIsFav = !previewFile.isFavorite;
        await favoritesApi.toggle({
          resource_type: 2,
          resource_id: previewFile.id,
        });
        message.success(newIsFav ? t("mine.favorited") : t("mine.unfavorited"));
        previewModifiedRef.current = true;
        setPreviewFile((prev) => (prev ? { ...prev, isFavorite: newIsFav } : prev));
      } else if (cmd === "rename") {
        setRenamingFile(previewFile);
        // 与列表中的重命名逻辑保持一致：去掉后缀
        const fileExt = previewFile.file_ext || '';
        const realExt = fileExt === 'md' ? '' : '.' + fileExt;
        const displayName = previewFile.isfolder
          ? previewFile.name
          : previewFile.name.replace(realExt || '.md', '');
        setRenameValue(displayName);
        setRenameModalVisible(true);
      } else if (cmd === "delete") {
        Modal.confirm({
          title: t("common.tip"),
          content: previewFile.isfolder ? t("mine.delete_folder_confirm") : t("status.file_del"),
          okText: t("action.confirm"),
          cancelText: t("action.cancel"),
          onOk: async () => {
            try {
              await filesApi.delete(previewFile.id);
              message.success(t("action.delete_success"));
              previewModifiedRef.current = true;
              handleBackToList();
            } catch (error) {
              message.error(t("mine.delete_failed"));
            }
          },
        });
      }
    },
    [previewFile, t, handleBackToList, activeTab]
  );

  // Rename confirm
  const handleRenameConfirm = useCallback(async () => {
    if (!renamingFile || !renameValue.trim()) return;

    try {
      const fullPath = renamingFile.rawData?.path || "";
      let fullName: string;

      if (renamingFile.isfolder) {
        fullName = renameValue.trim();
      } else {
        // 检查是否是录音相关文件（双重后缀如 .m4a.md 或音频后缀如 .m4a）
        const isAudioFile = AUDIO_DOUBLE_EXT_REGEX.test(fullPath) ||
          /\.(mp3|m4a|wav|flac|ogg|aac|webm)$/i.test(fullPath);

        if (isAudioFile) {
          // 录音文件：使用 audio.tsx 的逻辑，保留原后缀
          const doubleExtMatch = fullPath.match(AUDIO_DOUBLE_EXT_REGEX);
          let ext: string;

          if (doubleExtMatch) {
            ext = doubleExtMatch[0];
          } else {
            const extMatch = fullPath.match(AUDIO_EXT_REGEX);
            ext = extMatch ? extMatch[0] : ".m4a";
          }

          // 去掉用户可能输入的后缀，避免重复
          let newName = renameValue.trim();
          const inputDoubleExtMatch = newName.match(AUDIO_DOUBLE_EXT_REGEX);
          if (inputDoubleExtMatch) {
            newName = newName.substring(0, newName.length - inputDoubleExtMatch[0].length);
          } else {
            const inputExtMatch = newName.match(AUDIO_EXT_REGEX);
            if (inputExtMatch) {
              newName = newName.substring(0, newName.length - inputExtMatch[0].length);
            }
          }

          fullName = `${newName}${ext}`;
        } else {
          // 非录音文件：原逻辑，以 .md 结尾
          const fileExt = renamingFile.file_ext || '';
          const normalizedExt = fileExt.replace(/^\./, '');

          if (normalizedExt === 'md' || !normalizedExt) {
            fullName = `${renameValue.trim()}.md`;
          } else {
            fullName = `${renameValue.trim()}.${normalizedExt}.md`;
          }
        }
      }

      // 构建新路径
      const basePath = fullPath.startsWith('/')
        ? fullPath.substring(1)
        : fullPath;
      const parentDir = basePath.includes('/') ? basePath.substring(0, basePath.lastIndexOf('/')) : '';
      const newPath = parentDir ? `/${parentDir}/${fullName}` : `/${fullName}`;

      await filesApi.rename({ id: renamingFile.id, path: newPath });

      // 更新显示名称（去掉 .md 后缀用于显示）
      const displayName = fullName.replace(/\.md$/, '');
      setPreviewFile((prev) => (prev ? { ...prev, name: displayName } : prev));

      previewModifiedRef.current = true;
      message.success(t("mine.rename_success"));
      setRenameModalVisible(false);
      setRenamingFile(null);
    } catch (error) {
      message.error(t("mine.rename_failed"));
    }
  }, [renamingFile, renameValue]);

  // Shared rename handler for edit views and preview panel
  const handleRename = useCallback(async (fileId: string, newPath: string) => {
    await filesApi.rename({ id: fileId, path: newPath });
    previewModifiedRef.current = true;
    if (previewFile) {
      const fileName = extractFileName(newPath);
      setPreviewFile((prev) => (prev ? { ...prev, name: fileName.replace(/\.md$/, "") } : prev));
    }
  }, [previewFile]);

  // Menu items
  const createMenuItems = createCreateMenuItems({
    onCreateFolder: handleCreateFolder,
    onCreateFile: handleCreateFile,
  });
  const importMenuItems = createImportMenuItems({
    onUploadFile: handleUploadFile,
    onUploadFolder: handleUploadFolder,
  });

  // Get active component
  const getComponent = () => {
    switch (activeTab) {
      case "visit":
        return <VisitView keyword={keyword} onPreview={handleOpenPreview} refreshKey={refreshKey} />;
      case "ai":
        return <AIGeneratedView keyword={keyword} onPreview={handleOpenPreview} refreshKey={refreshKey} fileRefreshKey={fileRefreshKey} dirRefreshKey={dirRefreshKey} enableFavorite={hasKnowledgeBase} />;
      case "upload":
        return (
          <UploadedView
            refreshKey={refreshKey}
            fileRefreshKey={fileRefreshKey}
            dirRefreshKey={dirRefreshKey}
            keyword={keyword}
            onPreview={handleOpenPreview}
            contextReady={contextReady}
            onCacheNames={handleCacheNames}
            enableFavorite={hasKnowledgeBase}
          />
        );
      case "audio":
        return (
          <MineAudioView
            ref={audioViewRef}
            keyword={keyword}
            refreshKey={refreshKey}
            fileRefreshKey={fileRefreshKey}
            dirRefreshKey={dirRefreshKey}
            onPreview={handleOpenPreview}
            enableFavorite={hasKnowledgeBase}
          />
        );
      default:
        return <FavView keyword={keyword} onPreview={handleOpenPreview} refreshKey={refreshKey} />;
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* List view - 编辑模式时隐藏但保持挂载 */}
      <div className="h-full" style={{ display: previewMode || editMode !== 'none' ? "none" : undefined }}>
        {activeTab === "upload" && contextInitializing && (
          <div className="flex flex-col items-center justify-center h-full">
            <Spin size="large" />
            <p className="mt-4 text-[#9A9A9A]">{t("mine.space_init")}</p>
          </div>
        )}

        {(activeTab !== "upload" || !contextInitializing) && (
          <>
            <Header title={t("module.mine")} border={false}></Header>

            <div className="w-11/12 lg:w-4/5 max-w-[1200px] mx-auto py-5 relative h-[calc(100%-96px)] flex flex-col">
              <MineHeader
                tabs={filteredTabList}
                activeTab={activeTab}
                keyword={keyword}
                onKeywordChange={setKeyword}
                onTabChange={handleTabChange}
                uploadActions={activeTab === "upload" ? {
                  importMenuItems,
                  createMenuItems,
                } : undefined}
                audioActions={activeTab === "audio" ? {
                  onImportFile: audioImport.handleImportFile,
                  importing: audioImport.importing,
                  hasActiveRecording,
                  onCreateFolder: handleCreateRecordingFolder,
                  onStartRecording: showRecordingButton ? () => useRecordingStore.getState().start(false) : undefined,
                } : undefined}
              />

              <Suspense
                fallback={
                  <div className="flex justify-center py-8 h-[calc(100%-32px)]">
                    <Spin size="large" />
                  </div>
                }
              >
                {getComponent()}
              </Suspense>
            </div>

            {contextReady && (
              <FileUpload
                ref={fileUploadRef}
                libraryId={libraryId}
                basePath={currentPath}
                onComplete={handleUploadComplete}
                onView={handleViewUploadedFile}
              />
            )}
          </>
        )}
      </div>

      {/* Preview panel */}
      {previewMode && previewFile && (
        <PreviewPanel
          file={previewFile}
          content={previewContent}
          loading={previewLoading}
          onBack={handleBackToList}
          onCommand={handlePreviewCommand}
          onEdit={handleOpenEditor}
          onRename={handleRename}
          libraryId={libraryId}
          activeTab={activeTab}
          enableFavorite={hasKnowledgeBase}
        />
      )}

      {/* Chunks Edit panel */}
      {editMode === "chunks" && (
        <Suspense fallback={<div className="flex justify-center items-center h-full"><Spin size="large" /></div>}>
          <ChunksEditView
            onBack={handleBackFromEdit}
            onRefresh={() => setRefreshKey((prev) => prev + 1)}
            onRename={handleRename}
          />
        </Suspense>
      )}

      {/* Source Edit panel */}
      {editMode === "source" && (
        <Suspense fallback={<div className="flex justify-center items-center h-full"><Spin size="large" /></div>}>
          <SourceEditView
            onBack={handleBackFromEdit}
            onRefresh={() => setRefreshKey((prev) => prev + 1)}
            onRename={handleRename}
          />
        </Suspense>
      )}

      {/* Rename Modal */}
      <Modal
        title={t("action.rename")}
        open={renameModalVisible}
        onOk={handleRenameConfirm}
        onCancel={() => {
          setRenameModalVisible(false);
          setRenamingFile(null);
        }}
        okText={t("action.confirm")}
        cancelText={t("action.cancel")}
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder={t("common.file_name")}
          onPressEnter={handleRenameConfirm}
        />
      </Modal>

      {/* Create Folder Modal */}
      <CreateFolderModal
        open={createFolderModalVisible}
        value={createFolderValue}
        onChange={setCreateFolderValue}
        onConfirm={handleCreateFolderConfirm}
        onCancel={() => setCreateFolderModalVisible(false)}
      />

      {/* Hidden file input for audio import */}
      <input
        type="file"
        ref={audioImport.fileInputRef}
        accept={AUDIO_ACCEPT}
        multiple
        onChange={audioImport.handleFileChange}
        style={{ display: "none" }}
      />
    </div>
  );
}

export default MineView2;
