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
import type { MyFilesDialogProps, MyFilesDialogRef, TreeNode, FileSource, SelectedFileInfo } from './types';
import './dialog.css';

const SOURCE_CONFIG: Record<FileSource, { title: string; defaultPath: string }> = {
  uploads: { title: '我上传的', defaultPath: '/' },
  'ai-generated': { title: 'AI生成的', defaultPath: '/ai-generated' },
  recordings: { title: '我的录音', defaultPath: '/' }
};

const formatTreeNode = (item: any): TreeNode => {
  const formattedFile = formatFile(item);
  const isFolder = item.type === 0;
  return {
    id: formattedFile.id,
    name: formattedFile.name,
    icon: isFolder ? getPublicPath('/images/file/folder.png') : formattedFile.origin_source === 'recording' || formattedFile.origin_source === 'recording_import' ? getPublicPath("/images/file/recrod.png"):  formattedFile.icon,
    isfolder: isFolder,
    path: item.path || '',
    children: [],
    loaded: !isFolder,
    rawData: item
  };
};

export const MyFilesDialog = forwardRef<MyFilesDialogRef, MyFilesDialogProps>(
  function MyFilesDialog({ source, onConfirm }, ref) {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [searchKeyword, setSearchKeyword] = useState('');
    const [treeData, setTreeData] = useState<TreeNode[]>([]);
    const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
    const [checkedKeys, setCheckedKeys] = useState<string[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [popoverVisible, setPopoverVisible] = useState(false);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const loadingNodesRef = useRef<Set<string>>(new Set()); // 同步跟踪正在加载的节点

    // 清理搜索防抖定时器
    useEffect(() => {
      return () => {
        if (searchTimeoutRef.current) {
          clearTimeout(searchTimeoutRef.current);
        }
      };
    }, []);

    const config = SOURCE_CONFIG[source];

    // 加载文件列表
    const loadFiles = useCallback(async (path: string, keyword?: string) => {
      setLoading(true);
      try {
        const baseParams = { path, offset: 0, limit: 30 };
        if (keyword?.trim()) {
          Object.assign(baseParams, { keyword });
        }

        let dirNodes: TreeNode[] = [];
        let fileNodes: TreeNode[] = [];

        if (source === 'recordings') {
          // 录音使用 recordingApi
          const [dirRes, fileRes] = await Promise.all([
            recordingApi.getRecordings({ ...baseParams, type: 'dir' }),
            recordingApi.getRecordings({ ...baseParams, type: 'file' })
          ]);
          dirNodes = (dirRes.data || []).filter((item: any) => item.path !== '/').map(formatTreeNode);
          fileNodes = (fileRes.data || []).map(formatTreeNode);
        } else {
          // uploads 和 ai-generated 使用 mySpaceApi
          const [dirRes, fileRes] = await Promise.all([
            source === 'uploads'
              ? mySpaceApi.getUploads({ ...baseParams, type: 'dir' })
              : mySpaceApi.getAIGenerated({ ...baseParams, type: 'dir' }),
            source === 'uploads'
              ? mySpaceApi.getUploads({ ...baseParams, type: 'file' })
              : mySpaceApi.getAIGenerated({ ...baseParams, type: 'file' })
          ]);
          dirNodes = (dirRes.data || []).filter((item: any) => item.path !== '/').map(formatTreeNode);
          fileNodes = (fileRes.data || []).map(formatTreeNode);
        }

        // 文件夹在前，文件在后
        return [...dirNodes, ...fileNodes];
      } catch (error) {
        console.error('Failed to load files:', error);
        return [];
      } finally {
        setLoading(false);
      }
    }, [source]);

    // 初始加载
    const loadInitialData = useCallback(async () => {
      const nodes = await loadFiles(config.defaultPath);
      setTreeData(nodes);
    }, [loadFiles, config.defaultPath]);

    // 搜索处理（带防抖）
    const handleSearch = useCallback((value: string) => {
      setSearchKeyword(value);
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
      searchTimeoutRef.current = setTimeout(async () => {
        if (!value.trim()) {
          setExpandedKeys([]);  // 清空展开状态，避免触发 loadData
          loadInitialData();
          return;
        }
        const nodes = await loadFiles(config.defaultPath, value);
        // 搜索结果：文件夹保持 loaded = false，允许用户点击展开加载子节点
        setTreeData(nodes);
        setExpandedKeys([]);
      }, 300);
    }, [loadFiles, config.defaultPath, loadInitialData]);

    // Tree 异步加载子节点
    const handleLoadData = useCallback(async (treeNode: TreeDataNode) => {
      const node = treeNode as unknown as TreeNode;
      const nodeId = String(node.key || node.id);

      // 使用 ref 同步检查是否正在加载
      if (loadingNodesRef.current.has(nodeId) || !node.isfolder) {
        return;
      }

      // 从 treeData 状态中查找节点，获取最新的 loaded 状态
      const findNodeInTree = (nodes: TreeNode[], targetId: string): TreeNode | null => {
        for (const n of nodes) {
          if (String(n.id) === targetId) return n;
          if (n.children?.length) {
            const found = findNodeInTree(n.children, targetId);
            if (found) return found;
          }
        }
        return null;
      };

      const currentNode = findNodeInTree(treeData, nodeId);
      if (currentNode?.loaded) {
        return;
      }

      // 标记为正在加载
      loadingNodesRef.current.add(nodeId);
      const children = await loadFiles(node.path);
      const hasSubFolders = children.some(child => child.isfolder);
      // 收集子节点 ID，用于去除其他层级的重复节点
      const childIds = new Set(children.map(c => String(c.id)));

      const updateNode = (nodes: TreeNode[]): TreeNode[] => {
        return nodes.map(n => {
          if (String(n.id) === nodeId) {
            return { ...n, children, loaded: true, hasSubFolders };
          }
          if (n.children) {
            return { ...n, children: updateNode(n.children) };
          }
          return n;
        });
      };

      // 去除其他层级的重复节点（不在目标文件夹的 children 里移除）
      const removeDuplicates = (nodes: TreeNode[], isInsideTarget: boolean): TreeNode[] => {
        return nodes.filter(n => {
          // 在目标文件夹内部，不移除任何节点
          if (isInsideTarget) return true;
          // 保留当前展开的文件夹
          if (String(n.id) === nodeId) return true;
          // 移除与加载子节点重复的节点（它们应该只在 children 里）
          return !childIds.has(String(n.id));
        }).map(n => {
          // 如果是目标文件夹，其 children 不需要检查重复
          const nextIsInsideTarget = isInsideTarget || String(n.id) === nodeId;
          if (n.children?.length) {
            return { ...n, children: removeDuplicates(n.children, nextIsInsideTarget) };
          }
          return n;
        });
      };

      setTreeData(prev => {
        const updated = updateNode(prev);
        return removeDuplicates(updated, false);
      });

      // 加载完成后移除加载中标记
      loadingNodesRef.current.delete(nodeId);
    }, [loadFiles, treeData]);

    // 处理展开
    const handleExpand: TreeProps['onExpand'] = useCallback((keys) => {
      setExpandedKeys(keys as string[]);
    }, []);

    // 统一的勾选切换逻辑（联动父子节点）
    const toggleCheck = useCallback((key: string, isChecked: boolean) => {
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

      const node = findNode(treeData, key);
      if (!node) return;

      const nodePath = node.path || '';
      const isFolder = node.isfolder;

      setCheckedKeys(prev => {
        let newKeys = [...prev];

        // 收集所有子节点 ID（递归）
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

        // 收集所有祖先文件夹 ID
        const collectAncestorIds = (nodes: TreeNode[], targetPath: string): string[] => {
          const ids: string[] = [];
          for (const n of nodes) {
            const nPath = n.path || '';
            if (n.isfolder && targetPath.startsWith(nPath) && nPath !== targetPath) {
              ids.push(n.id);
            }
            if (n.children?.length) {
              ids.push(...collectAncestorIds(n.children, targetPath));
            }
          }
          return ids;
        };

        if (isChecked) {
          // 取消勾选：移除当前节点及其所有子节点
          newKeys = newKeys.filter(k => k !== key);
          if (isFolder) {
            const childIds = collectChildIds(node);
            newKeys = newKeys.filter(k => !childIds.includes(k));
          }
          // 取消子节点时也要取消祖先文件夹
          const ancestorIds = collectAncestorIds(treeData, nodePath);
          newKeys = newKeys.filter(k => !ancestorIds.includes(k));
        } else {
          // 勾选：添加当前节点及其所有子节点
          newKeys.push(key);
          if (isFolder) {
            const childIds = collectChildIds(node);
            for (const childId of childIds) {
              if (!newKeys.includes(childId)) {
                newKeys.push(childId);
              }
            }
          }
        }

        return newKeys;
      });
    }, [treeData]);

    // 点击复选框
    const handleCheck: TreeProps['onCheck'] = useCallback((checked, info) => {
      const key = info.node?.key as string;
      if (!key) return;
      const willBeChecked = Array.isArray(checked)
        ? checked.includes(key)
        : checked.checked.includes(key);
      const isChecked = !willBeChecked; // 当前状态是操作的反向
      toggleCheck(key, isChecked);
    }, [toggleCheck]);

    // 点击行（与点击复选框效果一致）
    const handleSelect: TreeProps['onSelect'] = useCallback((selectedKeys, info) => {
      const key = info.node?.key as string;
      if (!key) return;

      // 判断节点是否实际已勾选（考虑父节点情况）
      const node = info.node as any;
      const isFolder = node.isfolder;
      const nodeLoaded = node.loaded;

      let isChecked: boolean;
      if (isFolder && nodeLoaded && node.children?.length > 0) {
        // 已展开且有子节点的文件夹：检查所有子节点是否都已勾选
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

        const treeNode = findNode(treeData, key);
        if (treeNode) {
          const allChildIds = collectAllChildIds(treeNode);
          // 如果所有子节点都在 checkedKeys 中，视为已勾选
          isChecked = allChildIds.length > 0 && allChildIds.every(id => checkedKeys.includes(id));
        } else {
          isChecked = checkedKeys.includes(key);
        }
      } else {
        // 未展开的文件夹或文件节点：直接检查 checkedKeys
        isChecked = checkedKeys.includes(key);
      }

      toggleCheck(key, isChecked);
    }, [checkedKeys, toggleCheck, treeData]);

    // 更新选中的文件列表（文件夹本身也算作已选）
    useEffect(() => {
      const findNodeById = (nodes: TreeNode[], id: string): TreeNode | null => {
        for (const node of nodes) {
          if (node.id === id) return node;
          if (node.children?.length) {
            const found = findNodeById(node.children, id);
            if (found) return found;
          }
        }
        return null;
      };

      // 收集节点：文件直接加入，文件夹也加入（与 SpaceDialog 一致）
      const collectFiles = (node: TreeNode, fileMap: Map<string, FileItem>) => {
        // 文件夹和文件都加入已选列表
        fileMap.set(node.id, {
          id: node.id,
          name: node.name,
          icon: node.icon,
          path: node.path,
          isfolder: node.isfolder,
          rawData: node.rawData
        } as FileItem);

        // 文件夹：如果有子节点，也递归收集
        if (node.isfolder && node.children?.length) {
          for (const child of node.children) {
            collectFiles(child, fileMap);
          }
        }
      };

      const fileMap = new Map<string, FileItem>();
      for (const id of checkedKeys) {
        const node = findNodeById(treeData, id);
        if (node) {
          collectFiles(node, fileMap);
        }
      }
      setSelectedFiles(Array.from(fileMap.values()));
    }, [checkedKeys, treeData]);

    // 打开弹窗
    const open = useCallback((files?: SelectedFileInfo[]) => {
      setVisible(true);
      setSearchKeyword('');
      setExpandedKeys([]);
      if (files?.length) {
        setCheckedKeys(files.map(f => f.id));
        // 转换为 FileItem 格式（用于 selectedFiles 状态）
        setSelectedFiles(files.map(f => ({
          id: f.id,
          name: f.name,
          icon: f.icon || '',
          path: f.path,
          isfolder: f.isfolder || false,
          rawData: f.rawData,
        } as FileItem)));
      } else {
        setCheckedKeys([]);
        setSelectedFiles([]);
      }
      loadInitialData();
    }, [loadInitialData]);

    useImperativeHandle(ref, () => ({ open }), [open]);

    // 关闭弹窗
    const handleClose = useCallback(() => {
      setVisible(false);
    }, []);

    // 确定按钮
    const handleConfirm = useCallback(() => {
      if (selectedFiles.length === 0) {
        message.error(t("common.please_select_file"));
        return;
      }
      setVisible(false);
      onConfirm?.(selectedFiles);
    }, [selectedFiles, onConfirm]);

    // 移除选中文件（同时移除祖先文件夹，避免子文件被重新加入）
    const handleRemoveFile = useCallback((item: FileItem) => {
      const itemPath = item.path || '';
      // 找出所有祖先文件夹（path 是当前 item path 的前缀）
      const ancestorIds = selectedFiles
        .filter(f => f.isfolder && itemPath.startsWith(f.path || '') && f.id !== item.id)
        .map(f => f.id);

      setCheckedKeys(prev => prev.filter(id => id !== item.id && !ancestorIds.includes(id)));
    }, [selectedFiles]);

    // 已选文件 Popover 内容
    const selectedFilesPopoverContent = useMemo(() => (
      <div className="p-2">
        <div className="h-8 px-2 flex items-center gap-1 justify-between">
          <span className="text-sm">全部已选（{selectedFiles.length}）</span>
          <div
            className="size-6 flex items-center justify-center rounded cursor-pointer hover:bg-[#F2F3F5]"
            onClick={() => setPopoverVisible(false)}
          >
            <CloseOutlined />
          </div>
        </div>
        <div className="space-y-1 max-h-80 overflow-y-auto">
          {selectedFiles.map((item) => (
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
    ), [selectedFiles, handleRemoveFile]);

    // 构建 Tree 节点数据
    const treeDataNodes = useMemo((): TreeDataNode[] => {
      const processNode = (node: TreeNode): TreeDataNode => {
        // 文件：isLeaf: true（无箭头）
        // 文件夹未加载：isLeaf: false（显示箭头）
        // 文件夹已加载无子节点：isLeaf: true（无箭头，避免重复请求）
        // 文件夹已加载有子节点：isLeaf: false（显示箭头）
        const isLeaf = !node.isfolder || (node.loaded && (!node.children || node.children.length === 0));

        return {
          key: node.id,
          title: (
            <div className="flex items-center gap-2">
              <img src={node.icon} className="w-5 h-5 shrink-0" alt="" />
              <span className="flex-1 text-sm text-[#1D1E1F] overflow-hidden text-ellipsis whitespace-nowrap">{node.name}</span>
            </div>
          ),
          isLeaf,
          // 把 TreeNode 的属性挂到 TreeDataNode 上，供 loadData 使用
          // @ts-ignore - Ant Design Tree 允许自定义属性
          name: node.name,
          isfolder: node.isfolder,
          path: node.path,
          loaded: node.loaded,
          hasSubFolders: node.hasSubFolders,
          icon: node.icon,
          rawData: node.rawData,
          children: node.isfolder
            ? (node.loaded ? (node.children?.map(child => processNode(child)) || []) : undefined)
            : undefined,
        };
      };

      return treeData.map(node => processNode(node));
    }, [treeData]);

    return (
      <Modal
        open={visible}
        title="选择更多"
        width={600}
        onCancel={handleClose}
        footer={
          <div className="flex items-center justify-between gap-2">
            <div>
              {selectedFiles.length > 0 && (
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
                    <span className="text-sm">已选{selectedFiles.length}个文件</span>
                    <DownOutlined className={popoverVisible ? "rotate-180" : ""} />
                  </div>
                </Popover>
              )}
            </div>
            <div>
              <Button onClick={handleClose}>取消</Button>
              <Button type="primary" onClick={handleConfirm} className="ml-2">确定</Button>
            </div>
          </div>
        }
        className="my-files-dialog"
      >
        <div className="p-0">
          <div className="py-4">
            <Search
              mode="expanded"
              placeholder="搜索"
              value={searchKeyword}
              onDebouncedChange={handleSearch}
              className="max-w-[240px]"
            />
          </div>
          <div className="h-[450px] overflow-y-auto p-3 border border-[#E5E5E5] rounded-xl">
            <div className="flex items-center text-sm text-[#999999]">{config.title}</div>
            {loading ? (
              <div className="flex justify-center py-8">
                <Spin />
              </div>
            ) : treeData.length === 0 ? (
              <Empty
                image={getPublicPath("/images/empty.png")}
                description={t("common.no_data")}
              />
            ) : (
              <Tree
                checkable
                blockNode
                treeData={treeDataNodes}
                checkedKeys={checkedKeys}
                expandedKeys={expandedKeys}
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

MyFilesDialog.displayName = "MyFilesDialog";

export default MyFilesDialog;
