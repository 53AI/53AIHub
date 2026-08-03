import {
  useState,
  useRef,
  useCallback,
  forwardRef,
  useImperativeHandle,
  useMemo,
  useEffect,
} from "react";
import { Tree, Modal, Input, Tooltip, message } from "antd";
import { Dropdown } from "@km/shared-components-react";
import type { TreeProps, TreeDataNode } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useNavigate, useParams } from "react-router-dom";
import { useLibraryStore } from "@/stores/modules/library";
import { CatalogDropdown } from "./components/catalog/dropdown";
import LibraryPermission from "../components/permission/Library";
import FilePermission from "../components/permission/File";
import { PERMISSION_TYPE } from "@/components/KMPermission/constant";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import { filesApi } from "@/api/modules/files";
import { generateUniqueName } from "@/utils/uniqueName";
import "./catalog.css";

/** 重命名错误提示 — 区分文件/文件夹 */
function getRenameErrorMessage(e: any, isFile: boolean): string {
  const msg = e?.response?.data?.message || e?.message || "";
  if (msg.includes("目标路径已存在")) {
    return `${isFile ? "文件" : "文件夹"}名已存在`;
  }
  return msg || "重命名失败";
}

interface FileItem {
  id: string;
  name: string;
  path: string;
  library_id: string;
  isfile: boolean;
  isfolder: boolean;
  icon?: string;
  permission: number;
  base_path?: string;
  file_ext?: string;
  children?: FileItem[];
  [key: string]: any;
}

interface CatalogProps {
  onUpload?: (type: "file" | "folder", basePath: string) => void;
  className?: string;
}

export interface CatalogRef {
  renameFile: (data: FileItem) => void;
  createFolder: (path: string) => void;
  createMd: (path: string) => void;
  deleteFile: (data: FileItem) => Promise<void>;
  editFile: (data: FileItem) => void;
  router: (data: FileItem, query?: Record<string, any>) => void;
  newTab: (data: FileItem) => Window | null;
  filter: (keyword: string) => void;
  command: (cmd: string, data: FileItem) => void;
}

export const Catalog = forwardRef<CatalogRef, CatalogProps>(
  ({ onUpload, className }, ref) => {
    const navigate = useNavigate();
    const params = useParams<{ id: string; fid: string }>();

    // Slice selectors — 仅在订阅字段变化时触发组件重渲染，
    // 避免之前 useLibraryStore() 整库订阅导致树在 sidebar/assistant 等无关更新时连带重建。
    const files = useLibraryStore((s) => s.files);
    const currentFileId = useLibraryStore((s) => s.currentFileId);
    const expandedKeys = useLibraryStore((s) => s.expandedKeys);
    const fileViewType = useLibraryStore((s) => s.fileViewType);
    const treeFilesFn = useLibraryStore((s) => s.treeFiles);
    const setExpandedKeys = useLibraryStore((s) => s.setExpandedKeys);
    const findNodeInPath = useLibraryStore((s) => s.findNodeInPath);
    const findNodeInBasePath = useLibraryStore((s) => s.findNodeInBasePath);
    const loadFilesAll = useLibraryStore((s) => s.loadFilesAll);
    const loadFilePermissions = useLibraryStore((s) => s.loadFilePermissions);
    const renameFileAction = useLibraryStore((s) => s.rename);
    const deleteFileAction = useLibraryStore((s) => s.deleteFile);
    const createFolderAction = useLibraryStore((s) => s.createFolder);
    const createFileAction = useLibraryStore((s) => s.createFile);

    // 缓存 treeFiles —— 仅在 files 变化时重建，避免每次渲染都重跑 buildFileTree
    // biome-ignore lint/correctness/useExhaustiveDependencies: treeFilesFn 是稳定 slice 选择器但其内部通过 get() 读取最新 files；列出 files 才能在 files 变化时刷新缓存，否则 memo 会永远返回初次结果。
    const treeFiles = useMemo(() => treeFilesFn(), [treeFilesFn, files]);
    const treeRef = useRef<any>(null);
    const treeContainerRef = useRef<HTMLDivElement>(null);
    const dragExpandTimerRef = useRef<number>(0);
    // 当前拖拽悬停的文件夹 ID。
    // 用 ref 同步读用于 handleDrop 决策；用 rAF 节流后的 state 触发 buildTreeData 重建，
    // 避免每个 mouseMove 都重渲整棵树（一次拖拽有数百次 mousemove）。
    const dragOverFolderIdRef = useRef<string | null>(null);
    const dragOverRafRef = useRef<number | null>(null);
    const [dragOverFolderId, setDragOverFolderIdState] = useState<string | null>(
      null,
    );
    const setDragOverFolderId = useCallback((id: string | null) => {
      if (dragOverFolderIdRef.current === id) return;
      dragOverFolderIdRef.current = id;
      if (dragOverRafRef.current != null) return;
      dragOverRafRef.current = requestAnimationFrame(() => {
        dragOverRafRef.current = null;
        setDragOverFolderIdState(dragOverFolderIdRef.current);
      });
    }, []);
    const clearDragOverFolderId = useCallback(() => {
      dragOverFolderIdRef.current = null;
      if (dragOverRafRef.current != null) {
        cancelAnimationFrame(dragOverRafRef.current);
        dragOverRafRef.current = null;
      }
      setDragOverFolderIdState(null);
    }, []);
    const [treeHeight, setTreeHeight] = useState<number>(400);
    const [searchValue, setSearchValue] = useState("");
    const [renameModalVisible, setRenameModalVisible] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);

    // Inline editing state
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editingNodeValue, setEditingNodeValue] = useState("");
    const inlineInputRef = useRef<HTMLInputElement>(null);

    const libraryId = params.id || "";

    // Focus input when editing starts
    useEffect(() => {
      if (editingNodeId !== null) {
        setTimeout(() => {
          inlineInputRef.current?.focus();
          inlineInputRef.current?.select();
        }, 50);
      }
    }, [editingNodeId]);

    // Update tree height when container resizes
    useEffect(() => {
      const container = treeContainerRef.current;
      if (!container) return;

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          setTreeHeight(entry.contentRect.height);
        }
      });

      resizeObserver.observe(container);
      return () => resizeObserver.disconnect();
    }, []);

    // 收集目标节点在嵌套树中的祖先文件夹 id（按 root -> ... -> parent 顺序）
    // 文件夹路径索引：在 files 变化时一次性建表，让祖先查询从 O(n) 降到 O(depth)
    const folderPathIndex = useMemo(() => {
      const pathToId = new Map<string, string>();
      const idToBasePath = new Map<string, string>();
      for (const f of files) {
        if (!f.isfile) {
          pathToId.set(f.path, f.id);
          idToBasePath.set(f.id, f.base_path || "");
        }
      }
      return { pathToId, idToBasePath };
    }, [files]);

    // 当前文件被路由选中（包含刷新页面）时，展开祖先并滚动到目标节点
    // 解决"library/:id/file/:fid 刷新后目录未展开 / 未滚动到文件"的 bug
    //
    // 仅在 currentFileId 变化时触发（首次进入 / 切换文件）。
    // 数据更新（files 重载）和用户手动折叠/展开不应触发，避免打断当前视图。
    // 用 processedFileIdRef 标记"已为该目标处理过"，并在标记后再调度滚动 rAF：
    // 后续因 setExpandedKeys 触发的 effect 重跑会早返回，但已调度的 rAF 仍会执行。
    // 用 scrollGenerationRef 让过期 rAF 自废，无需 cancelAnimationFrame。
    // 记录"已为 (id, base_path) 组合处理过"。仅 id 不够：
    // 用户在 /file/X 滚动到 X 后拖拽 X 到新文件夹（base_path 变了），
    // id 不变但需要重新展开新位置的祖先并滚动。
    const processedTargetRef = useRef<{ id: string; basePath: string } | null>(
      null,
    );
    // 滚动请求的代数计数器：每次调度新滚动 +1；rAF 回调比较当前代数，过期则 no-op，
    // 避免上一次的滚动在新的 targetId 到来后还命中。
    const scrollGenerationRef = useRef(0);

    // biome-ignore lint/correctness/useExhaustiveDependencies: 反应性已通过 folderPathIndex（files 派生）覆盖，setExpandedKeys 是稳定的 zustand 选择器；刻意不直接依赖 files 与 expandedKeys：files 由 folderPathIndex 传递，expandedKeys 展开状态变化时 processedTargetRef 已护身（基于 id+basePath），加进 deps 反而每次 expand/collapse 都触发多余的 find+walk。
    useEffect(() => {
      const targetId = currentFileId;
      // currentFileId 短暂变空时【不清空】已处理记忆。
      // file/layout.tsx 会在 pathname 变化 / 组件卸载时把 currentFileId 置为 ''，
      // 随后又设回同一个 id（例如 preview↔chunks 切换、或列表数据刷新引发的重渲）。
      // 若在此处清空记忆，回到同一文件时会再次滚动，把用户已手动滚动到的位置
      // 强行拉回目标节点——表现为：滚到下方给最底部文件夹点“上传”时列表跳回最上面，
      // 且上传下拉菜单所在的虚拟列表节点被滚动卸载，导致“选择文件”弹窗无法触发。
      // 真正切到不同文件（id 变化）仍会滚动；文件被拖拽移动（base_path 变化）仍会重新定位。
      if (!targetId) return;
      // 数据未就绪：等待 files 变化后再次触发
      if (!files || files.length === 0) return;

      const target = files.find((f) => f.id === targetId);
      if (!target) return;
      const targetBasePath = target.base_path || "";

      // 已为该 (id, basePath) 组合处理过：跳过。basePath 变化（文件被移动）会重做。
      const processed = processedTargetRef.current;
      if (processed?.id === targetId && processed?.basePath === targetBasePath)
        return;

      // O(depth) 向上爬：target.base_path → 父文件夹 id → 父.base_path → ...
      const { pathToId, idToBasePath } = folderPathIndex;
      const ancestors: string[] = [];
      let parentPath = targetBasePath;
      let hops = 0;
      while (parentPath && hops < 512) {
        const fid = pathToId.get(parentPath);
        if (!fid) break;
        ancestors.push(fid);
        parentPath = idToBasePath.get(fid) || "";
        hops++;
      }

      // 合并到现有 expandedKeys（仅追加缺失项，幂等不破坏用户状态）
      if (ancestors.length > 0) {
        const missing = ancestors.filter((id) => !expandedKeys.includes(id));
        if (missing.length > 0) {
          setExpandedKeys([...expandedKeys, ...missing]);
        }
      }

      // 关键：先标记已处理，再调度滚动，避免后续 effect 重跑重复处理
      // 记录 (id, basePath)：basePath 变了（文件被移动）会触发重新处理
      processedTargetRef.current = { id: targetId, basePath: targetBasePath };

      // 替代原 setTimeout(120) 魔数：用 rAF 等到下一帧 DOM 提交后调用 scrollTo。
      // rc-tree 的虚拟列表在 commit 后还可能做内部测量布局，所以加一个重试兜底
      // （最多 5 帧 ≈ 80ms @ 60fps，比旧 120ms 紧；最终失败时 warn 暴露问题）。
      // 用 scrollGenerationRef 让过期 rAF 自废，无需 cancelAnimationFrame。
      const scheduledKey = targetId;
      const generation = ++scrollGenerationRef.current;
      const maxScrollAttempts = 5;
      const tryScroll = (attempts: number): void => {
        if (scrollGenerationRef.current !== generation) return;
        try {
          treeRef.current?.scrollTo?.({
            key: scheduledKey,
            align: "auto",
          });
        } catch (err) {
          if (attempts < maxScrollAttempts) {
            requestAnimationFrame(() => tryScroll(attempts + 1));
          } else {
            console.warn(
              `[catalog] scrollTo ${maxScrollAttempts} 帧内未命中，放弃 key=${scheduledKey}`,
              err,
            );
          }
        }
      };
      requestAnimationFrame(() => tryScroll(1));
    }, [currentFileId, folderPathIndex]);

    // 卸载时清理挂起的 rAF（拖拽悬停）
    useEffect(() => {
      return () => {
        // 滚动 rAF 无需显式取消：scrollGenerationRef 已让过期回调 no-op
        if (dragOverRafRef.current != null) {
          cancelAnimationFrame(dragOverRafRef.current);
          dragOverRafRef.current = null;
        }
      };
    }, []);

    // Start inline editing
    const startInlineEdit = useCallback(
      (nodeId: string, currentName: string) => {
        setEditingNodeId(nodeId);
        setEditingNodeValue(currentName);
      },
      [],
    );

    // Stop inline editing
    const stopInlineEdit = useCallback(() => {
      setEditingNodeId(null);
      setEditingNodeValue("");
    }, []);

    // Handle inline edit save
    const handleInlineEditSave = useCallback(
      async (data: FileItem, newName: string) => {
        // 过滤掉 / 字符
        const sanitized = newName.replace(/\//g, "");
        const realExt = data.isfile
          ? data.file_ext === "md"
            ? ""
            : "." + data.file_ext
          : "";
        const fullName = data.isfile ? `${sanitized}${realExt}.md` : sanitized;
        const newPath = `${data.base_path}/${fullName}`;

        if (data.path === newPath) {
          stopInlineEdit();
          return;
        }

        // Check for duplicate names：在归一化的显示名空间里做去重
        const siblings = findNodeInBasePath(data.base_path, treeFiles);
        const isDuplicate = siblings.some(
          (item) => item.id !== data.id && item.name === fullName,
        );

        let finalName = fullName;
        if (isDuplicate) {
          // baseName = 去除 realExt 后的显示名（与 existingNames 空间一致）
          const baseName = data.isfile ? newName.replace(realExt, "") : newName;
          const existingDisplayNames = siblings
            .filter((item) => item.id !== data.id)
            .map((item) =>
              data.isfile
                ? item.name.replace(".md", "").replace(realExt, "")
                : item.name,
            );
          const uniqueBase = generateUniqueName(baseName, existingDisplayNames);
          finalName = data.isfile ? `${uniqueBase}${realExt}.md` : uniqueBase;
        }

        const finalPath = `${data.base_path}/${finalName}`;
        try {
          await renameFileAction(data.id, finalPath);
          loadFilesAll();
          stopInlineEdit();
        } catch (e: any) {
          message.error(getRenameErrorMessage(e, data.isfile));
          // 关闭内联编辑模式，tree 节点会从 store 中读取原始名称
          stopInlineEdit();
        }
      },
      [
        renameFileAction,
        loadFilesAll,
        findNodeInBasePath,
        stopInlineEdit,
        treeFiles,
      ],
    );

    // Navigate to file/folder
    const fileRouteNavigate = useCallback(
      (data: FileItem, view?: string, query?: Record<string, any>) => {
        const routeName = data.isfile
          ? view === "edit"
            ? `/library/${libraryId}/file/${data.id}/chunks-edit`
            : view === "chunks"
              ? `/library/${libraryId}/file/${data.id}/chunks`
              : `/library/${libraryId}/file/${data.id}`
          : `/library/${libraryId}/folder/${data.id}`;

        navigate(
          routeName +
            (query ? `?${new URLSearchParams(query).toString()}` : ""),
        );
      },
      [navigate, libraryId],
    );

    const handleEditFile = useCallback(
      (data: FileItem) => {
        fileRouteNavigate(data, "edit");
      },
      [fileRouteNavigate],
    );

    const handleView = useCallback(
      (data: FileItem, query?: Record<string, any>) => {
        const view =
          fileViewType === "chunk" ? "chunks" : undefined;
        fileRouteNavigate(data, view, query);
      },
      [fileRouteNavigate, fileViewType],
    );

    // Refresh parent node
    // 用 getState() 读最新 expandedKeys，避免 deps 含 expandedKeys 击穿下游 useMemo 链。
    const refreshParentNode = useCallback(
      (path: string) => {
        const { expandedKeys: currentKeys, setExpandedKeys: setKeys } =
          useLibraryStore.getState();
        const currentExpandedKeys = [...currentKeys];
        loadFilesAll().then(() => {
          setKeys(currentExpandedKeys);
        });
      },
      [loadFilesAll],
    );

    // Create folder with unique name
    const createFolder = useCallback(
      (path: string) => {
        const nodes = findNodeInBasePath(path, treeFiles);
        const existingNames = nodes.map((item) => item.name);
        const name = generateUniqueName("无标题文件夹", existingNames);
        createFolderAction({ name, path }).then((res: any) => {
          // Save current expanded state via getState() 读最新值
          const { expandedKeys: currentKeys, setExpandedKeys: setKeys } =
            useLibraryStore.getState();
          const currentExpandedKeys = [...currentKeys];
          loadFilesAll().then(() => {
            // Restore expanded state
            setKeys(currentExpandedKeys);
            // Start inline editing for the new folder
            setTimeout(() => {
              startInlineEdit(res.id, name);
            }, 100);
          });
        });
      },
      [
        createFolderAction,
        findNodeInBasePath,
        loadFilesAll,
        startInlineEdit,
        treeFiles,
      ],
    );

    // Create MD file with unique name
    const createMd = useCallback(
      (path: string) => {
        const nodes = findNodeInBasePath(path, treeFiles);
        // 在归一化的显示名空间（无 .md）里做去重
        const existingNames = nodes.map((item) => item.name.replace(".md", ""));
        const baseName = generateUniqueName("无标题知识", existingNames);
        const name = `${baseName}.md`;
        createFileAction({ name, path, permissions: [] })
          .then((res: any) => {
            // Save current expanded state via getState() 读最新值
            const { expandedKeys: currentKeys, setExpandedKeys: setKeys } =
              useLibraryStore.getState();
            const currentExpandedKeys = [...currentKeys];
            loadFilesAll().then(() => {
              // Restore expanded state
              setKeys(currentExpandedKeys);
              // Start inline editing for the new file
              setTimeout(() => {
                startInlineEdit(res.id, baseName);
              }, 100);
            });
          });
      },
      [
        createFileAction,
        findNodeInBasePath,
        loadFilesAll,
        startInlineEdit,
        treeFiles,
      ],
    );

    // Rename file/folder - open modal
    const openRenameModal = useCallback((data: FileItem) => {
      const realExt = data.file_ext === "md" ? "" : "." + data.file_ext;
      const currentName = data.isfile
        ? data.name.replace(realExt || ".md", "")
        : data.name;
      setRenamingFile(data);
      setRenameValue(currentName);
      setRenameModalVisible(true);
    }, []);

    // Handle rename confirmation
    const handleRenameConfirm = useCallback(() => {
      if (!renamingFile || !renameValue.trim()) return;

      // 过滤掉 / 字符
      const sanitized = renameValue.replace(/\//g, "");
      const realExt =
        renamingFile.file_ext === "md" ? "" : "." + renamingFile.file_ext;
      const fullName = renamingFile.isfile
        ? `${sanitized}${realExt}.md`
        : sanitized;
      const newPath = `${renamingFile.base_path}/${fullName}`;

      if (renamingFile.path === newPath) {
        setRenameModalVisible(false);
        return;
      }

      renameFileAction(renamingFile.id, newPath)
        .then(() => {
          loadFilesAll();
          setRenameModalVisible(false);
        })
        .catch((e: any) => {
          message.error(getRenameErrorMessage(e, renamingFile.isfile));
        });
    }, [renamingFile, renameValue, renameFileAction, loadFilesAll]);

    // Delete file/folder
    const deleteFile = useCallback(
      async (data: FileItem) => {
        const confirmMessage = data.isfolder
          ? t("status.files_del")
          : t("status.file_del");

        Modal.confirm({
          title: t("common.tip"),
          content: confirmMessage,
          okText: t("action.confirm"),
          cancelText: t("action.cancel"),
          onOk: async () => {
            await deleteFileAction(data);
            if (currentFileId === data.id) {
              // Check if there's a parent folder
              if (data.base_path) {
                // Find parent folder
                const parentFolder = findNodeInPath(
                  data.base_path,
                  treeFiles,
                );
                if (parentFolder) {
                  // Navigate to parent folder page
                  navigate({
                    pathname: `/library/${libraryId}/folder/${parentFolder.id}`,
                  });
                  return;
                }
              }
              // No parent folder, navigate to home
              navigate(`/library/${libraryId}`);
            }
          },
        });
      },
      [
        deleteFileAction,
        currentFileId,
        treeFiles,
        findNodeInPath,
        navigate,
        libraryId,
      ],
    );

    // Handle command from dropdown
    const handleCommand = useCallback(
      (command: string) => {
        switch (command) {
          case "create_md":
            createMd("");
            break;
          case "create_folder":
            createFolder("");
            break;
          case "upload_file":
            onUpload?.("file", "");
            break;
          case "upload_folder":
            onUpload?.("folder", "");
            break;
        }
        document.body.click();
      },
      [createMd, createFolder, onUpload],
    );

    // Handle tree node command
    const handleTreeCommand = useCallback(
      (command: string, data: FileItem) => {
        switch (command) {
          case "rename":
            openRenameModal(data);
            break;
          case "delete":
            deleteFile(data);
            break;
        }
      },
      [openRenameModal, deleteFile],
    );

    // Handle folder command
    // 用 getState() 读最新 expandedKeys，避免 deps 含 expandedKeys 击穿下游 useMemo 链。
    const handleFolderCommand = useCallback(
      (command: string, data: FileItem) => {
        // Auto-expand the folder if it's not already expanded
        const { expandedKeys: currentKeys, setExpandedKeys: setKeys } =
          useLibraryStore.getState();
        if (data.isfolder && !currentKeys.includes(data.id)) {
          setKeys([...currentKeys, data.id]);
        }

        switch (command) {
          case "create_md":
            createMd(data.path);
            break;
          case "create_folder":
            createFolder(data.path);
            break;
          case "upload_file":
            onUpload?.("file", data.path);
            break;
          case "upload_folder":
            onUpload?.("folder", data.path);
            break;
        }
      },
      [createMd, createFolder, onUpload],
    );

    // Handle mouse enter to load permissions
    const handleMouseEnter = useCallback(
      (data: FileItem) => {
        loadFilePermissions(data.id);
      },
      [loadFilePermissions],
    );

    // Sort files - accepts array of file ids and their sort values
    const sortFilesByIds = useCallback(
      async (fileIds: string[], basePath: string) => {
        await filesApi.sort({
          files: fileIds.map((id, index) => ({
            id,
            sort: index + 2,
          })),
        });
      },
      [],
    );

    // Get siblings at a path (files at the same level)
    const getSiblingsAtPath = useCallback(
      (basePath: string): FileItem[] => {
        if (basePath === "") {
          return treeFiles;
        }
        const parent = findNodeInPath(basePath, treeFiles);
        return parent?.children || [];
      },
      [treeFiles, findNodeInPath],
    );

    // Handle node drop
    // Ant Design Tree onDrop parameters:
    // - dropToGap: boolean - true if dropped in gap, false if dropped inside
    // - dropPosition: -1 | 0 | 1 - -1: above, 0: inside, 1: below
    const handleDrop: TreeProps["onDrop"] = async (info) => {
      const { node: dropNode, dragNode, dropPosition, dropToGap } = info;

      const dropData = dropNode as any;
      const dragData = dragNode as any;

      // Get file data from store
      const dragFile = files.find((f) => f.id === dragData.key);
      const dropFile = files.find((f) => f.id === dropData.key);

      if (!dragFile || !dropFile) return;

      // 判断是否应该放入文件夹内部：
      // 1. Ant Design 认为是内部放置 (dropToGap=false)
      // 2. 或者我们检测到鼠标在文件夹中心区域 (dragOverFolderIdRef === dropFile.id)
      const shouldDropInside =
        !dropToGap ||
        (dropFile.isfolder && dragOverFolderIdRef.current === dropFile.id);

      if (shouldDropInside) {
        // Drop inside a folder (become child of dropNode)
        const newPath = `${dropFile.path}/${dragFile.name}${dragFile.isfile ? ".md" : ""}`;
        await renameFileAction(dragFile.id, newPath);

        // Wait for files state to refresh before sorting
        await loadFilesAll();

        // Sort the children of target folder
        const children = getSiblingsAtPath(dropFile.path);
        const childIds = [...children.map((f) => f.id), dragFile.id];
        await sortFilesByIds(childIds, dropFile.path);

        // Expand the target folder
        if (!expandedKeys.includes(dropFile.id)) {
          setExpandedKeys([
            ...expandedKeys,
            dropFile.id,
          ]);
        }
      } else {
        // Drop in gap (before or after dropNode)
        // dropPosition: -1 = before, 1 = after
        const targetBasePath = dropFile.base_path;

        // First, move to the target directory if cross-level
        const isSameLevel = dragFile.base_path === dropFile.base_path;
        if (!isSameLevel) {
          const newPath = `${targetBasePath}/${dragFile.name}${dragFile.isfile ? ".md" : ""}`;
          await renameFileAction(dragFile.id, newPath);
          // Wait for files state to refresh before sorting
          await loadFilesAll();
        }

        // Get siblings at target level and calculate new order
        const siblings = getSiblingsAtPath(targetBasePath);
        const siblingIds = siblings.map((f) => f.id);

        // Remove dragged item from current position if same level
        if (isSameLevel) {
          const dragIdx = siblingIds.indexOf(dragFile.id);
          if (dragIdx !== -1) {
            siblingIds.splice(dragIdx, 1);
          }
        }

        // Find position of drop target in the list
        const dropIdx = siblingIds.indexOf(dropFile.id);
        if (dropIdx !== -1) {
          // Insert at correct position
          // dropPosition = -1: insert BEFORE dropFile (at dropIdx)
          // dropPosition = 1: insert AFTER dropFile (at dropIdx + 1)
          const insertIdx = dropPosition === -1 ? dropIdx : dropIdx + 1;
          siblingIds.splice(insertIdx, 0, dragFile.id);
          await sortFilesByIds(siblingIds, targetBasePath);
        }
      }

      // Clear drag over state（同时取消挂起的 rAF，避免视觉遗留）
      clearDragOverFolderId();

      // Refresh to show changes
      refreshParentNode("");
    };

    // Handle drag enter - auto expand folder when hovering
    const onDragEnter: TreeProps["onDragEnter"] = (info) => {
      const nodeData = info.node as any;
      const fileData = files.find((f) => f.id === nodeData.key);

      // Clear any existing timer
      clearTimeout(dragExpandTimerRef.current);

      // Set drag over folder for visual feedback
      if (fileData && fileData.isfolder) {
        setDragOverFolderId(fileData.id);
      }

      // Auto-expand folder after short delay when dragging over it
      if (
        fileData &&
        fileData.isfolder &&
        !expandedKeys.includes(fileData.id)
      ) {
        dragExpandTimerRef.current = window.setTimeout(() => {
          if (!expandedKeys.includes(fileData.id)) {
            setExpandedKeys([
              ...expandedKeys,
              fileData.id,
            ]);
          }
        }, 500);
      }
    };

    // Handle drag leave - clear expand timer and drag over state
    const onDragLeave: TreeProps["onDragLeave"] = (info) => {
      clearTimeout(dragExpandTimerRef.current);
      // 检查 ref（同步），避免视觉遗留。离开时清掉 ref + 取消挂起的 rAF。
      const nodeData = info.node as any;
      if (nodeData.key === dragOverFolderIdRef.current) {
        clearDragOverFolderId();
      }
    };

    // Handle drag end - clear drag over state
    const onDragEnd: TreeProps["onDragEnd"] = () => {
      clearDragOverFolderId();
    };

    // Allow drop check
    // Ant Design Tree allowDrop: returns true to allow drop, false to deny
    // options: { dragNode, dropNode, dropPosition } where dropPosition: -1 | 0 | 1
    // -1: drop in gap ABOVE, 0: drop INSIDE, 1: drop in gap BELOW
    const allowDrop: TreeProps["allowDrop"] = ({
      dropNode,
      dropPosition,
      dragNode,
    }) => {
      const nodeData = dropNode as any;
      const dragData = dragNode as any;

      // dropPosition === 0 means dropping INSIDE the node
      if (dropPosition === 0) {
        // Check if target node is a folder by looking up in our data
        const fileData = files.find((f) => f.id === nodeData.key);
        // Only allow dropping inside folders (isfolder=true), not files
        return !!(fileData && fileData.isfolder);
      }
      return true;
    };

    // Handle node title click - custom expand/navigate logic
    const handleNodeTitleClick = useCallback(
      (file: FileItem, e: React.MouseEvent) => {
        e.stopPropagation();

        if (file.isfolder) {
          // Check if folder is expanded
          const isExpanded = expandedKeys.includes(file.id);
          if (!isExpanded) {
            // Folder not expanded - expand it (don't navigate)
            setExpandedKeys([
              ...expandedKeys,
              file.id,
            ]);
          } else {
            // Folder already expanded - navigate to folder page
            handleView(file);
          }
        } else {
          // File - navigate to file page
          handleView(file);
        }
      },
      [expandedKeys, setExpandedKeys, handleView],
    );

    // 注：不在 onSelect 中处理导航 —— 让 handleNodeTitleClick 负责，
    // 否则 AntD Tree 的选中 + 自定义点击会触发双重跳转。

    const onExpand: TreeProps["onExpand"] = (expandedKeys, info) => {
      const nodeData = info.node as any;
      // 文件树扁平顺序下用 find 直查节点 —— O(n) 但仅在折叠/展开时触发
      const file = files.find((f) => f.id === nodeData.key);

      if (info.expanded) {
        // Node expanded - add to expanded keys
        setExpandedKeys(expandedKeys as string[]);
      } else {
        // Node collapsed - remove all children keys recursively
        if (file && file.isfolder) {
          // Get all descendant IDs
          const getAllChildIds = (node: FileItem): string[] => {
            const ids: string[] = [];
            if (node.children) {
              for (const child of node.children) {
                ids.push(child.id);
                ids.push(...getAllChildIds(child));
              }
            }
            return ids;
          };

          const childIds = getAllChildIds(file);
          const filteredKeys = (expandedKeys as string[]).filter(
            (key) => !childIds.includes(key),
          );
          setExpandedKeys(filteredKeys);
        } else {
          setExpandedKeys(expandedKeys as string[]);
        }
      }
    };

    // Filter tree by keyword
    const filter = useCallback((keyword: string) => {
      setSearchValue(keyword);
      // Ant Design Tree doesn't have built-in filter, we'd need to implement custom filtering
      // For now, just store the search value
    }, []);

    // Expose methods via ref
    useImperativeHandle(ref, () => ({
      renameFile: openRenameModal,
      createFolder,
      createMd,
      deleteFile,
      editFile: handleEditFile,
      router: handleView,
      newTab: (data: FileItem) => {
        const url = buildUrl(
          `/library/${libraryId}/${data.isfile ? "file" : "folder"}/${data.id}`,
        );
        return window.open(url, "_blank");
      },
      filter,
      command: handleFolderCommand,
    }));

    // Build tree data from already-structured tree files
    const buildTreeData = useCallback(
      (treeFiles: FileItem[]): TreeDataNode[] => {
        const processNode = (file: FileItem): TreeDataNode => {
          const isEditing = editingNodeId === file.id;

          return {
            key: file.id,
            title: (
              <div
                className={`catalog-tree-node group${dragOverFolderId === file.id && file.isfolder ? " drag-over-folder" : ""}`}
                onMouseEnter={() => handleMouseEnter(file)}
                onClick={(e) => handleNodeTitleClick(file, e)}
                onDragOver={(e) => {
                  // 仅���节点中心区域设置蓝色背景（用于放入文件夹）
                  // 边缘区域（上方/下方 8px）不触发，保持间隙排序行为
                  if (file.isfolder) {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const y = e.clientY - rect.top;
                    const edgeThreshold = 8;
                    const inCenter =
                      y > edgeThreshold && y < rect.height - edgeThreshold;
                    // 内部去重 + rAF 节流，调用成本低
                    setDragOverFolderId(inCenter ? file.id : null);
                  }
                }}
              >
                <div className="flex-none size-5 flex items-center">
                  <img className="size-4" src={file.icon} alt="" />
                </div>
                {isEditing ? (
                  <input
                    ref={inlineInputRef}
                    value={editingNodeValue}
                    onChange={(e) => setEditingNodeValue(e.target.value)}
                    className="text-sm text-[#1D1E1F] px-1 py-0.5 border rounded outline-none bg-white inline-edit-input"
                    style={{ borderColor: "rgba(50, 150, 250, 1)" }}
                    onBlur={() => handleInlineEditSave(file, editingNodeValue)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        stopInlineEdit();
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        handleInlineEditSave(file, editingNodeValue);
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <Tooltip
                    title={file.name}
                    placement="right"
                    styles={{ root: { marginLeft: "28px" } }}
                  >
                    <p className="flex-1 min-w-0 text-sm text-[#1D1E1F] truncate">
                      {file.name}
                    </p>
                  </Tooltip>
                )}
                {file.permission >= PERMISSION_TYPE.viewer && !isEditing && (
                  <div
                    className="node-actions hidden group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                    }}
                  >
                    <FilePermission
                      permission={file.permission}
                      resource={file}
                      required={PERMISSION_TYPE.edit_knowledge}
                    >
                      <Dropdown
                        menu={{
                          items: [
                            {
                              key: "rename",
                              label: t("action.rename"),
                            },
                            {
                              key: "delete",
                              label: t("action.del"),
                              danger: true,
                            },
                          ],
                          onClick: ({ key }) => handleTreeCommand(key, file),
                        }}
                        trigger={["click"]}
                        placement="bottomRight"
                      >
                        <span
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                          }}
                          className="action-btn"
                        >
                          <SvgIcon name="more-h" size={16} />
                        </span>
                      </Dropdown>
                    </FilePermission>

                    {file.isfolder && (
                      <FilePermission
                        permission={file.permission}
                        resource={file}
                        required={PERMISSION_TYPE.edit_knowledge}
                      >
                        <CatalogDropdown
                          filter="all"
                          onCreateMd={() => createMd(file.path)}
                          onCreateFolder={() => createFolder(file.path)}
                          onUploadFile={() => onUpload?.("file", file.path)}
                          onUploadFolder={() => onUpload?.("folder", file.path)}
                        >
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                            }}
                            className="action-btn"
                          >
                            <SvgIcon name="plus" size={16} />
                          </span>
                        </CatalogDropdown>
                      </FilePermission>
                    )}
                  </div>
                )}
              </div>
            ),
            isLeaf: file.isfile,
            // Ensure folders always have children array (even empty) so Tree recognizes them as expandable
            children: file.isfolder
              ? file.children?.map((child) => processNode(child)) || []
              : undefined,
          };
        };

        return treeFiles.map((file) => processNode(file));
      },
      [
        editingNodeId,
        editingNodeValue,
        dragOverFolderId,
        setDragOverFolderId,
        stopInlineEdit,
        handleMouseEnter,
        handleInlineEditSave,
        handleTreeCommand,
        createMd,
        createFolder,
        onUpload,
        handleNodeTitleClick,
      ],
    );

    const treeData = useMemo(
      () => buildTreeData(treeFiles),
      [treeFiles, buildTreeData],
    );

    return (
      <div className={`py-4 flex flex-col h-full ${className || ""}`}>
        {/* Header */}
        <div className="flex-none px-4 flex items-center gap-2 mb-1">
          <div className="flex-1 text-xs text-[#4F5052]">
            {t("common.catalog")}
          </div>

          <LibraryPermission required={PERMISSION_TYPE.edit_knowledge}>
            <CatalogDropdown onCommand={handleCommand}>
              <div className="size-5 flex items-center justify-center rounded cursor-pointer hover:bg-[#F2F2F2]">
                <SvgIcon name="plus" size={16} />
              </div>
            </CatalogDropdown>
          </LibraryPermission>
        </div>

        {/* Tree */}
        <div
          ref={treeContainerRef}
          className="flex-1 px-4 overflow-x-hidden overflow-hidden relative"
        >
          {treeData.length > 0 ? (
            <Tree
              ref={treeRef}
              blockNode
              virtual
              height={treeHeight}
              itemHeight={36}
              // 关闭 rc-tree 的可聚焦 input：避免在用户操作节点上的 + / 下拉菜单时，
              // 焦点回落到树隐藏 input 触发 onFocus → onActiveChange(visibleSelectedKey) →
              // scrollTo(当前选中节点)，把用户已手动滚到的位置强行拉回最上面。
              // 导航通过 onClick(handleNodeTitleClick) 完成，不需要键盘焦点；拖拽与鼠标交互不受影响。
              focusable={false}
              treeData={treeData}
              selectedKeys={
                currentFileId ? [currentFileId] : []
              }
              expandedKeys={expandedKeys}
              onExpand={onExpand}
              expandAction={false}
              draggable={{
                icon: false,
                nodeDraggable: (node) => {
                  return !editingNodeId;
                },
              }}
              onDrop={handleDrop}
              allowDrop={allowDrop}
              onDragEnter={onDragEnter}
              onDragLeave={onDragLeave}
              onDragEnd={onDragEnd}
              className="library-documents-tree"
              style={{
                "--ant-tree-title-height": "34px",
                "--ant-tree-indent-size": "12px",
                "--ant-tree-switcher-size": "12px",
              }}
            />
          ) : (
            <div className="catalog-empty">
              <div className="catalog-empty-icon">
                <SvgIcon name="inside-share" size={80} className="!size-20" />
              </div>
              <p className="catalog-empty-text">
                暂无内容，点击{" "}
                <SvgIcon name="plus" size={14} className="mx-1" /> 新建
              </p>
            </div>
          )}
        </div>

        {/* Rename Modal */}
        <Modal
          open={renameModalVisible}
          title={t("action.rename")}
          onOk={handleRenameConfirm}
          onCancel={() => setRenameModalVisible(false)}
          okText={t("action.confirm")}
          cancelText={t("action.cancel")}
        >
          <div className="py-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder={
                renamingFile?.isfile
                  ? t("common.file_name")
                  : t("common.files_name")
              }
              onPressEnter={handleRenameConfirm}
            />
          </div>
        </Modal>
      </div>
    );
  },
);

export default Catalog;
