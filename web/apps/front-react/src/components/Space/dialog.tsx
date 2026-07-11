import { useState, forwardRef, useImperativeHandle, useRef, useCallback, useEffect } from "react";
import { Modal, Button, Popover, message, Input } from "antd";
import { DownOutlined, CloseOutlined, CloseCircleFilled, SearchOutlined } from "@ant-design/icons";
import { spacesApi, type SpaceItem } from "@/api/modules/spaces";
import { librariesApi, type LibraryItem } from "@/api/modules/libraries";
import { filesApi } from "@/api/modules/files";
import type { FileItem } from "@/api/modules/files/types";
import { formatFile } from "@/api/modules/files/transform";
import { permissionsApi } from "@/api/modules/permissions";
import {
  RESOURCE_TYPE,
  PERMISSION_TYPE,
} from "@/components/KMPermission/constant";
import { cacheManager as cache } from "@km/shared-utils";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";
import { RecentAccess } from "./components/recent-access";
import { KnowledgeDirectory } from "./components/knowledge-directory";
import { SearchResult, type FileSearchResultItem } from "./components/search-result";
import "./dialog.css";

// 防抖 hook
function useDebounceFn<T extends (...args: any[]) => any>(
  fn: T,
  ms: number,
): T {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fnRef = useRef(fn)
  fnRef.current = fn

  return useCallback(
    (...args: Parameters<T>) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => fnRef.current(...args), ms)
    },
    [ms],
  ) as T
}

export interface SpaceDialogRef {
  open: (files?: FileItem[], libraries?: LibraryItem[], library?: LibraryItem, spaces?: SpaceItem[]) => void;
}

export interface SpaceDialogProps {
  onConfirm?: (files: FileItem[], libraries?: LibraryItem[], spaces?: SpaceItem[]) => void;
  /** 是否允许选择知识库（在知识库列表项右边显示 checkbox） */
  allowSelectLibrary?: boolean;
  allowSelectSpace?: boolean;
}

export const SpaceDialog = forwardRef<SpaceDialogRef, SpaceDialogProps>(
  ({ onConfirm, allowSelectLibrary = true, allowSelectSpace = true }, ref) => {
    const [visible, setVisible] = useState(false);
    const [spaceList, setSpaceList] = useState<SpaceItem[]>([]);
    const [libraryList, setLibraryList] = useState<LibraryItem[]>([]);
    const [fileList, setFileList] = useState<FileItem[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
    const [selectedLibraries, setSelectedLibraries] = useState<LibraryItem[]>([]);
    const [selectedSpaces, setSelectedSpaces] = useState<SpaceItem[]>([])
    const [popoverVisible, setPopoverVisible] = useState(false);

    const [spaceId, setSpaceId] = useState("");
    const [libraryId, setLibraryId] = useState("");
    const [spaceLoading, setSpaceLoading] = useState(false);
    const [libraryLoading, setLibraryLoading] = useState(false);
    const [fileLoading, setFileLoading] = useState(false);

    // 搜索相关状态
    const [searchQuery, setSearchQuery] = useState('')
    const [searchLoading, setSearchLoading] = useState(false)
    const [searchSpaces, setSearchSpaces] = useState<SpaceItem[]>([])
    const [searchLibraries, setSearchLibraries] = useState<LibraryItem[]>([])
    const [searchFiles, setSearchFiles] = useState<FileSearchResultItem[]>([])

    // Tab 状态
    const [activeTab, setActiveTab] = useState<'recent' | 'directory'>('directory')

    // 最近访问刷新 key，每次打开弹窗时更新以触发数据刷新
    const [recentRefreshKey, setRecentRefreshKey] = useState(0)

    const loadSpaceList = async () => {
      setSpaceLoading(true);
      return cache
        .getOrFetch(`spaces_list`, () => {
          return spacesApi.list({
            status: 0,
            limit: 100,
            offset: 0,
            view: "user",
          });
        })
        .then(async (list: any) => {
          const privateSpaces = list.spaces.filter((item: SpaceItem) => !item.visibility);
          let permissionMap: Record<string, number> = {};
          if (privateSpaces.length > 0) {
            permissionMap = await permissionsApi.myBatch({
              resource_type: RESOURCE_TYPE.space,
              resource_ids: privateSpaces.map((item: SpaceItem) => item.id),
            });
          }
          const newList: SpaceItem[] = list.spaces.filter((item: SpaceItem) => {
            if (item.visibility) return true;
            const key = `${RESOURCE_TYPE.space}:${item.id}`;
            return permissionMap[key] >= PERMISSION_TYPE.viewer;
          });
          setSpaceList(newList);
          return newList;
        })
        .finally(() => {
          setSpaceLoading(false);
        });
    };

    // 执行搜索 - 只有知识目录 tab 才请求接口
    const handleSearch = useDebounceFn(async (query: string) => {
      if (!query.trim()) {
        setSearchSpaces([])
        setSearchLibraries([])
        setSearchFiles([])
        return
      }

      // 最近访问 tab 下不搜索（由 RecentAccess 组件内部过滤）
      if (activeTab === 'recent') {
        setSearchSpaces([])
        setSearchLibraries([])
        setSearchFiles([])
        return
      }

      // 知识目录 tab 下请求接口搜索
      setSearchLoading(true)
      try {
        const [spaces, libraries, files] = await Promise.all([
          // 空间本地过滤
          Promise.resolve(spaceList.filter(s =>
            s.name.toLowerCase().includes(query.toLowerCase())
          )),
          // 知识库远程搜索（禁用时跳过）
          allowSelectLibrary
            ? librariesApi.search({ name: query })
            : Promise.resolve([]),
          // 知识远程搜索
          filesApi.search({ query, top_k: 50 }),
        ])

        setSearchSpaces(spaces)
        setSearchLibraries(libraries || [])
        setSearchFiles(files?.results || [])
      } catch (error) {
        console.error('Search failed:', error)
        setSearchSpaces([])
        setSearchLibraries([])
        setSearchFiles([])
      } finally {
        setSearchLoading(false)
      }
    }, 300)

    // 监听搜索词变化
    useEffect(() => {
      handleSearch(searchQuery)
    }, [searchQuery, spaceList, activeTab])

    const loadLibraryList = (spaceId: string) => {
      setLibraryLoading(true);
      return cache
        .getOrFetch(`libraries_list_${spaceId}`, () => {
          return librariesApi.list({
            space_id: spaceId,
            get_recently: 0,
            limit: 100,
          });
        })
        .then(async (list: any) => {
          if (list.length === 0) {
            setLibraryList([]);
            return [];
          }
          const permissionMap = await permissionsApi.myBatch({
            resource_type: RESOURCE_TYPE.library,
            resource_ids: list.map((item: LibraryItem) => item.id),
          });
          const newList: LibraryItem[] = list.filter((item: LibraryItem) => {
            const key = `${RESOURCE_TYPE.library}:${item.id}`;
            return permissionMap[key] >= PERMISSION_TYPE.viewer;
          });
          setLibraryList(newList);
          return newList;
        })
        .finally(() => {
          setLibraryLoading(false);
        });
    };

    const loadFilesAll = async (libraryId: string, parentPath?: string) => {
      const isRoot = !parentPath || parentPath === '/'

      if (isRoot) {
        setFileLoading(true)
      }

      try {
        const params: { library_id: string; parent_path?: string } = { library_id: libraryId }
        if (parentPath) {
          params.parent_path = parentPath
        }
        const list = await cache.getOrFetch(`files_all_${libraryId}_${!parentPath || parentPath === '/' ? 'root' : parentPath}`, () => {
          return filesApi.all(params)
        })

        if (list.length === 0) {
          if (parentPath && parentPath !== '/') {
            // 标记空子文件夹为已加载
            setFileList(prev => {
              const markEmpty = (nodes: FileItem[]): FileItem[] => {
                return nodes.map(node => {
                  if (node.path === parentPath) {
                    return { ...node, children: [], loaded: true }
                  }
                  if (node.children) {
                    return { ...node, children: markEmpty(node.children) }
                  }
                  return node
                })
              }
              return markEmpty([...prev])
            })
          } else {
            // 根目录为空
            setFileList([])
          }
          return []
        }

        const permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.file,
          resource_ids: list.map((item: any) => item.id),
        })

        const newList: FileItem[] = list
          .filter((item: any) => {
            const key = `${RESOURCE_TYPE.file}:${item.id}`
            return permissionMap[key] >= PERMISSION_TYPE.viewer
          })
          .map((item: any) => formatFile(item))

        if (parentPath && parentPath !== '/') {
          // 懒加载子目录：将子项合并到树结构中
          setFileList(prev => {
            const updated = [...prev]
            const insertChildren = (nodes: FileItem[]): FileItem[] => {
              return nodes.map(node => {
                if (node.path === parentPath) {
                  return { ...node, children: newList, loaded: true }
                }
                if (node.children) {
                  return { ...node, children: insertChildren(node.children) }
                }
                return node
              })
            }
            return insertChildren(updated)
          })
        } else {
          // 根目录加载 - 直接使用返回的列表
          setFileList(newList)
        }
        return newList
      } finally {
        if (isRoot) {
          setFileLoading(false)
        }
      }
    }

    const handleSelectLibrary = (item: LibraryItem) => {
      if (libraryId === item.id || libraryLoading) return;
      setLibraryId(item.id);
      loadFilesAll(item.id, '/');  // 传 '/' 加载根级文件
    };

    const handleSelectSpace = (item: SpaceItem, libraryIdParam?: string) => {
      if (spaceId === item.id || spaceLoading) return;
      setSpaceId(item.id);
      loadLibraryList(item.id).then((list) => {
        if (list && list.length > 0) {
          const library = list.find((item) => item.id === libraryIdParam);
          handleSelectLibrary(library || list[0]);
        } else {
          setLibraryId("");
          setFileList([]);
        }
      });
    };

    const handleSelectFile = (item: FileItem) => {
      const hasSelected = selectedFiles.some((file) => file.id === item.id);
      if (hasSelected) {
        setSelectedFiles(selectedFiles.filter((file) => file.id !== item.id));
      } else {
        setSelectedFiles([...selectedFiles, item]);
      }
    };

    // 批量选择文件
    const handleSelectAllFiles = (files: FileItem[], selected: boolean) => {
      if (selected) {
        // 全选：合并去重
        setSelectedFiles((prev) => {
          const existingIds = new Set(prev.map((f) => f.id));
          const newFiles = files.filter((f) => !existingIds.has(f.id));
          return [...prev, ...newFiles];
        });
      } else {
        // 取消全选：移除指定文件
        const fileIds = new Set(files.map((f) => f.id));
        setSelectedFiles((prev) => prev.filter((f) => !fileIds.has(f.id)));
      }
    };

    const handleRemoveFile = (item: FileItem) => {
      handleSelectFile(item);
    };

    // 切换知识库选择
    const handleToggleLibrary = (item: LibraryItem, e?: React.MouseEvent) => {
      e?.stopPropagation(); // 阻止触发 handleSelectLibrary
      const hasSelected = selectedLibraries.some((lib) => lib.id === item.id);
      if (hasSelected) {
        setSelectedLibraries(selectedLibraries.filter((lib) => lib.id !== item.id));
      } else {
        setSelectedLibraries([...selectedLibraries, item]);
      }
    };

    // 切换空间选择
    const handleToggleSpace = (item: SpaceItem, e?: React.MouseEvent) => {
      e?.stopPropagation()
      const hasSelected = selectedSpaces.some(s => s.id === item.id)
      if (hasSelected) {
        setSelectedSpaces(selectedSpaces.filter(s => s.id !== item.id))
      } else {
        setSelectedSpaces([...selectedSpaces, item])
      }
    }

    // 切换搜索结果中的知识选择
    const handleToggleSearchFile = (item: FileSearchResultItem) => {
      const fileItem: FileItem = {
        id: String(item.file_id),
        name: item.path.split('/').pop() || '',
        path: item.path,
        library_id: String(item.library_id),
        type: item.type,
        icon: getPublicPath('/images/file-default.png'),
      } as FileItem

      const hasSelected = selectedFiles.some(f => f.id === fileItem.id)
      if (hasSelected) {
        setSelectedFiles(selectedFiles.filter(f => f.id !== fileItem.id))
      } else {
        setSelectedFiles([...selectedFiles, fileItem])
      }
    }

    const handleClose = () => {
      setVisible(false);
    };

    const handleConfirm = () => {
      const hasSelection = selectedFiles.length > 0 || selectedLibraries.length > 0 || selectedSpaces.length > 0;

      if (!hasSelection) {
        message.error(t("common.please_select_file"));
        return;
      }
      setVisible(false);
      onConfirm?.(selectedFiles, selectedLibraries, selectedSpaces);
    };

    useImperativeHandle(ref, () => ({
      open: (files, libraries, library, spaces) => {
        setSearchQuery('')
        setSelectedSpaces(spaces?.concat([]) || [])
        setSelectedFiles(files?.concat([]) || []);
        setSelectedLibraries(libraries?.concat([]) || []); // 保留已选知识库
        // 每次打开弹窗时更新 refreshKey，触发最近访问数据刷新
        setRecentRefreshKey(prev => prev + 1)
        setVisible(true);
        setTimeout(() => {
          if (spaceId && spaceList.length > 0) return;
          loadSpaceList().then((list) => {
            if (library) {
              handleSelectSpace(
                { id: library.space_id } as SpaceItem,
                library.id,
              );
            } else if (list && list.length > 0 && !spaceId) {
              handleSelectSpace(list[0]);
            }
          });
        }, 0);
      },
    }));

    const selectedFilesPopoverContent = (
      <div>
        <div className="h-8 px-2 flex items-center gap-1 justify-between">
          <span className="text-sm text-secondary">全部已选（{selectedFiles.length + selectedLibraries.length + selectedSpaces.length}）</span>
          <div
            className="size-3 text-secondary flex items-center justify-center rounded cursor-pointer hover:bg-[#F2F3F5]"
            onClick={() => setPopoverVisible(false)}
          >
            <CloseOutlined />
          </div>
        </div>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {selectedSpaces.map((item) => (
            <div
              key={`space-${item.id}`}
              className="h-8 px-2 rounded flex items-center gap-2 text-secondary hover:bg-[#F2F3F5] cursor-pointer group overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={item.icon} className="size-4" alt="" />
              <span className="flex-1 text-sm text-[#1D1E1F] truncate">{item.name}</span>
              <CloseCircleFilled
                className="group-hover:block hidden"
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedSpaces(selectedSpaces.filter(s => s.id !== item.id))
                }}
              />
            </div>
          ))}
          {selectedLibraries.map((item) => (
            <div
              key={`lib-${item.id}`}
              className="h-8 px-2 rounded flex items-center gap-2 text-secondary hover:bg-[#F2F3F5] cursor-pointer group overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={item.icon} className="size-4" alt="" />
              <span className="flex-1 text-sm text-[#1D1E1F] truncate">{item.name}</span>
              <CloseCircleFilled
                className="group-hover:block hidden"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedLibraries(selectedLibraries.filter((lib) => lib.id !== item.id));
                }}
              />
            </div>
          ))}
          {selectedFiles.map((item) => (
            <div
              key={`file-${item.id}`}
              className="h-8 px-2 rounded flex items-center gap-2 text-secondary hover:bg-[#F2F3F5] cursor-pointer group overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <img src={item.icon} className="size-4" alt="" />
              <span className="flex-1 text-sm text-[#1D1E1F] truncate">{item.name}</span>
              <CloseCircleFilled
                className="group-hover:block hidden"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemoveFile(item);
                }}
              />
            </div>
          ))}
        </div>
      </div>
    );

    return (
      <Modal
        open={visible}
        title="选择更多"
        width={1006}
        onCancel={handleClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {(selectedFiles.length > 0 || selectedLibraries.length > 0 || selectedSpaces.length > 0) && (
                <Popover
                  open={popoverVisible}
                  onOpenChange={setPopoverVisible}
                  content={selectedFilesPopoverContent}
                  trigger="click"
                  placement="topLeft"
                  overlayClassName="!p-0"
                  overlayStyle={{ width: 360 }}
                >
                  <div className={`h-8 px-2 rounded flex items-center gap-1 cursor-pointer ${popoverVisible ? 'bg-[#F2F3F5]' : 'hover:bg-[#F2F3F5]'}`}>
                    <span className="text-sm">
                      已选{selectedSpaces.length + selectedFiles.length + selectedLibraries.length}个
                    </span>
                    <DownOutlined
                      className={`${popoverVisible ? "rotate-180" : ""} text-xs`}
                    />
                  </div>
                </Popover>
              )}
            </div>
            <div>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" onClick={handleConfirm} className="ml-2">
                确定
              </Button>
            </div>
          </div>
        }
      >
        <>
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 bg-[#F5F5F5] p-1 rounded-xl">
              {[
                { key: 'recent', label: '最近使用' },
                { key: 'directory', label: '知识目录' },
              ].map((tab) => (
                <div
                  key={tab.key}
                  className={`px-4 h-[30px] flex-center text-sm cursor-pointer transition-colors ${activeTab === tab.key ? 'text-[#1D1E1F] font-medium bg-white rounded-md' : 'text-[#9A9A9A] hover:text-[#666]'}`}
                  onClick={() => setActiveTab(tab.key as 'recent' | 'directory')}
                >
                  {tab.label}
                </div>
              ))}
            </div>
            <div>
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={allowSelectLibrary ? "搜索空间、知识库、知识" : "搜索知识"}
                prefix={<SearchOutlined />}
                allowClear
              />
            </div>
          </div>
          {activeTab === 'recent' ? (
            <RecentAccess
              selectedSpaces={selectedSpaces}
              selectedLibraries={selectedLibraries}
              selectedFiles={selectedFiles}
              allowSelectLibrary={allowSelectLibrary}
              allowSelectSpace={allowSelectSpace}
              searchQuery={searchQuery}
              refreshTrigger={recentRefreshKey}
              onToggleSpace={handleToggleSpace}
              onToggleLibrary={handleToggleLibrary}
              onToggleFile={handleSelectFile}
            />
          ) : searchQuery.trim() ? (
            <SearchResult
              searchSpaces={searchSpaces}
              searchLibraries={searchLibraries}
              searchFiles={searchFiles}
              searchLoading={searchLoading}
              searchQuery={searchQuery}
              selectedSpaces={selectedSpaces}
              selectedLibraries={selectedLibraries}
              selectedFiles={selectedFiles}
              allowSelectLibrary={allowSelectLibrary}
              allowSelectSpace={allowSelectSpace}
              onToggleSpace={handleToggleSpace}
              onToggleLibrary={handleToggleLibrary}
              onToggleSearchFile={handleToggleSearchFile}
            />
          ) : (
            <KnowledgeDirectory
              spaceList={spaceList}
              libraryList={libraryList}
              fileList={fileList}
              spaceId={spaceId}
              libraryId={libraryId}
              selectedSpaces={selectedSpaces}
              selectedLibraries={selectedLibraries}
              selectedFiles={selectedFiles}
              spaceLoading={spaceLoading}
              libraryLoading={libraryLoading}
              fileLoading={fileLoading}
              allowSelectLibrary={allowSelectLibrary}
              allowSelectSpace={allowSelectSpace}
              onSelectSpace={handleSelectSpace}
              onSelectLibrary={handleSelectLibrary}
              onToggleSpace={handleToggleSpace}
              onToggleLibrary={handleToggleLibrary}
              onToggleFile={handleSelectFile}
              onSelectAllFiles={handleSelectAllFiles}
              onLoadFiles={loadFilesAll}
            />
          )}
        </>
      </Modal>
    );
  },
);

SpaceDialog.displayName = "SpaceDialog";

export default SpaceDialog;
