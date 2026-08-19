import React, { lazy, Suspense, useCallback, useEffect, useState, useMemo } from "react";
import { Spin, message } from "antd";
import { useSpaceStore } from "@/stores/modules/space";
import { useUserStore } from "@/stores/modules/user";
import { useShortcutsStore } from "@/stores/modules/shortcuts";
import { transformWikiInlineMarkup } from "../utils/wiki-markup";
import wikiApi from "@/api/modules/wiki";
import type { WikiIndexResponse } from "@/api/modules/wiki";
import { useNavigate } from "react-router-dom";
import { SvgIcon } from "@km/shared-components-react";
import { MoreDropdown, MenuItem } from "@/components/MoreDropdown";
import { IconButton } from "@/components/IconButton";
import { FullscreenToggle } from "@/components/FullscreenToggle";
import { useFullscreen } from "@/hooks/useFullscreen";
import { copyToClip } from "@km/shared-utils";
import { buildUrl, buildWikiPageUrl } from "@/utils/router";
import { RESOURCE_TYPE } from "@/components/KMPermission/constant";
import { t } from "@/locales";
import WikiFav from "./components/fav";
import EmptyView from "./EmptyView";

// Lazy load markdown 渲染组件
const ChunkView = lazy(() =>
  import("@/components/Markdown").then((m) => ({ default: m.ChunkView })),
);

/**
 * 索引视图：直接请求 wiki index 接口并渲染 index_markdown
 *
 * 收藏/快捷方式维度：当前实现以 **空间本身** 为粒度收藏和加入快捷方式
 * （区别于具体 wiki_page）。详见《空间收藏与快捷方式-前端对接指南》：
 * - 收藏 resource_type = RESOURCE_TYPE.favorite_space (4)
 * - 快捷方式 type = "space"
 */
const IndexView: React.FC = () => {
  const navigate = useNavigate();
  const spaceId = useSpaceStore((state) => state.spaceId);
  const userStore = useUserStore();
  const shortcutsStore = useShortcutsStore();
  const { fullscreen, toggle: toggleFullscreen, composeClassName } = useFullscreen();
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

  // 分享：复制当前 wiki 索引页 URL（带上 eid）
  const handleShare = useCallback(() => {
    const url = buildUrl("/knowledge/wiki", {
      space_id: spaceId || "",
      sub: "index",
      eid: userStore.info?.eid,
    });
    copyToClip(url).then(() => {
      message.success(t("common.copied") + t("action.share") + t("common.link"));
    });
  }, [spaceId, userStore.info?.eid]);

  // 当前空间是否已添加为快捷方式
  const isShortcut = useMemo(() => {
    if (!spaceId) return false;
    return shortcutsStore.isShortcut("space_wiki", spaceId);
  }, [spaceId, shortcutsStore]);

  // 更多菜单回调（添加/移除空间快捷方式）
  const handleMore = useCallback(
    async (command: string) => {
      if (!spaceId) return;
      try {
        if (command === "add-shortcut") {
          await shortcutsStore.addShortcut("space_wiki", spaceId);
        } else if (command === "remove-shortcut") {
          await shortcutsStore.removeShortcut("space_wiki", spaceId);
        }
      } catch {
        message.error(t("action.remove_failed"));
      }
    },
    [spaceId, shortcutsStore],
  );

  const moreItems: MenuItem[] = useMemo(() => {
    return [
      {
        key: isShortcut ? "remove-shortcut" : "add-shortcut",
        label: isShortcut ? t("shortcut.remove") : t("shortcut.add"),
        icon: isShortcut ? "delete-mode" : "add-mode",
      },
    ];
  }, [isShortcut]);

  // 登录用户进入页面时拉一次快捷方式列表，用于初始化 isShortcut
  useEffect(() => {
    if (userStore.is_login) {
      shortcutsStore.loadShortcuts();
    }
  }, [userStore.is_login]);

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
    <div className={composeClassName("flex h-full relative")}>
      <div className="flex-1 flex flex-col min-w-0 px-8 pt-5 overflow-hidden">
        {/* 顶部标题栏：标题 + 右上角分享 / 收藏 / 更多 */}
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-2xl font-medium text-main m-0">
            {t("wiki.page_type.index")}
          </h1>
          <div className="flex items-center gap-1">
            <IconButton
              title={t("action.share")}
              size="medium"
              onClick={handleShare}
            >
              <SvgIcon name="share-two" />
            </IconButton>
            {/* 空间维度收藏：resource_type=4 */}
            <WikiFav
              resource_id={spaceId || undefined}
              resource_type={RESOURCE_TYPE.favorite_space}
            />
            <FullscreenToggle
              fullscreen={fullscreen}
              onToggle={toggleFullscreen}
            />
            <MoreDropdown onCommand={handleMore} items={moreItems} />
          </div>
        </div>

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
