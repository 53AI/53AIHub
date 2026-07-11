// packages/shared-business/src/chat/components/source/SpecifiedFiles.tsx

import { memo } from "react";
import { Tooltip } from "antd";
import { SvgIcon } from "@km/shared-components-react";
import { useChatAdapters } from "../../i18n";
import type { FileItem } from "../../types/message";

export interface SpecifiedFilesProps {
  /** 文件列表 */
  files?: FileItem[];
  /** 显示类型：no_jump 不跳转，jump 支持跳转 */
  type?: "no_jump" | "jump";
  /** 引用内容（替代文件显示） */
  content?: string;
  /** 是否展开显示内容 */
  isExpanded?: boolean;
  /** 文件点击回调 */
  onFileClick?: (file: FileItem) => void;
  /** 自定义跳转链接渲染 */
  renderLink?: (file: FileItem, children: React.ReactNode) => React.ReactNode;
}

function SpecifiedFilesInner({
  files,
  type,
  content,
  isExpanded = false,
  onFileClick,
  renderLink,
}: SpecifiedFilesProps) {
  const fileLinkApi = useChatAdapters()?.fileLink;

  // 自动推断 type：如果未指定且有 adapter 或 renderLink，自动启用跳转
  const resolvedType = type ?? ((renderLink || fileLinkApi) ? "jump" : "no_jump");

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

  // Files display mode
  if (!files?.length) return null;

  // 按 id 去重
  const uniqueFiles = files.filter((file, index, self) =>
    index === self.findIndex(f => f.id === file.id)
  );

  const renderFileItem = (file: FileItem) => {
    const inner = (
      <>
        <SvgIcon className="flex-none" name="corner-down-right" />
        {file.icon && <img src={file.icon} className="size-3" alt="" />}
        <p className="text-sm truncate">{file.name || file.file_name || file.filename}</p>
      </>
    );

    // 空间/知识库：优先使用跳转链接，无适配器时回退到 onFileClick
    if (file.isspace || file.islibrary) {
      if (renderLink) {
        return renderLink(file, inner);
      }
      if (fileLinkApi) {
        return (
          <a
            key={file.id}
            href={fileLinkApi.getFileLink(file)}
            target="_blank"
            rel="noopener noreferrer"
            className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1 no-underline"
            onClick={(e) => e.stopPropagation()}
          >
            {inner}
          </a>
        );
      }
      // 无适配器时回退到 no_jump 模式（调用 onFileClick）
    }

    // 文件：如果提供了自定义链接渲染且 resolvedType=jump，使用自定义渲染
    if (renderLink && resolvedType === "jump") {
      return renderLink(file, inner);
    }

    // 文件：如果有 fileLink 适配器且 resolvedType=jump，使用适配器生成链接
    if (fileLinkApi && resolvedType === "jump") {
      return (
        <a
          key={file.id}
          href={fileLinkApi.getFileLink(file)}
          target="_blank"
          rel="noopener noreferrer"
          className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1 no-underline"
          onClick={(e) => e.stopPropagation()}
        >
          {inner}
        </a>
      );
    }

    // no_jump 模式：使用点击回调
    return (
      <div
        key={file.id}
        className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-[#4F5052] bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1"
        onClick={(e) => {
          e.stopPropagation();
          onFileClick?.(file);
        }}
      >
        {inner}
      </div>
    );
  };

  return (
    <div className="flex flex-wrap gap-2 mb-2">
      {uniqueFiles.map(renderFileItem)}
    </div>
  );
}

const SpecifiedFiles = memo(SpecifiedFilesInner);
SpecifiedFiles.displayName = "SpecifiedFiles";

export default SpecifiedFiles;
