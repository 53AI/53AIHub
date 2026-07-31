import { useState, forwardRef, useCallback, useImperativeHandle } from "react";
import { Modal, Button, Popover, message } from "antd";
import { DownOutlined, CloseOutlined, CloseCircleFilled } from "@ant-design/icons";
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
import { Search } from "@km/shared-components-react/Search";
import { SvgIcon } from "@km/shared-components-react";
import { RecentAccess } from "./components/recent-access";
import { KnowledgeDirectory } from "./components/knowledge-directory";
import { SearchResult, type FileSearchResultItem } from "./components/search-result";
import { KnowledgeList } from "./components/knowledge-list";
import { KnowledgeSearch } from "./components/knowledge-search";
import type { WikiPageItem } from "@/api/modules/wiki";
import type { WikiItem } from "@/components/KnowledgeSource/types";
import "./dialog.css";

// 重新导出 WikiItem,保持向后兼容(knowledge-list / knowledge-search 仍从 dialog 导入)
export type { WikiItem } from "@/components/KnowledgeSource/types";

export interface SpaceDialogRef {
  open: (files?: FileItem[], libraries?: LibraryItem[], library?: LibraryItem, spaces?: SpaceItem[], wikis?: WikiItem[]) => void;
}

export interface SpaceDialogProps {
  onConfirm?: (files: FileItem[], libraries?: LibraryItem[], spaces?: SpaceItem[], wikis?: WikiItem[]) => void;
  /** 是否允许选择知识库（在知识库列表项右边显示 checkbox） */
  allowSelectLibrary?: boolean;
  allowSelectSpace?: boolean;
  /** 是否单选文件（选择后自动确认） */
  singleSelect?: boolean;
  /** 是否允许选择动态知识 */
  allowSelectDynamicKnowledge?: boolean;
}

export const SpaceDialog = forwardRef<SpaceDialogRef, SpaceDialogProps>(
  ({ onConfirm, allowSelectLibrary = true, allowSelectSpace = true, singleSelect = false, allowSelectDynamicKnowledge = false }, ref) => {
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
    const [activeTab, setActiveTab] = useState<'recent' | 'directory' | 'dynamicKnowledge'>('directory')

    // 最近访问刷新 key，每次打开弹窗时更新以触发数据刷新
    const [recentRefreshKey, setRecentRefreshKey] = useState(0)

    // 动态知识相关状态
    const [selectedWikis, setSelectedWikis] = useState<WikiItem[]>([]);

    // 动态知识搜索状态（独立搜索词）
    const [wikiSearchText, setWikiSearchText] = useState('');

    // 切换单个动态知识页面
    const handleToggleWikiPage = useCallback((page: WikiPageItem) => {
      setSelectedWikis((prev) => {
        const currentPage = { ...page, wikiType: 'page' as const, type: 'wiki' as const }
        const exists = prev.some((w) => w.wikiType === 'page' && w.id === currentPage.id);
        if (exists) {
          return prev.filter((w) => !(w.wikiType === 'page' && w.id === currentPage.id));
        }
        return [...prev, currentPage];
      });
    }, []);

    // 切换动态知识空间选择
    const handleToggleWikiSpace = useCallback((space: SpaceItem) => {
      setSelectedWikis((prev) => {
        const currentSpace = { ...space, wikiType: 'space' as const, type: 'wiki' as const }
        const exists = prev.some((w) => w.wikiType === 'space' && w.id === currentSpace.id);
        if (exists) {
          return prev.filter((w) => !(w.wikiType === 'space' && w.id === currentSpace.id));
        }
        return [...prev, currentSpace];
      });
    }, []);

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

    // 执行搜索
    const handleSearch = useCallback(async (query: string) => {
      setSearchQuery(query)
      if (!query.trim()) {
        setSearchSpaces([])
        setSearchLibraries([])
        setSearchFiles([])
        return
      }

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
    }, [spaceList, allowSelectLibrary])

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
      if (singleSelect) {
        // 单选模式：替换选中项，等待用户点击确定
        setSelectedFiles([item]);
      } else {
        const hasSelected = selectedFiles.some((file) => file.id === item.id);
        if (hasSelected) {
          setSelectedFiles(selectedFiles.filter((file) => file.id !== item.id));
        } else {
          setSelectedFiles([...selectedFiles, item]);
        }
      }
    };

    // 批量选择文件（单选模式下禁用）
    const handleSelectAllFiles = (files: FileItem[], selected: boolean) => {
      if (singleSelect) return;
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

    const totalSelectedCount =
      selectedFiles.length +
      selectedLibraries.length +
      selectedSpaces.length +
      selectedWikis.length;

    const handleConfirm = () => {
      const hasSelection = totalSelectedCount > 0;

      if (!hasSelection) {
        message.error(t("common.please_select_file"));
        return;
      }
      setVisible(false);
      onConfirm?.(selectedFiles, selectedLibraries, selectedSpaces, selectedWikis);
    };

    useImperativeHandle(ref, () => ({
      open: (files, libraries, library, spaces, wikis) => {
        setSearchQuery('')
        setWikiSearchText('')
        setSelectedWikis(wikis?.concat([]) || [])
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
          <span className="text-sm text-secondary">{t("space.all_selected_count", { count: totalSelectedCount })}</span>
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
          {selectedWikis.map((item) => (
            <div
              key={`wiki-${item.id}`}
              className="h-8 px-2 rounded flex items-center gap-2 text-secondary hover:bg-[#F2F3F5] cursor-pointer group overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className={`size-4 rounded flex items-center justify-center ${item.wikiType === 'space' ? 'bg-[#E6EEFF] text-[#4798F5]' : 'bg-[#4798F5] text-white'}`}>
                <SvgIcon name={item.wikiType === 'space' ? 'data' : 'doc-detail'} size={12} />
              </div>
              <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                {'title' in item ? item.title : item.name}
              </span>
              <CloseCircleFilled
                className="group-hover:block hidden"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelectedWikis(selectedWikis.filter(w => w.id !== item.id));
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
        title={t("space.select_more")}
        width={1006}
        onCancel={handleClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {(totalSelectedCount > 0) && (
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
                      {t("space.selected_count", { count: totalSelectedCount })}
                    </span>
                    <DownOutlined
                      className={`${popoverVisible ? "rotate-180" : ""} text-xs`}
                    />
                  </div>
                </Popover>
              )}
            </div>
            <div>
              <Button onClick={handleClose}>{t("action.cancel")}</Button>
              <Button type="primary" onClick={handleConfirm} className="ml-2">
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        }
      >
        <>
          <div className="mb-2 pt-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 bg-[#F5F5F5] p-1 rounded-xl">
              {[
                { key: 'recent', label: t("dynamic_knowledge.tab_recent") },
                { key: 'directory', label: t("knowledge.document_file") },
                ...(allowSelectDynamicKnowledge ? [{ key: 'dynamicKnowledge', label: t("module.dynamic_knowledge") }] : []),
              ].map((tab) => (
                <div
                  key={tab.key}
                  className={`px-4 h-[30px] flex-center text-sm cursor-pointer transition-colors ${activeTab === tab.key ? 'text-[#1D1E1F] font-medium bg-white rounded-md' : 'text-[#9A9A9A] hover:text-[#666]'}`}
                  onClick={() => setActiveTab(tab.key as 'recent' | 'directory' | 'dynamicKnowledge')}
                >
                  {tab.label}
                </div>
              ))}
            </div>
     
            <div>
              <Search
                value={activeTab === 'dynamicKnowledge' ? wikiSearchText : searchQuery}
                onDebouncedChange={activeTab === 'dynamicKnowledge' ? setWikiSearchText : handleSearch}
                placeholder={activeTab === 'dynamicKnowledge' ? t("dynamic_knowledge.search_placeholder") : (allowSelectLibrary ? t("space.search_placeholder_with_library") : t("space.search_knowledge_placeholder"))}
                mode="expanded"
              />
            </div>
          </div>
          {searchQuery.trim() ? (
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
          ) : activeTab === 'recent' ? (
            <RecentAccess
              selectedSpaces={selectedSpaces}
              selectedLibraries={selectedLibraries}
              selectedFiles={selectedFiles}
              allowSelectLibrary={allowSelectLibrary}
              allowSelectSpace={allowSelectSpace}
              refreshTrigger={recentRefreshKey}
              onToggleSpace={handleToggleSpace}
              onToggleLibrary={handleToggleLibrary}
              onToggleFile={handleSelectFile}
            />
          ) : activeTab === 'dynamicKnowledge' ? (
            wikiSearchText.trim() ? (
              <KnowledgeSearch
                searchText={wikiSearchText}
                selectedWikis={selectedWikis}
                onTogglePage={handleToggleWikiPage}
              />
            ) : (
              <KnowledgeList
                selectedWikis={selectedWikis}
                allowSelectSpace={allowSelectSpace}
                onToggleSpace={handleToggleWikiSpace}
                onTogglePage={handleToggleWikiPage}
              />
            )
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
              singleSelect={singleSelect}
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
