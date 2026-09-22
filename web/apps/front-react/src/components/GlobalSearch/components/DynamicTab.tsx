import { useCallback } from "react";
import { Spin, Empty } from "antd";
import { getPublicPath } from "@/utils/config";
import { getSimpleDateFormatString } from "@km/shared-utils";
import { t } from "@/locales";
import { buildWikiPageUrl, navigate as routerNavigate } from "@/utils/router";
import type { WikiSearchResultItem } from "@/api/modules/global-search/types";
import { useDynamicSearch } from "../hooks/useDynamicSearch";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { sanitizeSearchContent } from "../utils/transform";
import { SvgIcon } from "@km/shared-components-react";
import type { FilterParams } from "../types";

interface DynamicTabProps {
  searchQuery: string;
  filterParams: FilterParams;
  onCloseModal: () => void;
}

const highlightText = (text: string, query: string): string => {
  if (!query) return text;
  const regex = new RegExp(
    `(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`,
    "gi",
  );
  return text.replace(regex, '<span style="color:#2563EB">$1</span>');
};

/** 动态知识（wiki 搜索结果）行 */
function DynamicRow({
  page,
  query,
  onClick,
}: {
  page: WikiSearchResultItem;
  query: string;
  onClick: () => void;
}) {
  const title = page.title || "";
  const highlighted = query ? highlightText(title, query) : title;
  const summary = page.summary || "";
  const contentHighlight = sanitizeSearchContent(page.content_highlight);
  const categoryName = page.categories?.[0]?.name || t("global_search.other");
  const meta = `${page.space_name || ""} · ${categoryName} · ${t("wiki.last_updated_label")}${getSimpleDateFormatString({ date: page.updated_time })}`;

  const titleNode = <div
      className="text-sm text-main truncate"
      dangerouslySetInnerHTML={{ __html: highlighted }}
    />;

  return (
    <div
      className="p-3 rounded-lg flex items-center gap-2 cursor-pointer hover:bg-[#F5F6F7] transition-colors duration-150 group"
      onClick={onClick}
    >
      <div className="flex-1 min-w-0">
        {titleNode}
        {summary && (
          <div className="text-xs text-[#6B7280] line-clamp-2 mt-1">{summary}</div>
        )}
        {contentHighlight && (
          <div
            className="text-xs text-[#6B7280] line-clamp-2 mt-1"
            dangerouslySetInnerHTML={{ __html: contentHighlight }}
          />
        )}
        <div className="text-xs text-[#9CA3AF] mt-2">{meta}</div>
      </div>
      <span className="w-4 h-4 text-[#9CA3AF] opacity-0 group-hover:opacity-100 mt-0.5 flex-shrink-0">
        <SvgIcon name="corner-down-left" />
      </span>
    </div>
  );
}

export function DynamicTab({ searchQuery, filterParams, onCloseModal }: DynamicTabProps) {
  const { results, total, loading, loadingMore, hasMore, loadMore, mode, setMode, isSearchMode } =
    useDynamicSearch(searchQuery, filterParams);

  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loadingMore,
    onLoadMore: loadMore,
    threshold: 100,
  });

  const handleSelect = useCallback(
    (page: WikiSearchResultItem) => {
      // 带 space_id 跳转到 wiki 详情（WikiView 依赖 URL space_id 切换空间）
      routerNavigate(buildWikiPageUrl(page.space_id, page.slug));
      onCloseModal();
    },
    [onCloseModal],
  );

  const query = searchQuery.trim();

  return (
    <div className="h-full flex flex-col">
      {/* 子标签：最近访问 / 最近更新（仅最近模式显示，与「知识文档」一致） */}
      {!isSearchMode && (
        <div className="flex gap-[10px] mt-5 mb-2 flex-shrink-0">
          <button
            className={`w-20 h-8 flex-center text-sm rounded-md transition-colors ${mode === "recent_access" ? "bg-[#EBF1FF] text-[#2563EB]" : "text-secondary hover:bg-[#F2F3F5]"}`}
            onClick={() => setMode("recent_access")}
          >
            {t("common.recently_visit")}
          </button>
          <button
            className={`w-20 h-8 flex-center text-sm rounded-md transition-colors ${mode === "recent_update" ? "bg-[#EBF1FF] text-[#2563EB]" : "text-secondary hover:bg-[#F2F3F5]"}`}
            onClick={() => setMode("recent_update")}
          >
            {t("common.recently_updated")}
          </button>
        </div>
      )}

      {/* 加载中（搜索 / 最近） */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Spin size="small" />
        </div>
      ) : results.length === 0 ? (
        <div className="flex-1 flex-center">
          <Empty
            description={
              query ? (
                <>
                  <div className="text-primary">{t("global_search.no_search_result")}</div>
                  <div className="text-xs">{t("global_search.try_modify_keywords")}</div>
                </>
              ) : (
                <div className="text-primary">{t("common.no_data")}</div>
              )
            }
            image={getPublicPath("/images/chat/completion_empty.png")}
          />
        </div>
      ) : (
        <>
          {query && <div className="h-9 px-2 flex items-center text-sm text-secondary flex-shrink-0">
            {t("global_search.related_dynamic_knowledge")}
          </div>}
          {results.map((page) => (
            <DynamicRow
              key={page.page_id}
              page={page}
              query={query}
              onClick={() => handleSelect(page)}
            />
          ))}

          {/* 加载更多 sentinel */}
          {hasMore && (
            <div ref={sentinelRef} className="flex justify-center py-4">
              {loadingMore && <Spin size="small" />}
            </div>
          )}

          {/* 底部提示 */}
          {!loadingMore && !hasMore && (
            <div className="w-full h-8 py-6 flex-center text-sm text-secondary">
              {t("global_search.all_results_shown")}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DynamicTab;