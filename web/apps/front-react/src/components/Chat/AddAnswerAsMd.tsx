import {
  useState,
  useImperativeHandle,
  forwardRef,
  useRef,
  useCallback,
} from "react";
import {
  Modal,
  Button,
  Radio,
  Input,
  Tree,
  Empty,
  Spin,
  message,
} from "antd";
import type { TreeDataNode } from "antd";
import {
  CheckOutlined,
  CloseOutlined,
  FolderOutlined,
  FileOutlined,
} from "@ant-design/icons";
import spacesApi, { type SpaceItem } from "@/api/modules/spaces";
import librariesApi, { type LibraryItem } from "@/api/modules/libraries";
import filesApi, { type RawFileItem } from "@/api/modules/files";
import chunksApi from "@/api/modules/chunks";
import fileBodiesApi from "@/api/modules/file-bodies";
import permissionsApi from "@/api/modules/permissions";
import {
  PERMISSION_TYPE,
  RESOURCE_TYPE,
} from "@/components/KMPermission/constant";
import {
  generateUniqueFileName,
  generateUniqueFolderName,
  cacheManager,
} from "@km/shared-utils";
import { useLibraryStore } from "@/stores";
import { buildUrl } from "@/utils/router";
import { t } from "@/locales";
import { getPublicPath } from "@/utils/config";

// Types
interface CheckedFileItem {
  id: string;
  name: string;
  path: string;
  type: number;
  library_id: string;
  eid: number;
  sort: number;
  created_time: number;
  updated_time: number;
  upload_file_id: number;
  parse_type: string;
  last_body_time: number;
  ai_generate_chunk_status: number;
  questions: string;
  summary: string;
  upload_file: { size: number; filename: string } | null;
  is_favorite: boolean;
  cleaning_rule_info: string;
  isfolder: boolean;
  isfile: boolean;
  base_path: string;
  file_ext: string;
  file_mime: string;
  icon: string;
  file_url: string;
  file_type: string;
  permission: number;
  created_at: string;
  updated_at: string;
  updated_date: string;
  children: CheckedFileItem[];
  checked: boolean;
  isEditing: boolean;
}

interface AddAnswerAsMdProps {
  onConfirm?: () => void;
}

export interface AddAnswerAsMdRef {
  open: (data: { answer: string; question: string }) => void;
}

const defaultCheckedFile: Partial<CheckedFileItem> = {
  id: "",
  sort: 0,
  path: "",
  type: 0,
  library_id: "",
  eid: 0,
  created_time: 0,
  updated_time: 0,
  upload_file_id: 0,
  parse_type: "",
  last_body_time: 0,
  ai_generate_chunk_status: 0,
  questions: "",
  summary: "",
  upload_file: null,
  is_favorite: false,
  name: "",
  isfolder: false,
  isfile: false,
  base_path: "",
  file_type: "",
  file_ext: "",
  file_url: "",
  created_at: "",
  icon: "",
  updated_at: "",
  updated_date: "",
  permission: PERMISSION_TYPE.viewer,
  children: [],
  checked: false,
  isEditing: false,
};

// Helper functions
const formatFileInfo = (
  fileName: string,
  isfolder: boolean = false,
): { ext: string; mime: string; fname: string; icon: string } => {
  let file_ext = "";
  let file_mime = "";
  let file_name = fileName?.split("/")?.pop() || "";
  let displayName = file_name;
  if (!isfolder) {
    const parts = file_name.split(".");
    if (parts.length >= 2) {
      file_ext = parts.slice(-1)[0] || "";
      displayName = parts.slice(0, -1).join(".");
    }
  } else {
    file_ext = "folder";
    displayName = fileName;
  }
  return {
    ext: file_ext,
    mime: file_mime,
    fname: displayName,
    icon: getPublicPath(`/images/file/${file_mime || "folder"}.png`),
  };
};

const formatFile = (file: RawFileItem): CheckedFileItem => {
  const base_path = file.path.split("/").slice(0, -1).join("/");
  const isfolder = file.type === 0;
  const { ext, mime, fname, icon } = formatFileInfo(
    file.path.split("/").pop() || "",
    isfolder,
  );
  return {
    ...file,
    name: fname,
    isfolder,
    isfile: !isfolder,
    base_path,
    file_ext: ext,
    file_mime: mime,
    permission: PERMISSION_TYPE.loading,
    file_type: isfolder ? "folder" : "file",
    icon,
    file_url: "",
    created_at: new Date(file.created_time * 1000).toLocaleString(),
    updated_at: new Date(file.updated_time * 1000).toLocaleString(),
    updated_date: new Date(file.updated_time * 1000).toLocaleDateString(),
    children: [],
    checked: false,
    isEditing: false,
  };
};

const buildFileTree = (files: CheckedFileItem[]): CheckedFileItem[] => {
  const map = new Map<string, CheckedFileItem>();
  const roots: CheckedFileItem[] = [];

  files.forEach((file) => {
    map.set(file.id, { ...file, children: [] });
  });

  files.forEach((file) => {
    const node = map.get(file.id)!;
    if (file.base_path) {
      const parent = files.find((f) => f.path === file.base_path);
      if (parent && map.has(parent.id)) {
        map.get(parent.id)!.children!.push(node);
      } else {
        roots.push(node);
      }
    } else {
      roots.push(node);
    }
  });

  return roots;
};

export const AddAnswerAsMd = forwardRef<AddAnswerAsMdRef, AddAnswerAsMdProps>(
  ({ onConfirm }, ref) => {
    const [visible, setVisible] = useState(false);
    const [spaceList, setSpaceList] = useState<SpaceItem[]>([]);
    const [libraryList, setLibraryList] = useState<LibraryItem[]>([]);
    const [folderTree, setFolderTree] = useState<CheckedFileItem[]>([]);
    const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
    const [loading, setLoading] = useState({
      space: false,
      library: false,
      folder: false,
    });
    const [state, setState] = useState({
      spaceId: "",
      libraryId: "",
      fileId: "",
      selectRoot: true,
      content: "",
      question: "",
      creating: false,
      selectedFolderPath: "",
      lastSelectedFolderPath: "",
    });
    const folderTreeRef = useRef<any>(null);
    const newFolderInputRef = useRef<any>(null);

    const libraryStore = useLibraryStore();

    const curLibrary =
      libraryList.find((item) => item.id === state.libraryId) || null;
    const confirmBtnDisabled =
      !state.libraryId || (!state.selectRoot && !state.selectedFolderPath);

    useImperativeHandle(ref, () => ({
      open: async (data: { answer: string; question: string }) => {
        setVisible(true);
        // 过滤掉技能执行过程的 skill-run 代码块，只保留实际内容
        let content = data.answer;
        // 移除 skill-run 代码块
        content = content.replace(/```skill-run\n[\s\S]*?\n```\n?/g, '');
        // 移除可能存在的 reasoning 代码块（技能推理过程）
        content = content.replace(/```reasoning\n[\s\S]*?\n```\n?/g, '');
        // 清理开头多余的空行
        content = content.trim();
        setState((prev) => ({
          ...prev,
          content: content,
          question: data.question,
          spaceId: "",
          libraryId: "",
          selectRoot: true,
          selectedFolderPath: "",
          lastSelectedFolderPath: "",
        }));
        setLibraryList([]);
        setFolderTree([]);
        setExpandedKeys([]);
        const list = await loadSpaceList();
        if (list && list.length > 0) {
          handleSelectSpace(list[0]);
        }
      },
    }));

    const loadSpaceList = async () => {
      setLoading((prev) => ({ ...prev, space: true }));
      try {
        const res = await cacheManager.getOrFetch("spaces_list", () => {
          return spacesApi.list({
            status: 0,
            limit: 100,
            offset: 0,
            view: "user",
          });
        });
        const privateSpaces = res.spaces.filter((item) => !item.visibility);
        let permissionMap: Record<string, number> = {};
        if (privateSpaces.length > 0) {
          permissionMap = await permissionsApi.myBatch({
            resource_type: RESOURCE_TYPE.space,
            resource_ids: privateSpaces.map((item) => item.id),
          });
        }
        const newList: SpaceItem[] = res.spaces.filter((item) => {
          if (item.visibility) return true;
          const key = `${RESOURCE_TYPE.space}:${item.id}`;
          return permissionMap[key] >= PERMISSION_TYPE.viewer;
        });
        setSpaceList(newList);
        return newList;
      } finally {
        setLoading((prev) => ({ ...prev, space: false }));
      }
    };

    const loadLibraryList = async (spaceId: string) => {
      setLoading((prev) => ({ ...prev, library: true }));
      try {
        const list = await cacheManager.getOrFetch(
          `libraries_list_${spaceId}`,
          () => {
            return librariesApi.list({
              space_id: spaceId,
              get_recently: 0,
              limit: 100,
            });
          },
        );
        if (list.length === 0) {
          setLibraryList([]);
          return [];
        }
        const permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.library,
          resource_ids: list.map((item) => item.id),
        });
        const newList: LibraryItem[] = list.filter((item) => {
          const key = `${RESOURCE_TYPE.library}:${item.id}`;
          return permissionMap[key] >= PERMISSION_TYPE.edit_knowledge;
        });
        setLibraryList(newList);
        return newList;
      } finally {
        setLoading((prev) => ({ ...prev, library: false }));
      }
    };

    const loadFoldersAll = async (libraryId: string) => {
      setLoading((prev) => ({ ...prev, folder: true }));
      try {
        const list = await filesApi.all({ library_id: libraryId });
        const folders = list.filter((item) => item.type === 0);
        if (folders.length === 0) {
          setFolderTree([]);
          setExpandedKeys([]);
          return;
        }
        const permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.file,
          resource_ids: folders.map((item) => item.id),
        });
        const newList: CheckedFileItem[] = folders
          .filter((item) => {
            const key = `${RESOURCE_TYPE.file}:${item.id}`;
            return permissionMap[key] >= PERMISSION_TYPE.viewer;
          })
          .map((item) => {
            const file = formatFile(item);
            return {
              ...file,
              checked: false,
              isEditing: false,
            };
          });
        const tree = buildFileTree(newList);
        setFolderTree(tree);
        // 默认展开所有文件夹
        const allFolderIds = newList.map((item) => item.id);
        setExpandedKeys(allFolderIds);
        return tree;
      } finally {
        setLoading((prev) => ({ ...prev, folder: false }));
      }
    };

    const clearChecked = useCallback((nodes: CheckedFileItem[]) => {
      nodes?.forEach((item: CheckedFileItem) => {
        item.checked = false;
        if (item.children && item.children.length) clearChecked(item.children);
      });
    }, []);

    const handleSelectSpace = (item: SpaceItem) => {
      if (state.spaceId === item.id || loading.space) return;
      setState((prev) => ({
        ...prev,
        spaceId: item.id,
        libraryId: "",
        selectRoot: true,
        selectedFolderPath: "",
        lastSelectedFolderPath: "",
      }));
      setLibraryList([]);
      setFolderTree([]);
      setExpandedKeys([]);
      loadLibraryList(item.id).then((list) => {
        if (list && list.length > 0) {
          handleSelectLibrary(list[0]);
        }
      });
    };

    const handleSelectLibrary = async (item: LibraryItem) => {
      if (state.libraryId === item.id || loading.library) return;
      setState((prev) => ({
        ...prev,
        libraryId: item.id,
        selectRoot: true,
        selectedFolderPath: "",
        lastSelectedFolderPath: "",
      }));
      // 不调用 libraryStore.setLibraryId，避免触发路由跳转
      await loadFoldersAll(item.id);
    };

    const handleSelectRoot = (checked: boolean) => {
      setState((prev) => ({
        ...prev,
        selectRoot: checked,
        selectedFolderPath: "",
      }));
      if (checked) {
        clearChecked(folderTree);
        setFolderTree([...folderTree]);
      }
    };

    const handleCheckChange = (data: CheckedFileItem) => {
      if (!data.isfolder) return;
      clearChecked(folderTree);
      // Find the node in folderTree and update it
      const findAndCheckNode = (
        nodes: CheckedFileItem[],
        targetPath: string,
      ): boolean => {
        for (const node of nodes) {
          if (node.path === targetPath) {
            node.checked = true;
            return true;
          }
          if (node.children && node.children.length) {
            if (findAndCheckNode(node.children, targetPath)) return true;
          }
        }
        return false;
      };
      findAndCheckNode(folderTree, data.path);
      setState((prev) => ({
        ...prev,
        selectedFolderPath: data.path,
        selectRoot: false,
      }));
      setFolderTree([...folderTree]);
    };

    const handleNodeClick = (data: CheckedFileItem) => {
      if (data.isEditing) return;
      if (!data.isfolder) return;
      // Find the node in folderTree and toggle its checked state
      const node = findFolderByPath(folderTree, data.path);
      if (node) {
        node.checked = !node.checked;
        handleCheckChange(node);
      }
    };

    const findFolderByPath = (
      nodes: CheckedFileItem[],
      targetPath: string,
    ): CheckedFileItem | null => {
      for (const node of nodes) {
        if (node.path === targetPath && node.isfolder) {
          return node;
        }
        if (node.children && node.children.length) {
          const childNode = findFolderByPath(node.children, targetPath);
          if (childNode) return childNode;
        }
      }
      return null;
    };

    const removeEmptyNode = (nodes: CheckedFileItem[]) => {
      if (!nodes || nodes.length === 0) return;
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        if (!n.id || n.isEditing) {
          nodes.splice(i, 1);
        }
      }
    };

    const handleCreateFolder = () => {
      if (!state.libraryId) return;
      if (state.lastSelectedFolderPath === "") {
        removeEmptyNode(folderTree);
      } else {
        const prev = findFolderByPath(folderTree, state.lastSelectedFolderPath);
        if (prev && prev.children) removeEmptyNode(prev.children);
      }
      const newFolder: CheckedFileItem = {
        ...(defaultCheckedFile as CheckedFileItem),
        id: `new-folder-${Date.now()}`,
        name: "",
        isfolder: true,
        isEditing: true,
      };
      if (state.selectRoot) {
        setFolderTree([...folderTree, newFolder]);
        setState((prev) => ({ ...prev, lastSelectedFolderPath: "" }));
        setTimeout(() => {
          newFolderInputRef.current?.focus();
        }, 0);
      } else {
        const parent = findFolderByPath(folderTree, state.selectedFolderPath);
        if (parent) {
          if (!parent.children) {
            parent.children = [];
          }
          parent.children.push(newFolder);
          // 展开父文件夹
          if (!expandedKeys.includes(parent.id)) {
            setExpandedKeys([...expandedKeys, parent.id]);
          }
          setFolderTree([...folderTree]);
          setState((prev) => ({
            ...prev,
            lastSelectedFolderPath: state.selectedFolderPath,
          }));
          setTimeout(() => {
            newFolderInputRef.current?.focus();
          }, 0);
        }
      }
    };

    const handleConfirmCreateFolderWithValue = async (
      data: CheckedFileItem,
      value: string,
    ) => {
      if (!state.selectRoot && !state.selectedFolderPath) {
        message.warning("请选择目录");
        return;
      }
      // 过滤掉特殊字符
      const safeValue = value.replace(/\//g, "");
      if (!safeValue) {
        message.warning("请输入文件夹名称");
        return;
      }
      const base = state.selectRoot ? "" : state.selectedFolderPath;
      const parent = state.selectRoot ? null : findFolderByPath(folderTree, state.selectedFolderPath);
      const list = state.selectRoot
        ? folderTree.slice(0, -1)
        : parent?.children?.filter((n: any) => !!n.id) || [];
      const name = generateUniqueFolderName(safeValue, list);
      const path = `${base}/${name}`.replace(/\/+/g, "/");
      try {
        await filesApi.create({
          path,
          type: 0,
          library_id: state.libraryId,
          permissions: [],
        });
        message.success("创建成功");
        const newTree = await loadFoldersAll(state.libraryId);
        // Select the newly created folder
        if (newTree) {
          selectCurFolder(newTree, path);
        }
      } catch (e) {
        console.error(e);
      }
    };

    const selectCurFolder = (
      nodes: CheckedFileItem[],
      targetPath: string,
    ): boolean => {
      for (const fileData of nodes) {
        if (fileData.path === targetPath) {
          fileData.checked = true;
          fileData.isEditing = false;
          fileData.isfolder = true;
          // 找到节点后，触发状态更新和选中逻辑
          setState((prev) => ({
            ...prev,
            selectedFolderPath: fileData.path,
            selectRoot: false,
          }));
          clearChecked(nodes);
          fileData.checked = true;
          setFolderTree([...nodes]);
          return true;
        }
        if (fileData.children?.length) {
          if (selectCurFolder(fileData.children, targetPath)) return true;
        }
      }
      return false;
    };

    const handleCancelCreateFolder = (node: any, data: CheckedFileItem) => {
      if (state.selectRoot) {
        setFolderTree(folderTree.slice(0, -1));
      } else {
        const parent = findFolderByPath(folderTree, state.selectedFolderPath);
        if (parent && parent.children) {
          const index = parent.children.findIndex((d: any) => d.id === data.id);
          if (index !== -1) {
            parent.children.splice(index, 1);
          }
        }
        setFolderTree([...folderTree]);
      }
    };

    const handleClose = () => {
      setVisible(false);
    };

    const createMd = async (path: string): Promise<{ fileId: string; libraryId: string }> => {
      const nodes = libraryStore.findNodeInBasePath(path, folderTree as any);
      const name = generateUniqueFileName(state.question, nodes as any) + ".md";
      // 直接调用 filesApi.create，使用 state.libraryId 而非全局状态
      const res = await filesApi.create({
        path: `${path}/${name}`,
        type: 1,
        library_id: state.libraryId,
        permissions: [],
      });
      const file = formatFile(res);
      setState((prev) => ({ ...prev, fileId: file.id }));
      await fileBodiesApi.create({
        content: state.content,
        file_id: file.id,
        library_id: state.libraryId,
      });
      await chunksApi.sync({ file_id: file.id });
      message.success(t("action.save_success"));
      return { fileId: file.id, libraryId: state.libraryId };
    };

    const handleOpenFile = (libraryId: string, fileId: string) => {
      const url = buildUrl(`/library/${libraryId}/file/${fileId}`);
      window.open(url, "_blank");
    };

    const handleConfirm = async () => {
      const basePath = state.selectRoot ? "" : state.selectedFolderPath;
      setState((prev) => ({ ...prev, creating: true }));
      try {
        const result = await createMd(basePath);
        setTimeout(() => {
          handleOpenFile(result.libraryId, result.fileId);
          handleClose();
        }, 1000);
      } catch (error) {
        console.error(error);
        message.error(t("action.save_failed"));
      } finally {
        setState((prev) => ({ ...prev, creating: false }));
      }
    };

    const convertToTreeData = (nodes: CheckedFileItem[], parentPath = ""): TreeDataNode[] => {
      return nodes.map((node, index) => ({
        key: node.id || `temp-${parentPath}-${index}`,
        path: node.path, // 保存原始数据的 path 用于查找
        isfolder: node.isfolder,
        isEditing: node.isEditing,
        title: node.isEditing ? (
          <div className="p-2 flex items-center gap-2">
            <img
              src={getPublicPath("/images/file/folder.png")}
              className="size-6"
              alt=""
            />
            <Input
              ref={newFolderInputRef}
              key={node.id || "new-folder"}
              defaultValue="无标题文件夹"
              style={{ width: 200 }}
              onPressEnter={(e) => {
                const input = e.target as HTMLInputElement;
                const value = input.value.trim();
                if (value) {
                  handleConfirmCreateFolderWithValue(node, value);
                }
              }}
            />
            <CheckOutlined
              className="cursor-pointer hover:opacity-70 mr-1"
              onClick={() => {
                const input = newFolderInputRef.current?.input;
                const value = (input as HTMLInputElement)?.value?.trim();
                if (value) {
                  handleConfirmCreateFolderWithValue(node, value);
                }
              }}
            />
            <CloseOutlined
              className="cursor-pointer hover:opacity-70"
              onClick={() => handleCancelCreateFolder({ parent: null }, node)}
            />
          </div>
        ) : (
          <div className="w-full h-10 p-2 flex justify-between items-center">
            <div className="flex-1 flex items-center gap-2">
              <img src={node.icon} className="size-6" alt="" />
              <span className="text-sm text-[#1D1E1F] truncate">
                {node.name}
              </span>
            </div>
            {node.isfolder && (
              <Radio
                checked={node.checked}
                onClick={(e) => e.stopPropagation()}
                onChange={() => handleCheckChange(node)}
              />
            )}
          </div>
        ),
        icon: node.isfolder ? <FolderOutlined /> : <FileOutlined />,
        children: node.children?.length
          ? convertToTreeData(node.children, node.path)
          : undefined,
      }));
    };

    return (
      <Modal
        open={visible}
        title={
          <span>
            <span className="text-lg">{t("library.add_to")}</span>
            <span className="text-sm text-[#999999] ml-2 font-normal">
              {t("library.can_add_to")}
            </span>
          </span>
        }
        width={840}
        centered
        destroyOnHidden
        onCancel={handleClose}
        mask={{ closable: false }}
        footer={
          <div className="flex items-center justify-between gap-2">
            <Button
              type="link"
              className="px-0"
              disabled={!state.libraryId}
              onClick={handleCreateFolder}
            >
              + {t("library.create_folder")}
            </Button>
            <div className="flex gap-2">
              <Button onClick={handleClose}>{t("action.cancel")}</Button>
              <Button
                type="primary"
                loading={state.creating}
                disabled={confirmBtnDisabled}
                onClick={handleConfirm}
              >
                {t("action.confirm")}
              </Button>
            </div>
          </div>
        }
      >
        <div className="h-[500px] flex overflow-hidden border rounded-lg">
          {/* Space Panel */}
          <div className="flex-none w-[170px] p-2 border-r flex flex-col overflow-hidden">
            <div className="h-10 px-4 flex items-center text-sm text-[#999999]">
              {t("library.team_space")}
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {loading.space ? (
                <div className="flex items-center justify-center h-full">
                  <Spin />
                </div>
              ) : spaceList.length === 0 ? (
                <Empty
                  description={t("library.no_space")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                spaceList.map((item) => (
                  <div
                    key={item.id}
                    className={`h-10 pl-4 flex items-center gap-2 rounded cursor-pointer text-[#1D1E1F] hover:bg-[#F2F3F5] ${state.spaceId === item.id ? "bg-[#F2F3F5]" : ""}`}
                    onClick={() => handleSelectSpace(item)}
                  >
                    <div className="size-4 flex items-center justify-center rounded">
                      <FolderOutlined />
                    </div>
                    <p className="flex-1 text-sm truncate">{item.name}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Library Panel */}
          <div className="flex-none w-[170px] p-2 border-r flex flex-col overflow-hidden">
            <div className="h-10 px-4 flex items-center text-sm text-[#999999]">
              {t("library.name")}
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {loading.library ? (
                <div className="flex items-center justify-center h-full">
                  <Spin />
                </div>
              ) : libraryList.length === 0 ? (
                <Empty
                  description={t("library.no_library")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                libraryList.map((item) => (
                  <div
                    key={item.id}
                    className={`h-10 pl-4 flex items-center gap-2 rounded cursor-pointer text-[#1D1E1F] hover:bg-[#F2F3F5] ${state.libraryId === item.id ? "bg-[#F2F3F5]" : ""}`}
                    onClick={() => handleSelectLibrary(item)}
                  >
                    {item.icon && (
                      <img src={item.icon} className="size-6" alt="" />
                    )}
                    <p className="flex-1 text-sm truncate">{item.name}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Folder Tree Panel */}
          <div className="flex-1 p-2 flex flex-col overflow-hidden">
            <div
              className="h-10 px-7 flex items-center text-sm text-[#999999] relative hover:bg-[#F2F3F5] cursor-pointer"
              onClick={() => handleSelectRoot(!state.selectRoot)}
            >
              {curLibrary && (
                <div className="flex items-center gap-2">
                  {curLibrary.icon && (
                    <img src={curLibrary.icon} className="size-6" alt="" />
                  )}
                  <span className="text-sm text-[#1D1E1F]">
                    {curLibrary.name}
                  </span>
                </div>
              )}
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center">
                {t("library.root_folder")}
                <Radio
                  className="ml-1"
                  checked={state.selectRoot}
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading.folder ? (
                <div className="flex items-center justify-center h-full">
                  <Spin />
                </div>
              ) : folderTree.length === 0 ? (
                <Empty
                  description={t("library.no_folder")}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              ) : (
                <Tree
                  ref={folderTreeRef}
                  blockNode={true}
                  expandedKeys={expandedKeys}
                  onExpand={(keys) => setExpandedKeys(keys as string[])}
                  style={{
                    "--ant-tree-indent-size": "6px",
                    "--ant-tree-title-height": "40px",
                  }}
                  treeData={convertToTreeData(folderTree)}
                  onSelect={(keys, info) => {
                    const treeNode = info.node as any;
                    if (treeNode && treeNode.isfolder && !treeNode.isEditing) {
                      // 通过 path 找到原始数据进行操作
                      const originalNode = findFolderByPath(
                        folderTree,
                        treeNode.path,
                      );
                      if (originalNode) {
                        originalNode.checked = !originalNode.checked;
                        handleCheckChange(originalNode);
                      }
                    }
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </Modal>
    );
  },
);

AddAnswerAsMd.displayName = "AddAnswerAsMd";

export default AddAnswerAsMd;
