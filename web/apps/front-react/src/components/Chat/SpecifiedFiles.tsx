import { Tooltip } from "antd";
import { Link } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";

interface SpecifiedFile {
  id: string | number;
  name: string;
  icon: string;
  library_id?: string | number;
  isfolder?: boolean;
  islibrary?: boolean;
  isspace?: boolean;
}

interface SpecifiedFilesProps {
  files?: SpecifiedFile[];
  type?: string;
  content?: string;
  isExpanded?: boolean;
  onFileClick?: (file: SpecifiedFile) => void;
}

export function SpecifiedFiles({
  files,
  type,
  content,
  isExpanded = false,
  onFileClick,
}: SpecifiedFilesProps) {
  // Content display mode
  if (content) {
    if (isExpanded) {
      return (
        <div className="mb-2">
          <div className="max-w-[568px] p-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-end gap-1">
            <SvgIcon className="flex-none" name="corner-down-right" />
            <p className="text-sm text-start">{content}</p>
          </div>
        </div>
      );
    }

    return (
      <div className="mb-2">
        <Tooltip title={content}>
          <div className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1">
            <SvgIcon className="flex-none" name="corner-down-right" />
            <p className="text-sm truncate">{content}</p>
          </div>
        </Tooltip>
      </div>
    );
  }

  // 获取跳转链接
  const getFileLink = (file: SpecifiedFile): string => {
    // 空间：跳转到知识库首页，并选中对应空间的 tab
    if (file.isspace) {
      return `/knowledge/${file.id}`;
    }
    // 知识库：跳转到知识库详情
    if (file.islibrary) {
      return `/library/${file.id}`;
    }
    // 知识（文件）：跳转到文件详情
    if (file.isfolder) {
      return `/library/${file.library_id}/folder/${file.id}`;
    }
    return `/library/${file.library_id}/file/${file.id}`;
  };

  // Files display mode
  if (files?.length) {
    // 按 id 去重
    const uniqueFiles = files.filter((file, index, self) =>
      index === self.findIndex(f => f.id === file.id)
    );

    return (
      <div className="flex flex-wrap gap-2 mb-2">
        {uniqueFiles.map((file) => {
          // 空间和知识库：始终渲染 Link 进行跳转
          if (file.isspace || file.islibrary) {
            return (
              <Link
                key={file.id}
                to={getFileLink(file)}
                target="_blank"
                className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1"
              >
                <SvgIcon className="flex-none" name="corner-down-right" />
                {file.icon && <img src={file.icon} className="size-3" alt="" />}
                <p className="text-sm truncate">{file.name}</p>
              </Link>
            );
          }

          // 知识（文件）：根据 type 决定是否跳转
          if (type === "no_jump") {
            return (
              <div
                key={file.id}
                className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1"
                onClick={() => onFileClick?.(file)}
              >
                <SvgIcon className="flex-none" name="corner-down-right" />
                {file.icon && <img src={file.icon} className="size-3" alt="" />}
                <p className="text-sm truncate">{file.name}</p>
              </div>
            );
          }

          return (
            <Link
              key={file.id}
              to={getFileLink(file)}
              target="_blank"
              className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1"
            >
              <SvgIcon className="flex-none" name="corner-down-right" />
              {file.icon && <img src={file.icon} className="size-3" alt="" />}
              <p className="text-sm truncate">{file.name}</p>
            </Link>
          );
        })}
      </div>
    );
  }

  return null;
}

export default SpecifiedFiles;
