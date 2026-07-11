import { useState, useMemo, useCallback, useEffect } from "react";
import { Spin, Empty, Table, Checkbox, Tooltip } from "antd";
import { RightOutlined } from "@ant-design/icons";
import type { SpaceItem } from "@/api/modules/spaces";
import type { LibraryItem } from "@/api/modules/libraries";
import type { FileItem } from "@/api/modules/files/types";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";

// 支持懒加载的文件项
interface FileItemWithLoaded extends FileItem {
  loaded?: boolean;
}

interface KnowledgeDirectoryProps {
  // 数据
  spaceList: SpaceItem[];
  libraryList: LibraryItem[];
  fileList: FileItem[];

  // 选中状态
  spaceId: string;
  libraryId: string;
  selectedSpaces: SpaceItem[];
  selectedLibraries: LibraryItem[];
  selectedFiles: FileItem[];

  // 加载状态
  spaceLoading: boolean;
  libraryLoading: boolean;
  fileLoading: boolean;

  // 开关
  allowSelectLibrary: boolean;
  allowSelectSpace: boolean;

  // 回调
  onSelectSpace: (item: SpaceItem) => void;
  onSelectLibrary: (item: LibraryItem) => void;
  onToggleSpace: (item: SpaceItem) => void;
  onToggleLibrary: (item: LibraryItem) => void;
  onToggleFile: (item: FileItem) => void;
  onSelectAllFiles: (files: FileItem[], selected: boolean) => void;
  onLoadFiles: (libraryId: string, parentPath?: string) => void;
}

export function KnowledgeDirectory({
  spaceList,
  libraryList,
  fileList,
  spaceId,
  libraryId,
  selectedSpaces,
  selectedLibraries,
  selectedFiles,
  spaceLoading,
  libraryLoading,
  fileLoading,
  allowSelectLibrary,
  allowSelectSpace,
  onSelectSpace,
  onSelectLibrary,
  onToggleSpace,
  onToggleLibrary,
  onToggleFile,
  onSelectAllFiles,
  onLoadFiles,
}: KnowledgeDirectoryProps) {
  // 内部状态：展开的行
  const [expandedRowKeys, setExpandedRowKeys] = useState<string[]>([]);
  // 内部状态：正在加载的文件夹路径
  const [loadingPaths, setLoadingPaths] = useState<string[]>([]);

  // 监听 fileList 变化，当文件夹加载完成后移除 loadingPaths
  useEffect(() => {
    if (loadingPaths.length === 0) return;

    const checkLoaded = (items: FileItem[]): string[] => {
      const loaded: string[] = [];
      for (const item of items) {
        if (loadingPaths.includes(item.path) && (item as FileItemWithLoaded).loaded) {
          loaded.push(item.path);
        }
        if (item.children) {
          loaded.push(...checkLoaded(item.children));
        }
      }
      return loaded;
    };

    const loadedPaths = checkLoaded(fileList);
    if (loadedPaths.length > 0) {
      setLoadingPaths((prev) => prev.filter((p) => !loadedPaths.includes(p)));
    }
  }, [fileList, loadingPaths]);

  // 判断文件是否选中
  const isSelectedFile = useCallback((item: FileItem) => {
    return selectedFiles.some((file) => file.id === item.id);
  }, [selectedFiles]);

  // 获取当前显示的所有文件（包括文件夹）
  const getVisibleFiles = useCallback((): FileItem[] => {
    const traverse = (items: FileItem[]): FileItem[] => {
      const result: FileItem[] = [];
      for (const item of items) {
        result.push(item);
        if (item.children && item.children.length > 0) {
          result.push(...traverse(item.children));
        }
      }
      return result;
    };
    return traverse(fileList);
  }, [fileList]);

  // 全选当前知识库下的所有文件
  const handleSelectAllFiles = useCallback(() => {
    const visibleFiles = getVisibleFiles();
    const allSelected = visibleFiles.every((f) => isSelectedFile(f));

    // 使用批量选择回调
    onSelectAllFiles(visibleFiles, !allSelected);
  }, [getVisibleFiles, isSelectedFile, onSelectAllFiles]);

  // 是否全选
  const isAllFilesSelected = useMemo(() => {
    const visibleFiles = getVisibleFiles();
    if (visibleFiles.length === 0) return false;
    return visibleFiles.every((f) => isSelectedFile(f));
  }, [getVisibleFiles, isSelectedFile]);

  // 是否部分选中
  const isIndeterminateFiles = useMemo(() => {
    const visibleFiles = getVisibleFiles();
    if (visibleFiles.length === 0) return false;
    const selectedCount = visibleFiles.filter((f) => isSelectedFile(f)).length;
    return selectedCount > 0 && selectedCount < visibleFiles.length;
  }, [getVisibleFiles, isSelectedFile]);

  // 处理文件/文件夹点击
  const handleFileClick = useCallback((record: FileItem) => {
    onToggleFile(record);
  }, [onToggleFile]);

  // 处理文件夹展开/折叠
  const handleFolderToggle = useCallback((record: FileItem) => {
    const isExpanded = expandedRowKeys.includes(record.id);
    if (isExpanded) {
      setExpandedRowKeys(expandedRowKeys.filter((id) => id !== record.id));
    } else {
      setExpandedRowKeys([...expandedRowKeys, record.id]);
      // 懒加载子项
      if (!(record as FileItemWithLoaded).loaded) {
        setLoadingPaths((prev) => [...prev, record.path]);
        onLoadFiles(libraryId, record.path);
      }
    }
  }, [expandedRowKeys, libraryId, onLoadFiles]);

  return (
    <div className="h-[500px] flex overflow-hidden border rounded-xl">
      {/* 空间列 */}
      <div className="flex-none w-[216px] py-1 border-r flex flex-col overflow-hidden">
        <div className="h-9 px-4 flex items-center text-sm text-secondary">
          空间
        </div>
        <div className="flex-1 px-2 space-y-1 overflow-y-auto">
          {spaceLoading ? (
            <div className="flex justify-center py-4">
              <Spin />
            </div>
          ) : spaceList.length === 0 ? (
            <Empty
              image={getPublicPath("/images/empty.png")}
              description={t("common.no_data")}
            />
          ) : (
            spaceList.map((item) => (
              <div
                key={item.id}
                className={`h-9 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] ${spaceId === item.id ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]" : "hover:bg-[#F2F3F5]"}`}
                onClick={() => onSelectSpace(item)}
              >
                {allowSelectSpace && (
                  <Checkbox
                    checked={selectedSpaces.some((space) => space.id === item.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSpace(item);
                    }}
                  />
                )}
                <img src={item.icon} className="size-5" alt="" />
                <Tooltip title={item.name}>
                  <span className="flex-1 text-sm truncate">{item.name}</span>
                </Tooltip>
                {spaceId === item.id && (
                  <RightOutlined className="text-xs text-[#999]" />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 知识库列 */}
      <div className="flex-none w-[216px] py-1 border-r flex flex-col overflow-hidden">
        <div className="h-9 px-4 flex items-center text-sm text-secondary">
          知识库
        </div>
        <div className="flex-1 px-2 space-y-1 overflow-y-auto">
          {libraryLoading ? (
            <div className="flex justify-center py-4">
              <Spin />
            </div>
          ) : libraryList.length === 0 ? (
            <Empty
              image={getPublicPath("/images/empty.png")}
              description={t("common.no_data")}
            />
          ) : (
            libraryList.map((item) => (
              <div
                key={item.id}
                className={`h-9 flex items-center gap-2 px-2 mb-1 rounded cursor-pointer text-[#1D1E1F] ${libraryId === item.id ? "bg-[#EDF3FF] hover:bg-[#EDF3FF]" : "hover:bg-[#F2F3F5]"}`}
                onClick={() => onSelectLibrary(item)}
              >
                {allowSelectLibrary && (
                  <Checkbox
                    checked={selectedLibraries.some((lib) => lib.id === item.id)}
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleLibrary(item);
                    }}
                  />
                )}
                <div className="size-5 flex items-center justify-center rounded">
                  <img src={item.icon} className="size-5" alt="" />
                </div>
                <Tooltip title={item.name}>
                  <span className="flex-1 text-sm truncate">{item.name}</span>
                </Tooltip>
                {libraryId === item.id && (
                  <RightOutlined className="text-xs text-[#999]" />
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 文件列 */}
      <div className="flex-1 overflow-y-auto">
        <div className="h-9 px-4 flex items-center justify-between">
          <span className="text-sm text-secondary">知识</span>
          <Checkbox
            checked={isAllFilesSelected}
            indeterminate={isIndeterminateFiles}
            onClick={(e) => {
              e.stopPropagation();
              handleSelectAllFiles();
            }}
          >
            {isAllFilesSelected ? "取消全选" : "全选"}
          </Checkbox>
        </div>
        {fileLoading ? (
          <div className="flex justify-center py-8">
            <Spin />
          </div>
        ) : fileList.length === 0 ? (
          <Empty
            image={getPublicPath("/images/empty.png")}
            description={t("common.no_data")}
          />
        ) : (
          <Table
            dataSource={fileList}
            rowKey="id"
            pagination={false}
            showHeader={false}
            expandIcon={() => null}
            expandedRowKeys={expandedRowKeys}
            onExpandedRowsChange={(keys) => setExpandedRowKeys(keys as string[])}
            className="file-table"
            columns={[
              {
                dataIndex: "name",
                key: "name",
                ellipsis: true,
                render: (_: unknown, record: FileItem) => {
                  const isFolder = record.isfolder;
                  const isExpanded = expandedRowKeys.includes(record.id);
                  const depth = record.path.split("/").filter(Boolean).length - 1;
                  const isLoading = loadingPaths.includes(record.path);
                  return (
                    <div
                      className={`w-full flex items-center gap-2 py-2 ${isSelectedFile(record) ? "hover:bg-[#EDF3FF]" : ""}`}
                      onClick={() => handleFileClick(record)}
                    >
                      <div style={{ width: depth * 16 }}></div>
                      {isFolder ? (
                        <span
                          className="inline-flex items-center justify-center w-6 h-6 -ml-1 cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderToggle(record);
                          }}
                        >
                          {isLoading ? (
                            <Spin size="small" />
                          ) : (
                            <RightOutlined
                              className="text-xs text-[#999] transition-transform duration-200"
                              style={{
                                transform: isExpanded
                                  ? "rotate(90deg)"
                                  : "rotate(0deg)",
                              }}
                            />
                          )}
                        </span>
                      ) : (
                        <span className="inline-block w-6 h-6 -ml-1" />
                      )}
                      <input
                        type="checkbox"
                        checked={isSelectedFile(record)}
                        onChange={() => {}}
                        className="pointer-events-none"
                      />

                      <img src={record.icon} className="size-5" alt="" />
                      <Tooltip title={record.name}>
                        <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                          {record.name}
                        </span>
                      </Tooltip>
                    </div>
                  );
                },
              },
            ]}
          />
        )}
      </div>
    </div>
  );
}
