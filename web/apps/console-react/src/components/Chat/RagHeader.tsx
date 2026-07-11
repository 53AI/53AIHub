import React from "react";
import { SvgIcon } from "@km/shared-components-react";

interface RagHeaderProps {
  ragStats?: any;
  loading?: boolean;
  ragSearchText?: string;
  specifiedContent?: string;
  showLibraryCount?: boolean;
  onOpenKnow?: () => void;
}

export const RagHeader: React.FC<RagHeaderProps> = ({
  ragStats,
  loading,
  ragSearchText,
  specifiedContent,
  showLibraryCount = true,
  onOpenKnow,
}) => {
  const handleOpenKnow = () => {
    if (!showLibraryCount) return;
    onOpenKnow?.();
  };

  // RAG统计显示
  if (ragStats) {
    if (ragStats.type === "web_search") {
      return (
        <div
          className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3"
          onClick={handleOpenKnow}
        >
          <p className="text-sm text-primary">
            搜索到{ragStats.files_search?.length || 0}篇网络资料
          </p>
          <SvgIcon name="arrow-right" className="text-hint" />
        </div>
      );
    }
    return (
      <div
        className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3"
        onClick={handleOpenKnow}
      >
        <p className="text-sm text-primary">
          {showLibraryCount ? (
            <>
              搜索到{ragStats.library_search?.length || 0}个知识库
              {ragStats.files_search?.length || 0}篇资料
            </>
          ) : (
            "已完成对文档的搜索"
          )}
        </p>
        {showLibraryCount && (
          <SvgIcon name="arrow-right" className="text-hint" />
        )}
      </div>
    );
  }

  // 搜索中提示
  if (loading && ragSearchText) {
    return (
      <div className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3">
        <p className="flex-1 text-sm text-primary truncate">
          {ragSearchText}
        </p>
      </div>
    );
  }

  // 指定内容提示
  if (specifiedContent) {
    return (
      <div className="h-8 px-2 rounded-lg cursor-pointer bg-[#F4F5F7] hover:bg-[#E1E2E3] inline-flex items-center mb-3">
        <p className="flex-1 text-sm text-primary truncate">已分析指定知识</p>
      </div>
    );
  }

  return null;
};

export default RagHeader;
