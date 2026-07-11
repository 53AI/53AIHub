import { useEffect, useRef, useState } from "react";
import { Tooltip } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { formatFileInfo } from "@/api/modules/files/transform";
import { getPublicPath } from "@/utils/config";

export interface OutputFile {
  id: string | number;
  file_name?: string;
  url?: string;
  is_favorite?: boolean;
}

export interface OutputFilesProps {
  files: OutputFile[];
  onPreview: (file: OutputFile) => void;
  onFavorite?: (file: OutputFile) => void;
  onCheckFavorite?: (fileIds: string[]) => void;
}

export function OutputFiles({ files, onPreview, onFavorite, onCheckFavorite }: OutputFilesProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hasChecked, setHasChecked] = useState(false);

  // 使用 Intersection Observer 检测是否在视野中
  useEffect(() => {
    if (!onCheckFavorite || !files?.length || hasChecked) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 进入视野时检查收藏状态
            const fileIds = files.map(f => String(f.id));
            onCheckFavorite(fileIds);
            setHasChecked(true);
            observer.disconnect();
          }
        });
      },
      { threshold: 0.1 } // 10% 可见时触发
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [files, onCheckFavorite, hasChecked]);

  if (!files?.length) return null;

  const defaultIcon = getPublicPath("/images/default_agent.png");

  return (
    <div ref={containerRef} className="flex flex-wrap gap-3 mt-3">
      {files.map((file) => {
        const fileName = file.file_name?.split("/").pop() || file.file_name || "";
        const { icon: displayIcon, fname: displayName } = formatFileInfo(fileName);
        return (
          <div
            key={file.id}
            className="w-[280px] flex items-center justify-between px-4 py-4 bg-[#f5f7fa] border border-[#E8E8E8] rounded-lg cursor-pointer hover:shadow-sm hover:border-[#D9D9D9] transition-all group"
            onClick={() => onPreview(file)}
          >
            <div className="flex flex-col gap-1 flex-1 min-w-0">
              <img
                className="flex-none size-5"
                src={displayIcon || defaultIcon}
                alt=""
                onError={(e) => {
                  (e.target as HTMLImageElement).src = defaultIcon;
                }}
              />
              <span className="text-sm text-[#555454] truncate">
                {displayName}
              </span>
            </div>
            <div className="w-20 relative overflow-hidden rounded">
              <img
                src={getPublicPath(`/images/output-file.png`)}
                alt=""
                className="w-full h-full object-cover"
              />
              {onFavorite && (
                <Tooltip
                  title={file.is_favorite ? "取消收藏" : "收藏"}
                  placement="top"
                >
                  <div
                    className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      onFavorite(file);
                    }}
                  >
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shadow-md">
                      {file.is_favorite ? (
                        <SvgIcon name="star-filled" color="#FFB300" size={16} />
                      ) : (
                        <SvgIcon name="star" size={16} className="text-[#999]" />
                      )}
                    </div>
                  </div>
                </Tooltip>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default OutputFiles;
