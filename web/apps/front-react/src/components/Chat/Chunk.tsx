import {
  useState,
  useImperativeHandle,
  forwardRef,
  useRef,
  useEffect,
} from "react";
import { Popover, Button } from "antd";
import { CloseOutlined, ShareAltOutlined } from "@ant-design/icons";
import type { PopoverProps } from "antd";
import chunksApi from "@/api/modules/chunks";
import { markdownPreview } from "@/components/Markdown/helper";
import { cacheManager } from "@km/shared-utils";
import { buildUrl } from "@/utils/router";
import { deepCopy } from "@/utils";

interface ChunkInfo {
  chunk_id: string;
  file_id: string | number;
  file_name: string;
  file_path?: string;
  file_icon?: string;
  library_id: string | number;
  library_name: string;
  library_icon?: string;
  space_name?: string;
  content?: string;
  token_count?: number;
  chunk_index?: number;
}

interface ChunkProps extends Omit<PopoverProps, "content"> {
  onOpenLibrary?: (info: ChunkInfo) => void;
  virtualRef?: React.RefObject<HTMLElement | null>;
}

export interface ChunkRef {
  setLibraryInfo: (info: ChunkInfo, type?: string) => void;
  hide: () => void;
}

export const Chunk = forwardRef<ChunkRef, ChunkProps>(
  ({ onOpenLibrary, virtualRef, ...popoverProps }, ref) => {
    const [visible, setVisible] = useState(false);
    const [libraryInfo, setLibraryInfo] = useState<ChunkInfo | null>(null);
    const [searchType, setSearchType] = useState("web_search");
    const [triggerRect, setTriggerRect] = useState<DOMRect | null>(null);
    const markdownRef = useRef<HTMLDivElement>(null);

    const isRagSearch = searchType !== "web_search";

    useImperativeHandle(ref, () => ({
      setLibraryInfo: (info: ChunkInfo, type: string = "web_search") => {
        setSearchType(type);
        setLibraryInfo({
          ...deepCopy(info),
          token_count: 0,
          chunk_index: 0,
        });
        // 设置触发元素的位置
        if (virtualRef?.current) {
          setTriggerRect(virtualRef.current.getBoundingClientRect());
        }
        // web_search 类型不需要从 API 获取 chunk 内容，直接显示弹窗
        if (type === "web_search") {
          setVisible(true);
          return;
        }
        if (!type) return;
        // 其他类型从 API 获取 chunk 详细内容
        cacheManager
          .getOrFetch(`chunk_${info.chunk_id}`, () =>
            chunksApi.get(info.chunk_id),
          )
          .then((res: any) => {
            setLibraryInfo((prev) =>
              prev
                ? {
                    ...prev,
                    content: res.content,
                    token_count: res.token_count,
                    chunk_index: res.chunk_index,
                  }
                : null,
            );
          });
        setVisible(true);
      },
      hide: () => {
        setVisible(false);
        setTriggerRect(null);
      },
    }));

    useEffect(() => {
      if (visible && libraryInfo?.content && markdownRef.current) {
        // 先清空内容，避免重复渲染导致样式叠加
        markdownRef.current.innerHTML = libraryInfo.content;
        void markdownPreview(markdownRef.current, libraryInfo.content);
      }
    }, [visible, libraryInfo?.content]);

    // 关闭时清理触发元素位置和markdown内容，避免下次打开时字体变大
    useEffect(() => {
      if (!visible) {
        setTriggerRect(null);
        if (markdownRef.current) {
          markdownRef.current.innerHTML = "";
        }
      }
    }, [visible]);

    const handleOpenLibrary = () => {
      if (libraryInfo) {
        const url = buildUrl(
          `/library/${libraryInfo.library_id}/file/${libraryInfo.file_id}`,
        );
        window.open(url, "_blank");
        onOpenLibrary?.(libraryInfo);
      }
    };

    const content = libraryInfo ? (
      <div className="overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 overflow-hidden">
            <img
              className="size-5"
              src={
                isRagSearch ? libraryInfo.file_icon : libraryInfo.library_icon
              }
              alt=""
            />
            <h3 className="flex-1 text-base text-[#1D1E1F] truncate">
              {isRagSearch ? libraryInfo.file_name : libraryInfo.library_name}
            </h3>
            {isRagSearch && (
              <>
                <span className="text-sm text-[#999999]">
                  #{libraryInfo.chunk_index}
                </span>
                <div className="h-2.5 w-px bg-[#dbdbdb]"></div>
                <span className="text-sm text-[#999999]">
                  {libraryInfo.token_count} Token
                </span>
              </>
            )}
          </div>
          <Button
            type="link"
            size="small"
            onClick={() => setVisible(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            <CloseOutlined />
          </Button>
        </div>

        {/* File link for web search */}
        {!isRagSearch && libraryInfo.file_path && (
          <a
            className="text-base text-[#2563EB] block mb-3"
            href={libraryInfo.file_path}
            target="_blank"
            rel="noopener noreferrer"
          >
            {libraryInfo.file_name}
          </a>
        )}

        {/* Content */}
        <div className="max-h-56 overflow-auto space-y-2">
          <div className="text-sm text-gray-700" ref={markdownRef}>
            {libraryInfo.content}
          </div>
        </div>

        {/* Footer */}
        {isRagSearch && (
          <div className="flex items-center justify-between mt-4">
            <div className="flex-1 flex items-center gap-1.5 overflow-hidden">
              <span className="flex-1 text-sm text-[#1D1E1F] truncate">
                {libraryInfo.space_name && `${libraryInfo.space_name}/`}
                {libraryInfo.library_name}
              </span>
            </div>
            <Button
              color="primary"
              variant="filled"
              onClick={handleOpenLibrary}
            >
              查看文档
              <ShareAltOutlined style={{ marginLeft: 4 }} />
            </Button>
          </div>
        )}
      </div>
    ) : null;

    // 触发 span 定位到虚拟 ref 元素的位置
    const triggerStyle: React.CSSProperties = triggerRect
      ? {
          position: "fixed",
          left: triggerRect.left,
          top: triggerRect.top,
          width: Math.max(triggerRect.width, 1),
          height: Math.max(triggerRect.height, 1),
          pointerEvents: "none",
          zIndex: -1,
        }
      : { display: "none" };

    return (
      <Popover
        open={visible}
        onOpenChange={(open) => {
          if (!open) {
            setVisible(false);
            setTriggerRect(null);
          }
        }}
        placement="bottomLeft"
        trigger="click"
        content={content}
        classNames={{ root: "!p-0" }}
        styles={{ root: { width: searchType === "web_search" ? 680 : 600 } }}
        {...popoverProps}
      >
        <span style={triggerStyle} />
      </Popover>
    );
  },
);

Chunk.displayName = "Chunk";

export default Chunk;
