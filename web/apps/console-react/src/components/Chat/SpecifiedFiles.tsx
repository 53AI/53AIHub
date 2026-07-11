import React from "react";
import { Tooltip } from "antd";
import { SvgIcon } from "@km/shared-components-react";

interface SpecifiedFile {
  id: string | number;
  name: string;
  icon: string;
  library_id: string | number;
  isfolder?: boolean;
}

interface SpecifiedFilesProps {
  files?: SpecifiedFile[];
  type?: string;
  content?: string;
  isExpanded?: boolean;
  onFileClick?: (file: any) => void;
}

export const SpecifiedFiles: React.FC<SpecifiedFilesProps> = ({
  files,
  content,
  isExpanded,
  onFileClick,
}) => {
  if (content) {
    if (isExpanded) {
      return (
        <div className="mb-2">
          <div className="max-w-[568px] p-2 rounded-lg cursor-pointer text-secondary bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-end gap-1">
            <SvgIcon className="flex-none" name="corner-down-right" />
            <p className="text-sm text-start">{content}</p>
          </div>
        </div>
      );
    }
    return (
      <div className="mb-2">
        <Tooltip title={content}>
          <div className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-secondary bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1">
            <SvgIcon className="flex-none" name="corner-down-right" />
            <p className="text-sm truncate">{content}</p>
          </div>
        </Tooltip>
      </div>
    );
  }

  if (files?.length) {
    return (
      <div className="flex flex-wrap gap-2 mb-2">
        {files.map((file) => (
          <div
            key={file.id}
            className="max-w-40 h-7 px-2 rounded-lg cursor-pointer text-secondary bg-[#F8F9FA] hover:bg-[#E1E2E3] inline-flex items-center gap-1"
            onClick={() => onFileClick?.(file)}
          >
            <SvgIcon className="flex-none" name="corner-down-right" />
            {file.icon && <img src={file.icon} className="size-3" alt="" />}
            <p className="text-sm truncate">{file.name}</p>
          </div>
        ))}
      </div>
    );
  }

  return null;
};

export default SpecifiedFiles;
