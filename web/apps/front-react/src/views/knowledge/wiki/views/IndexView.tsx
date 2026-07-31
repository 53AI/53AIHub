import React, { lazy, Suspense, useCallback, useEffect, useState, useMemo } from "react";
import { Spin } from "antd";
import { useSpaceStore } from "@/stores/modules/space";
import { transformWikiInlineMarkup } from "../utils/wiki-markup";
import wikiApi from "@/api/modules/wiki";
import type { WikiIndexResponse } from "@/api/modules/wiki";
import { useNavigate } from "react-router-dom";
import { buildWikiPageUrl } from "@/utils/router";
import { t } from "@/locales";
import EmptyView from "./EmptyView";

// Lazy load markdown 渲染组件
const ChunkView = lazy(() =>
  import("@/components/Markdown").then((m) => ({ default: m.ChunkView })),
);

/**
 * 索引视图：直接请求 wiki index 接口并渲染 index_markdown
 */
const IndexView: React.FC = () => {
  const navigate = useNavigate();
  const spaceId = useSpaceStore((state) => state.spaceId);
  const [data, setData] = useState<WikiIndexResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 组件挂载时请求索引数据
  useEffect(() => {
    if (!spaceId) return;
    setLoading(true);
    setError(null);
    wikiApi
      .index(spaceId)
      .then((res) => {
        setData(res);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [spaceId]);

  // 构建 wiki 页面链接：保留 space_id，点击后切换到 list tab 并选中对应页面
  const hrefBuilder = useMemo(() => {
    return (slug: string) => buildWikiPageUrl(spaceId || "", slug);
  }, [spaceId]);

  // 转换 wiki markup 为标准 markdown
  const transformedContent = useMemo(() => {
    if (!data?.index_markdown) return "";
    return transformWikiInlineMarkup(data.index_markdown, hrefBuilder);
  }, [data?.index_markdown, hrefBuilder]);

  // Markdown 预览内的链接点击：阻止浏览器整页刷新，改用 SPA 导航
  const handleLinkClick = useCallback(
    (event: MouseEvent, anchor: HTMLAnchorElement) => {
      event.preventDefault();
      navigate(anchor.href);
    },
    [navigate],
  );

  if (loading && !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-red-500">
        {t("status.load_fail")}: {error}
      </div>
    );
  }

  if (!data || !data.index_markdown) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyView type="dynamic" />
      </div>
    );
  }

  return (
    <div className="flex h-full relative">
      <div className="flex-1 flex flex-col min-w-0 px-8 pt-5 overflow-hidden">
        <h1 className="text-2xl font-medium text-main">{t("wiki.page_type.index")}</h1>


        {/* Markdown 内容 */}
        <div className="flex-1 min-h-0 -mr-6">
          <Suspense
            fallback={
              <div className="flex justify-center">
                <Spin />
              </div>
            }
          >
            <ChunkView
              content={transformedContent}
              showDisplayMode={false}
              showOutline={true}
              outlinePosition="relative"
              outlineSide="right"
              outlineMode="simple"
              defaultOutlineVisible={true}
              contentClass=""
              enableTextSelection
              onLinkClick={handleLinkClick}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default IndexView;