import {
    useState,
    useCallback, forwardRef,
    useImperativeHandle
} from "react";
import {
    Modal,
    Empty,
    Table,
    Checkbox,
    Button,
    Popover,
    Spin,
    message,
} from "antd";
import { CloseOutlined, ArrowDownOutlined } from "@ant-design/icons";
import { spacesApi } from "@/api";
import { librariesApi } from "@/api";
import { filesApi } from "@/api";
import { permissionsApi } from "@/api";
import { buildFileTree, formatFile } from "@/api/modules/files/transform";
import {
    RESOURCE_TYPE,
    PERMISSION_TYPE,
} from "@/components/Permission/constant";
import { SvgIcon } from "@km/shared-components-react";
import type { FileItem } from "@/api/modules/files/types";
import type { SpaceItem } from "@/api/modules/spaces/types";
import type { LibraryItem } from "@/api/modules/libraries/types";
import "./FileSelectDialog.scss";

interface FileSelectDialogProps {
  onConfirm?: (files: FileItem[]) => void;
}

export interface FileSelectDialogRef {
  open: (files?: FileItem[], library?: LibraryItem) => void;
}

export const FileSelectDialog = forwardRef<
  FileSelectDialogRef,
  FileSelectDialogProps
>(({ onConfirm }, ref) => {
  const [visible, setVisible] = useState(false);
  const [spaceList, setSpaceList] = useState<SpaceItem[]>([]);
  const [libraryList, setLibraryList] = useState<LibraryItem[]>([]);
  const [fileList, setFileList] = useState<FileItem[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<FileItem[]>([]);
  const [spaceId, setSpaceId] = useState<string>("");
  const [libraryId, setLibraryId] = useState<string>("");
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [popoverVisible, setPopoverVisible] = useState(false);

  // 加载空间列表
  const loadSpaceList = useCallback(async () => {
    setSpaceLoading(true);
    try {
      const res = await spacesApi.list({
        status: 0,
        limit: 100,
        offset: 0,
        view: "user",
      });
      const privateSpaces = (res.spaces || []).filter((item) => !item.visibility);
      let permissionMap: Record<string, number> = {};
      if (privateSpaces.length > 0) {
        permissionMap = await permissionsApi.myBatch({
          resource_type: RESOURCE_TYPE.space,
          resource_ids: privateSpaces.map((item) => item.id),
        });
      }
      const newList: SpaceItem[] = (res.spaces || []).filter((item) => {
        if (item.visibility) return true;
        const key = `${RESOURCE_TYPE.space}:${item.id}`;
        return permissionMap[key] >= PERMISSION_TYPE.viewer;
      });
      setSpaceList(newList);
    } finally {
      setSpaceLoading(false);
    }
  }, []);

  // 加载知识库列表
  const loadLibraryList = useCallback(async (sid: string) => {
    setLibraryLoading(true);
    try {
      const list = await librariesApi.list({
        space_id: sid,
        get_recently: 0,
        limit: 100,
      });
      if (!list || list.length === 0) {
        setLibraryList([]);
        return;
      }
      const permissionMap = await permissionsApi.myBatch({
        resource_type: RESOURCE_TYPE.library,
        resource_ids: list.map((item) => item.id),
      });
      const newList: LibraryItem[] = list.filter((item) => {
        const key = `${RESOURCE_TYPE.library}:${item.id}`;
        return permissionMap[key] >= PERMISSION_TYPE.viewer;
      });
      setLibraryList(newList);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  // 加载文件列表
  const loadFilesAll = useCallback(async (libId: string) => {
    setFileLoading(true);
    try {
      const list = await filesApi.all({ library_id: libId });
      if (!list || list.length === 0) {
        setFileList([]);
        return;
      }
      const permissionMap = await permissionsApi.myBatch({
        resource_type: RESOURCE_TYPE.file,
        resource_ids: list.map((item) => item.id),
      });
      const newList: FileItem[] = list
        .filter((item) => {
          const key = `${RESOURCE_TYPE.file}:${item.id}`;
          return permissionMap[key] >= PERMISSION_TYPE.viewer;
        })
        .map((item) => formatFile(item));
      setFileList(buildFileTree(newList));
    } finally {
      setFileLoading(false);
    }
  }, []);

  // 选择空间
  const handleSelectSpace = useCallback(
    (item: SpaceItem, libId?: string) => {
      if (spaceId === item.id || spaceLoading) return;
      setSpaceId(item.id);
      loadLibraryList(item.id).then(() => {
        const list = libraryList;
        if (list.length > 0) {
          const library = list.find((l) => l.id === libId);
          handleSelectLibrary(library || list[0]);
        } else {
          setLibraryId("");
          setFileList([]);
        }
      });
    },
    [spaceId, spaceLoading, loadLibraryList, libraryList],
  );

  // 选择知识库
  const handleSelectLibrary = useCallback(
    (item: LibraryItem) => {
      if (libraryId === item.id || libraryLoading) return;
      setLibraryId(item.id);
      loadFilesAll(item.id);
    },
    [libraryId, libraryLoading, loadFilesAll],
  );

  // 判断文件是否已选
  const isSelectedFile = useCallback(
    (item: FileItem) => selectedFiles.some((file) => file.id === item.id),
    [selectedFiles],
  );

  // 选择文件
  const handleSelectFile = useCallback((item: FileItem) => {
    setSelectedFiles((prev) => {
      const hasSelected = prev.some((file) => file.id === item.id);
      if (hasSelected) {
        return prev.filter((file) => file.id !== item.id);
      }
      return [...prev, item];
    });
  }, []);

  // 移除文件
  const handleRemoveFile = useCallback((item: FileItem) => {
    setSelectedFiles((prev) => prev.filter((file) => file.id !== item.id));
  }, []);

  // 关闭
  const handleClose = useCallback(() => {
    setVisible(false);
  }, []);

  // 确认
  const handleConfirm = useCallback(() => {
    if (selectedFiles.length === 0) {
      message.error("请选择文件");
      return;
    }
    setVisible(false);
    onConfirm?.(selectedFiles);
  }, [selectedFiles, onConfirm]);

  // 打开对话框
  const open = useCallback(
    (files?: FileItem[], library?: LibraryItem) => {
      setSelectedFiles(files?.concat([]) || []);
      setVisible(true);
      if (spaceList.length === 0) {
        loadSpaceList().then(() => {
          if (library) {
            handleSelectSpace(
              { id: library.space_id } as SpaceItem,
              library.id,
            );
          } else if (spaceList.length > 0) {
            handleSelectSpace(spaceList[0]);
          }
        });
      }
    },
    [spaceList, loadSpaceList, handleSelectSpace],
  );

  useImperativeHandle(ref, () => ({ open }), [open]);

  // 文件列表表格列配置
  const columns = [
    {
      title: "知识",
      dataIndex: "name",
      key: "name",
      render: (_: any, record: FileItem) => (
        <div className="file-item-row" onClick={() => handleSelectFile(record)}>
          <img src={record.icon} className="size-6" alt="" />
          <span className="flex-1 text-sm text-primary truncate">
            {record.name}
          </span>
          <Checkbox checked={isSelectedFile(record)} />
        </div>
      ),
    },
  ];

  return (
    <Modal
      open={visible}
      title="选择"
      width={784}
      onCancel={handleClose}
      className="file-select-dialog"
      footer={
        <div className="dialog-footer">
          <div className="selected-info">
            {selectedFiles.length > 0 && (
              <Popover
                open={popoverVisible}
                onOpenChange={setPopoverVisible}
                trigger="click"
                placement="topLeft"
                content={
                  <div className="selected-files-popover">
                    <div className="popover-header">
                      <span>全部已选（{selectedFiles.length}）</span>
                      <CloseOutlined onClick={() => setPopoverVisible(false)} />
                    </div>
                    <div className="selected-files-list">
                      {selectedFiles.map((item) => (
                        <div key={item.id} className="selected-file-item">
                          <img src={item.icon} className="size-4" alt="" />
                          <span className="truncate">{item.name}</span>
                          <CloseOutlined
                            className="remove-btn"
                            onClick={() => handleRemoveFile(item)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                }
              >
                <div className="selected-trigger">
                  <span>已选{selectedFiles.length}个文件</span>
                  <ArrowDownOutlined rotate={popoverVisible ? 180 : 0} />
                </div>
              </Popover>
            )}
          </div>
          <div className="dialog-actions">
            <Button onClick={handleClose}>取消</Button>
            <Button type="primary" onClick={handleConfirm}>
              确定
            </Button>
          </div>
        </div>
      }
    >
      <div className="dialog-content">
        {/* 空间列表 */}
        <div className="space-list">
          <div className="list-header">空间</div>
          <Spin spinning={spaceLoading}>
            <div className="list-content">
              {spaceList.map((item) => (
                <div
                  key={item.id}
                  className={`list-item ${spaceId === item.id ? "active" : ""}`}
                  onClick={() => handleSelectSpace(item)}
                >
                  <div className="item-icon">
                    <SvgIcon name="app-one" size={18} />
                  </div>
                  <p className="truncate">{item.name}</p>
                </div>
              ))}
              {!spaceLoading && spaceList.length === 0 && (
                <Empty description="暂无数据" />
              )}
            </div>
          </Spin>
        </div>

        {/* 知识库列表 */}
        <div className="library-list">
          <div className="list-header">知识库</div>
          <Spin spinning={libraryLoading}>
            <div className="list-content">
              {libraryList.map((item) => (
                <div
                  key={item.id}
                  className={`list-item ${libraryId === item.id ? "active" : ""}`}
                  onClick={() => handleSelectLibrary(item)}
                >
                  <img src={item.icon} className="size-5" alt="" />
                  <p className="truncate">{item.name}</p>
                </div>
              ))}
              {!libraryLoading && libraryList.length === 0 && (
                <Empty description="暂无数据" />
              )}
            </div>
          </Spin>
        </div>

        {/* 文件列表 */}
        <div className="file-list-container">
          <div className="list-header">知识</div>
          <Spin spinning={fileLoading}>
            <Table
              dataSource={fileList}
              columns={columns}
              rowKey="id"
              pagination={false}
              showHeader={false}
              defaultExpandAllRows
            />
          </Spin>
        </div>
      </div>
    </Modal>
  );
});

export default FileSelectDialog;
