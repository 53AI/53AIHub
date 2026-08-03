import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Spin, Empty, Tooltip } from "antd";
import { getPublicPath, api_host } from "@/utils/config";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import type { GlobalSearchSpace, GlobalSearchLibrary } from "@/api/modules/global-search/types";
import type { GlobalSearchFile } from "../hooks/useGlobalSearch";
import { SvgIcon } from '@km/shared-components-react';

interface KnowledgeTabProps {
  searchQuery: string;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  itemRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  onSelectItem: (item: GlobalSearchFile) => void;
  onCloseModal: () => void;
  // 统一数据（由 hook 根据模式自动切换）
  mode: "recent_access" | "recent_update";
  onModeChange: (mode: "recent_access" | "recent_update") => void;
  spaces: GlobalSearchSpace[];
  libraries: GlobalSearchLibrary[];
  files: GlobalSearchFile[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  // 搜索模式相关
  isSearchMode: boolean;
  searchTotal: number;
  searchLoading: boolean;
}

const DEFAULT_AGENT_IMG = "/images/default_agent.png";

const getIconUrl = (icon?: string): string => {
  if (!icon) return getPublicPath("/images/file-default.png");
  if (icon.startsWith("https://") || icon.startsWith("http://")) return icon;
  return `${api_host}${icon.startsWith("/") ? "" : "/"}${icon}`;
};

const handleIconError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  const target = e.currentTarget;
  const fallback = getPublicPath(DEFAULT_AGENT_IMG);
  if (target.src.endsWith(fallback)) return;
  target.src = fallback;
};

const highlightText = (text: string, query: string): string => {
  if (!query) return text;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return text.replace(regex, '<span class="text-blue-600">$1</span>');
};

/** Chip 标签（空间 & 知识库卡片） */
function ChipLabel({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-1.5 rounded border border-[#E5E6EB] bg-white cursor-pointer hover:bg-[#F5F6F7] transition-colors"
      onClick={onClick}
    >
      <img src={icon} className="size-4 flex-shrink-0" alt="" onError={handleIconError} />
      <span className="text-sm text-[#1D1E1F] whitespace-nowrap">{label}</span>
    </div>
  );
}

/** 文档行组件 */
function DocumentRow({
  icon,
  name,
  subtitle,
  query,
  onClick,
  onMouseEnter,
  itemRef,
}: {
  icon: string;
  name: string;
  subtitle?: string;
  query?: string;
  onClick?: () => void;
  onMouseEnter?: () => void;
  itemRef?: (el: HTMLDivElement) => void;
}) {
  const highlighted = query ? highlightText(name, query) : undefined;

  const row = (
    <div
      ref={itemRef}
      className="px-2 py-[10px] rounded-xl cursor-pointer transition-colors duration-150 hover:bg-[#F5F6F7] group"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0">
          <img className="size-5" src={icon} alt="" onError={handleIconError} />
        </div>
        <div className="flex-1 min-w-0">
          {highlighted ? (
            <div
              className="text-sm truncate"
              dangerouslySetInnerHTML={{ __html: highlighted }}
            />
          ) : (
            <div className="text-sm truncate">{name}</div>
          )}
          {subtitle && (
            <div className="text-xs text-secondary mt-1">{subtitle}</div>
          )}
        </div>
      </div>
    </div>
  );

  if (highlighted) {
    return (
      <Tooltip title={name} placement="topLeft" mouseEnterDelay={0.5}>
        {row}
      </Tooltip>
    );
  }
  return row;
}

export function KnowledgeTab({
  searchQuery,
  selectedIndex,
  onSelectedIndexChange,
  itemRefs,
  scrollContainerRef,
  onSelectItem,
  onCloseModal,
  mode,
  onModeChange,
  spaces,
  libraries,
  files,
  loading,
  loadingMore,
  hasMore,
  onLoadMore,
  isSearchMode,
  searchTotal,
  searchLoading,
}: KnowledgeTabProps) {
  const navigate = useNavigate();

  // 使用 useInfiniteScroll hook 处理滚动加载
  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loadingMore,
    onLoadMore,
    threshold: 100,
  });

  // 处理空间点击
  const handleSpaceClick = useCallback(
    (space: GlobalSearchSpace) => {
      navigate(`/knowledge?space_id=${space.id}`);
      onCloseModal();
    },
    [navigate, onCloseModal],
  );

  // 处理知识库点击
  const handleLibraryClick = useCallback(
    (library: GlobalSearchLibrary) => {
      navigate(`/library/${library.id}`);
      onCloseModal();
    },
    [navigate, onCloseModal],
  );

  // 空间和知识库只展示前5个
  const displaySpaces = useMemo(() => spaces.slice(0, 5), [spaces]);
  const displayLibraries = useMemo(() => libraries.slice(0, 5), [libraries]);

  return (
    <div className="h-full flex flex-col">
      {/* 子标签（仅最近模式显示） */}
      {!isSearchMode && (
        <div className="flex gap-[10px] mt-5 mb-2">
          <button
            className={`w-20 h-8 flex-center text-sm rounded-md transition-colors ${mode === "recent_access" ? "bg-[#EBF1FF] text-[#2563EB]" : "text-secondary hover:bg-[#F2F3F5]"}`}
            onClick={() => onModeChange("recent_access")}
          >
            最近访问
          </button>
          <button
            className={`w-20 h-8 flex-center text-sm rounded-md transition-colors ${mode === "recent_update" ? "bg-[#EBF1FF] text-[#2563EB]" : "text-secondary hover:bg-[#F2F3F5]"}`}
            onClick={() => onModeChange("recent_update")}
          >
            最近更新
          </button>
        </div>
      )}

      {/* 搜索中 */}
      {searchLoading && isSearchMode && (
        <div className="flex items-center justify-center py-8">
          <Spin size="small" />
        </div>
      )}

      {/* 加载中（最近访问/更新） */}
      {loading && !isSearchMode && (
        <div className="flex items-center justify-center py-8">
          <Spin size="small" />
        </div>
      )}

      {/* 内容区域 */}
      {!searchLoading && !loading && (
        <>
          {/* 知识空间 */}
          {displaySpaces.length > 0 && (
            <div className={`mb-2 ${isSearchMode ? 'mt-5' : ''}`}>
              <div className="h-9 px-2 flex items-center text-sm text-secondary">
                {isSearchMode ? "相关知识空间" : "知识空间"}
              </div>
              {isSearchMode ? (
                // 搜索模式：使用 DocumentRow
                displaySpaces.map((space) => (
                  <DocumentRow
                    key={space.id}
                    icon={getIconUrl(space.icon)}
                    name={space.name}
                    query={searchQuery}
                    onClick={() => handleSpaceClick(space)}
                  />
                ))
              ) : (
                // 最近模式：使用 ChipLabel
                <div className="flex flex-wrap gap-2 px-2">
                  {displaySpaces.map((space) => (
                    <ChipLabel
                      key={space.id}
                      icon={getIconUrl(space.icon)}
                      label={space.name}
                      onClick={() => handleSpaceClick(space)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 知识库 */}
          {displayLibraries.length > 0 && (
            <div className="mb-2">
              <div className="h-9 px-2 flex items-center text-sm text-secondary">
                {isSearchMode ? "相关知识库" : "知识库"}
              </div>
              {isSearchMode ? (
                // 搜索模式：使用 DocumentRow
                displayLibraries.map((library) => (
                  <DocumentRow
                    key={library.id}
                    icon={getIconUrl(library.icon)}
                    name={library.name}
                    query={searchQuery}
                    onClick={() => handleLibraryClick(library)}
                  />
                ))
              ) : (
                // 最近模式：使用 ChipLabel
                <div className="flex flex-wrap gap-2 px-2">
                  {displayLibraries.map((library) => (
                    <ChipLabel
                      key={library.id}
                      icon={getIconUrl(library.icon)}
                      label={library.name}
                      onClick={() => handleLibraryClick(library)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 知识文档 */}
          {files.length > 0 && (
            <div className="mb-2">
              <div className="h-9 px-2 flex items-center text-sm text-secondary">
                {isSearchMode ? "相关文档" : "知识文档"}
              </div>
              {files.map((file, index) => (
                <DocumentRow
                  key={file.file_id}
                  icon={file.icon}
                  name={file.name}
                  query={isSearchMode ? searchQuery : undefined}
                  subtitle={`${file.location} · 最近更新: ${file.lastUpdated} · ${file.creator_name}创建`}
                  onClick={() => onSelectItem(file)}
                  onMouseEnter={() => onSelectedIndexChange(index)}
                  itemRef={(el) => {
                    if (el) itemRefs.current.set(index, el);
                  }}
                />
              ))}
            </div>
          )}

          {/* 加载更多 sentinel */}
          {hasMore && !loading && files.length > 0 && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && <Spin size="small" />}
            </div>
          )}

          {/* 底部提示 */}
          {!loadingMore && files.length > 0 && !hasMore && (
            <div className="w-full h-8 py-6 flex-center text-sm text-secondary">
              已显示所有结果
            </div>
            )
          }

          {/* 空状态 */}
          {!loading && !searchLoading && displaySpaces.length === 0 && displayLibraries.length === 0 && files.length === 0 && (
            <div className="flex-1 flex-center">
              <Empty
                description={isSearchMode ? (
                  <>
                    <div className="text-primary">没有搜索结果</div>
                    <div className="text-xs">尝试修改关键词进行搜索</div>
                  </>
                ) : "暂无数据"}
                image={getPublicPath("/images/chat/completion_empty.png")}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default KnowledgeTab;