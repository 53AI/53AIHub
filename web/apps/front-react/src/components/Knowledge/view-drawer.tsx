import {
  useState,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  useRef,
} from "react";
import { Drawer, Button, Spin } from "antd";
import { ExportOutlined } from "@ant-design/icons";
import FileViewerWrapper from "@/components/FileViewer/view";
import { FileItem } from "@/api/modules/files/types";
import filesApi from "@/api/modules/files";
import { formatFile } from "@/api/modules/files/transform";
import chunksApi from "@/api/modules/chunks";
import { buildUrl } from "@/utils/router";

interface ViewDrawerProps {
  onClose?: () => void;
}

export interface ViewDrawerRef {
  open: (data: { file_id: string }) => void;
  close: () => void;
}

export const KnowledgeViewDrawer = forwardRef<ViewDrawerRef, ViewDrawerProps>(
  ({ onClose }, ref) => {
    const [visible, setVisible] = useState(false);
    const [currentFile, setCurrentFile] = useState<FileItem>({} as FileItem);
    const [loading, setLoading] = useState(false);
    const [fileContent, setFileContent] = useState("");
    const [fileExtension, setFileExtension] = useState("");
    const requestIdRef = useRef(0);

    const loadChunks = async (id: string) => {
      const res = await chunksApi.files.list(id);
      const content = res.chunks.map((item: any) => item.content).join("\n");
      setFileContent(content);
      setFileExtension("md");
    };

    const loadFile = async (id: string, requestId: number) => {
      const res = await filesApi.get(id);
      // 只应用最新请求的结果，避免竞态条件
      if (requestId !== requestIdRef.current) return;
      const file = formatFile(res);
      setCurrentFile(file);
      if (!file.file_url && file.file_ext === "md") {
        return loadChunks(id);
      }
    };

    const handleView = () => {
      const url = buildUrl(
        `/library/${currentFile.library_id}/file/${currentFile.id}`,
      );
      window.open(url);
    };

    const handleClose = () => {
      // Clean up Blob URL to avoid memory leaks
      if (currentFile.file_url && currentFile.file_url.startsWith("blob:")) {
        URL.revokeObjectURL(currentFile.file_url);
      }
      setFileContent("");
      setFileExtension("");
      setCurrentFile({} as FileItem);
      setVisible(false);
      onClose?.();
    };

    const open = useCallback(async (data: { file_id: string }) => {
      // 递增请求ID，用于追踪最新请求
      const requestId = ++requestIdRef.current;
      // 清理之前的状态
      setFileContent("");
      setFileExtension("");
      setCurrentFile({} as FileItem);
      setLoading(true);
      setVisible(true);
      try {
        await loadFile(data.file_id, requestId);
      } finally {
        // 只在最新请求完成时更新loading状态
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    }, []);

    useImperativeHandle(ref, () => ({
      open,
      close: handleClose,
    }));

    useEffect(() => {
      return () => {
        if (currentFile.file_url && currentFile.file_url.startsWith("blob:")) {
          URL.revokeObjectURL(currentFile.file_url);
        }
      };
    }, [currentFile.file_url]);

    return (
      <Drawer
        open={visible}
        onClose={handleClose}
        placement="left"
        styles={{
          wrapper: { width: "calc(100vw - 418px)", "--ant-box-shadow-drawer-left":"none", "--ant-motion-duration-slow": "none" },
        }}

        mask={false}
        destroyOnHidden
        title={
          <div className="flex items-center gap-2">
            <div className="size-6 flex-shrink-0">
              {currentFile.icon && (
                <img className="size-6" src={currentFile.icon} alt="" />
              )}
            </div>
            <div className="flex-1 text-base text-[#1D1E1F] truncate">
              {currentFile.name || "--"}
            </div>
            {currentFile.id && (
              <Button type="link" onClick={handleView}>
                查看文档
                <ExportOutlined className="ml-1.5" />
              </Button>
            )}
          </div>
        }
      >
        <Spin
          spinning={loading}
          classNames={{
            root: "h-full",
            container: "h-full",
          }}
        >
          <div className="h-full overflow-hidden">
            {(currentFile.id || fileContent) && (
              <FileViewerWrapper
                currentFile={currentFile}
                content={fileContent}
              />
            )}
          </div>
        </Spin>
      </Drawer>
    );
  },
);

export default KnowledgeViewDrawer;
