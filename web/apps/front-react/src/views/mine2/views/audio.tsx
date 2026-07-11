import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Empty, Spin, message, Modal, Input, Breadcrumb } from "antd";
import { useSearchParams } from "react-router-dom";
import { recordingApi } from "@/api/modules/recording";
import type { RecordingFileItem, RecordingConfig } from "@/api/modules/recording/types";
import { SvgIcon } from "@km/shared-components-react";
import { MoreDropdown } from "@/components/MoreDropdown";
import { getPublicPath } from "@/utils/config";
import { t } from "@/locales";
import { buildUrl } from "@/utils/router";
import favoritesApi from "@/api/modules/favorites";
import filesApi from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import { RecordingFloat } from "@/components/RecordingFloat";
import { useRecordingStore } from "@/stores/modules/recording";
import { CreateFolderModal } from "../components/CreateFolderModal";
import { AUDIO_EXT_REGEX, AUDIO_DOUBLE_EXT_REGEX } from "../constants";
import "../mine.css";
import { getFormatTimeStamp } from "@km/shared-utils";
import type { BreadcrumbItem, PreviewFile, MineFileItem } from "../types";

interface AudioItem extends MineFileItem {
  file_ext?: string;
  file_url?: string;
  rawData: RecordingFileItem;
}

interface MineAudioViewProps {
  keyword?: string;
  onPreview?: (file: PreviewFile, content?: string) => void;
  refreshKey?: number;
  fileRefreshKey?: number;
  dirRefreshKey?: number;
  onCreateFolder?: () => void;
  hasActiveRecording?: boolean;
  enableFavorite?: boolean;
}

export interface MineAudioViewRef {
  createFolder: () => void;
}

export const MineAudioView = forwardRef<MineAudioViewRef, MineAudioViewProps>(
  function MineAudioView({ keyword = "", onPreview, refreshKey = 0, fileRefreshKey, dirRefreshKey, enableFavorite = true }, ref) {
    const [searchParams, setSearchParams] = useSearchParams();
    const [loading, setLoading] = useState(false);
    const [fileList, setFileList] = useState<AudioItem[]>([]);
    const [dirList, setDirList] = useState<AudioItem[]>([]);
    const currentPath = searchParams.get("path") || "/";
    const [breadcrumb, setBreadcrumb] = useState<BreadcrumbItem[]>([
      { name: t("mine.all_recording"), path: "/" },
    ]);

    // 分页状态
    const [fileOffset, setFileOffset] = useState(0);
    const [dirOffset, setDirOffset] = useState(0);
    const [hasMoreFiles, setHasMoreFiles] = useState(true);
    const [hasMoreDirs, setHasMoreDirs] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const loadingRef = useRef(false);
    const loadingMoreRef = useRef(false);

    const PAGE_SIZE = 30;

    // 录音配置
    const [recordingConfig, setRecordingConfig] = useState<RecordingConfig | null>(null);

    // 录音状态
    const status = useRecordingStore((s) => s.status);
    const hasActiveRecording = status !== "idle";
    const hideFloat = useRecordingStore((s) => s.hideFloat);
    const showFloat = useRecordingStore((s) => s.showFloat);

    // 记录上一次的 keyword 值
    const prevKeywordRef = useRef(keyword);
    // 标记是否已加载过数据
    const hasLoadedRef = useRef(false);
    // 记录首次加载是否已完成
    const initialLoadDoneRef = useRef(false);
    // 请求 ID，用于防止竞态条件
    const requestIdRef = useRef(0);

    // Rename modal state
    const [renameModalVisible, setRenameModalVisible] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [renamingFile, setRenamingFile] = useState<AudioItem | null>(null);

    // Create folder modal state
    const [createFolderModalVisible, setCreateFolderModalVisible] =
      useState(false);
    const [createFolderValue, setCreateFolderValue] = useState("");

    // Drag state
    const [dragItemId, setDragItemId] = useState<string | null>(null);
    const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);

    // Intersection observer ref
    const sentinelRef = useRef<HTMLDivElement | null>(null);

    // 格式化录音文件项
    const mapItem = useCallback((item: RecordingFileItem): AudioItem => {
      const isFolder = item.type === 0;
      const name = item.path.split("/").pop() || item.path;
      // 使用 packages/shared-public/images/file/ 下的图标
      const icon = isFolder
        ? getPublicPath("/images/file/folder.png")
        : getPublicPath("/images/file/recrod.png");

      return {
        id: String(item.id),
        name: isFolder ? name : name.replace(/\.(md|m4a|webm)$/i, ""),
        icon,
        path: item.path,
        createdTime: getFormatTimeStamp(item.created_time),
        updatedTime: getFormatTimeStamp(item.updated_time),
        isFavorite: item.is_favorite,
        isfolder: isFolder,
        rawData: item,
      };
    }, []);

    // 加载文件和文件夹列表
    const loadFiles = useCallback(
      async (path: string = "/", forceRefresh: boolean = false, onlyFiles: boolean = false, onlyDirs: boolean = false) => {
        if (loadingRef.current) return;
        if (!forceRefresh && hasLoadedRef.current) return;

        loadingRef.current = true;
        setLoading(true);

        const currentRequestId = ++requestIdRef.current;

        try {
          let rawDirs: RecordingFileItem[] = [];
          let rawFiles: RecordingFileItem[] = [];

          // 先获取文件夹列表（仅在需要时）
          if (!onlyFiles) {
            try {
              const dirRes = await recordingApi.getRecordings({
                type: "dir",
                path,
                keyword: undefined,
                offset: 0,
                limit: PAGE_SIZE,
              });
              if (currentRequestId !== requestIdRef.current) return;
              rawDirs = dirRes.data.filter((item) => item.path !== "/");
              setDirList(rawDirs.map(mapItem));
              setDirOffset(rawDirs.length);
              setHasMoreDirs(dirRes.data.length >= PAGE_SIZE);
            } catch (error) {
              console.error("Failed to load folders:", error);
              setDirList([]);
              setHasMoreDirs(false);
            }
          }

          // 文件列表（仅在需要时）
          if (!onlyDirs) {
            try {
              const fileRes = await recordingApi.getRecordings({
                type: "file",
                path,
                keyword: undefined,
                offset: 0,
                limit: PAGE_SIZE,
              });
              if (currentRequestId !== requestIdRef.current) return;
              rawFiles = fileRes.data;
              setFileList(rawFiles.map(mapItem));
              setFileOffset(rawFiles.length);
              setHasMoreFiles(rawFiles.length >= PAGE_SIZE);
            } catch (error) {
              console.error("Failed to load files:", error);
              setFileList([]);
              setHasMoreFiles(false);
            }
          }

          hasLoadedRef.current = true;
          initialLoadDoneRef.current = true;
        } catch (error) {
          console.error("Failed to load recording files:", error);
        } finally {
          if (currentRequestId === requestIdRef.current) {
            setLoading(false);
            loadingRef.current = false;
          }
        }
      },
      [mapItem],
    );

    // 加载更多数据
    const loadMore = useCallback(async () => {
      if (loadingMoreRef.current) return;
      if (!hasMoreFiles && !hasMoreDirs) return;

      loadingMoreRef.current = true;
      setLoadingMore(true);
      try {
        // 先加载更多文件夹
        if (hasMoreDirs) {
          const dirRes = await recordingApi.getRecordings({
            type: "dir",
            path: currentPath,
            keyword: undefined,
            offset: dirOffset,
            limit: PAGE_SIZE,
          });
          const filteredDirs = dirRes.data.filter((item) => item.path !== "/");
          if (filteredDirs.length > 0) {
            setDirList((prev) => [...prev, ...filteredDirs.map(mapItem)]);
            setDirOffset((prev) => prev + filteredDirs.length);
            setHasMoreDirs(dirRes.data.length >= PAGE_SIZE);
          } else {
            setHasMoreDirs(false);
          }
        }

        // 再加载更多文件
        if (hasMoreFiles) {
          const fileRes = await recordingApi.getRecordings({
            type: "file",
            path: currentPath,
            keyword: undefined,
            offset: fileOffset,
            limit: PAGE_SIZE,
          });
          if (fileRes.data.length > 0) {
            setFileList((prev) => [...prev, ...fileRes.data.map(mapItem)]);
            setFileOffset((prev) => prev + fileRes.data.length);
            setHasMoreFiles(fileRes.data.length >= PAGE_SIZE);
          } else {
            setHasMoreFiles(false);
          }
        }
      } catch (error) {
        console.error("Failed to load more:", error);
      } finally {
        loadingMoreRef.current = false;
        setLoadingMore(false);
      }
    }, [
      hasMoreFiles,
      hasMoreDirs,
      currentPath,
      dirOffset,
      fileOffset,
      mapItem,
    ]);

    // keyword 变化时单独搜索
    const searchFiles = useCallback(
      async (kw: string) => {
        if (!kw.trim()) {
          loadFiles(currentPath, true);
          return;
        }
        setFileOffset(0);
        setDirOffset(0);
        setHasMoreFiles(false);
        setHasMoreDirs(false);
        setLoading(true);
        try {
          const results = await Promise.allSettled([
            recordingApi.getRecordings({ type: "file", keyword: kw }),
            recordingApi.getRecordings({ type: "dir", keyword: kw }),
          ]);

          if (results[0].status === "fulfilled") {
            setFileList(results[0].value.data.map(mapItem));
          } else {
            setFileList([]);
          }

          if (results[1].status === "fulfilled") {
            setDirList(
              results[1].value.data
                .filter((item) => item.path !== "/")
                .map(mapItem),
            );
          } else {
            setDirList([]);
          }
        } catch (error) {
          console.error("Failed to search files:", error);
        } finally {
          setLoading(false);
        }
      },
      [currentPath, loadFiles, mapItem],
    );

    // 跟踪上一次的 refreshKey 和 path
    const prevRefreshKeyRef = useRef(refreshKey);
    const prevPathRef = useRef(currentPath);
    const effectExecutedRef = useRef(false);

    useEffect(() => {
      // 检查是否是重复调用
      const isSamePath = prevPathRef.current === currentPath;
      const isSameRefreshKey = prevRefreshKeyRef.current === refreshKey;
      const isSameDeps = isSamePath && isSameRefreshKey;

      if (isSameDeps && effectExecutedRef.current) return;

      const forceRefresh = !isSameRefreshKey || !isSamePath;

      if (!isSamePath) {
        setFileOffset(0);
        setDirOffset(0);
        setHasMoreFiles(true);
        setHasMoreDirs(true);
        setFileList([]);
        setDirList([]);
        hasLoadedRef.current = false;
        initialLoadDoneRef.current = false;
      }

      prevRefreshKeyRef.current = refreshKey;
      prevPathRef.current = currentPath;
      effectExecutedRef.current = true;

      if (!forceRefresh && initialLoadDoneRef.current) return;

      loadFiles(currentPath, forceRefresh);
    }, [currentPath, refreshKey, loadFiles]);

    // keyword 变化时触发搜索
    useEffect(() => {
      if (keyword) {
        searchFiles(keyword);
      } else if (prevKeywordRef.current && !keyword) {
        loadFiles(currentPath, true);
      }
      prevKeywordRef.current = keyword;
    }, [keyword, searchFiles, loadFiles, currentPath]);

    // fileRefreshKey 变化时只刷新文件列表
    const prevFileRefreshKeyRef = useRef(fileRefreshKey);
    useEffect(() => {
      if (fileRefreshKey !== undefined && fileRefreshKey !== prevFileRefreshKeyRef.current) {
        prevFileRefreshKeyRef.current = fileRefreshKey;
        loadFiles(currentPath, true, true, false);
      }
    }, [fileRefreshKey, loadFiles, currentPath]);

    // dirRefreshKey 变化时只刷新文件夹列表
    const prevDirRefreshKeyRef = useRef(dirRefreshKey);
    useEffect(() => {
      if (dirRefreshKey !== undefined && dirRefreshKey !== prevDirRefreshKeyRef.current) {
        prevDirRefreshKeyRef.current = dirRefreshKey;
        loadFiles(currentPath, true, false, true);
      }
    }, [dirRefreshKey, loadFiles, currentPath]);

    // 面包屑
    useEffect(() => {
      if (currentPath === "/") {
        setBreadcrumb([{ name: t("mine.all_recording"), path: "/" }]);
      } else {
        const parts = currentPath.split("/").filter(Boolean);
        const crumbs: BreadcrumbItem[] = [{ name: t("mine.all_recording"), path: "/" }];
        let accumulated = "";
        parts.forEach((part) => {
          accumulated += "/" + part;
          crumbs.push({ name: part, path: accumulated });
        });
        setBreadcrumb(crumbs);
      }
    }, [currentPath, t]);

    // IntersectionObserver for infinite scroll
    useEffect(() => {
      const el = sentinelRef.current;
      if (!el) return;

      const observer = new IntersectionObserver(
        (entries) => {
          if (
            entries[0].isIntersecting &&
            !loadingRef.current &&
            !loadingMoreRef.current
          ) {
            loadMore();
          }
        },
        { threshold: 0.1 },
      );
      observer.observe(el);
      return () => observer.disconnect();
    }, [loadMore]);

    // 加载录音配置
    useEffect(() => {
      const loadConfig = async () => {
        try {
          const config = await recordingApi.getConfig();
          setRecordingConfig(config);
        } catch (e) {
          console.error("Failed to load recording config:", e);
        }
      };
      loadConfig();
    }, []);

    // 进入页面隐藏浮层，离开恢复
    useEffect(() => {
      hideFloat();
      return () => {
        showFloat();
      };
    }, [hideFloat, showFloat]);

    // 合并排序：文件夹优先
    const displayFiles = useMemo(() => {
      return [...dirList, ...fileList];
    }, [fileList, dirList]);

    // Handle favorite toggle
    const handleToggleFavorite = async (
      fileId: string,
      isFavorite: boolean,
    ) => {
      try {
        await favoritesApi.toggle({
          resource_type: 2,
          resource_id: fileId,
        });
        message.success(isFavorite ? t("mine.unfavorite_success") : t("mine.favorited"));
        setFileList((prev) =>
          prev.map((item) =>
            item.id === fileId ? { ...item, isFavorite: !isFavorite } : item,
          ),
        );
        setDirList((prev) =>
          prev.map((item) =>
            item.id === fileId ? { ...item, isFavorite: !isFavorite } : item,
          ),
        );
      } catch (error) {
        message.error(t("action.operation_failed"));
      }
    };

    // Drag handlers
    const handleDragStart = useCallback((item: AudioItem) => (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', item.id)
      setDragItemId(item.id)
    }, [])

    const handleDragOver = useCallback((item: AudioItem) => (e: React.DragEvent) => {
      e.preventDefault()
      if (item.isfolder) {
        setDragOverFolderId(item.id)
        e.dataTransfer.dropEffect = 'move'
      }
    }, [])

    const handleDragLeave = useCallback(() => {
      setDragOverFolderId(null)
    }, [])

    const handleDrop = useCallback((targetFolder: AudioItem) => async (e: React.DragEvent) => {
      e.preventDefault()
      setDragOverFolderId(null)

      if (!targetFolder.isfolder) return

      const dragFileId = e.dataTransfer.getData('text/plain')
      if (!dragFileId || dragFileId === targetFolder.id) return

      const allFiles = [...fileList, ...dirList]
      const dragFile = allFiles.find(f => f.id === dragFileId)
      if (!dragFile) return

      try {
        // 计算目标路径
        const targetFolderPath = targetFolder.rawData.path?.startsWith('/')
          ? targetFolder.rawData.path
          : `${currentPath}/${targetFolder.rawData.path}`

        if (dragFile.isfolder) {
          // 文件夹移动：使用 filesApi.rename
          const newPath = `${targetFolderPath}/${dragFile.name}`
          await filesApi.rename({ id: dragFile.id, path: newPath })
        } else {
          // 文件移动：使用 filesApi.rename
          const fullPath = dragFile.rawData.path
          const doubleExtMatch = fullPath.match(AUDIO_DOUBLE_EXT_REGEX)
          let ext: string
          if (doubleExtMatch) {
            ext = doubleExtMatch[0]
          } else {
            const extMatch = fullPath.match(AUDIO_EXT_REGEX)
            ext = extMatch ? extMatch[0] : ".m4a"
          }
          const newPath = `${targetFolderPath}/${dragFile.name}${ext}`
          await filesApi.rename({ id: dragFile.id, path: newPath })
        }

        // 根据移动的是文件夹还是文件，只刷新对应的列表
        loadFiles(currentPath, true, !dragFile.isfolder, dragFile.isfolder)
        message.success(t("mine.moved"))
      } catch (error) {
        console.error('移动文件失败:', error)
        message.error(t("mine.move_failed"))
      } finally {
        setDragItemId(null)
      }
    }, [fileList, dirList, currentPath, loadFiles, t])

    const handleDragEnd = useCallback(() => {
      setDragItemId(null)
      setDragOverFolderId(null)
    }, [])

    // Open rename modal
    const openRenameModal = useCallback((item: AudioItem) => {
      setRenamingFile(item);
      // 去掉后缀，只显示文件名
      let displayName = item.name;
      if (!item.isfolder) {
        // 优先检查双重后缀（如 .m4a.md），只去掉 .md
        const doubleExtMatch = item.name.match(AUDIO_DOUBLE_EXT_REGEX);
        if (doubleExtMatch) {
          // xxx.m4a.md -> xxx.m4a（只去掉 .md）
          displayName = item.name.substring(0, item.name.length - 3);
        } else {
          const extMatch = item.name.match(AUDIO_EXT_REGEX);
          if (extMatch) {
            displayName = item.name.substring(0, item.name.length - extMatch[0].length);
          }
        }
      }
      setRenameValue(displayName);
      setRenameModalVisible(true);
    }, []);

    // Handle rename confirm
    const handleRenameConfirm = useCallback(async () => {
      if (!renamingFile || !renameValue.trim()) return;

      try {
        const fullPath = renamingFile.rawData.path || "";
        const parentPath = fullPath.substring(0, fullPath.lastIndexOf("/"));

        let newPath: string;
        if (renamingFile.isfolder) {
          // 文件夹重命名：保留父路径，只修改最后一级名称
          newPath = parentPath
            ? `${parentPath}/${renameValue.trim()}`
            : `/${renameValue.trim()}`;
        } else {
          // 文件重命名：保留父路径和后缀
          // 检查原始文件是否是双重后缀（如 .m4a.md）
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

          newPath = parentPath
            ? `${parentPath}/${newName}${ext}`
            : `/${newName}${ext}`;
        }

        await filesApi.rename({ id: renamingFile.id, path: newPath });
        message.success(t("mine.rename_success"));
        // 根据重命名的是文件夹还是文件，只刷新对应的列表
        loadFiles(currentPath, true, !renamingFile.isfolder, renamingFile.isfolder);
        setRenameModalVisible(false);
        setRenamingFile(null);
      } catch (error) {
        message.error(t("mine.rename_failed"));
      }
    }, [renamingFile, renameValue, currentPath, loadFiles, t]);

    // Handle delete
    const handleDelete = useCallback(
      (item: AudioItem) => {
        Modal.confirm({
          title: t("common.tip"),
          content: item.isfolder ? "确定删除此文件夹？" : t("status.file_del"),
          okText: t("action.confirm"),
          cancelText: t("action.cancel"),
          onOk: async () => {
            try {
              await filesApi.delete(item.id);
              message.success(t("action.delete_success"));
              // 根据删除的是文件夹还是文件，只刷新对应的列表
              loadFiles(currentPath, true, !item.isfolder, item.isfolder);
            } catch (error) {
              message.error(t("mine.delete_failed"));
            }
          },
        });
      },
      [currentPath, loadFiles, t],
    );

    // Handle open in new tab
    const handleOpenNewTab = (url: string) => {
      window.open(url, "_blank");
    };

    // Handle row click
    const handleRowClick = async (item: AudioItem) => {
      try {
        if (item.isfolder) {
          const folderPath = item.path?.startsWith("/")
            ? item.path
            : `/${item.path}`;
          setSearchParams({ tab: "audio", path: folderPath });
        } else {
          // 获取文件详情
          const fileData = await filesApi.get(item.id);
          const formattedFile = formatFile(fileData);
          if (onPreview) {
            onPreview(
              {
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
                // 传递录音配置，用于控制预览页轮询行为
                recordingConfig: recordingConfig
                  ? {
                      enabled: recordingConfig.enabled,
                      parser_platform: recordingConfig.parser_platform,
                    }
                  : undefined,
              },
              "",
            );
          }
        }
      } catch (error) {
        console.error("Failed to load file details:", error);
      }
    };

    // Handle breadcrumb click
    const handleBreadcrumbClick = (index: number) => {
      if (index === 0) {
        setSearchParams({ tab: "audio" });
      } else {
        const targetPath = breadcrumb[index].path;
        setSearchParams({ tab: "audio", path: targetPath });
      }
    };

    // 新建录音文件夹 - 打开弹窗
    const handleCreateRecordingFolder = useCallback(() => {
      // 生成唯一名称
      const existingNames = dirList.map((item) => item.name);
      const generateUniqueName = (baseName: string): string => {
        if (!existingNames.includes(baseName)) return baseName;
        const pattern = new RegExp(
          `^${baseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\((\\d+)\\)$`,
        );
        const numbers: number[] = [];
        existingNames.forEach((name) => {
          const match = name.match(pattern);
          if (match) numbers.push(parseInt(match[1], 10));
        });
        const maxNumber = numbers.length > 0 ? Math.max(...numbers) : 0;
        return `${baseName}(${maxNumber + 1})`;
      };

      const folderName = generateUniqueName(t("mine.untitled_folder"));
      setCreateFolderValue(folderName);
      setCreateFolderModalVisible(true);
    }, [dirList, t]);

    // 确认新建录音文件夹
    const handleCreateFolderConfirm = useCallback(async () => {
      const name = createFolderValue.trim() || t("mine.untitled_folder");
      const folderPath =
        currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;

      try {
        await recordingApi.createFolder({
          path: folderPath,
        });

        message.success(t("mine.created"));
        setCreateFolderModalVisible(false);
        loadFiles(currentPath, true);
      } catch (error: any) {
        const errorCode = error?.response?.data?.code;
        const errorMsg = error?.response?.data?.message || t("mine.create_failed");

        if (errorCode === 100402) {
          message.error(t("mine.no_recording_task"));
        } else {
          message.error(errorMsg);
        }
      }
    }, [createFolderValue, currentPath, loadFiles, t]);

    // 暴露给父组件的方法
    useImperativeHandle(
      ref,
      () => ({
        createFolder: handleCreateRecordingFolder,
      }),
      [handleCreateRecordingFolder],
    );

    // Loading state
    if (loading) {
      return (
        <div className="flex justify-center py-8">
          <Spin size="large" />
        </div>
      );
    }

    // Empty state
    const isEmpty = displayFiles.length === 0;

    return (
      <div className="h-[calc(100%-32px)] flex flex-col">
        {/* Active Recording Status Bar */}
        {status !== "idle" && (
          <div className="mt-4">
            <RecordingFloat full floating={false} />
          </div>
        )}

        {/* Breadcrumb Navigation */}
        {breadcrumb.length > 1 && (
          <div className="mt-4 flex items-center">
            <Breadcrumb
              separator={
                <SvgIcon name="arrow-right" classname="pt-1" size={14} />
              }
              items={breadcrumb.map((item, index) => ({
                title: (
                  <span
                    className={`cursor-pointer ${index === breadcrumb.length - 1 ? "text-[#1D1E1F]" : "hover:text-[#2563EB]"}`}
                    onClick={() =>
                      index < breadcrumb.length - 1 &&
                      handleBreadcrumbClick(index)
                    }
                  >
                    {item.name}
                  </span>
                ),
              }))}
            />
          </div>
        )}

        {/* Table Header */}
        { displayFiles.length > 0 && (
          <div className="bg-white rounded-lg border border-gray-200 mt-4">
            <div className="h-12 flex items-center gap-2 px-4 border-b border-gray-100">
              {/* 名称列 */}
              <div className="flex-1 min-w-0 text-sm text-[#4F5052] font-medium">
                {t("name")}
              </div>

              {/* 上传时间列 */}
              <div className="w-[140px] flex-shrink-0 text-sm text-[#4F5052] font-medium text-right">
                {t("common.create_time")}
              </div>

              {/* 操作列 */}
              <div className="w-[48px] flex-shrink-0"></div>
            </div>

            {/* Table Content */}
            <div className="flex flex-col">
              {displayFiles.map((item, index) => {
                const url = item.isfolder
                  ? buildUrl(
                      `/mine?tab=audio&path=${encodeURIComponent(item.rawData.path)}`,
                    )
                  : buildUrl(`/mine?tab=audio&preview=${item.id}`);

                return (
                  <div
                    key={`audio-${item.id}-${index}`}
                    className={`resource-item-row h-12 flex items-center gap-2 px-4 ${
                      dragOverFolderId === item.id ? 'bg-[#E8F3FF]' : ''
                    } ${dragItemId === item.id ? 'opacity-50' : ''}`}
                    onClick={() => handleRowClick(item)}
                    draggable
                    onDragStart={handleDragStart(item)}
                    onDragOver={handleDragOver(item)}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop(item)}
                    onDragEnd={handleDragEnd}
                  >
                    {/* 名称列 */}
                    <div className="flex-1 min-w-0 flex items-center gap-2">
                      <img className="flex-none w-6 h-6" src={item.icon} alt="" />
                      <span className="text-sm text-primary truncate">
                        {item.name}
                      </span>
                      {enableFavorite && item.isFavorite && (
                        <SvgIcon
                          name="star-filled"
                          color="#FFB300"
                          className="text-[#FFB300] flex-shrink-0"
                          size="14"
                        />
                      )}
                    </div>

                    {/* 上传时间列 */}
                    <div className="w-[140px] flex-shrink-0 text-sm text-placeholder text-right">
                      {item.createdTime}
                    </div>

                    {/* 操作列 */}
                    <div className="w-[48px] flex-shrink-0 flex justify-end more-actions">
                      <MoreDropdown
                        size="28px"
                        icon="more-h"
                        iconSize={16}
                        backgroundColor="#F5F6F7"
                        items={[
                          {
                            key: "new-tab",
                            icon: "arrow-right-up",
                            label: t("common.new_tab_page") + t("action.open"),
                          },
                          ...(enableFavorite && !item.isfolder
                            ? [
                                {
                                  key: "favorite",
                                  icon: item.isFavorite ? "star-cancel" : "star",
                                  label: item.isFavorite ? t("action.unfavorite") : t("action.favorite"),
                                },
                              ]
                            : []),
                          {
                            key: "rename",
                            icon: "edit",
                            label: t("action.rename"),
                          },
                          { key: "divider-2", divided: true },
                          {
                            key: "delete",
                            icon: "delete",
                            label: t("action.delete"),
                            danger: true,
                          },
                        ]}
                        onCommand={(cmd) => {
                          if (cmd === "new-tab") {
                            handleOpenNewTab(url);
                          } else if (cmd === "favorite") {
                            handleToggleFavorite(item.id, item.isFavorite);
                          } else if (cmd === "rename") {
                            openRenameModal(item);
                          } else if (cmd === "delete") {
                            handleDelete(item);
                          }
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 加载更多 sentinel */}
            {(hasMoreFiles || hasMoreDirs) && !loading && (
              <div className="flex justify-center py-4" ref={sentinelRef}>
                {loadingMore && <Spin size="small" />}
              </div>
            )}
          </div>
        )}
          {/* Empty State */}
          {isEmpty && (
            <div className="mt-8 flex justify-center">
              <Empty
                styles={{ image: { height: 100 } }}
                image={getPublicPath("/images/empty.png")}
                description={
                  keyword
                    ? t("mine.no_recording_found")
                    : t("mine.no_recording_empty")
                }
              />
            </div>
          )}

        {/* Rename Modal */}
        <Modal
          open={renameModalVisible}
          title={t("action.rename")}
          onOk={handleRenameConfirm}
          onCancel={() => {
            setRenameModalVisible(false);
            setRenamingFile(null);
          }}
          okText={t("action.confirm")}
          cancelText={t("action.cancel")}
        >
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => {
                const newValue = e.target.value
                if (!/[\/\\]/.test(newValue)) {
                  setRenameValue(newValue)
                }
              }}
              placeholder={t("common.file_name")}
              onPressEnter={handleRenameConfirm}
            />
          </div>
        </Modal>

        {/* Create Folder Modal */}
        <CreateFolderModal
          open={createFolderModalVisible}
          value={createFolderValue}
          onChange={setCreateFolderValue}
          onConfirm={handleCreateFolderConfirm}
          onCancel={() => setCreateFolderModalVisible(false)}
        />
      </div>
    );
  },
);

export default MineAudioView;
