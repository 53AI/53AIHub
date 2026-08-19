import { useState, useCallback, useMemo, useRef, forwardRef, useImperativeHandle, useEffect } from "react";
import { Modal, Spin, Empty, Button, Popover, Tree, message } from "antd";
import type { TreeDataNode, TreeProps } from "antd";
import { DownOutlined, CloseOutlined } from "@ant-design/icons";
import { Search } from "@km/shared-components-react";
import mySpaceApi from '@/api/modules/my-space';
import recordingApi from '@/api/modules/recording';
import { formatFile } from '@/api/modules/files/transform';
import { getPublicPath } from '@/utils/config';
import { t } from '@/locales';
import type { FileItem } from '@/api/modules/files/types';
import type {
  FileSource,
  MyFilesDialogProps,
  MyFilesDialogRef,
  TreeNode,
  SelectedFileInfo,
  SelectedFilesBySource,
  SourceState,
} from './types';
import './dialog.css';

/** Tab 标签 i18n key 映射(复用 apps/front-react/src/views/mine/constants.tsx 的 key) */
const TAB_LABEL_KEYS: Record<FileSource, string> = {
  uploads: 'mine.uploaded',
  'ai-generated': 'mine.ai_generated',
  recordings: 'mine.recording',
  favorites: 'mine.my_favorites',
  recently: 'mine.recent_visit',
};

/** path 前缀 → source 推断(用于 open(files?) 时归属判定) */
const inferSourceFromPath = (path: string | undefined, fallback: FileSource | undefined): FileSource | undefined => {
  if (!path) return fallback;
  if (path.startsWith('/ai-generated')) return 'ai-generated';
  if (path.startsWith('/recordings')) return 'recordings';
  if (path.startsWith('/uploads')) return 'uploads';
  if (path.startsWith('/favorites')) return 'favorites';
  if (path.startsWith('/recently')) return 'recently';
  return fallback;
};

/** flat list source 集合(不展示 Tree,用 antd List 平铺) */
const FLAT_LIST_SOURCES: ReadonlySet<FileSource> = new Set(['favorites', 'recently']);

const formatTreeNode = (item: any): TreeNode => {
  const formattedFile = formatFile(item);
  const isFolder = item.type === 0;
  return {
    id: formattedFile.id,
    name: formattedFile.name,
    icon: isFolder
      ? getPublicPath('/images/file/folder.png')
      : formattedFile.origin_source === 'recording' || formattedFile.origin_source === 'recording_import'
        ? getPublicPath('/images/file/recrod.png')
        : formattedFile.icon,
    isfolder: isFolder,
    path: item.path || '',
    children: [],
    loaded: !isFolder,
    rawData: item,
  };
};

const emptySourceState = (): SourceState => ({
  treeData: [],
  checkedKeys: [],
  expandedKeys: [],
  searchKeyword: '',
  loaded: false,
  loading: false,
});

export const MyFilesDialog = forwardRef<MyFilesDialogRef, MyFilesDialogProps>(
  function MyFilesDialog({ enabledSources = [], defaultTab, onConfirm }, ref) {
    // 防御:enabledSources 缺失/为空时不要崩(旧调用方 / 还未迁移的 legacy Sender 触发)
    const safeSources = enabledSources ?? [];
    const initialTab = defaultTab ?? safeSources[0];

    const [visible, setVisible] = useState(false);
    const [activeTab, setActiveTab] = useState<FileSource | undefined>(initialTab);
    const [sourceStates, setSourceStates] = useState<Record<FileSource, SourceState>>(() =>
      Object.fromEntries(safeSources.map((s) => [s, emptySourceState()]))
    );
    // 跨 tab 累加池(id → FileItem,3 个 source 全局唯一)
    const [selectedFiles, setSelectedFiles] = useState<Map<string, FileItem>>(new Map());
    const [popoverVisible, setPopoverVisible] = useState(false);

    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadingNodesRef = useRef<Set<string>>(new Set());

    // enabledSources 在弹窗生命周期内是稳定的(ChatContainer useMemo 锁定);
    // 若调用方动态变更 enabledSources,这里补齐缺失桶
    useEffect(() => {
      setSourceStates((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const s of safeSources) {
          if (!next[s]) {
            next[s] = emptySourceState();
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, [safeSources]);

    // 清理搜索防抖定时器
    useEffect(() => {
      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }, []);

    // 工具:更新指定 source 的状态(浅合并)
    const updateSourceState = useCallback(
      (source: FileSource, patch: Partial<SourceState>) => {
        setSourceStates((prev) => ({
          ...prev,
          [source]: { ...prev[source], ...patch },
        }));
      },
      []
    );

    /** 加载 source 的指定 path/keyword 数据(不修改 expandedKeys) */
    const loadFilesForSource = useCallback(
      async (source: FileSource, path: string, keyword?: string) => {
        const baseParams: Record<string, any> = { path, offset: 0, limit: 30 };
        if (keyword?.trim()) {
          baseParams.keyword = keyword;
        }

        let dirNodes: TreeNode[] = [];
        let fileNodes: TreeNode[] = [];

        if (source === 'recordings') {
          const [dirRes, fileRes] = await Promise.all([
            recordingApi.getRecordings({ ...baseParams, type: 'dir' }),
            recordingApi.getRecordings({ ...baseParams, type: 'file' }),
          ]);
          dirNodes = (dirRes.data || []).filter((item: any) => item.path !== '/').map(formatTreeNode);
          fileNodes = (fileRes.data || []).map(formatTreeNode);
        } else if (source === 'uploads') {
          const [dirRes, fileRes] = await Promise.all([
            mySpaceApi.getUploads({ ...baseParams, type: 'dir' }),
            mySpaceApi.getUploads({ ...baseParams, type: 'file' }),
          ]);
          dirNodes = (dirRes.data || []).filter((item: any) => item.path !== '/').map(formatTreeNode);
          fileNodes = (fileRes.data || []).map(formatTreeNode);
        } else if (source === 'ai-generated') {
          const [dirRes, fileRes] = await Promise.all([
            mySpaceApi.getAIGenerated({ ...baseParams, type: 'dir' }),
            mySpaceApi.getAIGenerated({ ...baseParams, type: 'file' }),
          ]);
          dirNodes = (dirRes.data || []).filter((item: any) => item.path !== '/').map(formatTreeNode);
          fileNodes = (fileRes.data || []).map(formatTreeNode);
        } else if (source === 'favorites' || source === 'recently') {
          // 平铺列表:API 没有 dir/file 拆分,直接拉一次 items,过滤 file 类型,
          // 构造虚拟 path(`/favorites/<id>` / `/recently/<id>`)让 open(files) 推断回 source
          const res =
            source === 'favorites'
              ? await mySpaceApi.getFavorites({ offset: 0, limit: 100 })
              : await mySpaceApi.getRecently({ offset: 0, limit: 100 });
          fileNodes = (res.items || [])
            .filter((item: any) => item.resource_type === 2 && item.file)
            .map((item: any) => {
              const f = item.file;
              const formatted = formatFile(f);
              return {
                id: String(item.resource_id),
                name: formatted.name,
                icon: formatted.icon,
                isfolder: false,
                path: `/${source}/${item.resource_id}`,
                loaded: true,
                rawData: item,
              } as TreeNode;
            });
        } else {
          return [];
        }

        return [...dirNodes, ...fileNodes];
      },
      []
    );

    /** 触发 source 首次加载(根目录 / 默认 path) */
    const triggerInitialLoad = useCallback(
      async (source: FileSource) => {
        updateSourceState(source, { loading: true });
        try {
          const defaultPath = source === 'ai-generated' ? '/ai-generated' : '/';
          const nodes = await loadFilesForSource(source, defaultPath);
          updateSourceState(source, {
            treeData: nodes,
            loaded: true,
            loading: false,
            expandedKeys: [],
          });
        } catch (error) {
          console.error('Failed to load files:', error);
          updateSourceState(source, { loading: false, loaded: true });
        }
      },
      [loadFilesForSource, updateSourceState]
    );

    // 打开弹窗:仅触发 activeTab 首次加载(若未 loaded)
    const open = useCallback(
      (files?: SelectedFileInfo[]) => {
        setVisible(true);
        // 重置搜索词(searchKeyword 保留在 sourceStates 内不重置,以便切 tab 不丢上下文)
        if (files?.length) {
          // 按 source 推断归属并写入对应桶
          const fallbackSource = initialTab;
          const bySourceChecked: Record<FileSource, Set<string>> = {
            uploads: new Set(),
            'ai-generated': new Set(),
            recordings: new Set(),
          };
          const newSelected = new Map<string, FileItem>();
          for (const f of files) {
            const source = f.source ?? inferSourceFromPath(f.path, fallbackSource);
            if (!source || !enabledSources.includes(source)) continue;
            bySourceChecked[source].add(f.id);
            newSelected.set(f.id, {
              id: f.id,
              name: f.name,
              icon: f.icon || '',
              path: f.path,
              isfolder: f.isfolder || false,
              rawData: f.rawData,
            } as FileItem);
          }
          setSelectedFiles(newSelected);
          setSourceStates((prev) => {
            const next = { ...prev };
            for (const source of enabledSources) {
              if (bySourceChecked[source].size > 0 || next[source]) {
                next[source] = {
                  ...next[source],
                  checkedKeys: Array.from(bySourceChecked[source]),
                };
              }
            }
            return next;
          });
        } else {
          setSelectedFiles(new Map());
          setSourceStates((prev) => {
            const next = { ...prev };
            for (const source of enabledSources) {
              next[source] = { ...next[source], checkedKeys: [] };
            }
            return next;
          });
        }

        // 触发 activeTab 首次加载
        const activeState = sourceStates[activeTab];
        if (!activeState?.loaded) {
          triggerInitialLoad(activeTab);
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [activeTab, enabledSources, initialTab, sourceStates, triggerInitialLoad]
    );

    useImperativeHandle(ref, () => ({ open }), [open]);

    // 切 tab:若目标 source 未 loaded,触发首次加载
    const handleTabChange = useCallback(
      (next: FileSource) => {
        if (next === activeTab) return;
        setActiveTab(next);
        const state = sourceStates[next];
        if (state && !state.loaded) {
          triggerInitialLoad(next);
        }
      },
      [activeTab, sourceStates, triggerInitialLoad]
    );

    const handleClose = useCallback(() => {
      setVisible(false);
    }, []);

    // 搜索(per-tab):输入 → 防抖 → 重新拉当前 activeTab 数据
    // - tree sources(uploads / ai-generated / recordings):服务端 keyword
    // - flat sources(favorites / recently):API 不支持 keyword,客户端按 name 过滤
    const handleSearch = useCallback(
      (value: string) => {
        updateSourceState(activeTab, { searchKeyword: value });
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
        searchTimeoutRef.current = setTimeout(async () => {
          const defaultPath = activeTab === 'ai-generated' ? '/ai-generated' : '/';
          if (!value.trim()) {
            updateSourceState(activeTab, { expandedKeys: [] });
            triggerInitialLoad(activeTab);
            return;
          }
          const isFlat = FLAT_LIST_SOURCES.has(activeTab);
          const nodes = await loadFilesForSource(
            activeTab,
            defaultPath,
            isFlat ? undefined : value
          );
          // flat sources 客户端按 name 过滤
          const filtered = isFlat
            ? nodes.filter((n) => n.name.toLowerCase().includes(value.toLowerCase()))
            : nodes;
          updateSourceState(activeTab, {
            treeData: filtered,
            loaded: true,
            expandedKeys: [],
          });
        }, 300);
      },
      [activeTab, loadFilesForSource, triggerInitialLoad, updateSourceState]
    );

    // Tree 异步加载子节点(per-source)
    const handleLoadData = useCallback(
      async (treeNode: TreeDataNode) => {
        const node = treeNode as unknown as TreeNode;
        const nodeId = String(node.key || node.id);
        if (loadingNodesRef.current.has(nodeId) || !node.isfolder) return;

        loadingNodesRef.current.add(nodeId);
        try {
          const state = sourceStates[activeTab];
          const findNode = (nodes: TreeNode[], targetId: string): TreeNode | null => {
            for (const n of nodes) {
              if (String(n.id) === targetId) return n;
              if (n.children?.length) {
                const found = findNode(n.children, targetId);
                if (found) return found;
              }
            }
            return null;
          };
          const currentNode = findNode(state.treeData, nodeId);
          if (currentNode?.loaded) return;

          const children = await loadFilesForSource(activeTab, node.path);
          const hasSubFolders = children.some((child) => child.isfolder);
          const childIds = new Set(children.map((c) => String(c.id)));

          updateSourceState(activeTab, {
            treeData: (() => {
              const updateNode = (nodes: TreeNode[]): TreeNode[] =>
                nodes.map((n) => {
                  if (String(n.id) === nodeId) {
                    return { ...n, children, loaded: true, hasSubFolders };
                  }
                  if (n.children) {
                    return { ...n, children: updateNode(n.children) };
                  }
                  return n;
                });
              const removeDuplicates = (
                nodes: TreeNode[],
                isInsideTarget: boolean
              ): TreeNode[] =>
                nodes
                  .filter((n) => {
                    if (isInsideTarget) return true;
                    if (String(n.id) === nodeId) return true;
                    return !childIds.has(String(n.id));
                  })
                  .map((n) => {
                    const nextIsInsideTarget = isInsideTarget || String(n.id) === nodeId;
                    if (n.children?.length) {
                      return { ...n, children: removeDuplicates(n.children, nextIsInsideTarget) };
                    }
                    return n;
                  });
              const updated = updateNode(state.treeData);
              return removeDuplicates(updated, false);
            })(),
          });
        } finally {
          loadingNodesRef.current.delete(nodeId);
        }
      },
      [activeTab, loadFilesForSource, sourceStates, updateSourceState]
    );

    const handleExpand: TreeProps['onExpand'] = useCallback(
      (keys) => {
        updateSourceState(activeTab, { expandedKeys: keys as string[] });
      },
      [activeTab, updateSourceState]
    );

    // 勾选切换:同时维护 per-source checkedKeys 和全局 selectedFiles Map
    const toggleCheck = useCallback(
      (source: FileSource, key: string, isChecked: boolean) => {
        const state = sourceStates[source];
        if (!state) return;

        const findNode = (nodes: TreeNode[], targetKey: string): TreeNode | null => {
          for (const n of nodes) {
            if (n.id === targetKey) return n;
            if (n.children?.length) {
              const found = findNode(n.children, targetKey);
              if (found) return found;
            }
          }
          return null;
        };

        const node = findNode(state.treeData, key);
        if (!node) return;

        const nodePath = node.path || '';
        const isFolder = node.isfolder;

        const collectChildIds = (n: TreeNode): string[] => {
          const ids: string[] = [];
          if (n.children?.length) {
            for (const child of n.children) {
              ids.push(child.id);
              ids.push(...collectChildIds(child));
            }
          }
          return ids;
        };

        const collectAncestorIds = (nodes: TreeNode[], targetPath: string): string[] => {
          const ids: string[] = [];
          for (const n of nodes) {
            const nPath = n.path || '';
            if (n.isfolder && targetPath.startsWith(nPath) && nPath !== targetPath) {
              ids.push(n.id);
            }
            if (n.children) {
              ids.push(...collectAncestorIds(n.children, targetPath));
            }
          }
          return ids;
        };

        let newKeys = [...state.checkedKeys];

        if (isChecked) {
          // 取消勾选
          newKeys = newKeys.filter((k) => k !== key);
          if (isFolder) {
            const childIds = collectChildIds(node);
            newKeys = newKeys.filter((k) => !childIds.includes(k));
          }
          const ancestorIds = collectAncestorIds(state.treeData, nodePath);
          newKeys = newKeys.filter((k) => !ancestorIds.includes(k));
        } else {
          // 勾选
          newKeys.push(key);
          if (isFolder) {
            const childIds = collectChildIds(node);
            for (const childId of childIds) {
              if (!newKeys.includes(childId)) newKeys.push(childId);
            }
          }
        }

        updateSourceState(source, { checkedKeys: newKeys });

        // 同步更新 selectedFiles Map(累加语义:删除用 unselect 路径)
        setSelectedFiles((prev) => {
          const next = new Map(prev);
          // 删除受影响的所有 key(包括取消勾选时收集的 childIds / ancestorIds)
          const keysToRemove = new Set<string>([key]);
          if (isChecked) {
            if (isFolder) {
              for (const id of collectChildIds(node)) keysToRemove.add(id);
            }
            for (const id of collectAncestorIds(state.treeData, nodePath)) keysToRemove.add(id);
          }
          for (const id of keysToRemove) next.delete(id);

          // 勾选时:把当前节点 + 文件夹子节点加入(已有则跳过)
          if (!isChecked) {
            const addOne = (n: TreeNode) => {
              next.set(n.id, {
                id: n.id,
                name: n.name,
                icon: n.icon,
                path: n.path,
                isfolder: n.isfolder,
                rawData: n.rawData,
              } as FileItem);
              if (n.isfolder && n.children?.length) {
                for (const child of n.children) addOne(child);
              }
            };
            addOne(node);
          }
          return next;
        });
      },
      [sourceStates, updateSourceState]
    );

    const handleCheck: TreeProps['onCheck'] = useCallback(
      (checked, info) => {
        const key = info.node?.key as string;
        if (!key) return;
        const willBeChecked = Array.isArray(checked)
          ? checked.includes(key)
          : checked.checked.includes(key);
        // 操作反向 = 当前状态
        toggleCheck(activeTab, key, !willBeChecked);
      },
      [activeTab, toggleCheck]
    );

    const handleSelect: TreeProps['onSelect'] = useCallback(
      (_selectedKeys, info) => {
        const key = info.node?.key as string;
        if (!key) return;
        const node = info.node as any;
        const isFolder = node.isfolder;
        const nodeLoaded = node.loaded;
        const state = sourceStates[activeTab];
        if (!state) return;

        let isChecked: boolean;
        if (isFolder && nodeLoaded && node.children?.length > 0) {
          const collectAllChildIds = (n: TreeNode): string[] => {
            const ids: string[] = [];
            if (n.children?.length) {
              for (const child of n.children) {
                ids.push(child.id);
                ids.push(...collectAllChildIds(child));
              }
            }
            return ids;
          };

          const findNode = (nodes: TreeNode[], targetKey: string): TreeNode | null => {
            for (const n of nodes) {
              if (n.id === targetKey) return n;
              if (n.children?.length) {
                const found = findNode(n.children, targetKey);
                if (found) return found;
              }
            }
            return null;
          };

          const treeNode = findNode(state.treeData, key);
          if (treeNode) {
            const allChildIds = collectAllChildIds(treeNode);
            isChecked = allChildIds.length > 0 && allChildIds.every((id) => state.checkedKeys.includes(id));
          } else {
            isChecked = state.checkedKeys.includes(key);
          }
        } else {
          isChecked = state.checkedKeys.includes(key);
        }

        toggleCheck(activeTab, key, isChecked);
      },
      [activeTab, sourceStates, toggleCheck]
    );

    // 确认按钮:按 path 前缀分桶
    const handleConfirm = useCallback(() => {
      const all = Array.from(selectedFiles.values());
      if (all.length === 0) {
        message.error(t('common.please_select_file'));
        return;
      }
      const fallbackSource = activeTab;
      const bySource: SelectedFilesBySource = {};
      for (const file of all) {
        const source = inferSourceFromPath(file.path, fallbackSource);
        if (!source) continue;
        if (!bySource[source]) bySource[source] = [];
        bySource[source]!.push(file);
      }
      setVisible(false);
      onConfirm?.(bySource);
    }, [selectedFiles, activeTab, onConfirm]);

    // 移除选中文件(从 Map + 对应 source 的 checkedKeys 中清除)
    const handleRemoveFile = useCallback(
      (item: FileItem) => {
        const source = inferSourceFromPath(item.path, activeTab);
        if (!source) return;
        setSelectedFiles((prev) => {
          const next = new Map(prev);
          next.delete(item.id);
          return next;
        });
        updateSourceState(source, {
          checkedKeys: (sourceStates[source]?.checkedKeys || []).filter((id) => id !== item.id),
        });
      },
      [activeTab, sourceStates, updateSourceState]
    );

    const selectedFilesPopoverContent = useMemo(
      () => (
        <div className="p-2">
          <div className="h-8 px-2 flex items-center gap-1 justify-between">
            <span className="text-sm">全部已选({selectedFiles.size})</span>
            <div
              className="size-6 flex items-center justify-center rounded cursor-pointer hover:bg-[#F2F3F5]"
              onClick={() => setPopoverVisible(false)}
            >
              <CloseOutlined />
            </div>
          </div>
          <div className="space-y-1 max-h-80 overflow-y-auto">
            {Array.from(selectedFiles.values()).map((item) => (
              <div
                key={item.id}
                className="h-8 px-2 rounded flex items-center gap-1 text-[#999999] hover:bg-[#F2F3F5] cursor-pointer group overflow-hidden"
              >
                <img src={item.icon} className="size-4" alt="" />
                <span className="flex-1 text-sm text-[#1D1E1F] truncate">{item.name}</span>
                <CloseOutlined
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
      ),
      [selectedFiles, handleRemoveFile]
    );

    // 当前 activeTab 的状态(供渲染用)
    const activeState = sourceStates[activeTab];

    const treeDataNodes = useMemo((): TreeDataNode[] => {
      const processNode = (node: TreeNode): TreeDataNode => {
        const isLeaf = !node.isfolder || (node.loaded && (!node.children || node.children.length === 0));
        return {
          key: node.id,
          title: (
            <div className="flex items-center gap-2">
              <img src={node.icon} className="w-5 h-5 shrink-0" alt="" />
              <span className="flex-1 text-sm text-[#1D1E1F] overflow-hidden text-ellipsis whitespace-nowrap">
                {node.name}
              </span>
            </div>
          ),
          isLeaf,
          // @ts-ignore - Ant Design Tree 允许自定义属性
          name: node.name,
          isfolder: node.isfolder,
          path: node.path,
          loaded: node.loaded,
          hasSubFolders: node.hasSubFolders,
          icon: node.icon,
          rawData: node.rawData,
          children: node.isfolder
            ? node.loaded
              ? node.children?.map((child) => processNode(child)) || []
              : undefined
            : undefined,
        };
      };
      return activeState?.treeData.map((node) => processNode(node)) || [];
    }, [activeState]);

    // 没有可用的 source 时直接不渲染(防御:旧调用方 / 还没迁移的 legacy Sender)
    if (safeSources.length === 0) {
      return null;
    }

    return (
      <Modal
        open={visible}
        title="选择我的"
        width={1006}
        onCancel={handleClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {selectedFiles.size > 0 && (
                <Popover
                  open={popoverVisible}
                  onOpenChange={setPopoverVisible}
                  content={selectedFilesPopoverContent}
                  trigger="click"
                  placement="topLeft"
                  overlayClassName="!p-0"
                  overlayStyle={{ width: 360 }}
                >
                  <div className="h-8 px-2 rounded flex items-center gap-1 text-[#999999] hover:bg-[#F2F3F5] cursor-pointer">
                    <span className="text-sm">已选{selectedFiles.size}个文件</span>
                    <DownOutlined className={popoverVisible ? 'rotate-180' : ''} />
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
        className="my-files-dialog"
      >
        <div className="p-0">
          {/* Tab 条 + 搜索框(对齐 SpaceDialog 样式) */}
          <div className="mb-2 pt-2 flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1 bg-[#F5F5F5] p-1 rounded-xl">
              {enabledSources.map((source) => (
                <div
                  key={source}
                  className={`px-4 h-[30px] flex-center text-sm cursor-pointer transition-colors ${
                    activeTab === source
                      ? 'text-[#1D1E1F] font-medium bg-white rounded-md'
                      : 'text-[#9A9A9A] hover:text-[#666]'
                  }`}
                  onClick={() => handleTabChange(source)}
                >
                  {t(TAB_LABEL_KEYS[source])}
                </div>
              ))}
            </div>
            <Search
              mode="expanded"
              placeholder="搜索"
              value={activeState?.searchKeyword ?? ''}
              onDebouncedChange={handleSearch}
              className="max-w-[240px]"
            />
          </div>
          <div className="h-[450px] overflow-y-auto p-3 border border-[#E5E5E5] rounded-xl">
            {activeState?.loading ? (
              <div className="flex justify-center py-8">
                <Spin />
              </div>
            ) : FLAT_LIST_SOURCES.has(activeTab) ? (
              // 平铺视图:favorites / recently 仅展示文件项(已过滤 resource_type=2)
              treeDataNodes.length === 0 ? (
                <Empty image={getPublicPath('/images/empty.png')} description={t('common.no_data')} />
              ) : (
                <div className="flex flex-col gap-1">
                  {treeDataNodes.map((node) => {
                    const checked = (activeState?.checkedKeys ?? []).includes(String(node.key));
                    return (
                      <div
                        key={node.key}
                        className={`h-9 px-2 flex items-center gap-2 rounded cursor-pointer transition-colors ${
                          checked ? 'bg-[#EBF1FF]' : 'hover:bg-[#F2F3F5]'
                        }`}
                        onClick={() => {
                          // 模拟点击 Tree checkbox 行为:toggleCheck(activeTab, key, !checked)
                          toggleCheck(activeTab, String(node.key), checked);
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCheck(activeTab, String(node.key), checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <img src={(node as any).icon} className="w-5 h-5 shrink-0" alt="" />
                        <span className="flex-1 text-sm text-[#1D1E1F] truncate">{(node as any).name}</span>
                      </div>
                    );
                  })}
                </div>
              )
            ) : treeDataNodes.length === 0 ? (
              <Empty image={getPublicPath('/images/empty.png')} description={t('common.no_data')} />
            ) : (
              <Tree
                checkable
                blockNode
                treeData={treeDataNodes}
                checkedKeys={activeState?.checkedKeys ?? []}
                expandedKeys={activeState?.expandedKeys ?? []}
                onCheck={handleCheck}
                onExpand={handleExpand}
                onSelect={handleSelect}
                loadData={handleLoadData}
                className="my-files-dialog-tree"
              />
            )}
          </div>
        </div>
      </Modal>
    );
  }
);

MyFilesDialog.displayName = 'MyFilesDialog';

export default MyFilesDialog;