import React, { useEffect, useState, useCallback } from "react";
import { Spin } from "antd";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSpaceStore } from "@/stores/modules/space";
import wikiApi from "@/api/modules/wiki";
import type { WikiLogItem } from "@/api/modules/wiki";
import { getFormatTimeStamp } from "@km/shared-utils";
import { useInfiniteScroll } from "@/hooks";
import { t } from "@/locales";
import { OverflowTooltip } from "@km/shared-components-react";
import EmptyView from "./EmptyView";

const PAGE_SIZE = 20;

/**
 * 日志视图：支持滚动加载
 */
const LogsView: React.FC = () => {
  const navigate = useNavigate();
  const spaceId = useSpaceStore((state) => state.spaceId);
  const [items, setItems] = useState<WikiLogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = items.length < total;

  // 加载初始数据
  useEffect(() => {
    if (!spaceId) return;

    setLoading(true);
    setError(null);
    wikiApi
      .logs(spaceId, { offset: 0, limit: PAGE_SIZE })
      .then((res) => {
        setItems(res.entries ?? []);
        setTotal(res.total ?? 0);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [spaceId]);

  // 加载更多数据
  const handleLoadMore = useCallback(async () => {
    if (!spaceId || loadingMore || !hasMore) return;

    setLoadingMore(true);
    try {
      const res = await wikiApi.logs(spaceId, {
        offset: items.length,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...(res.entries ?? [])]);
    } catch (err) {
      console.error("Failed to load more logs:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [spaceId, loadingMore, hasMore, items.length]);

  // 滚动加载
  const { sentinelRef } = useInfiniteScroll({
    hasMore,
    loadingMore,
    onLoadMore: handleLoadMore,
  });

  return (
    <div className="flex h-full relative">
      <div className="flex-1 overflow-y-auto px-8 pt-5">
        <h1 className="text-2xl font-medium text-main">{t("logs.title")}</h1>
        <div className="space-y-4 mt-6">
          {loading && items.length === 0 ? (
            <div className="py-10 flex justify-center">
              <Spin />
            </div>
          ) : error ? (
            <div className="text-center text-sm text-red-500 py-10 border rounded-xl">
              {t("status.load_fail")}: {error}
            </div>
          ) : items.length === 0 ? (
            <div className="h-[60vh] flex items-center justify-center">
              <EmptyView title={t("logs.empty")} description="" />
            </div>
          ) : (
            <>
              {items.map((log, idx) => (
                <LogCard key={log.id ?? idx} log={log} />
              ))}
              {/* 滚动加载哨兵 */}
              <div ref={sentinelRef} className="py-4 flex justify-center">
                {loadingMore && <Spin />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

const LogCard: React.FC<{ log: WikiLogItem }> = ({ log }) => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const action = log.action ?? "";
  const docTitle = log.doc_title ?? "";
  const summary = log.summary ?? "";
  const pagesAffected = log.pages_affected ?? [];

  const timeText = getFormatTimeStamp(new Date(log.created_at).getTime());

  const handlePageClick = (slug: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const params = new URLSearchParams(searchParams.toString());
    params.set("selected", slug);
    navigate(`/knowledge/wiki?${params.toString()}`);
  };

  return (
    <div className="border rounded-xl px-3 py-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start gap-3 mb-3">
        {action && (
          <span className="h-5 flex items-center bg-blue-50 text-theme px-1.5 rounded text-xs">
            {action}
          </span>
        )}
        <OverflowTooltip>
          <h3 className="text-sm text-main flex-1 truncate">{docTitle || action}</h3>
        </OverflowTooltip>
        {timeText && (
          <span className="text-[#9CA3AF] text-xs shrink-0">{timeText}</span>
        )}
      </div>
      {summary && (
        <p className="text-sm text-[#6B7280] my-2.5 leading-relaxed line-clamp-2">{summary}</p>
      )}
      {pagesAffected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2.5">
          {pagesAffected.map((page) => (
            <a
              key={page.slug}
              onClick={(e) => handlePageClick(page.slug, e)}
              title={page.slug}
              className="text-xs text-theme transition-colors cursor-pointer"
            >
              {page.title}
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default LogsView;